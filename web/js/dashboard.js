// ==========================================
// 0. STORAGE SEGURO (evita: Access to storage is not allowed)
// ==========================================
function safeLSGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    console.warn('⚠️ Storage bloqueado (getItem):', e);
    return null;
  }
}

function safeLSSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('⚠️ Storage bloqueado (setItem):', e);
    return false;
  }
}

function safeLSClear() {
  try {
    window.localStorage.clear();
  } catch (e) {
    console.warn('⚠️ Storage bloqueado (clear):', e);
  }
}

// ==========================================
// 1. AUTENTICACIÓN Y SESIÓN
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
  whoEl.textContent = `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;
}

const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado');
  safeLSClear();
  window.location.href = '/login.html';
}

const CAN_CHANGE_STATUS = true;
const REPORT_ROLES_ALLOWED = ['SUPERVISOR', 'ADMIN'];

// ==========================================
// 2. VARIABLES GLOBALES
// ==========================================
let CURRENT_FILTER = 'ALL';
let currentIncidents = [];
let map, markersLayer;
let socket;

// ==========================================
// 3. HELPERS
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
// 4. NORMALIZACIÓN DE ESTADO
// ==========================================
function normalizeStatus(status) {
  if (!status) return 'ABIERTO';
  const st = status.toString().toLowerCase();

  if (['abierto', 'pendiente', 'nueva'].includes(st)) return 'ABIERTO';
  if (['en_atencion', 'en atención'].includes(st)) return 'EN_ATENCION';
  if (['cerrado', 'cerrada', 'finalizado'].includes(st)) return 'CERRADO';

  return 'ABIERTO';
}

// ==========================================
// 5. MAPA
// ==========================================
function initMap() {
  if (map) return;
  map = L.map('map').setView([-9.19, -75.015], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

// 🔥 FUNCIÓN CORREGIDA
function updateMap(incidents) {
  if (!map) initMap();
  markersLayer.clearLayers();

  const bounds = [];

  incidents.forEach(i => {
    if (i.latitude === null || i.latitude === undefined) return;
    if (i.longitude === null || i.longitude === undefined) return;
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
      <strong>${(i.tipo || '').replaceAll('_', ' ')}</strong><br>
      Estado: ${normalizeStatus(i.status)}<br>
      Score: ${sc}
    `);

    bounds.push([lat, lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 13);
  } else if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

// ==========================================
// 6. CARGA INICIAL
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
setInterval(load, 5000);
