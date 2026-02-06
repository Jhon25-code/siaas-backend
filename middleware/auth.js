const jwt = require('jsonwebtoken');

// 🔥 La clave debe ser IGUAL a la de index.js
const JWT_SECRET = process.env.JWT_SECRET || 'secret_super_seguro';

function auth(requiredRoles = []) {
  return (req, res, next) => {
    // Node normaliza headers a minúsculas, pero igual lo dejamos robusto
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({ error: 'Token no proporcionado', message: 'Token no proporcionado' });
    }

    const header = authHeader.trim();

    // Debe venir como: Bearer <token>
    if (!header.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado', message: 'Token no proporcionado' });
    }

    const token = header.split(' ')[1];

    if (!token || token.trim().length === 0) {
      return res.status(401).json({ error: 'Token no proporcionado', message: 'Token no proporcionado' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      // Guardamos el usuario en la request
      req.user = decoded;

      // Validación de roles (si aplica)
      if (requiredRoles.length > 0) {
        const userRole = String(decoded.role || '').toUpperCase();
        const requiredRolesUpper = requiredRoles.map((r) => String(r).toUpperCase());

        if (!requiredRolesUpper.includes(userRole)) {
          return res.status(403).json({ error: 'Acceso denegado por rol', message: 'Acceso denegado por rol' });
        }
      }

      return next();
    } catch (err) {
      console.error('Error verificando token:', err.message);
      return res.status(401).json({ error: 'Token inválido o expirado', message: 'Token inválido o expirado' });
    }
  };
}

module.exports = auth;
