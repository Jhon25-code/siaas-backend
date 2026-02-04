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
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
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
  role: (jwtData?.role || '').toUpperCase(),
  name: jwtData?.username || 'Usuario',
  zone: jwtData?.zone || '',
};

const whoEl = document.getElementById('who');
if (whoEl) {
  whoEl.textContent =
    `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;
}

// ================= ROLES =================
const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado');
  localStorage.clear();
  window.location.href = '/login.html';
}

const CAN_CHANGE_STATUS = true;

// ================= VARIABLES GLOBALES =================
let CURRENT_FILTER = 'ALL';
let currentIncidents = []; // ✅ Cache local para evitar parpadeos
let map, markersLayer;
let socket; // ✅ Variable para la conexión en tiempo real

// ================= FILTRO =================
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    CURRENT_FILTER = btn.dataset.filter;
    // Actualizamos UI usando la cache local sin volver a pedir a la API
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  });
});

// ================= ELEMENTOS =================
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');

// ================= HELPERS =================
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

// ================= NORMALIZAR ESTADO (CLAVE) =================
function normalizeStatus(status) {
  if (!status) return 'NUEVA';
  const st = status.toString().toLowerCase();
  if (st === 'pendiente' || st === 'nueva') return 'NUEVA';
  if (st === 'en_atencion' || st === 'en atención') return 'EN_ATENCION';
  if (st === 'cerrado' || st === 'cerrada') return 'CERRADA';
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
  // if (!confirm(`¿Cambiar estado a ${nextStatus}?`)) return; // Opcional: quitar confirmación para agilidad

  await API.request(`/incidents/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: nextStatus })
  });

  // Al cambiar estado, recargamos para ver el cambio
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
      <div><b>Estado:</b> ${normalizeStatus(incident.status)}</div>
      <div><b>Severidad:</b> ${scoreLabel(incident.smart_score ?? 0)}</div>
      <div><b>GPS:</b> ${fmtCoord(incident.latitude)}, ${fmtCoord(incident.longitude)}</div>
      <div style="grid-column: span 2; margin-top: 10px;">
        <b>Descripción:</b><br>
        ${incident.descripcion || 'Sin descripción adicional.'}
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
}

