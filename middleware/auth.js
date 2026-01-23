const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      // Guardamos el usuario en la request
      req.user = decoded;

      // Validación de roles (si aplica)
      if (requiredRoles.length > 0) {
        const userRole = (decoded.role || '').toUpperCase();

        if (!requiredRoles.includes(userRole)) {
          return res.status(403).json({ error: 'Acceso denegado por rol' });
        }
      }

      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}

module.exports = auth;
