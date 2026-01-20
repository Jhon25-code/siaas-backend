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
 * Roles oficiales del proyecto (HU 2 / HU 18)
 */
const ROLES = ['TRABAJADOR', 'AUXILIAR', 'TOPICO', 'SUPERVISOR', 'ADMIN'];

/**
 * Usuarios DEMO (para el proyecto)
 * user: topico     / pass: 123456
 * user: admin      / pass: 123456
 * user: supervisor / pass: 123456
 * user: trabajador / pass: 123456
 * user: auxiliar   / pass: 123456
 */
const users = [
  // WEB
  { id: 1, username: 'topico', passwordHash: bcrypt.hashSync('123456', 10), role: 'TOPICO', zone: 'ZONA_1', name: 'Tópico' },
  { id: 2, username: 'admin',  passwordHash: bcrypt.hashSync('123456', 10), role: 'ADMIN',  zone: null,     name: 'Admin' },

  // DEMO APP / WEB
  { id: 3, username: 'supervisor', passwordHash: bcrypt.hashSync('123456', 10), role: 'SUPERVISOR', zone: 'ZONA_1', name: 'Supervisor' },
  { id: 4, username: 'trabajador', passwordHash: bcrypt.hashSync('123456', 10), role: 'TRABAJADOR', zone: 'ZONA_1', name: 'Trabajador' },
  { id: 5, username: 'auxiliar',   passwordHash: bcrypt.hashSync('123456', 10), role: 'AUXILIAR',   zone: 'ZONA_1', name: 'Auxiliar' },
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
    { id: user.id, role: user.role, name: user.name, zone: user.zone, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.json({ token, role: user.role, name: user.name, zone: user.zone, username: user.username });
});

/**
 * =========================
 *  USERS (ADMIN) - HU 2/18
 * =========================
 */

// Listar usuarios (ADMIN)
app.get('/users', authRequired, requireRole(['ADMIN']), (req, res) => {
  const safe = users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    zone: u.zone,
    name: u.name
  }));
  res.json(safe);
});

// Crear usuario (ADMIN)
app.post('/users', authRequired, requireRole(['ADMIN']), (req, res) => {
  const { username, password, role, zone, name } = req.body || {};

  if (!username || !password || !ROLES.includes(role)) {
    return res.status(400).json({ message: 'Datos inválidos (username, password, role)' });
  }
  if (users.some(u => u.username === username)) {
    return res.status(409).json({ message: 'Usuario ya existe' });
  }

  const newUser = {
    id: users.length ? Math.max(...users.map(u => u.id)) + 1 : 1,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    zone: zone ?? null,
    name: name || username,
  };

  users.push(newUser);

  res.status(201).json({
    success: true,
    user: { id: newUser.id, username: newUser.username, role: newUser.role, zone: newUser.zone, name: newUser.name }
  });
});

// Actualizar usuario (ADMIN)
app.patch('/users/:id', authRequired, requireRole(['ADMIN']), (req, res) => {
  const id = Number(req.params.id);
  const u = users.find(x => x.id === id);
  if (!u) return res.status(404).json({ message: 'No encontrado' });

  const { role, zone, name, password } = req.body || {};

  if (role && !ROLES.includes(role)) return res.status(400).json({ message: 'Rol inválido' });

  if (role) u.role = role;
  if (zone !== undefined) u.zone = zone;
  if (name) u.name = name;
  if (password) u.passwordHash = bcrypt.hashSync(password, 10);

  res.json({
    success: true,
    user: { id: u.id, username: u.username, role: u.role, zone: u.zone, name: u.name }
  });
});

// Eliminar usuario (ADMIN)
app.delete('/users/:id', authRequired, requireRole(['ADMIN']), (req, res) => {
  const id = Number(req.params.id);
  const idx = users.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ message: 'No encontrado' });

  // Evitar borrar un ADMIN en demo
  if (users[idx].role === 'ADMIN') {
    return res.status(400).json({ message: 'No se puede eliminar un ADMIN (demo)' });
  }

  users.splice(idx, 1);
  res.json({ success: true });
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
 *
 * Mejoras:
 * - client_id (id del móvil) para evitar duplicados
 * - zone y created_by para filtrar por rol/zona (TOPICO/SUPERVISOR)
 * - validación de tipo
 */
app.post('/sync', (req, res) => {
  const nowIso = new Date().toISOString();

  // Validación mínima
  const tipo = (req.body.tipo || '').trim();
  if (!tipo) {
    return res.status(400).json({ success: false, message: 'El campo "tipo" es obligatorio' });
  }

  //  Anti-duplicados si el móvil reintenta
  const client_id = req.body.client_id || null;
  if (client_id) {
    const existing = incidents.find(i => i.client_id === client_id);
    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Duplicado ignorado (ya existe)',
        data: existing,
      });
    }
  }

  const incident = {
    id: generateId(),
    client_id,

    tipo,
    descripcion: req.body.descripcion || '',
    severidad: req.body.severidad || 'leve',
    latitude: req.body.latitude ?? null,
    longitude: req.body.longitude ?? null,
    timestamp: req.body.timestamp ?? null,

    // Control por roles
    zone: req.body.zone || 'ZONA_1',
    created_by: req.body.created_by || 'APP',

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

  console.log(' Incidente recibido:', incident);

  res.status(200).json({
    success: true,
    message: 'Incidente sincronizado correctamente',
    data: incident,
  });
});

