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
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
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
  name: jwtData?.username || 'Usuario',
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
// 3. FILTROS
// ==========================================
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    // btn.classList.add('active'); // Descomenta si usas clase active en CSS
    CURRENT_FILTER = btn.dataset.filter;
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  });
});

const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');

// ==========================================
// 4. HELPERS DE FORMATO
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

// 🔥 NORMALIZACIÓN DE ESTADOS
function normalizeStatus(status) {
  if (!status) return 'NUEVA';
  const st = status.toString().toLowerCase();

  // Mapeo estricto
  if (st === 'nueva' || st === 'pendiente' || st === 'abierto') return 'ABIERTO';
  if (st === 'en_atencion' || st === 'en atención') return 'EN_ATENCION';
  if (st === 'cerrada' || st === 'cerrado') return 'CERRADO';

  return 'ABIERTO';
}

function stateUI(statusNorm) {
  if (statusNorm === 'EN_ATENCION') return { label: 'En atención', cls: 'state-attention' };
  if (statusNorm === 'CERRADO') return { label: 'Cerrado', cls: 'state-closed' };
  return { label: 'Abierto', cls: 'state-open' };
}

// ==========================================
// 5. GESTIÓN DE ESTADOS
// ==========================================
async function changeStatus(id, nextStatus, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = '⏳ ...';
  }

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/incidents/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: nextStatus })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error ${response.status}`);
    }
    await load();

  } catch (error) {
    alert(`⛔ Error:\n${error.message}`);
    if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerText = "Reintentar";
    }
  }
}

// ==========================================
// 6. MODAL
// ==========================================
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const closeModalBtn = document.getElementById('closeModalBtn');
const closeModalX = document.querySelector('.close');

function closeModal() { modal.classList.add('hidden'); }
if (closeModalBtn) closeModalBtn.onclick = closeModal;
if (closeModalX) closeModalX.onclick = closeModal;
window.onclick = (e) => { if (e.target == modal) closeModal(); };

function openModal(incident) {
  const stUI = stateUI(normalizeStatus(incident.status));

  modalTitle.textContent = `Detalle: ${(incident.tipo || '').replaceAll('_', ' ')}`;
  modalSub.textContent = `ID: ${incident.id} · ${fmtDate(incident.received_at)}`;

  modalBody.innerHTML = `
    <div class="detailGrid">
      <div><b>Estado:</b> <span class="${stUI.cls}" style="padding:2px 6px; border-radius:4px;">${stUI.label}</span></div>
      <div><b>Severidad:</b> ${scoreLabel(incident.smart_score ?? 0)}</div>
      <div><b>GPS:</b> ${fmtCoord(incident.latitude)}, ${fmtCoord(incident.longitude)}</div>
      <div style="grid-column: span 2; margin-top: 10px;">
        <b>Descripción:</b><br>
        <p style="background:#f5f5f5; padding:8px; border-radius:4px;">
            ${incident.descripcion || 'Sin descripción.'}
        </p>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
}

