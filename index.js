const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const auth = require('./middleware/auth'); // ✅ USAMOS TU MIDDLEWARE

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
 * 🚨 NO CACHE para HTML (Render)
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

// =========================
// SERVIR FRONTEND (web/)
// =========================
const WEB_DIR = path.join(__dirname, 'web');
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

// =========================
// 📦 PERSISTENCIA SIMPLE
// =========================
const DATA_FILE = path.join(__dirname, 'incidents.json');

function loadIncidents() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('❌ Error cargando incidents.json', e);
  }
  return [];
}

function saveIncidents() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(incidents, null, 2));
  } catch (e) {
    console.error('❌ Error guardando incidents.json', e);
  }
}

// =========================
// Base de datos (persistente)
// =========================
let incidents = loadIncidents();

// ==================
// Roles oficiales
// ==================
const ROLES = ['TRABAJADOR', 'AUXILIAR', 'TOPICO', 'SUPERVISOR', 'ADMIN'];

// ==================
// Usuarios DEMO
// ==================
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
function generateId() {
  return String(Date.now()) + Math.random().toString(16).slice(2);
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
    {
      id: user.id,
      role: user.role,
      name: user.name,
      zone: user.zone,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    role: user.role,
    name: user.name,
    zone: user.zone,
    username: user.username
  });
});

// =====================
// 📌 INCIDENTES API (PROTEGIDO)
// =====================
app.post('/incidents',
  auth(['TRABAJADOR', 'AUXILIAR', 'TOPICO', 'SUPERVISOR', 'ADMIN']),
  (req, res) => {
    const data = req.body;

    const incident = {
      id: generateId(),
      tipo: data.tipo || 'SIN_TIPO',
      descripcion: data.descripcion || '',
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      received_at: new Date().toISOString(),
      status: 'NUEVA',
      smart_score: data.smart_score || 0,
      zone: req.user.zone || null
    };

    incidents.push(incident);
    saveIncidents();

    res.json({ ok: true, incident });
  }
);

app.get('/incidents',
  auth(['TOPICO', 'SUPERVISOR', 'ADMIN']),
  (req, res) => {
    res.json(incidents);
  }
);

app.get('/incidents/:id',
  auth(['TOPICO', 'SUPERVISOR', 'ADMIN']),
  (req, res) => {
    const i = incidents.find(x => x.id === req.params.id);
    if (!i) return res.status(404).json({ message: 'No encontrado' });
    res.json(i);
  }
);

app.patch('/incidents/:id/status',
  auth(['TOPICO', 'SUPERVISOR', 'ADMIN']),
  (req, res) => {
    const inc = incidents.find(x => x.id === req.params.id);
    if (!inc) return res.status(404).json({ message: 'No encontrado' });

    inc.status = req.body.status || inc.status;
    saveIncidents();
    res.json({ ok: true, incident: inc });
  }
);

// =====================
// Health check
// =====================
app.get('/health', (req, res) => {
  res.json({ ok: true, incidents: incidents.length });
});

// =====================
// START SERVER
// =====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor SIAAS activo:
  → http://localhost:${PORT}
  → https://siaas-backend.onrender.com
  `);
});
