const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

const SAFE_COLUMNS = 'id, nombre, usuario, rol, activo, fecha_registro';

router.get('/', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  try {
    const usuarios = await pool.query(`
      SELECT ${SAFE_COLUMNS} 
      FROM usuarios 
      ORDER BY nombre ASC
    `);
    res.json(usuarios.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.get('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const user = await pool.query(
      `SELECT ${SAFE_COLUMNS} FROM usuarios WHERE id = $1`, 
      [id]
    );
    if (user.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar usuario' });
  }
});

router.post('/', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { nombre, usuario, contraseña, rol } = req.body;


  if (!nombre || !usuario || !contraseña || !rol) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  const rolesPermitidos = ['admin', 'ventas', 'inventario'];
  if (!rolesPermitidos.includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido. Permitidos: admin, ventas, inventario' });
  }

  try {
    const existente = await pool.query('SELECT 1 FROM usuarios WHERE usuario = $1', [usuario]);
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
    }

    const hashed = await bcrypt.hash(contraseña, 10);

    await pool.query(
      'INSERT INTO usuarios (nombre, usuario, contraseña, rol) VALUES ($1, $2, $3, $4)',
      [nombre, usuario, hashed, rol]
    );

    res.status(201).json({ message: 'Usuario registrado correctamente' });
  } catch (err) {
    console.error('Error POST /usuarios:', err);
    res.status(500).json({ error: 'Error interno al registrar usuario' });
  }
});

router.put('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const { nombre, usuario, rol, contraseña, activo } = req.body;

  try {
    const check = await pool.query('SELECT id FROM usuarios WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (usuario) {
      const dup = await pool.query('SELECT 1 FROM usuarios WHERE usuario = $1 AND id <> $2', [usuario, id]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'Ese nombre de usuario ya está ocupado' });
    }

    let passwordQueryPart = '';
    const params = [nombre, usuario, rol, activo, id];

    if (contraseña && contraseña.trim() !== '') {
      const hashed = await bcrypt.hash(contraseña, 10);
      params.push(hashed);
      passwordQueryPart = `, contraseña = $6`;
    }

    const query = `
      UPDATE usuarios 
      SET nombre = COALESCE($1, nombre),
          usuario = COALESCE($2, usuario),
          rol = COALESCE($3, rol),
          activo = COALESCE($4, activo)
          ${passwordQueryPart}
      WHERE id = $5 
      RETURNING ${SAFE_COLUMNS}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario mientras estás logueado' });
  }

  try {
    const result = await pool.query(
      'UPDATE usuarios SET activo = FALSE WHERE id = $1 RETURNING id', 
      [id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ message: 'Usuario desactivado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;