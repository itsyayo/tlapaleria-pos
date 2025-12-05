const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM proveedores WHERE activo = TRUE ORDER BY nombre ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

router.post('/nuevo', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  let { nombre } = req.body;
  
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
  }
  
  nombre = nombre.trim();

  try {
    const dup = await pool.query(
      'SELECT 1 FROM proveedores WHERE lower(nombre) = lower($1)', 
      [nombre]
    );

    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `El proveedor "${nombre}" ya existe` });
    }

    const result = await pool.query(
      'INSERT INTO proveedores (nombre) VALUES ($1) RETURNING *', 
      [nombre]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar proveedor' });
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE proveedores SET activo = FALSE WHERE id = $1 RETURNING id', 
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    res.json({ message: 'Proveedor eliminado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar proveedor' });
  }
});

router.put('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  let { nombre, email, telefono } = req.body;

  try {
    const result = await pool.query(
      `UPDATE proveedores 
       SET nombre = COALESCE($1, nombre),
           email = COALESCE($2, email),
           telefono = COALESCE($3, telefono)
       WHERE id = $4 
       RETURNING *`,
      [nombre, email, telefono, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
        return res.status(409).json({ error: 'Ya existe otro proveedor con ese nombre' });
    }
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

module.exports = router;