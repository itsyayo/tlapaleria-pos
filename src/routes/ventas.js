const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.fecha, v.total, v.descuento_total, v.forma_pago, v.estado, v.monto_recibido,
             u.usuario, u.nombre as nombre_vendedor,
             c.nombre as nombre_cliente
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      ORDER BY v.fecha DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener historial de ventas' });
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  const ventaId = req.params.id;
  try {
    const productos = await pool.query(`
      SELECT p.descripcion, dv.cantidad, dv.precio_unitario, (dv.cantidad * dv.precio_unitario) as subtotal, dv.descuento_aplicado
      FROM detalle_venta dv
      JOIN productos p ON p.id = dv.producto_id
      WHERE dv.venta_id = $1
    `, [ventaId]);

    res.json(productos.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener detalle de venta' });
  }
});

router.post('/', isAuthenticated, authorizeRoles('admin', 'ventas'), async (req, res) => {
  const { forma_pago, productos, cliente_id, descuento_total: descuento = 0, monto_recibido } = req.body;
  const usuarioId = req.user.id;

  if (!forma_pago || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'La venta debe contener productos y forma de pago' });
  }

  if (forma_pago === 'Fiado' && !cliente_id) {
    return res.status(400).json({ error: 'Para ventas a pagos es obligatorio seleccionar un Cliente.' });
  }

  const qtyById = new Map();
  for (const item of productos) {
    const pid = Number(item.id);
    const qty = Number(item.cantidad);
    if (!pid || qty <= 0) return res.status(400).json({ error: 'Producto con datos inválidos' });
    
    qtyById.set(pid, (qtyById.get(pid) || 0) + qty);
  }
  const productIds = Array.from(qtyById.keys());

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: prodRows } = await client.query(
      `SELECT id, descripcion, cantidad_stock, precio_venta, activo
       FROM productos
       WHERE id = ANY($1)
       FOR UPDATE`,
      [productIds]
    );

    if (prodRows.length !== productIds.length) {
      throw new Error('Uno o más productos no existen en la base de datos');
    }

    let sumaProductos = 0;
    const itemsProcesados = [];

    for (const p of prodRows) {
      if (!p.activo) throw new Error(`El producto "${p.descripcion}" está inactivo`);
      
      const cantidadSolicitada = qtyById.get(p.id);
      
      // Nota: Si deseas bloquear venta sin stock, descomenta las siguientes líneas:
      /*
      if (p.cantidad_stock < cantidadSolicitada) {
        throw new Error(`Stock insuficiente para "${p.descripcion}". Disponible: ${p.cantidad_stock}`);
      }
      */

      const subtotalItem = p.precio_venta * cantidadSolicitada;
      sumaProductos += subtotalItem;

      itemsProcesados.push({
        id: p.id,
        cantidad: cantidadSolicitada,
        precio: p.precio_venta
      });
    }

    const descuentoValidado = parseFloat(descuento) || 0;
    
    if (descuentoValidado < 0) {
        throw new Error('El descuento no puede ser negativo.');
    }
    if (descuentoValidado > sumaProductos) {
        throw new Error(`El descuento ($${descuentoValidado}) no puede ser mayor al total de productos ($${sumaProductos}).`);
    }

    const totalFinal = Number((sumaProductos - descuentoValidado).toFixed(2));

    const estadoVenta = forma_pago === 'Fiado' ? 'PENDIENTE' : 'PAGADO';
    const saldoPendiente = forma_pago === 'Fiado' ? totalFinal : 0;
    const clienteIdValido = cliente_id || null;

    const resVenta = await client.query(
      `INSERT INTO ventas 
       (fecha, total, descuento_total, forma_pago, usuario_id, cliente_id, estado, saldo_pendiente, monto_recibido)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [totalFinal, descuentoValidado, forma_pago, usuarioId, clienteIdValido, estadoVenta, saldoPendiente, monto_recibido]
    );
    const ventaId = resVenta.rows[0].id;

    if (forma_pago === 'Fiado' && clienteIdValido) {
      await client.query(
        `UPDATE clientes 
         SET saldo_actual = saldo_actual + $1 
         WHERE id = $2`,
        [totalFinal, clienteIdValido]
      );
    }

    const dIds = itemsProcesados.map(i => i.id);
    const dCants = itemsProcesados.map(i => i.cantidad);
    const dPrecios = itemsProcesados.map(i => i.precio);

    await client.query(
      `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, descuento_aplicado)
       SELECT $1, unnest($2::int[]), unnest($3::numeric[]), unnest($4::numeric[]), unnest($5::numeric[])`,
      [ventaId, dIds, dCants, dPrecios, Array(dIds.length).fill(0)]
    );

    await client.query(
      `UPDATE productos p
       SET cantidad_stock = p.cantidad_stock - d.cant
       FROM (SELECT unnest($1::int[]) as id, unnest($2::numeric[]) as cant) as d
       WHERE p.id = d.id`,
      [dIds, dCants]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      venta_id: ventaId,
      subtotal: sumaProductos,
      descuento: descuentoValidado,
      total: totalFinal,
      forma_pago,
      estado: estadoVenta,
      items_count: itemsProcesados.length
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en Transacción de Venta:', err);
    
    const status = (err.message.includes('Stock') || err.message.includes('descuento') || err.message.includes('inactivo')) ? 409 : 500;
    res.status(status).json({ error: err.message || 'Error al procesar la venta' });
  } finally {
    client.release();
  }
});

module.exports = router;