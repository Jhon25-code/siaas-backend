const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

/**
 * Render asigna el puerto dinámicamente
 */
const PORT = process.env.PORT || 3000;

// En Render → Settings → Environment
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ==================
// Middleware base
// ==================
app.use(cors());
app.use(express.json());

/**
 * 🚨 IMPORTANTE (FIX DEFINITIVO)
 * Desactivar cache SOLO para HTML
 */
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

/**
 * =========================
 * SERVIR FRONTEND (web/)
 * =========================
 */
const WEB_DIR = path.join(__dirname, 'web');

// Servir CSS, JS, imágenes
app.use(express.static(WEB_DIR));

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'login.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ==================
// MEMORIA TEMPORAL
// ==================
const incidents = [];

function generateId() {
  return String(Date.now()) + Math.random().toString(16).slice(2);
}

/**
 * Roles oficiales
 */
const ROLES = ['TRABAJADOR', 'AUXILIAR', 'TOPICO', 'SUPERVISOR', 'ADMIN'];

/**
 * Usuarios DEMO
 */
const users = [
  { id: 1, username: 'topico', passwordHash: bcrypt.hashSync('123456', 10), role: 'TOPICO', zone: 'ZONA_1', name: 'Tópico' },
  { id: 2, username: 'admin', passwordHash: bcrypt.hashSync('123456', 10), role: 'ADMIN', zone: null, name: 'Admin' },
  { id: 3, username: 'supervisor', passwordHash: bcrypt.hashSync('123456', 10), role: 'SUPERVISOR', zone: 'ZONA_1', name: 'Supervisor' },
  { id: 4, username: 'trabajador', passwordHash: bcrypt.hashSync('123456', 10), role: 'TRABAJADOR', zone: 'ZONA_1', name: 'Trabajador' },
  { id: 5, username: 'auxiliar', passwordHash: bcrypt.hashSync('123456', 10), role: 'AUXILIAR', zone: 'ZONA_1', name: 'Auxiliar' },
];

// ==================
// UTILIDADES
// ==================
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'No autenticado' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    next();
  };
}

// ==================
// AUTH
// ==================
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, zone: user.zone, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, role: user.role, name: user.name, zone: user.zone, username: user.username });
});


// ============================
// 🚨 API COMPLETA DE INCIDENTES
// ============================

/**
 * Crear incidente
 */
app.post('/incidents', authRequired, (req, res) => {
  const { tipo, descripcion, latitude, longitude, received_at } = req.body;

  if (!tipo) return res.status(400).json({ message: 'Tipo es requerido' });

  const incident = {
    id: generateId(),
    tipo,
    descripcion: descripcion || '',
    latitude: latitude || null,
    longitude: longitude || null,
    received_at: received_at || new Date().toISOString(),
    status: 'NUEVA',
    zone: req.user.zone || null,
    smart_score: 0
  };

  incidents.push(incident);
  res.json({ ok: true, incident });
});

/**
 * Listar incidentes
 */
app.get('/incidents', authRequired, (req, res) => {
  res.json(incidents);
});

/**
 * Obtener incidente por ID
 */
app.get('/incidents/:id', authRequired, (req, res) => {
  const incident = incidents.find(i => i.id === req.params.id);
  if (!incident) return res.status(404).json({ message: 'No encontrado' });
  res.json(incident);
});

/**
 * Cambiar estado de incidente
 */
app.put('/incidents/:id/status', authRequired, (req, res) => {
  const { status } = req.body;
  const allowed = ['NUEVA', 'RECIBIDA', 'EN_ATENCION', 'CERRADA'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Estado inválido' });
  }

  const incident = incidents.find(i => i.id === req.params.id);
  if (!incident) return res.status(404).json({ message: 'No encontrado' });

  incident.status = status;
  res.json({ ok: true, incident });
});


// ==================
// HEALTH CHECK
// ==================
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'SIAAS', time: new Date().toISOString() });
});

// ==================
// START SERVER
// ==================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor SIAAS activo:
  → http://localhost:${PORT}
  → https://siaas-backend.onrender.com
  `);
});
