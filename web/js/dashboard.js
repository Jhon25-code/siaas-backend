// ==========================================
// 1. AUTENTICACIÓN Y SESIÓN
// ==========================================
function ensureAuth() {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

document.getElementById('logout').onclick = () => {
  localStorage.clear();
  window.location.href = '/login.html';
};

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

const rawToken = localStorage.getItem('token') || '';
const jwtData = rawToken ? parseJwt(rawToken) : null;

const SESSION = {
  token: rawToken,
  role: (jwtData?.role || '').toUpperCase(),
  name: jwtData?.name || 'Usuario',
  zone: jwtData?.zone || '',
};

const whoEl = document.getElementById('who');
if (whoEl) {
  whoEl.textContent = `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;
}

const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado');
  localStorage.clear();
  window.location.href = '/login.html';
}

const CAN_CHANGE_STATUS = true;

// ==========================================
// 2. VARIABLES GLOBALES
// ==========================================
let CURRENT_FILTER = 'ALL';
let currentIncidents = [];
let map, markersLayer;
let socket;

// ==========================================
// 2.1 UI CONEXIÓN (para "Conectando..." / "Conectado")
// ==========================================
function setConnUI(state, extraText) {
  // intenta varios ids/clases comunes sin romper si no existen
  const candidates = [
    document.getElementById('connStatus'),
    document.getElementById('statusConn'),
    document.getElementById('connectionStatus'),
    document.getElementById('status'),
    document.querySelector('.connStatus'),
    document.querySelector('[data-conn-status]'),
  ].filter(Boolean);

  if (!candidates.length) return;

  let text = 'Conectando...';
  if (state === 'connected') text = 'Conectado';
  if (state === 'disconnected') text = 'Desconectado';
  if (state === 'error') text = 'Error de conexión';

  if (extraText) text += ` (${extraText})`;

  candidates.forEach(el => (el.textContent = text));
}

// ==========================================
// 3. FILTROS
// ==========================================
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    CURRENT_FILTER = btn.dataset.filter;
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  });
});

const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');

// ==========================================
// 4. HELPERS
// ==========================================
function scoreLabel(score) {
  if (score >= 51) return 'Grave';
  if (score >= 31) return 'Medio';
  return 'Leve';
}

function sevColor(label) {
  if (label === 'Grave') return 'red';
  if (label === 'Medio') return 'orange';
  return 'green';
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('es-PE'); } catch { return '—'; }
}

function fmtCoord(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(6);
}

// ==========================================
// 5. NORMALIZACIÓN DE ESTADO
// ==========================================
function normalizeStatus(status) {
  if (!status) return 'ABIERTO';
  const st = status.toString().toLowerCase();

  if (['abierto', 'pendiente', 'nueva'].includes(st)) return 'ABIERTO';
  if (['en_atencion', 'en atención', 'en_atencion '].includes(st)) return 'EN_ATENCION';
  if (['cerrado', 'cerrada', 'finalizado'].includes(st)) return 'CERRADO';

  return 'ABIERTO';
}

function stateUI(statusNorm) {
  if (statusNorm === 'EN_ATENCION') return { label: 'En atención', cls: 'state-attention' };
  if (statusNorm === 'CERRADO') return { label: 'Cerrado', cls: 'state-closed' };
  return { label: 'Abierto', cls: 'state-open' };
}

// ==========================================
// 6. CAMBIO DE ESTADO
// ==========================================
async function changeStatus(id, nextStatus, btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳';
  }

  try {
    const res = await fetch(`/incidents/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SESSION.token}`
      },
      body: JSON.stringify({ status: nextStatus })
    });

    if (!res.ok) throw new Error(`Error ${res.status}`);
    await load();
  } catch (e) {
    alert('Error al cambiar estado');
    if (btn) btn.disabled = false;
  }
}

// ==========================================
// 7. RENDER TARJETAS
// ==========================================
function renderCards(data) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  let filtered = data.map(i => ({
    ...i,
    statusNorm: normalizeStatus(i.status)
  }));

  if (CURRENT_FILTER !== 'ALL') {
    const f = CURRENT_FILTER === 'NUEVA' ? 'ABIERTO' : CURRENT_FILTER;
    filtered = filtered.filter(i => i.statusNorm === f);
  }

  filtered.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

  if (!filtered.length) {
    emptyEl.textContent = 'No hay alertas.';
    return;
  }

  filtered.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);
    const state = stateUI(i.statusNorm);

    const card = document.createElement('div');
    card.className = 'cardItem';
    card.style.borderLeft = `4px solid ${sevColor(label)}`;

    card.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_', ' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
          <span class="stateBadge ${state.cls}">${state.label}</span>
        </div>
        <span class="badge ${sevColor(label)}">${label}</span>
      </div>
      <div class="muted small">📍 ${fmtCoord(i.latitude)}, ${fmtCoord(i.longitude)}</div>
    `;

    cardsEl.appendChild(card);
  });
}

// ==========================================
// 8. MAPA
// ==========================================
function initMap() {
  if (map) return;
  map = L.map('map').setView([-9.19, -75.015], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function updateMap(incidents) {
  if (!map) initMap();
  markersLayer.clearLayers();

  incidents.forEach(i => {
    // NO filtrar 0, solo null/undefined
    if (i.latitude === null || i.latitude === undefined) return;
    if (i.longitude === null || i.longitude === undefined) return;
    if (normalizeStatus(i.status) === 'CERRADO') return;

    const sc = i.smart_score ?? 0;
    const col = sc >= 51 ? 'red' : sc >= 31 ? 'orange' : 'green';

    L.circleMarker([i.latitude, i.longitude], {
      radius: 10,
      color: 'white',
      fillColor: col,
      fillOpacity: 0.9
    }).addTo(markersLayer);
  });
}

// ==========================================
// 9. SOCKET.IO
// ==========================================
function initSocket() {
  setConnUI('connecting');

  // ✅ mismo origen (https en Render) + reconexión estable
  socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  socket.on('connect', () => {
    console.log('✅ Socket conectado:', socket.id);
    setConnUI('connected');
  });

  socket.on('disconnect', (reason) => {
    console.warn('⚠️ Socket desconectado:', reason);
    setConnUI('disconnected', reason);
  });

  socket.on('connect_error', (err) => {
    console.error('❌ Socket connect_error:', err?.message || err);
    setConnUI('error', err?.message || 'connect_error');
  });

  socket.on('nueva_alerta', (i) => {
    console.log('🚨 nueva_alerta:', i);

    currentIncidents.unshift(i);
    renderCards(currentIncidents);
    updateMap(currentIncidents);

    // Hooks opcionales (si existen en tu proyecto)
    try {
      if (typeof window.playAlarmSound === 'function') window.playAlarmSound(i);
      if (typeof window.showToast === 'function') window.showToast(i);
      if (typeof window.showAlarm === 'function') window.showAlarm(i);
    } catch (e) {
      console.warn('⚠️ Error ejecutando hooks de alarma:', e);
    }
  });

  socket.on('cambio_estado', () => {
    load();
  });
}

// ==========================================
// 10. CARGA INICIAL
// ==========================================
async function load() {
  try {
    const res = await fetch('/incidents', {
      headers: { 'Authorization': `Bearer ${SESSION.token}` }
    });

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.clear();
        window.location.href = '/login.html';
      }
      return;
    }

    const data = await res.json();
    if (Array.isArray(data)) {
      currentIncidents = data;
      renderCards(data);
      updateMap(data);
    }
  } catch (e) {
    console.error('Error cargando incidentes', e);
  }
}

// ARRANQUE
load();
initMap();
initSocket();
setInterval(load, 5000);
