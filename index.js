const express = require('express');
const cors = require('cors');

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require("socket.io");
const auth = require('./middleware/auth');

// Inicializar App
const app = express();
const server = http.createServer(app);

// Configuración Socket.io
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PATCH"] },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_super_seguro';

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// 📦 BASE DE DATOS
// ---------------------------------------------------------
const db = new sqlite3.Database('./siaas.db', (err) => {
  if (err) {
    console.error('❌ ERROR FATAL AL ABRIR BD:', err.message);
  } else {
    console.log('🗄️ Base de datos SQLite conectada correctamente');
  }
});

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

// ---------------------------------------------------------
// 📂 SERVIR FRONTEND
// ---------------------------------------------------------
const WEB_DIR = path.join(__dirname, 'web');
app.use(express.static(WEB_DIR));

app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/login.html', (req, res) => res.sendFile(path.join(WEB_DIR, 'login.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(WEB_DIR, 'dashboard.html')));

// ---------------------------------------------------------
// 👤 USUARIOS
// ---------------------------------------------------------
const PASSWORD_HASH = bcrypt.hashSync('Siaas2026', 10);
const PASSWORD_HASH_TRABAJADOR_DEMO = bcrypt.hashSync('123456', 10);

const users = [
  { id: 1, username: 'topico', passwordHash: PASSWORD_HASH, role: 'TOPICO', name: 'Tópico Central' },
  { id: 2, username: 'admin', passwordHash: PASSWORD_HASH, role: 'ADMIN', name: 'Administrador' },
  { id: 3, username: 'supervisor', passwordHash: PASSWORD_HASH, role: 'SUPERVISOR', name: 'Supervisor Zona 1' },
  {
    id: 4,
    username: 'trabajador',
    passwordHash: PASSWORD_HASH,
    passwordHashAlt: PASSWORD_HASH_TRABAJADOR_DEMO,
    role: 'TRABAJADOR',
    name: 'Juan Perez'
  }
];

// ---------------------------------------------------------
// 🔐 LOGIN
// ---------------------------------------------------------
app.post('/auth/login', (req, res) => {
  try {
    const username =
      req.body.username ||
      req.body.usuario ||
      req.body.email ||
      '';

    const password =
      req.body.password ||
      req.body.contrasena ||
      '';

    const user = users.find(u => u.username === username);

    const okMain = user && bcrypt.compareSync(password, user.passwordHash);
    const okAlt = user && user.passwordHashAlt && bcrypt.compareSync(password, user.passwordHashAlt);

    if (!user || (!okMain && !okAlt)) {
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ token, role: user.role, name: user.name });
  } catch (e) {
    console.error("❌ ERROR EN /auth/login:", e);
    return res.status(500).json({ message: 'Error interno en login' });
  }
});

// =========================================================
// 🚨 API INCIDENTES (🔥 FIX CLAVE AQUÍ 🔥)
// =========================================================

// 🔥 CAMBIO: solo validamos TOKEN, NO rol
app.post('/incidents', auth(), (req, res) => {
  const data = req.body;

  console.log("📥 [MÓVIL] Datos recibidos:", JSON.stringify(data));

  let score = 10;
  const analisis = JSON.stringify(data).toUpperCase();

  if (analisis.includes('GRAVE') || analisis.includes('ALTA') || analisis.includes('CRITICA')) {
    score = 60;
  } else if (analisis.includes('MEDIO') || analisis.includes('MEDIA')) {
    score = 40;
  }

  if (typeof data.smart_score === 'number' && data.smart_score > 0) {
    score = data.smart_score;
  }

  const incident = {
    id: String(Date.now()),
    tipo: data.tipo || 'Alerta General',
    descripcion: data.descripcion || '',
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    received_at: new Date().toISOString(),
    status: 'ABIERTO',
    smart_score: score,
    zone: 'ZONA_1'
  };

  const sql = `INSERT INTO incidents
    (id, tipo, descripcion, latitude, longitude, received_at, status, smart_score, zone)
    VALUES (?,?,?,?,?,?,?,?,?)`;

  db.run(sql, Object.values(incident), function (err) {
    if (err) {
      console.error("❌ ERROR BD:", err.message);
      return res.status(500).json({ error: "Error de base de datos" });
    }

    console.log(`✅ Incidente guardado: ${incident.tipo}`);
    io.emit('nueva_alerta', incident);
    res.json({ ok: true, id: incident.id });
  });
});

// ---------------------------------------------------------
// 📋 CONSULTAS (solo web)
// ---------------------------------------------------------
app.get('/incidents', auth(['TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  db.all("SELECT * FROM incidents ORDER BY received_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.patch('/incidents/:id/status', auth(['TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  const s = (req.body.status || '').toUpperCase();
  const finalStatus =
    s.includes('ATENCION') ? 'EN_ATENCION' :
    s.includes('CERR') ? 'CERRADO' : 'ABIERTO';

  db.run(
    "UPDATE incidents SET status = ? WHERE id = ?",
    [finalStatus, req.params.id],
    () => {
      io.emit('cambio_estado', { id: req.params.id, status: finalStatus });
      res.json({ ok: true });
    }
  );
});

app.get('/health', (req, res) => res.json({ status: 'OK' }));

// ---------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SERVIDOR SIAAS ACTIVO EN PUERTO ${PORT}`);
});
