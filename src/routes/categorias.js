const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

router.get('/', async (_req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, nombre, activo FROM categorias WHERE activo = TRUE ORDER BY nombre ASC'
    );
    res.json(r.rows);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Error al obtener categorías' }); 
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, nombre, activo FROM categorias WHERE id = $1',
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(r.rows[0]);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Error al buscar categoría' }); 
  }
});

router.post('/', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  let { nombre } = req.body;
  
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  
  nombre = nombre.trim();

  try {
    const dup = await pool.query('SELECT 1 FROM categorias WHERE lower(nombre) = lower($1)', [nombre]);
    if (dup.rows.length) {
      return res.status(409).json({ error: `La categoría "${nombre}" ya existe` });
    }

    const r = await pool.query(
      'INSERT INTO categorias (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Error interno al crear categoría' }); 
  }
});

router.put('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  let { nombre, activo } = req.body;

  try {
    if (nombre) {
      nombre = nombre.trim();
      const dup = await pool.query(
        'SELECT 1 FROM categorias WHERE lower(nombre) = lower($1) AND id <> $2',
        [nombre, id]
      );
      if (dup.rows.length) {
        return res.status(409).json({ error: `Ya existe otra categoría llamada "${nombre}"` });
      }
    }

    const r = await pool.query(
      `UPDATE categorias 
       SET nombre = COALESCE($1, nombre), 
           activo = COALESCE($2, activo) 
       WHERE id = $3 
       RETURNING *`,
      [nombre, activo, id]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(r.rows[0]);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar categoría' }); 
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  try {    
    const r = await pool.query(
      'UPDATE categorias SET activo = FALSE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (!r.rows.length) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría eliminada correctamente' });
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar categoría' }); 
  }
});

module.exports = router;