// ==========================================
// 7. RENDERIZADO DE TARJETAS
// ==========================================
function renderCards(data) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  let filtered = data.map(i => ({
    ...i,
    statusNorm: normalizeStatus(i.status)
  }));

  if (CURRENT_FILTER !== 'ALL') {
    let filterKey = CURRENT_FILTER;
    if (CURRENT_FILTER === 'NUEVA') filterKey = 'ABIERTO';
    filtered = filtered.filter(i => i.statusNorm === filterKey);
  }

  filtered.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

  if (!filtered.length) {
    emptyEl.textContent = 'No hay alertas.';
    return;
  }

  filtered.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);
    const state = stateUI(i.statusNorm);

    let actionArea = '';

    if (CAN_CHANGE_STATUS) {
      if (i.statusNorm === 'ABIERTO') {
        actionArea = `<button class="btn ok"
          onclick="event.stopPropagation(); changeStatus('${i.id}','EN_ATENCION', this)">
          Atender</button>`;
      } else if (i.statusNorm === 'EN_ATENCION') {
        actionArea = `<button class="btn danger"
          onclick="event.stopPropagation(); changeStatus('${i.id}','CERRADO', this)">
          Finalizar</button>`;
      } else {
         actionArea = `<span class="badge-closed">Cerrado</span>`;
      }
    }

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

      <div class="muted small" style="margin-top:6px;">
        📍 <b>${fmtCoord(i.latitude)}</b>, <b>${fmtCoord(i.longitude)}</b>
      </div>

      <div class="actions">${actionArea}</div>
    `;

    card.onclick = () => openModal(i);
    cardsEl.appendChild(card);
  });
}

// ==========================================
// 8. MAPA (LEAFLET)
// ==========================================
function initMap() {
  if (map) return;
  map = L.map('map').setView([-9.19, -75.015], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function updateMap(incidents) {
  if (!map) initMap();
  markersLayer.clearLayers();

  incidents.forEach(i => {
    if (!i.latitude || !i.longitude) return;
    if (normalizeStatus(i.status) === 'CERRADO') return;

    const sc = i.smart_score ?? 0;
    const col = sc >= 51 ? 'red' : sc >= 31 ? 'orange' : 'green';

    L.circleMarker([i.latitude, i.longitude], {
      radius: 10,
      color: 'white',
      fillColor: col,
      fillOpacity: 0.9
    }).bindPopup(i.tipo).addTo(markersLayer);
  });
}

// ==========================================
// 9. SOCKET.IO (CONEXIÓN ROBUSTA)
// ==========================================
function showToast(data) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
      <div class="toast-icon">🚨</div>
      <div class="toast-content">
          <strong>¡NUEVA ALERTA!</strong>
          <p>${data.tipo}</p>
      </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function initSocket() {
  if (typeof io === 'undefined') {
    console.error("Socket.io no cargado");
    return;
  }

  // 🔥 FIX: Forzar conexión a la URL real para evitar "Conectando..." infinito
  socket = io('https://siaas-backend.onrender.com', {
    transports: ['websocket', 'polling'],
    reconnection: true
  });

  const statusDiv = document.getElementById('connectionStatus');

  socket.on('connect', () => {
    console.log("🟢 Conectado a Socket.io");
    if (statusDiv) {
      statusDiv.innerHTML = '🟢 En línea (Tiempo Real)';
      statusDiv.style.color = '#1e7e34';
      statusDiv.style.backgroundColor = '#d4edda';
    }
  });

  socket.on('disconnect', () => {
    if (statusDiv) {
      statusDiv.innerHTML = '🔴 Desconectado';
      statusDiv.style.color = '#721c24';
      statusDiv.style.backgroundColor = '#f8d7da';
    }
  });

  socket.on('nueva_alerta', (newIncident) => {
    // Sonido
    const audio = document.getElementById('alertSound');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(e => console.log("Audio autoplay bloqueado"));
    }

    showToast(newIncident);
    currentIncidents.unshift(newIncident);
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  });

  socket.on('cambio_estado', () => {
    load(); // Recargar lista si otro usuario cambia estado
  });
}

// ==========================================
// 10. EXPORTAR A CSV
// ==========================================
const btnExport = document.getElementById('btnExportCsv');
if (btnExport) {
  btnExport.onclick = () => {
    if (!currentIncidents || currentIncidents.length === 0) {
      alert("No hay incidentes para exportar.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID;FECHA;TIPO;ESTADO;SEVERIDAD;LATITUD;LONGITUD;DESCRIPCION\n";

    currentIncidents.forEach(item => {
      const fecha = new Date(item.received_at).toLocaleString('es-PE');
      const tipo = (item.tipo || '').toUpperCase();
      const score = item.smart_score ?? 0;
      const severidad = score >= 51 ? 'GRAVE' : score >= 31 ? 'MEDIO' : 'LEVE';
      const desc = (item.descripcion || '').replace(/(\r\n|\n|\r)/gm, " ").replace(/;/g, ",");

      const row = [
        item.id,
        fecha,
        tipo,
        normalizeStatus(item.status),
        severidad,
        item.latitude || 0,
        item.longitude || 0,
        desc
      ].join(";");

      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const fileName = `reporte_siaas_${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
}

// ==========================================
// 11. INICIALIZACIÓN
// ==========================================
async function load() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/incidents', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    currentIncidents = data;
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  } catch (e) {
    console.error("Error cargando incidentes", e);
  }
}

// Arranque
load();
initMap();
initSocket();
// Polling de seguridad cada 15s
setInterval(load, 15000);