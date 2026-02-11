// ==========================================
// 0. STORAGE SEGURO
// ==========================================
function safeLSGet(key) {
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}

function safeLSSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; }
  catch { return false; }
}

function safeLSClear() {
  try { window.localStorage.clear(); }
  catch {}
}

// ==========================================
// 1. AUTENTICACIÓN
// ==========================================
function ensureAuth() {
  const token = safeLSGet('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

document.getElementById('logout').onclick = () => {
  safeLSClear();
  window.location.href = '/login.html';
};

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

const rawToken = safeLSGet('token') || '';
const jwtData = rawToken ? parseJwt(rawToken) : null;

const SESSION = {
  token: rawToken,
  role: (jwtData?.role || '').toUpperCase(),
  name: jwtData?.name || 'Usuario',
  zone: jwtData?.zone || '',
};

const whoEl = document.getElementById('who');
if (whoEl) {
  whoEl.textContent =
    `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;
}

const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado');
  safeLSClear();
  window.location.href = '/login.html';
}

// ==========================================
// VARIABLES GLOBALES
// ==========================================
let CURRENT_FILTER = 'ALL';
let currentIncidents = [];
let map, markersLayer;
let socket;

// ==========================================
// HELPERS
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
  try { return new Date(iso).toLocaleString('es-PE'); }
  catch { return '—'; }
}

function fmtCoord(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(6);
}

function normalizeStatus(status) {
  if (!status) return 'ABIERTO';
  const st = status.toString().toLowerCase();
  if (['abierto', 'pendiente', 'nueva'].includes(st)) return 'ABIERTO';
  if (['en_atencion', 'en atención'].includes(st)) return 'EN_ATENCION';
  if (['cerrado', 'finalizado'].includes(st)) return 'CERRADO';
  return 'ABIERTO';
}

// ==========================================
// RENDER TARJETAS
// ==========================================
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');

function renderCards(data) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  let filtered = data.map(i => ({
    ...i,
    statusNorm: normalizeStatus(i.status)
  }));

  if (!filtered.length) {
    emptyEl.textContent = 'No hay alertas.';
    return;
  }

  filtered.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);

    const card = document.createElement('div');
    card.className = 'cardItem';
    card.style.borderLeft = `4px solid ${sevColor(label)}`;

    card.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_', ' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
        </div>
        <span class="badge ${sevColor(label)}">${label}</span>
      </div>
      <div class="muted small">
        📍 ${fmtCoord(i.latitude)}, ${fmtCoord(i.longitude)}
      </div>
    `;

    cardsEl.appendChild(card);
  });
}

// ==========================================
// MAPA CORREGIDO
// ==========================================
function initMap() {
  if (map) return;

  map = L.map('map').setView([-9.19, -75.015], 5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function updateMap(incidents) {
  if (!map) initMap();

  markersLayer.clearLayers();
  const bounds = [];

  incidents.forEach(i => {
    if (normalizeStatus(i.status) === 'CERRADO') return;

    const lat = parseFloat(i.latitude);
    const lng = parseFloat(i.longitude);

    if (isNaN(lat) || isNaN(lng)) return;

    const sc = i.smart_score ?? 0;
    const col = sc >= 51 ? 'red' : sc >= 31 ? 'orange' : 'green';

    const marker = L.circleMarker([lat, lng], {
      radius: 10,
      color: 'white',
      weight: 2,
      fillColor: col,
      fillOpacity: 0.9
    }).addTo(markersLayer);

    marker.bindPopup(`
      <b>${(i.tipo || '').replaceAll('_', ' ')}</b><br>
      Estado: ${normalizeStatus(i.status)}<br>
      Score: ${sc}<br>
      ${fmtDate(i.received_at)}
    `);

    bounds.push([lat, lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  } else if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

// ==========================================
// SOCKET.IO
// ==========================================
function initSocket() {
  socket = io(window.location.origin);

  socket.on('connect', () => console.log('Socket conectado'));

  socket.on('nueva_alerta', (i) => {
    currentIncidents.unshift(i);
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  });

  socket.on('cambio_estado', () => load());
}

// ==========================================
// CARGA INICIAL
// ==========================================
async function load() {
  try {
    const res = await fetch('/incidents', {
      headers: { 'Authorization': `Bearer ${SESSION.token}` }
    });

    if (!res.ok) return;

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

// ==========================================
// ARRANQUE
// ==========================================
load();
initMap();
initSocket();
setInterval(load, 5000);
