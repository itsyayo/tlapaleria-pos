const pool = require('../db');

const getDashboardStats = async (req, res) => {
  try {
    const ventasQuery = `
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad 
      FROM ventas 
      WHERE fecha >= DATE_TRUNC('month', CURRENT_DATE)
    `;

    const gananciaQuery = `
      SELECT COALESCE(SUM((dv.precio_unitario - p.precio_compra) * dv.cantidad), 0) as ganancia
      FROM detalle_venta dv
      JOIN productos p ON dv.producto_id = p.id
      JOIN ventas v ON dv.venta_id = v.id
      WHERE v.fecha >= DATE_TRUNC('month', CURRENT_DATE)
    `;

    const topProductosQuery = `
      SELECT p.descripcion, SUM(dv.cantidad) as cantidad
      FROM detalle_venta dv
      JOIN productos p ON dv.producto_id = p.id
      JOIN ventas v ON dv.venta_id = v.id
      WHERE v.fecha >= DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY p.id, p.descripcion
      ORDER BY cantidad DESC
      LIMIT 5
    `;

    const stockBajoQuery = `
      SELECT descripcion, cantidad_stock, stock_minimo 
      FROM productos 
      WHERE cantidad_stock <= stock_minimo 
      LIMIT 5
    `;

    const [ventasRes, gananciaRes, topRes, stockRes] = await Promise.all([
      pool.query(ventasQuery),
      pool.query(gananciaQuery),
      pool.query(topProductosQuery),
      pool.query(stockBajoQuery)
    ]);

    res.json({
      ventasMensuales: {
        dinero: parseFloat(ventasRes.rows[0].total),
        transacciones: parseInt(ventasRes.rows[0].cantidad)
      },
      gananciaMensual: parseFloat(gananciaRes.rows[0].ganancia),
      topProductos: topRes.rows,
      stockBajo: stockRes.rows
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al generar reportes' });
  }
};

module.exports = { getDashboardStats };