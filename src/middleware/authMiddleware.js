const jwt = require('jsonwebtoken');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET no está definido en el archivo .env");
  process.exit(1);
}

function isAuthenticated(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(403).json({ error: 'Tu sesión ha expirado, inicia sesión nuevamente' });
      }
      return res.status(403).json({ error: 'Token inválido o corrupto' });
    }
    
    req.user = user;
    next();
  });
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(500).json({ 
        error: 'Error de servidor: Se intentó verificar rol sin autenticación previa.' 
      });
    }

    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ 
        error: `No tienes permisos suficientes. Se requiere rol: ${roles.join(' o ')}` 
      });
    }
    next();
  };
}

module.exports = {
  isAuthenticated,
  authorizeRoles
};