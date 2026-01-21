const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

/* ==============================
   CONFIG BASICA / RENDER
============================== */
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.use(cors());
app.use(express.json());

/* ==============================
   DESACTIVAR CACHE SOLO PARA HTML
============================== */
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

/* ==============================
   SERVIR FRONTEND (carpeta web/)
============================== */
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

/* ==============================
   MEMORIA LOCAL (DEMO)
============================== */
const incidents = [];

const users = [
  { id: 1, username: 'topico', passwordHash: bcrypt.hashSync('123456', 10), role: 'TOPICO', zone: 'ZONA_1', name: 'Tópico' },
  { id: 2, username: 'admin', passwordHash: bcrypt.hashSync('123456', 10), role: 'ADMIN', zone: null, name: 'Admin' },
  { id: 3, username: 'supervisor', passwordHash: bcrypt.hashSync('123456', 10), role: 'SUPERVISOR', zone: 'ZONA_1', name: 'Supervisor' },
  { id: 4, username: 'trabajador', passwordHash: bcrypt.hashSync('123456', 10), role: 'TRABAJADOR', zone: 'ZONA_1', name: 'Trabajador' },
  { id: 5, username: 'auxiliar', passwordHash: bcrypt.hashSync('123456', 10), role: 'AUXILIAR', zone: 'ZONA_1', name: 'Auxiliar' },
];

function generateId() {
  return String(Date.now()) + Math.random().toString(16).slice(2);
}

/* ==============================
   AUTH MIDDLEWARE
============================== */
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

/* ==============================
   LOGIN
============================== */
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

/* ==============================
   📌 ENDPOINT — CREAR INCIDENTE
============================== */
app.post('/incidents', authRequired, (req, res) => {
  const { tipo, descripcion, latitude, longitude, received_at } = req.body;

  const incident = {
    id: generateId(),
    tipo,
    descripcion,
    latitude,
    longitude,
    received_at: received_at || new Date().toISOString(),
    status: "NUEVA",
    created_by: req.user.username,
    zone: req.user.zone || null,
    smart_score: 0, // ya no mostramos número en dashboard
    severidad: "leve" // placeholder
  };

  incidents.push(incident);
  console.log("Nuevo incidente creado:", incident);

  res.json({ ok: true, incident });
});

/* ==============================
   📌 ENDPOINT — LISTAR INCIDENTES
============================== */
app.get('/incidents', authRequired, (req, res) => {
  res.json(incidents);
});

/* ==============================
   📌 ENDPOINT — CAMBIAR ESTADO
============================== */
app.patch('/incidents/:id/status', authRequired, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ message: "No encontrado" });

  incident.status = status;
  incident.history = incident.history || [];
  incident.history.push({
    status,
    at: new Date().toISOString(),
    by: req.user.username
  });

  res.json({ ok: true, incident });
});

/* ==============================
   HEALTHCHECK
============================== */
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'SIAAS', time: new Date().toISOString() });
});

/* ==============================
   START SERVER
============================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor SIAAS activo:
  → http://localhost:${PORT}
  → https://siaas-backend.onrender.com`);
});
