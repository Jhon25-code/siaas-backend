const jwt = require('jsonwebtoken');

// 🔥 CORRECCIÓN CRÍTICA: La clave debe ser IGUAL a la de index.js
const JWT_SECRET = process.env.JWT_SECRET || 'secret_super_seguro';

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    try {
      // Ahora sí validará correctamente porque las claves coinciden
      const decoded = jwt.verify(token, JWT_SECRET);

      // Guardamos el usuario en la request
      req.user = decoded;

      // Validación de roles (si aplica)
      if (requiredRoles.length > 0) {
        const userRole = (decoded.role || '').toUpperCase();

        // Normalizamos los roles requeridos a mayúsculas también para evitar errores
        const requiredRolesUpper = requiredRoles.map(r => r.toUpperCase());

        if (!requiredRolesUpper.includes(userRole)) {
          return res.status(403).json({ error: 'Acceso denegado por rol' });
        }
      }

      next();
    } catch (err) {
      console.error("Error verificando token:", err.message);
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };
}

module.exports = auth;