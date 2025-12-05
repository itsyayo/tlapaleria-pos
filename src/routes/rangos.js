const express = require('express');
const pool = require('../db');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

function buildNumRange(min, max) {
  return { 
    text: "numrange($1, $2, '[]')", 
    values: [min, max] 
  };
}

router.get('/', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id,
             lower(rango) AS min,
             CASE WHEN upper_inf(rango) THEN NULL ELSE upper(rango) END AS max,
             porcentaje
      FROM rangos_utilidad
      ORDER BY lower(rango) ASC
    `);

    res.json(rows.map(r => ({
      id: r.id,
      min: Number(r.min),
      max: r.max === null ? 'Infinity' : Number(r.max),
      porcentaje: Number(r.porcentaje)
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener rangos de utilidad' });
  }
});

router.post('/', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  try {
    const { min, max, porcentaje } = req.body;
    
    const parsedMin = parseFloat(min);
    const parsedPct = parseFloat(porcentaje);
    const isInfinite = max === 'Infinity' || max === null || max === '';
    const parsedMax = isInfinite ? null : parseFloat(max);

    if (isNaN(parsedMin) || isNaN(parsedPct)) {
      return res.status(400).json({ error: 'Valores numéricos inválidos' });
    }
    
    if (!isInfinite && parsedMin >= parsedMax) {
      return res.status(400).json({ error: 'El valor mínimo debe ser menor que el máximo' });
    }

    const rangeSql = buildNumRange(parsedMin, parsedMax);
    
    const query = `
      INSERT INTO rangos_utilidad (rango, porcentaje)
      VALUES (${rangeSql.text}, $3) 
      RETURNING id,
                lower(rango) AS min,
                CASE WHEN upper_inf(rango) THEN NULL ELSE upper(rango) END AS max,
                porcentaje
    `;

    const { rows } = await pool.query(query, [...rangeSql.values, parsedPct]);

    const r = rows[0];
    res.status(201).json({
      id: r.id,
      min: Number(r.min),
      max: r.max === null ? 'Infinity' : Number(r.max),
      porcentaje: Number(r.porcentaje)
    });

  } catch (e) {
    if (e.code === '23P01' || String(e.message).includes('rangos_no_solapados')) {
      return res.status(409).json({ error: 'El rango se solapa con otro existente. Ajusta los límites.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Error interno al guardar el rango' });
  }
});

router.put('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { min, max, porcentaje } = req.body;

    const parsedMin = parseFloat(min);
    const parsedPct = parseFloat(porcentaje);
    const isInfinite = max === 'Infinity' || max === null || max === '';
    const parsedMax = isInfinite ? null : parseFloat(max);

    if (isNaN(parsedMin) || isNaN(parsedPct)) {
      return res.status(400).json({ error: 'Valores numéricos inválidos' });
    }
    if (!isInfinite && parsedMin >= parsedMax) {
      return res.status(400).json({ error: 'El valor mínimo debe ser menor que el máximo' });
    }

    const rangeSql = buildNumRange(parsedMin, parsedMax);
    
    const query = `
      UPDATE rangos_utilidad
      SET rango = ${rangeSql.text}, porcentaje = $3
      WHERE id = $4
      RETURNING id,
                lower(rango) AS min,
                CASE WHEN upper_inf(rango) THEN NULL ELSE upper(rango) END AS max,
                porcentaje
    `;

    const { rows } = await pool.query(query, [...rangeSql.values, parsedPct, id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rango no encontrado' });
    }

    const r = rows[0];
    res.json({
      id: r.id,
      min: Number(r.min),
      max: r.max === null ? 'Infinity' : Number(r.max),
      porcentaje: Number(r.porcentaje)
    });

  } catch (e) {
    if (e.code === '23P01' || String(e.message).includes('rangos_no_solapados')) {
      return res.status(409).json({ error: 'El nuevo rango choca con otro existente' });
    }
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar el rango' });
  }
});

router.delete('/:id', isAuthenticated, authorizeRoles('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM rangos_utilidad WHERE id = $1 RETURNING id', 
      [req.params.id]
    );
    
    if (rows.length === 0) return res.status(404).json({ error: 'Rango no encontrado' });
    
    res.json({ ok: true, message: 'Rango eliminado correctamente' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al eliminar el rango' });
  }
});

module.exports = router;