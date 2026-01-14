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

// En Render crea esta variable (Settings → Environment):
// JWT_SECRET = un_valor_largo_unico
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// Middleware
app.use(cors());
app.use(express.json());

// Servir carpeta web (login.html, dashboard.html, css, js)
app.use(express.static(path.join(__dirname, 'web')));

// Memoria temporal (luego DB real)
const incidents = [];

/**
 * Usuarios DEMO (para el proyecto)
 * user: topico / pass: 123456
 * user: admin  / pass: 123456
 */
const users = [
  { id: 1, username: 'topico', passwordHash: bcrypt.hashSync('123456', 10), role: 'TOPICO', zone: null, name: 'Tópico' },
  { id: 2, username: 'admin',  passwordHash: bcrypt.hashSync('123456', 10), role: 'ADMIN',  zone: null, name: 'Admin' },
];

/**
 * Generar ID simple (sin DB)
 */
function generateId() {
  return String(Date.now()) + Math.random().toString(16).slice(2);
}

/**
 * Middleware: validar token
 */
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'No autenticado' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

/**
 * Middleware: validar rol
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    next();
  };
}

/**
 * LOGIN (Web)
 */
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, zone: user.zone },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.json({ token, role: user.role, name: user.name, zone: user.zone });
});

/**
 * SMART SCORE AUTOMÁTICO
 */
function calculateSmartScore({ tipo, severidad, latitude, longitude }) {
  let score = 0;

  // Base por severidad
  if (severidad === 'grave') score += 50;
  if (severidad === 'medio') score += 30;
  if (severidad === 'leve') score += 15;

  // GPS suma valor
  if (latitude != null && longitude != null) score += 20;

  // Tipo de incidente
  if (tipo === 'insolacion') score += 10;
  if (tipo === 'picadura_abeja') score += 15;
  if (tipo === 'intoxicacion') score += 25;
  if (tipo === 'corte') score += 20;

  return score;
}

/**
 * Endpoint de sincronización (Flutter)
 * (No requiere login porque viene desde el móvil offline)
 */
app.post('/sync', (req, res) => {
  const nowIso = new Date().toISOString();

  const incident = {
    id: generateId(),

    tipo: req.body.tipo,
    descripcion: req.body.descripcion || '',
    severidad: req.body.severidad || 'leve',
    latitude: req.body.latitude ?? null,
    longitude: req.body.longitude ?? null,
    timestamp: req.body.timestamp ?? null,

    // Hora real del servidor
    received_at: nowIso,

    // Flujo de atención
    status: 'NUEVA',
    status_updated_at: nowIso,

    // Historial de cambios
    history: [{ status: 'NUEVA', at: nowIso, by: 'SYSTEM' }],
  };

  // Calcular score automáticamente
  incident.smart_score = calculateSmartScore(incident);

  incidents.push(incident);

  console.log('📥 Incidente recibido:', incident);

  res.status(200).json({
    success: true,
    message: 'Incidente sincronizado correctamente',
    data: incident,
  });
});

/**
 * API para dashboard (PROTEGIDO)
 * ✅ Soporta filtros:
 *  - /incidents?status=NUEVA
 *  - /incidents?status=CERRADA
 *  - /incidents?status=NUEVA,RECIBIDA
 */
app.get('/incidents', authRequired, requireRole(['TOPICO', 'ADMIN']), (req, res) => {
  const { status } = req.query;

  let data = [...incidents];

  if (status) {
    const allowed = ['NUEVA', 'RECIBIDA', 'EN_ATENCION', 'CERRADA'];
    const wanted = String(status)
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => allowed.includes(s));

    if (wanted.length) {
      data = data.filter(i => wanted.includes(i.status));
    }
  }

  // Orden recomendado (más urgentes arriba)
  const rank = { NUEVA: 4, RECIBIDA: 3, EN_ATENCION: 2, CERRADA: 1 };
  data.sort((a, b) =>
    (rank[b.status] || 0) - (rank[a.status] || 0) ||
    (b.smart_score || 0) - (a.smart_score || 0)
  );

  res.json(data);
});

/**
 * (Opcional pero útil) Ver detalle de 1 incidente
 */
app.get('/incidents/:id', authRequired, requireRole(['TOPICO', 'ADMIN']), (req, res) => {
  const { id } = req.params;
  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ message: 'Incidente no encontrado' });
  res.json(incident);
});

/**
 * Cambiar estado (panel web)
 */
app.patch('/incidents/:id/status', authRequired, requireRole(['TOPICO', 'ADMIN']), (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  // Estados oficiales
  const allowed = ['NUEVA', 'RECIBIDA', 'EN_ATENCION', 'CERRADA'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Estado inválido' });
  }

  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ message: 'Incidente no encontrado' });

  const nowIso = new Date().toISOString();

  incident.status = status;
  incident.status_updated_at = nowIso;

  incident.history = incident.history || [];
  incident.history.push({ status, at: nowIso, by: req.user.name || req.user.role });

  return res.json({ success: true, data: incident });
});

/**
 * (Opcional) KPIs rápidos para tu demo (SLA y conteos)
 * - /kpi
 */
app.get('/kpi', authRequired, requireRole(['TOPICO', 'ADMIN']), (req, res) => {
  const byStatus = { NUEVA: 0, RECIBIDA: 0, EN_ATENCION: 0, CERRADA: 0 };
  for (const i of incidents) {
    if (byStatus[i.status] != null) byStatus[i.status]++;
  }

  // SLA promedio en minutos (solo cerradas)
  const closed = incidents.filter(i => i.status === 'CERRADA' && i.history?.length);
  const slaMins = closed
    .map(i => {
      const h = [...i.history].sort((a, b) => new Date(a.at) - new Date(b.at));
      const start = new Date(h[0].at).getTime();
      const end = new Date(h[h.length - 1].at).getTime();
      if (isNaN(start) || isNaN(end)) return null;
      return Math.round((end - start) / 60000);
    })
    .filter(x => x != null);

  const avgSla = slaMins.length ? Math.round(slaMins.reduce((a, b) => a + b, 0) / slaMins.length) : 0;

  res.json({
    total: incidents.length,
    byStatus,
    avgSlaMinutes: avgSla,
  });
});

/**
 * / redirige al login
 */
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor SIAAS activo:
  → http://localhost:${PORT}
  → https://siaas-backend.onrender.com
  `);
});