// ================= TARJETAS (ESTILO CORRECTO) =================
function renderCards(data) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  // 1. Filtrado en memoria
  let filtered = data.map(i => ({
    ...i,
    statusNorm: normalizeStatus(i.status)
  }));

  if (CURRENT_FILTER !== 'ALL') {
    filtered = filtered.filter(i => i.statusNorm === CURRENT_FILTER);
  }

  // Ordenar: Las más recientes primero
  filtered.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

  if (!filtered.length) {
    emptyEl.textContent = 'No hay alertas activas en esta categoría.';
    return;
  }

  filtered.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);
    const state = stateUI(i.statusNorm);

    let actionBtn = '';
    if (CAN_CHANGE_STATUS) {
      if (i.statusNorm === 'NUEVA') {
        actionBtn = `<button class="btn ok"
          onclick="event.stopPropagation(); changeStatus('${i.id}','EN_ATENCION')">
          Atender</button>`;
      } else if (i.statusNorm === 'EN_ATENCION') {
        actionBtn = `<button class="btn danger"
          onclick="event.stopPropagation(); changeStatus('${i.id}','CERRADA')">
          Cerrar</button>`;
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

      <div class="muted small" style="margin-top:6px;">
        📍 GPS: <b>${fmtCoord(i.latitude)}</b>, <b>${fmtCoord(i.longitude)}</b>
      </div>

      <div class="actions">${actionBtn}</div>
    `;

    card.onclick = async () => {
      // Si ya tenemos el dato en memoria, no hace falta llamar a API, pero por seguridad lo dejamos
      // openModal(i); // Opción rápida
      const incident = await API.request(`/incidents/${i.id}`);
      openModal(incident);
    };

    cardsEl.appendChild(card);
  });
}

// ================= MAPA (LEAFLET) =================
function initMap() {
  if (map) return;

  // Centro inicial (Perú aprox)
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
    if (normalizeStatus(i.status) === 'CERRADA') return; // No mostramos cerrados en mapa

    const score = i.smart_score ?? 0;
    const color = score >= 51 ? 'red' : score >= 31 ? 'orange' : 'green';

    // Crear marcador circular
    const marker = L.circleMarker([i.latitude, i.longitude], {
      radius: 10,
      color: 'white',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.9
    });

    // Popup simple
    marker.bindPopup(`
      <b>${(i.tipo || '').replaceAll('_', ' ')}</b><br>
      Severidad: ${scoreLabel(score)}<br>
      ${fmtDate(i.received_at)}
    `);

    marker.addTo(markersLayer);
  });
}

// ================= HELPERS UI (TOAST) =================
function showToast(data) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-icon">🚨</div>
        <div class="toast-content">
            <strong>¡NUEVO INCIDENTE!</strong>
            <p>${data.tipo} - ${normalizeStatus(data.status)}</p>
        </div>
    `;

    container.appendChild(toast);

    // Remover después de 5 segundos
    setTimeout(() => {
        toast.remove();
    }, 5000);
}

// ================= SOCKET.IO & TIEMPO REAL =================
function initSocket() {
  // Aseguramos que io existe (cargado por CDN en HTML)
  if (typeof io === 'undefined') {
    console.error("Socket.io no cargado");
    return;
  }

  socket = io(); // Conecta automáticamente al host actual
  const statusDiv = document.getElementById('connectionStatus');

  // ✅ EVENTO: Conexión Exitosa
  socket.on('connect', () => {
    console.log("🟢 WebSocket Conectado ID:", socket.id);
    if (statusDiv) {
        statusDiv.innerHTML = '🟢 En línea (Tiempo Real)';
        statusDiv.style.color = '#1e7e34'; // Verde Oscuro
        statusDiv.style.backgroundColor = '#e6f6ec'; // Verde Claro
    }
  });

  // ✅ EVENTO: Desconexión
  socket.on('disconnect', () => {
    console.log("🔴 WebSocket Desconectado");
    if (statusDiv) {
        statusDiv.innerHTML = '🔴 Sin conexión';
        statusDiv.style.color = '#d32f2f'; // Rojo
        statusDiv.style.backgroundColor = '#fde8e8'; // Rojo Claro
    }
  });

  // ✅ EVENTO: NUEVA ALERTA
  socket.on('nueva_alerta', (newIncident) => {
    console.log("⚡ SOCKET: Nueva alerta recibida", newIncident);

    // A. Reproducir sonido
    const audio = document.getElementById('alertSound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log("Audio autoplay bloqueado"));
    }

    // B. Mostrar Notificación Visual (Toast)
    showToast(newIncident);

    // C. Agregar a la lista local inmediatamente
    currentIncidents.push(newIncident);

    // D. Actualizar UI
    renderCards(currentIncidents);
    updateMap(currentIncidents);

    // E. INNOVACIÓN: Volar hacia el incidente en el mapa
    if (map && newIncident.latitude && newIncident.longitude) {
      map.flyTo([newIncident.latitude, newIncident.longitude], 13, {
        duration: 2.0 // Animación suave
      });

      // Abrir popup automáticamente
      L.popup()
        .setLatLng([newIncident.latitude, newIncident.longitude])
        .setContent(`<div style="text-align:center">🚨 <b>¡NUEVA ALERTA!</b><br>${newIncident.tipo}</div>`)
        .openOn(map);
    }
  });
}

// ================= CARGA DE DATOS =================
async function load() {
  try {
    const data = await API.request('/incidents');
    currentIncidents = data; // Guardamos en global
    renderCards(currentIncidents);
    updateMap(currentIncidents);
  } catch (e) {
    console.error("Error cargando incidentes", e);
  }
}

// ================= INICIALIZACIÓN =================
// 1. Cargar datos iniciales
load();

// 2. Iniciar mapa vacío (para que se vea mientras carga)
initMap();

// 3. Iniciar escuchas en tiempo real
initSocket();

// 4. Polling de respaldo (cada 10s por si acaso falla el socket)
setInterval(load, 10000);