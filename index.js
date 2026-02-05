const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require("socket.io");
const auth = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// Configuración Socket.io
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PATCH"] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.use(cors());
app.use(express.json());

// 📦 BASE DE DATOS SQLITE
const db = new sqlite3.Database('./siaas.db', (err) => {
  if (err) console.error('❌ Error BD:', err.message);
  else console.log('🗄️ SQLite conectada');
});

// Crear tabla
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    tipo TEXT,
    descripcion TEXT,
    latitude REAL,
    longitude REAL,
    received_at TEXT,
    status TEXT,
    smart_score INTEGER,
    zone TEXT
  )`);
});

// SERVIR FRONTEND
const WEB_DIR = path.join(__dirname, 'web');
app.use('/css', express.static(path.join(WEB_DIR, 'css')));
app.use('/js', express.static(path.join(WEB_DIR, 'js')));
app.use('/images', express.static(path.join(WEB_DIR, 'images')));
app.use(express.static(WEB_DIR));
app.get('/login.html', (req, res) => res.sendFile(path.join(WEB_DIR, 'login.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(WEB_DIR, 'dashboard.html')));
app.get('/', (req, res) => res.redirect('/login.html'));

// USUARIOS
const users = [
  { id: 1, username: 'topico', passwordHash: bcrypt.hashSync('123456', 10), role: 'TOPICO', zone: 'ZONA_1', name: 'Tópico' },
  { id: 2, username: 'admin', passwordHash: bcrypt.hashSync('123456', 10), role: 'ADMIN', zone: null, name: 'Admin' },
  { id: 3, username: 'supervisor', passwordHash: bcrypt.hashSync('123456', 10), role: 'SUPERVISOR', zone: 'ZONA_1', name: 'Supervisor' },
  { id: 4, username: 'trabajador', passwordHash: bcrypt.hashSync('123456', 10), role: 'TRABAJADOR', zone: 'ZONA_1', name: 'Trabajador' },
  { id: 5, username: 'auxiliar', passwordHash: bcrypt.hashSync('123456', 10), role: 'AUXILIAR', zone: 'ZONA_1', name: 'Auxiliar' },
];

function generateId() { return String(Date.now()) + Math.random().toString(16).slice(2); }

// AUTH
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ message: 'Credenciales inválidas' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name, zone: user.zone, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, role: user.role, name: user.name, zone: user.zone, username: user.username });
});

// ==========================================
// 📌 API INCIDENTES (CORREGIDA Y ROBUSTA)
// ==========================================

app.post('/incidents', auth(['TRABAJADOR', 'AUXILIAR', 'TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  const data = req.body;

  console.log("📥 Recibido del móvil:", JSON.stringify(data));

  // --- 🔥 SUPER TRADUCTOR DE SEVERIDAD 🔥 ---
  // Captura cualquier variante que envíe el celular
  let calculatedScore = 10; // Valor por defecto (Leve)

  // 1. Si ya viene como número, úsalo
  if (data.smart_score && typeof data.smart_score === 'number') {
      calculatedScore = data.smart_score;
  } else {
      // 2. Si es texto, busca palabras clave
      // Busca en 'severidad', 'severity', 'priority' o incluso 'tipo' si fuera necesario
      const sevText = (data.severidad || data.severity || data.priority || '').toString().toUpperCase();

      if (['GRAVE', 'ALTA', 'HIGH', 'CRITICA', 'URGENTE', 'SEVERA'].some(w => sevText.includes(w))) {
          calculatedScore = 60; // ROJO
      } else if (['MEDIO', 'MEDIA', 'MEDIUM', 'MODERADA', 'REGULAR'].some(w => sevText.includes(w))) {
          calculatedScore = 40; // NARANJA
      } else {
          calculatedScore = 10; // VERDE
      }

      console.log(`🔍 Severidad detectada: "${sevText}" -> Score: ${calculatedScore}`);
  }

  const incident = {
    id: generateId(),
    tipo: data.tipo || 'SIN_TIPO',
    descripcion: data.descripcion || '',
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    received_at: new Date().toISOString(),
    status: 'NUEVA',
    smart_score: calculatedScore,
    zone: req.user.zone || null
  };

  const query = `INSERT INTO incidents (id, tipo, descripcion, latitude, longitude, received_at, status, smart_score, zone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [incident.id, incident.tipo, incident.descripcion, incident.latitude, incident.longitude, incident.received_at, incident.status, incident.smart_score, incident.zone];

  db.run(query, params, function(err) {
    if (err) {
      console.error("❌ Error DB Insert:", err.message);
      return res.status(500).json({ error: "Error al guardar en BD" });
    }

    console.log(`✅ Guardado OK: ${incident.tipo} (Color: ${incident.smart_score >= 51 ? 'Rojo' : incident.smart_score >= 31 ? 'Naranja' : 'Verde'})`);
    io.emit('nueva_alerta', incident);
    res.json({ ok: true, incident });
  });
});

// LISTAR
app.get('/incidents', auth(['TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  db.all("SELECT * FROM incidents ORDER BY received_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// DETALLE
app.get('/incidents/:id', auth(['TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  db.get("SELECT * FROM incidents WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ message: 'No encontrado' });
    res.json(row);
  });
});

// CAMBIAR ESTADO
app.patch('/incidents/:id/status', auth(['TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['NUEVA', 'EN_ATENCION', 'CERRADA'];
  if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Estado no válido' });

  const sql = `UPDATE incidents SET status = ? WHERE id = ?`;

  db.run(sql, [status, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ message: 'Incidente no encontrado' });

    console.log(`✅ Estado actualizado: ${status}`);
    io.emit('cambio_estado', { id, status });
    res.json({ ok: true, id, newStatus: status });
  });
});

app.get('/health', (req, res) => res.json({ ok: true, db: 'SQLite' }));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor SIAAS V3 (Robust Severity) Listo en puerto ${PORT}`);
});