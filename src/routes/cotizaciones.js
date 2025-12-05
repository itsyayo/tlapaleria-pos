const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

async function calcularLineasYTotal(client, productosPayload) {
  if (!Array.isArray(productosPayload) || productosPayload.length === 0) {
    return { lineas: [], total: 0 };
  }

  const ids = productosPayload.map(p => p.id);

  const { rows: productos } = await client.query(
    `SELECT id, descripcion, precio_venta, cantidad_stock
     FROM productos WHERE id = ANY($1)`, [ids]
  );

  const byId = new Map(productos.map(p => [p.id, p]));
  
  const lineas = productosPayload.map(p => {
    const prod = byId.get(p.id);
    if (!prod) throw new Error(`Producto ID ${p.id} no encontrado o inactivo`);
    
    const cantidad = Math.max(1, parseInt(p.cantidad || 1));
    const precio = Number(prod.precio_venta);
    
    const subtotal = Number((precio * cantidad).toFixed(2));

    return {
      producto_id: prod.id,
      descripcion: prod.descripcion,
      precio_unitario: precio,
      cantidad,
      subtotal
    };
  });

  const total = Number(lineas.reduce((acc, l) => acc + l.subtotal, 0).toFixed(2));
  return { lineas, total };
}

router.post('/', isAuthenticated, authorizeRoles('ventas', 'admin'), async (req, res) => {
  const { cliente, forma_pago, productos } = req.body;
  const usuarioId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { lineas, total } = await calcularLineasYTotal(client, productos || []);

    if (lineas.length === 0) {
      throw new Error("La cotización debe tener al menos un producto válido");
    }

    const { rows } = await client.query(
      `INSERT INTO cotizaciones (cliente, forma_pago, total, usuario_id)
       VALUES ($1, $2, $3, $4) RETURNING id, fecha`,
      [cliente || 'Público General', forma_pago || 'Efectivo', total, usuarioId]
    );
    const cotizacionId = rows[0].id;

    const prodIds = lineas.map(l => l.producto_id);
    const descs = lineas.map(l => l.descripcion);
    const precios = lineas.map(l => l.precio_unitario);
    const cants = lineas.map(l => l.cantidad);
    const subtotales = lineas.map(l => l.subtotal);

    await client.query(
      `INSERT INTO cotizaciones_detalle 
       (cotizacion_id, producto_id, descripcion, precio_unitario, cantidad, subtotal)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::numeric[]), unnest($5::int[]), unnest($6::numeric[])`,
      [cotizacionId, prodIds, descs, precios, cants, subtotales]
    );

    await client.query('COMMIT');
    return res.json({ cotizacion_id: cotizacionId, total });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    const msg = e.message.includes('Producto ID') ? e.message : 'Error al procesar la cotización';
    return res.status(400).json({ error: msg });
  } finally {
    client.release();
  }
});

router.get('/', isAuthenticated, authorizeRoles('ventas', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.fecha, c.cliente, c.forma_pago, c.total, c.estado,
              u.nombre AS vendedor
       FROM cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       ORDER BY c.fecha DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno al listar cotizaciones' });
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const { rows: encabezadoRows } = await pool.query(
      `SELECT c.id, c.fecha, c.cliente, c.forma_pago, c.total, c.estado, u.nombre AS vendedor
       FROM cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.id = $1`, [id]
    );
    if (encabezadoRows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });

    const { rows: detalleRows } = await pool.query(
      `SELECT d.producto_id AS id, d.descripcion, d.precio_unitario, d.cantidad, d.subtotal,
              p.cantidad_stock
       FROM cotizaciones_detalle d
       LEFT JOIN productos p ON p.id = d.producto_id
       WHERE d.cotizacion_id = $1
       ORDER BY d.id`, [id]
    );

    res.json({ ...encabezadoRows[0], productos: detalleRows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener cotización' });
  }
});

router.put('/:id', isAuthenticated, authorizeRoles('ventas', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { cliente, forma_pago, productos } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { lineas, total } = await calcularLineasYTotal(client, productos || []);
    
    if (lineas.length === 0) throw new Error("La cotización debe tener productos");

    const updateRes = await client.query(
      `UPDATE cotizaciones SET cliente=$1, forma_pago=$2, total=$3 WHERE id=$4 RETURNING id`,
      [cliente || 'Público General', forma_pago, total, id]
    );
    
    if (updateRes.rowCount === 0) {
      throw new Error("Cotización no encontrada");
    }

    await client.query(`DELETE FROM cotizaciones_detalle WHERE cotizacion_id = $1`, [id]);

    const prodIds = lineas.map(l => l.producto_id);
    const descs = lineas.map(l => l.descripcion);
    const precios = lineas.map(l => l.precio_unitario);
    const cants = lineas.map(l => l.cantidad);
    const subtotales = lineas.map(l => l.subtotal);

    await client.query(
      `INSERT INTO cotizaciones_detalle 
       (cotizacion_id, producto_id, descripcion, precio_unitario, cantidad, subtotal)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::numeric[]), unnest($5::int[]), unnest($6::numeric[])`,
      [id, prodIds, descs, precios, cants, subtotales]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, id, total });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    const msg = e.message === "Cotización no encontrada" ? e.message : 'Error al actualizar cotización';
    const status = e.message === "Cotización no encontrada" ? 404 : 400;
    return res.status(status).json({ error: msg });
  } finally {
    client.release();
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('ventas', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const resDel = await pool.query(`DELETE FROM cotizaciones WHERE id = $1`, [id]);
    
    if (resDel.rowCount === 0) return res.status(404).json({ error: 'Cotización no encontrada' });
    
    res.json({ ok: true, message: 'Cotización eliminada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar cotización' });
  }
});

module.exports = router;