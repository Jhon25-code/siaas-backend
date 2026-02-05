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
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST", "PATCH"] } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

app.use(cors());
app.use(express.json());

// 📦 BASE DE DATOS SQLITE
const db = new sqlite3.Database('./siaas.db');

// Crear tabla si no existe
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
app.use(express.static(WEB_DIR));
app.get('/', (req, res) => res.redirect('/login.html'));

// USUARIOS DEMO
const users = [
  { id: 1, username: 'topico', passwordHash: bcrypt.hashSync('123456', 10), role: 'TOPICO', name: 'Tópico' },
  { id: 2, username: 'admin', passwordHash: bcrypt.hashSync('123456', 10), role: 'ADMIN', name: 'Admin' },
  { id: 3, username: 'supervisor', passwordHash: bcrypt.hashSync('123456', 10), role: 'SUPERVISOR', name: 'Supervisor' },
  { id: 4, username: 'trabajador', passwordHash: bcrypt.hashSync('123456', 10), role: 'TRABAJADOR', name: 'Trabajador' }
];

// AUTH
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({message:'Error'});
  const token = jwt.sign({ id:user.id, role:user.role }, JWT_SECRET);
  res.json({ token, role: user.role, name: user.name });
});

// =========================================================
// 📌 API INCIDENTES - LÓGICA DE SEVERIDAD (LEVE/MEDIO/GRAVE)
// =========================================================
app.post('/incidents', auth(['TRABAJADOR','TOPICO','SUPERVISOR','ADMIN']), (req, res) => {
  const data = req.body;

  // 🔍 OJO AQUÍ: Esto imprimirá en los Logs de Render EXACTAMENTE lo que llega del celular
  console.log("📥 DATOS RECIBIDOS:", JSON.stringify(data, null, 2));

  // --- LÓGICA DE SEVERIDAD ---
  let score = 10; // Por defecto LEVE (Verde)

  // 1. Buscamos la palabra clave que enviaste desde el emulador
  // Intentamos leer varios campos posibles por si acaso
  const severidadTexto = (data.severidad || data.severity || data.prioridad || data.descripcion || '').toString().toUpperCase().trim();

  console.log(`🕵️‍♂️ Analizando texto de severidad: "${severidadTexto}"`);

  // 2. Asignación de puntaje y color
  if (severidadTexto.includes('GRAVE') || severidadTexto.includes('ALTA')) {
      score = 60; // ROJO
  } else if (severidadTexto.includes('MEDIO') || severidadTexto.includes('MEDIA')) {
      score = 40; // NARANJA
  } else {
      score = 10; // VERDE (Leve)
  }

  // 3. Sobreescribir si envías un número directo (smart_score)
  if (data.smart_score && typeof data.smart_score === 'number') {
      score = data.smart_score;
  }

  const incident = {
    id: String(Date.now()),
    tipo: data.tipo || 'Alerta',
    descripcion: data.descripcion || '',
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    received_at: new Date().toISOString(),
    status: 'ABIERTO',
    smart_score: score,
    zone: req.user.zone || null
  };

  const q = `INSERT INTO incidents (id, tipo, descripcion, latitude, longitude, received_at, status, smart_score, zone) VALUES (?,?,?,?,?,?,?,?,?)`;
  db.run(q, [incident.id, incident.tipo, incident.descripcion, incident.latitude, incident.longitude, incident.received_at, incident.status, incident.smart_score, incident.zone], (err) => {
      if (err) {
        console.error("❌ Error guardando:", err.message);
        return res.status(500).json({error: err.message});
      }

      console.log(`✅ Incidente Guardado -> Severidad Final: ${score} (${score>=51?'ROJO':score>=31?'NARANJA':'VERDE'})`);

      io.emit('nueva_alerta', incident);
      res.json({ok:true});
  });
});

// LISTAR
app.get('/incidents', auth(['TOPICO','SUPERVISOR','ADMIN']), (req, res) => {
    db.all("SELECT * FROM incidents ORDER BY received_at DESC", [], (err, rows) => res.json(rows || []));
});

// DETALLE
app.get('/incidents/:id', auth(['TOPICO','SUPERVISOR','ADMIN']), (req, res) => {
    db.get("SELECT * FROM incidents WHERE id = ?", [req.params.id], (err, row) => {
        if(!row) return res.status(404).json({message:'No encontrado'});
        res.json(row);
    });
});

// CAMBIAR ESTADO
app.patch('/incidents/:id/status', auth(['TOPICO','SUPERVISOR','ADMIN']), (req, res) => {
    const { status } = req.body;

    // Normalización de estados
    let finalStatus = 'ABIERTO';
    const s = (status || '').toUpperCase();
    if(s === 'EN_ATENCION' || s === 'EN ATENCION') finalStatus = 'EN_ATENCION';
    if(s === 'CERRADO' || s === 'CERRADA' || s === 'FINALIZADO') finalStatus = 'CERRADO';

    db.run("UPDATE incidents SET status = ? WHERE id = ?", [finalStatus, req.params.id], function(err) {
        if(err) return res.status(500).json({error:err.message});

        console.log(`🔄 Estado cambiado: ${finalStatus}`);
        io.emit('cambio_estado', {id:req.params.id, status:finalStatus});
        res.json({ok:true});
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 SIAAS Corriendo en puerto ${PORT}`));