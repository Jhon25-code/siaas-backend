// ================= AUTENTICACIÓN =================
function ensureAuth() {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

// ================= LOGOUT =================
document.getElementById('logout').onclick = () => {
  localStorage.clear();
  window.location.href = '/login.html';
};

// ================= JWT PARSE =================
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

// ================= SESIÓN =================
const rawToken = localStorage.getItem('token') || '';
const jwtData = rawToken ? parseJwt(rawToken) : null;

const SESSION = {
  token: rawToken,
  role: (jwtData?.role || localStorage.getItem('role') || '').toUpperCase(),
  name: jwtData?.username || localStorage.getItem('name') || 'Usuario',
  zone: jwtData?.zone || localStorage.getItem('zone') || '',
};

const whoEl = document.getElementById('who');
if (whoEl) {
  whoEl.textContent =
    `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;
}

// ================= ROLES =================
const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];

if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado para acceder al panel web.');
  localStorage.clear();
  window.location.href = '/login.html';
}

const CAN_CHANGE_STATUS = WEB_ROLES_ALLOWED.includes(SESSION.role);

// ================= FILTRO =================
let CURRENT_FILTER = 'ALL';

document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    CURRENT_FILTER = btn.dataset.filter;
    load();
  });
});

// ================= ELEMENTOS =================
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');

// ================= HELPERS =================
function sevColor(label) {
  if (label === 'Grave') return 'red';
  if (label === 'Medio') return 'orange';
  return 'green';
}

function scoreLabel(score) {
  if (score >= 51) return 'Grave';
  if (score >= 31) return 'Medio';
  return 'Leve';
}

function fmtCoord(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(6);
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('es-PE'); } catch { return '—'; }
}

// ================= NORMALIZAR ESTADO =================
function normalizeStatus(status) {
  if (!status) return 'NUEVA';

  const st = status.toLowerCase();

  if (st === 'pendiente') return 'NUEVA';
  if (st === 'en_atencion') return 'EN_ATENCION';
  if (st === 'cerrado') return 'CERRADA';

  return status.toUpperCase();
}

// ================= ESTADO VISUAL =================
function stateUI(status) {
  if (status === 'EN_ATENCION') return { label: 'En atención', cls: 'state-attention' };
  if (status === 'CERRADA') return { label: 'Cerrado', cls: 'state-closed' };
  return { label: 'Abierto', cls: 'state-open' };
}

// ================= CAMBIO DE ESTADO =================
async function changeStatus(id, nextStatus) {
  if (!confirm(`¿Cambiar estado a "${nextStatus}"?`)) return;

  await API.request(`/incidents/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: nextStatus.toLowerCase() })
  });

  load();
}

// ================= MODAL =================
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');

function openModal(incident) {
  modalTitle.textContent = `Detalle: ${(incident.tipo || '').replaceAll('_', ' ')}`;
  modalSub.textContent = `ID: ${incident.id} · ${fmtDate(incident.received_at)}`;

  modalBody.innerHTML = `
    <div class="detailGrid">
      <div class="detailBox">
        <div class="muted small">Estado</div>
        <b>${normalizeStatus(incident.status)}</b>
      </div>
      <div class="detailBox">
        <div class="muted small">Severidad</div>
        <b>${scoreLabel(incident.smart_score ?? 0)}</b>
      </div>
      <div class="detailBox">
        <div class="muted small">GPS</div>
        <b>${fmtCoord(incident.latitude)}</b>,
        <b>${fmtCoord(incident.longitude)}</b>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

// ================= TARJETAS =================
function renderCards(data) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  // 🔥 SOLO ACTIVOS
  data = data.filter(i => normalizeStatus(i.status) !== 'CERRADA');

  if (!data.length) {
    emptyEl.textContent = 'No hay alertas activas.';
    return;
  }

  data.forEach(i => {
    const status = normalizeStatus(i.status);
    const label = scoreLabel(i.smart_score ?? 0);
    const state = stateUI(status);

    let actionBtn = '';
    if (CAN_CHANGE_STATUS) {
      if (status === 'NUEVA') {
        actionBtn = `<button class="btn ok" onclick="event.stopPropagation(); changeStatus(${i.id}, 'en_atencion')">En atención</button>`;
      } else if (status === 'EN_ATENCION') {
        actionBtn = `<button class="btn danger" onclick="event.stopPropagation(); changeStatus(${i.id}, 'cerrado')">Cerrar</button>`;
      }
    }

    const card = document.createElement('div');
    card.className = 'cardItem';

    card.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_', ' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
          <span class="stateBadge ${state.cls}">${state.label}</span>
        </div>
        <span class="badge ${sevColor(label)}">${label}</span>
      </div>

      <div class="muted small">
        GPS: <b>${fmtCoord(i.latitude)}</b>, <b>${fmtCoord(i.longitude)}</b>
      </div>

      <div class="actions" style="margin-top:10px;">
        ${actionBtn}
      </div>
    `;

    card.onclick = async () => {
      const incident = await API.request(`/incidents/${i.id}`);
      openModal(incident);
    };

    cardsEl.appendChild(card);
  });
}

// ================= CARGA =================
async function load() {
  let data = await API.request('/incidents');

  if (CURRENT_FILTER !== 'ALL') {
    data = data.filter(i => normalizeStatus(i.status) === CURRENT_FILTER);
  }

  renderCards(data);
  updateMap(data);
}

load();
setInterval(load, 4000);

// ================= MAPA =================
let map;
let markersLayer;

function initMap() {
  if (map) return;

  map = L.map('map').setView([-9.19, -75.015], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function sevColorMap(score) {
  if (score >= 51) return 'red';
  if (score >= 31) return 'orange';
  return 'green';
}

function updateMap(incidents) {
  if (!map) initMap();

  markersLayer.clearLayers();

  incidents.forEach(i => {
    if (!i.latitude || !i.longitude) return;
    if (normalizeStatus(i.status) === 'CERRADA') return;

    const color = sevColorMap(i.smart_score ?? 0);

    L.circleMarker([i.latitude, i.longitude], {
      radius: 8,
      color,
      fillColor: color,
      fillOpacity: 0.85
    }).bindPopup(`
      <b>${(i.tipo || '').replaceAll('_',' ')}</b><br>
      Severidad: ${scoreLabel(i.smart_score ?? 0)}<br>
      Estado: ${normalizeStatus(i.status)}
    `).addTo(markersLayer);
  });
}
