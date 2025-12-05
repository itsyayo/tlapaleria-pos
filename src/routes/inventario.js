const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

router.post('/entradas', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { entradas } = req.body || {};
  
  if (!Array.isArray(entradas) || entradas.length === 0) {
    return res.status(400).json({ error: 'La lista de entradas está vacía o es inválida' });
  }

  const client = await pool.connect();

  try {
    const ids = [];
    const cantidades = [];
    const preciosCompra = [];
    const preciosVenta = [];

    for (const item of entradas) {
      const id = parseInt(item.id);
      const cantidad = parseInt(item.cantidad);
      
      if (!id || !cantidad || cantidad <= 0) {
        return res.status(400).json({ 
          error: `Datos inválidos en producto ID ${item.id || '?'}. La cantidad debe ser positiva.` 
        });
      }

      let pCompra = null;
      if (item.precio_compra !== undefined && item.precio_compra !== null) {
        pCompra = parseFloat(item.precio_compra);
        if (isNaN(pCompra) || pCompra < 0) return res.status(400).json({ error: `Precio de compra inválido en ID ${id}` });
        pCompra = pCompra.toFixed(2); // Redondeo
      }

      let pVenta = null;
      if (item.precio_venta !== undefined && item.precio_venta !== null) {
        pVenta = parseFloat(item.precio_venta);
        if (isNaN(pVenta) || pVenta < 0) return res.status(400).json({ error: `Precio de venta inválido en ID ${id}` });
        pVenta = pVenta.toFixed(2); // Redondeo
      }

      ids.push(id);
      cantidades.push(cantidad);
      preciosCompra.push(pCompra);
      preciosVenta.push(pVenta);
    }

    await client.query('BEGIN');

    const query = `
      UPDATE productos p
      SET 
        cantidad_stock = p.cantidad_stock + data.cantidad,
        precio_compra = COALESCE(data.precio_compra, p.precio_compra),
        precio_venta = COALESCE(data.precio_venta, p.precio_venta)
      FROM (
        SELECT 
          unnest($1::int[]) as id, 
          unnest($2::int[]) as cantidad, 
          unnest($3::numeric[]) as precio_compra, 
          unnest($4::numeric[]) as precio_venta
      ) as data
      WHERE p.id = data.id AND p.activo = TRUE
      RETURNING p.id, p.descripcion, p.cantidad_stock, p.precio_compra, p.precio_venta
    `;

    const result = await client.query(query, [ids, cantidades, preciosCompra, preciosVenta]);

    if (result.rowCount !== entradas.length) {
      throw new Error('Uno o más productos no fueron encontrados o están inactivos. Operación cancelada.');
    }

    await client.query('COMMIT');

    res.json({ 
      mensaje: 'Inventario actualizado correctamente',
      total_actualizados: result.rowCount, 
      items: result.rows 
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    
    const statusCode = err.message.includes('Operación cancelada') ? 404 : 500;
    res.status(statusCode).json({ error: err.message || 'Error interno al actualizar inventario' });
  } finally {
    client.release();
  }
});

module.exports = router;