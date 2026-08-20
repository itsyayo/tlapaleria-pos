const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

async function calcularLineasYTotal(client, productosPayload) {
  if (!Array.isArray(productosPayload) || productosPayload.length === 0) {
    return { lineas: [], total: 0 };
  }

  const ids = productosPayload.map(p => p.id || p.producto_id);

  const { rows: productos } = await client.query(
    `SELECT id, descripcion, precio_venta, cantidad_stock
     FROM productos WHERE id = ANY($1)`, [ids]
  );

  const byId = new Map(productos.map(p => [p.id, p]));
  
  const lineas = productosPayload.map(p => {
    const prod = byId.get(p.id || p.producto_id);
    if (!prod) throw new Error(`Producto ID ${p.id || p.producto_id} no encontrado o inactivo`);
    
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

router.post('/', isAuthenticated, authorizeRoles('ventas', 'admin', 'inventario'), async (req, res) => {
  const { 
    cliente_nombre,
    subtotal, 
    descuento_total, 
    total, 
    productos 
  } = req.body;
  
  const usuarioId = req.user.id;

  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'La cotización debe contener productos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resCot = await client.query(
      `INSERT INTO cotizaciones (cliente, subtotal, descuento_total, total, usuario_id, estado, fecha)
       VALUES ($1, $2, $3, $4, $5, 'borrador', NOW())
       RETURNING id, fecha`,
      [cliente_nombre || 'Público General', subtotal || total, descuento_total || 0, total, usuarioId]
    );

    const cotizacionId = resCot.rows[0].id;

    const prodIds = productos.map(p => p.producto_id);
    const descs = productos.map(p => p.descripcion);
    const cantidades = productos.map(p => p.cantidad);
    const preciosUnitarios = productos.map(p => p.precio_unitario);
    
    const preciosOriginales = productos.map(p => p.precio_original || p.precio_unitario);
    const preciosCompras = productos.map(p => p.precio_compra || 0);
    const niveles = productos.map(p => p.nivel_aplicado || 1);
    const descuentos = productos.map(p => p.descuento_aplicado || 0);
    const subtotales = productos.map(p => p.subtotal);

    await client.query(
      `INSERT INTO cotizaciones_detalle 
       (cotizacion_id, producto_id, descripcion, cantidad, precio_unitario, precio_original, precio_compra, nivel_aplicado, descuento_aplicado, subtotal)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::numeric[]), 
              unnest($6::numeric[]), unnest($7::numeric[]), unnest($8::int[]), unnest($9::numeric[]), unnest($10::numeric[])`,
      [cotizacionId, prodIds, descs, cantidades, preciosUnitarios, preciosOriginales, preciosCompras, niveles, descuentos, subtotales]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, id: cotizacionId, total });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error al guardar cotización:', e);
    return res.status(500).json({ error: 'Error interno al guardar la cotización' });
  } finally {
    client.release();
  }
});


router.get('/', isAuthenticated, authorizeRoles('ventas', 'admin', 'inventario'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.fecha, c.cliente, c.forma_pago, c.subtotal, c.descuento_total, c.total, c.estado,
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


router.get('/:id', isAuthenticated, authorizeRoles('ventas', 'admin', 'inventario'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const { rows: encabezadoRows } = await pool.query(
      `SELECT c.id, c.fecha, c.cliente, c.forma_pago, c.subtotal, c.descuento_total, c.total, c.estado, u.nombre AS vendedor
       FROM cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.id = $1`, [id]
    );
    
    if (encabezadoRows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });

    const { rows: detalleRows } = await pool.query(
      `SELECT d.producto_id AS id, d.descripcion, d.precio_unitario, d.cantidad, d.subtotal,
              d.precio_original, d.precio_compra, d.nivel_aplicado, d.descuento_aplicado,
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



router.put('/:id', isAuthenticated, authorizeRoles('ventas', 'admin', 'inventario'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { cliente_nombre, cliente, subtotal, descuento_total, total, productos } = req.body;
  const clienteFinal = cliente_nombre || cliente || 'Público General';

  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'La cotización debe contener productos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE cotizaciones 
       SET cliente = $1, subtotal = $2, descuento_total = $3, total = $4 
       WHERE id = $5 RETURNING id`,
      [clienteFinal, subtotal || total, descuento_total || 0, total, id]
    );

    if (updateRes.rowCount === 0) {
      throw new Error("Cotización no encontrada");
    }

    await client.query(`DELETE FROM cotizaciones_detalle WHERE cotizacion_id = $1`, [id]);

    const prodIds = productos.map(p => p.producto_id || p.id);
    const descs = productos.map(p => p.descripcion);
    const cantidades = productos.map(p => p.cantidad);
    const preciosUnitarios = productos.map(p => p.precio_unitario);
    const preciosOriginales = productos.map(p => p.precio_original || p.precio_venta || p.precio_unitario);
    const preciosCompras = productos.map(p => p.precio_compra || 0);
    const niveles = productos.map(p => p.nivel_aplicado || p.nivelSeleccionado || 1);
    const descuentos = productos.map(p => p.descuento_aplicado || 0);
    const subtotales = productos.map(p => p.subtotal);

    await client.query(
      `INSERT INTO cotizaciones_detalle 
       (cotizacion_id, producto_id, descripcion, cantidad, precio_unitario, precio_original, precio_compra, nivel_aplicado, descuento_aplicado, subtotal)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::numeric[]), 
              unnest($6::numeric[]), unnest($7::numeric[]), unnest($8::int[]), unnest($9::numeric[]), unnest($10::numeric[])`,
      [id, prodIds, descs, cantidades, preciosUnitarios, preciosOriginales, preciosCompras, niveles, descuentos, subtotales]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, id, total, message: 'Cotización actualizada correctamente' });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error al actualizar cotización:', e);
    const status = e.message === "Cotización no encontrada" ? 404 : 400;
    return res.status(status).json({ error: e.message || 'Error al actualizar cotización' });
  } finally {
    client.release();
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('ventas', 'admin', 'inventario'), async (req, res) => {
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