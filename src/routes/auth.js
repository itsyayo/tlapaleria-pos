const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

router.post('/login', async (req, res) => {
  const { usuario, contraseña } = req.body;

  if (!usuario || !contraseña) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);
    const user = result.rows[0];
    const valid = user 
      ? await bcrypt.compare(contraseña, user.contraseña) 
      : false;

    if (!valid) {return res.status(401).json({ error: 'Credenciales inválidas' });}

    const token = jwt.sign(
      { id: user.id, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        rol: user.rol
      }
    });

  } catch (err) {
    console.error('Error en POST /login:', err); 
    res.status(500).json({ error: 'Error interno del servidor, intente más tarde' });
  }
});

module.exports = router;