/**
 * Consultar estado por client_id (móvil) - HU 12
 */
app.get('/sync/status/:clientId', (req, res) => {
  const { clientId } = req.params;
  const incident = incidents.find(i => i.client_id === clientId);
  if (!incident) return res.status(404).json({ message: 'Aún no recibido' });
  return res.json({ id: incident.id, status: incident.status, received_at: incident.received_at });
});

/**
 * API para dashboard (PROTEGIDO)
 *  Roles:
 * - ADMIN: ve todo
 * - TOPICO/SUPERVISOR: ve solo su zona
 */
app.get('/incidents', authRequired, requireRole(['TOPICO', 'ADMIN', 'SUPERVISOR']), (req, res) => {
  const { status } = req.query;

  let data = [...incidents];

  //  FILTRO POR ROL / ZONA
  if (req.user.role === 'TOPICO' || req.user.role === 'SUPERVISOR') {
    if (req.user.zone) {
      data = data.filter(i => i.zone === req.user.zone);
    }
  }

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
 * Ver detalle de 1 incidente
 */
app.get('/incidents/:id', authRequired, requireRole(['TOPICO', 'ADMIN', 'SUPERVISOR']), (req, res) => {
  const { id } = req.params;
  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ message: 'Incidente no encontrado' });

  //  si es TOPICO/SUPERVISOR, validar zona
  if ((req.user.role === 'TOPICO' || req.user.role === 'SUPERVISOR') && req.user.zone) {
    if (incident.zone !== req.user.zone) return res.status(403).json({ message: 'No autorizado (zona)' });
  }

  res.json(incident);
});

/**
 * Cambiar estado (panel web)
 *  roles: TOPICO / SUPERVISOR / ADMIN
 */
app.patch('/incidents/:id/status', authRequired, requireRole(['TOPICO', 'SUPERVISOR', 'ADMIN']), (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  const allowed = ['NUEVA', 'RECIBIDA', 'EN_ATENCION', 'CERRADA'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Estado inválido' });
  }

  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ message: 'Incidente no encontrado' });

  //  si es TOPICO/SUPERVISOR, validar zona
  if ((req.user.role === 'TOPICO' || req.user.role === 'SUPERVISOR') && req.user.zone) {
    if (incident.zone !== req.user.zone) return res.status(403).json({ message: 'No autorizado (zona)' });
  }

  const nowIso = new Date().toISOString();

  incident.status = status;
  incident.status_updated_at = nowIso;

  incident.history = incident.history || [];
  incident.history.push({ status, at: nowIso, by: req.user.name || req.user.role });

  return res.json({ success: true, data: incident });
});

/**
 * KPIs rápidos para tu demo (SLA y conteos)
 */
app.get('/kpi', authRequired, requireRole(['TOPICO', 'ADMIN', 'SUPERVISOR']), (req, res) => {
  //  si no es ADMIN, filtra por zona
  let data = [...incidents];
  if ((req.user.role === 'TOPICO' || req.user.role === 'SUPERVISOR') && req.user.zone) {
    data = data.filter(i => i.zone === req.user.zone);
  }

  const byStatus = { NUEVA: 0, RECIBIDA: 0, EN_ATENCION: 0, CERRADA: 0 };
  for (const i of data) {
    if (byStatus[i.status] != null) byStatus[i.status]++;
  }

  // SLA promedio en minutos (solo cerradas)
  const closed = data.filter(i => i.status === 'CERRADA' && i.history?.length);
  const slaMins = closed
    .map(i => {
      const h = [...i.history].sort((a, b) => new Date(a.at) - new Date(b.at));
      const start = new Date(h[0].at).getTime();
      const end = new Date(h[h.length - 1].at).getTime();
      if (isNaN(start) || isNaN(end)) return null;
      return Math.round((end - start) / 60000);
    })
    .filter(x => x != null);

  const avgSla = slaMins.length
    ? Math.round(slaMins.reduce((a, b) => a + b, 0) / slaMins.length)
    : 0;

  res.json({
    total: data.length,
    byStatus,
    avgSlaMinutes: avgSla,
  });
});

/**
 * REPORTES (CSV) - SOLO ADMIN
 * Descarga para Excel: /reports/incidents.csv
 */
app.get('/reports/incidents.csv', authRequired, requireRole(['ADMIN']), (req, res) => {
  const header = ['id','tipo','severidad','status','smart_score','received_at','descripcion','zone','created_by','latitude','longitude','client_id'];
  const rows = incidents.map(i => [
    i.id,
    i.tipo,
    i.severidad,
    i.status,
    i.smart_score,
    i.received_at,
    (i.descripcion || '').replace(/\n/g, ' ').replace(/"/g, '""'),
    i.zone || '',
    i.created_by || '',
    i.latitude ?? '',
    i.longitude ?? '',
    i.client_id || ''
  ]);

  const csv = [
    header.join(','),
    ...rows.map(r => r.map(v => `"${String(v ?? '')}"`).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="incidents.csv"');
  res.send(csv);
});

/**
 * Health check (opcional)
 */
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'SIAAS', time: new Date().toISOString() });
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
