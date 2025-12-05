const express = require('express');
const router = express.Router();
const pool = require('../db');
const fs = require('fs');
const path = require('path');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

const borrarImagen = (filePath) => {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err) console.error(`Error eliminando imagen huérfana ${filePath}:`, err);
  });
};

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.codigo, p.descripcion, p.ubicacion, p.stock_maximo, p.cantidad_stock,
             p.precio_compra, p.stock_minimo,
             GREATEST(p.stock_maximo - p.cantidad_stock, 0) AS stock_faltante,
             p.precio_venta,
             p.codigo_barras,
             pr.nombre AS nombre_proveedor,
             c.nombre AS nombre_categoria,
             p.imagen, p.activo, p.clave_sat
      FROM productos p
      LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = TRUE
      ORDER BY p.descripcion ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM productos WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el producto' });
  }
});

router.post('/', isAuthenticated, authorizeRoles('admin'), upload.single('imagen'), async (req, res) => {
  const body = req.body;
  const codigo = body.codigo?.trim();
  const descripcion = body.descripcion?.trim();
  const ubicacion = body.ubicacion?.trim() || '';
  const codigo_barras = body.codigo_barras?.trim() || null;
  const clave_sat = body.clave_sat?.trim() || null;
  
  // Convertimos a números seguros (fallback a 0 si es inválido)
  const stock_maximo = Math.trunc(Number(body.stock_maximo) || 0);
  const stock_minimo = Math.trunc(Number(body.stock_minimo) || 0);
  const cantidad_stock = Math.trunc(Number(body.cantidad_stock) || 0);
  const precio_compra = Math.max(0, Number(body.precio_compra) || 0);
  const precio_venta = Math.max(0, Number(body.precio_venta) || 0);
  const proveedor_id = body.proveedor_id ? Number(body.proveedor_id) : null;
  const categoria_id = body.categoria_id ? Number(body.categoria_id) : null;

  if (!codigo) {
    if (req.file) borrarImagen(req.file.path);
    return res.status(400).json({ error: 'El código es obligatorio' });
  }
  if (!descripcion) {
    if (req.file) borrarImagen(req.file.path);
    return res.status(400).json({ error: 'La descripción es obligatoria' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dupCodigo = await client.query('SELECT 1 FROM productos WHERE codigo = $1', [codigo]);
    if (dupCodigo.rowCount > 0) {
      throw new Error(`El código "${codigo}" ya está en uso.`);
    }

    if (codigo_barras) {
      const dupBarras = await client.query('SELECT 1 FROM productos WHERE codigo_barras = $1', [codigo_barras]);
      if (dupBarras.rowCount > 0) {
        throw new Error(`El código de barras "${codigo_barras}" ya está en uso.`);
      }
    }

    const imagenUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const query = `
      INSERT INTO productos
       (codigo, descripcion, ubicacion, stock_maximo, stock_minimo, cantidad_stock,
        precio_compra, precio_venta, proveedor_id, categoria_id, codigo_barras, clave_sat, imagen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *
    `;
    
    const values = [
      codigo, descripcion, ubicacion, stock_maximo, stock_minimo, cantidad_stock,
      precio_compra, precio_venta, proveedor_id, categoria_id, codigo_barras, clave_sat, imagenUrl
    ];

    const result = await client.query(query, values);
    
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);

  } catch (err) {
    await client.query('ROLLBACK');
    if (req.file) borrarImagen(req.file.path);

    const msg = err.message || 'Error al guardar el producto';
    const status = msg.includes('ya está en uso') ? 409 : 500;
    
    console.error('Error POST /productos:', err);
    res.status(status).json({ error: msg });
  } finally {
    client.release();
  }
});

router.put('/:id', isAuthenticated, authorizeRoles('admin'), upload.single('imagen'), async (req, res) => {
  const { id } = req.params;
  const body = req.body;

  const codigo = body.codigo?.trim();
  const descripcion = body.descripcion?.trim();
  const ubicacion = body.ubicacion?.trim() || '';
  const codigo_barras = body.codigo_barras?.trim() || null;
  const clave_sat = body.clave_sat?.trim() || null;
  
  const stock_maximo = Math.trunc(Number(body.stock_maximo) || 0);
  const stock_minimo = Math.trunc(Number(body.stock_minimo) || 0);
  const cantidad_stock = Math.trunc(Number(body.cantidad_stock) || 0);
  const precio_compra = Math.max(0, Number(body.precio_compra) || 0);
  const precio_venta = Math.max(0, Number(body.precio_venta) || 0);
  const proveedor_id = body.proveedor_id ? Number(body.proveedor_id) : null;
  const categoria_id = body.categoria_id ? Number(body.categoria_id) : null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const check = await client.query('SELECT imagen FROM productos WHERE id = $1', [id]);
    if (check.rowCount === 0) {
      if (req.file) borrarImagen(req.file.path);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const imagenAnterior = check.rows[0].imagen;

    if (codigo) {
      const dup = await client.query('SELECT 1 FROM productos WHERE codigo = $1 AND id <> $2', [codigo, id]);
      if (dup.rowCount > 0) throw new Error(`El código "${codigo}" ya está ocupado por otro producto.`);
    }
    if (codigo_barras) {
      const dup = await client.query('SELECT 1 FROM productos WHERE codigo_barras = $1 AND id <> $2', [codigo_barras, id]);
      if (dup.rowCount > 0) throw new Error(`El código de barras "${codigo_barras}" ya está ocupado.`);
    }

    const nuevaImagen = req.file ? `/uploads/${req.file.filename}` : undefined;

    const query = `
      UPDATE productos
      SET 
        codigo = COALESCE($1, codigo),
        descripcion = COALESCE($2, descripcion),
        ubicacion = COALESCE($3, ubicacion),
        stock_maximo = COALESCE($4, stock_maximo),
        stock_minimo = COALESCE($5, stock_minimo),
        cantidad_stock = COALESCE($6, cantidad_stock),
        precio_compra = COALESCE($7, precio_compra),
        precio_venta = COALESCE($8, precio_venta),
        proveedor_id = COALESCE($9, proveedor_id),
        categoria_id = COALESCE($10, categoria_id),
        codigo_barras = COALESCE($11, codigo_barras),
        clave_sat = COALESCE($12, clave_sat),
        imagen = COALESCE($13, imagen)
      WHERE id = $14
      RETURNING *
    `;

    const values = [
      codigo, descripcion, ubicacion, stock_maximo, stock_minimo, cantidad_stock,
      precio_compra, precio_venta, proveedor_id, categoria_id, codigo_barras, clave_sat, 
      nuevaImagen, id
    ];

    const result = await client.query(query, values);

    await client.query('COMMIT');
    res.json(result.rows[0]);

  } catch (err) {
    await client.query('ROLLBACK');
    if (req.file) borrarImagen(req.file.path); // GC
    
    const msg = err.message || 'Error al actualizar producto';
    const status = msg.includes('ya está ocupado') ? 409 : 500;
    
    console.error('Error PUT /productos:', err);
    res.status(status).json({ error: msg });
  } finally {
    client.release();
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE productos SET activo = false WHERE id = $1 RETURNING id', 
      [id]
    );
    
    if (result.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    
    res.json({ message: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

module.exports = router;