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

// Configuración de permisos
const CAN_CHANGE_STATUS = true;

// ==========================================
// 2. VARIABLES GLOBALES
// ==========================================
let CURRENT_FILTER = 'ALL';
let currentIncidents = [];
let map, markersLayer;
let socket;

// ==========================================
// 3. FILTROS Y ELEMENTOS DOM
// ==========================================
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    // btn.classList.add('active'); // Descomenta si tienes estilos para active

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

function normalizeStatus(status) {
  if (!status) return 'NUEVA';
  const st = status.toString().toLowerCase();
  if (st === 'pendiente' || st === 'nueva') return 'NUEVA';
  if (st === 'en_atencion' || st === 'en atención') return 'EN_ATENCION';
  if (st === 'cerrado' || st === 'cerrada') return 'CERRADA';
  return status.toUpperCase();
}

function stateUI(status) {
  if (status === 'EN_ATENCION') return { label: 'En atención', cls: 'state-attention' };
  if (status === 'CERRADA') return { label: 'Cerrado', cls: 'state-closed' };
  return { label: 'Abierto', cls: 'state-open' };
}

// ==========================================
// 5. GESTIÓN DE ESTADOS (HU15) - MEJORADO
// ==========================================
async function changeStatus(id, nextStatus, btnElement) {
  // 1. Feedback visual (UX)
  if (btnElement) {
    const originalText = btnElement.innerText;
    btnElement.disabled = true;
    btnElement.innerHTML = '⏳ ...';
  }

  try {
    // 2. Petición al Backend (Usamos fetch directo para control total de errores)
    const token = localStorage.getItem('token');

    // Asumimos ruta relativa '/incidents/...' que maneja el backend Node
    const response = await fetch(`/incidents/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // 🔥 IMPORTANTE: Enviar Token
      },
      body: JSON.stringify({ status: nextStatus })
    });

    // Validar respuesta HTTP
    if (!response.ok) {
        // Intentar leer el mensaje de error del servidor
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `Error ${response.status}`);
    }

    // 3. Éxito: Recargar datos
    await load();

  } catch (error) {
    console.error("Error cambiando estado:", error);
    // Mostrar mensaje real del servidor en el alert
    alert(`⛔ No se pudo actualizar:\n${error.message}`);

    // Restaurar botón si falló
    if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerText = "Reintentar";
    }
  }
}

// ==========================================
// 6. MODAL (DETALLES)
// ==========================================
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const closeModalBtn = document.getElementById('closeModalBtn');
const closeModalX = document.querySelector('.close');

function closeModal() {
    modal.classList.add('hidden');
}

if (closeModalBtn) closeModalBtn.onclick = closeModal;
if (closeModalX) closeModalX.onclick = closeModal;
window.onclick = (event) => {
    if (event.target == modal) closeModal();
};

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
        <p style="background:#f5f5f5; padding:8px; border-radius:4px;">
            ${incident.descripcion || 'Sin descripción adicional.'}
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
    filtered = filtered.filter(i => i.statusNorm === CURRENT_FILTER);
  }

  // Ordenar: Recientes primero
  filtered.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

  if (!filtered.length) {
    emptyEl.textContent = 'No hay alertas activas en esta categoría.';
    return;
  }

  filtered.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);
    const state = stateUI(i.statusNorm);

    // Lógica de botones de acción
    let actionBtn = '';
    if (CAN_CHANGE_STATUS) {
      if (i.statusNorm === 'NUEVA') {
        // Botón VERDE para atender
        actionBtn = `<button class="btn ok"
          onclick="event.stopPropagation(); changeStatus('${i.id}','EN_ATENCION', this)">
          Atender</button>`;
      } else if (i.statusNorm === 'EN_ATENCION') {
        // Botón AMARILLO/ROJO para cerrar
        actionBtn = `<button class="btn danger"
          onclick="event.stopPropagation(); changeStatus('${i.id}','CERRADA', this)">
          Finalizar</button>`;
      } else {
         // Badge gris si está cerrado
         actionBtn = `<span style="color:#999; font-size:0.85rem;">Archivado</span>`;
      }
    }

    const card = document.createElement('div');
    card.className = 'cardItem';
    // Borde izquierdo de color según severidad
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

      <div class="actions">${actionBtn}</div>
    `;

    card.onclick = async () => {
      // Usamos el API request global o fallback a data local
      try {
          // Si tienes API.request disponible globalmente
          if (typeof API !== 'undefined') {
             const freshData = await API.request(`/incidents/${i.id}`);
             openModal(freshData);
          } else {
             openModal(i);
          }
      } catch(e) {
          openModal(i);
      }
    };

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
    if (normalizeStatus(i.status) === 'CERRADA') return;

    const score = i.smart_score ?? 0;
    const color = score >= 51 ? 'red' : score >= 31 ? 'orange' : 'green';

    const marker = L.circleMarker([i.latitude, i.longitude], {
      radius: 10,
      color: 'white',
      weight: 2,
      fillColor: color,
      fillOpacity: 0.9
    });

    marker.bindPopup(`
      <div style="text-align:center">
        <b>${(i.tipo || '').replaceAll('_', ' ')}</b><br>
        <span style="color:${color}; font-weight:bold">${scoreLabel(score)}</span><br>
        <small>${fmtDate(i.received_at)}</small>
      </div>
    `);

    marker.addTo(markersLayer);
  });
}

// ==========================================
// 9. SOCKET.IO (TIEMPO REAL)
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
            <p>${data.tipo} - ${normalizeStatus(data.status)}</p>
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

  socket = io();
  const statusDiv = document.getElementById('connectionStatus');

  socket.on('connect', () => {
    console.log("🟢 WebSocket Conectado");
    if (statusDiv) {
        statusDiv.innerHTML = '🟢 En línea (Tiempo Real)';
        statusDiv.style.color = '#1e7e34';
        statusDiv.style.backgroundColor = '#e6f6ec';
    }
  });

  socket.on('disconnect', () => {
    if (statusDiv) {
        statusDiv.innerHTML = '🔴 Sin conexión';
        statusDiv.style.color = '#d32f2f';
        statusDiv.style.backgroundColor = '#fde8e8';
    }
  });

  socket.on('nueva_alerta', (newIncident) => {
    console.log("⚡ SOCKET: Nueva alerta", newIncident);

    const audio = document.getElementById('alertSound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log("Audio autoplay bloqueado"));
    }

    showToast(newIncident);

    currentIncidents.unshift(newIncident); // Al principio
    renderCards(currentIncidents);
    updateMap(currentIncidents);

    if (map && newIncident.latitude && newIncident.longitude) {
      map.flyTo([newIncident.latitude, newIncident.longitude], 13, { duration: 1.5 });
      L.popup()
        .setLatLng([newIncident.latitude, newIncident.longitude])
        .setContent(`<div style="text-align:center">🚨 <b>¡NUEVA ALERTA!</b><br>${newIncident.tipo}</div>`)
        .openOn(map);
    }
  });

  // Escuchar también cambios de estado desde otros clientes
  socket.on('cambio_estado', (data) => {
      console.log("⚡ SOCKET: Cambio de estado", data);
      // Recargar para ver el nuevo estado
      load();
  });
}

// ==========================================
// 10. HU16: EXPORTAR A CSV (REPORTES)
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
    // Intentamos usar API.request si existe, sino fetch manual
    let data;
    if (typeof API !== 'undefined') {
        data = await API.request('/incidents');
    } else {
        const token = localStorage.getItem('token');
        const res = await fetch('/incidents', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        data = await res.json();
    }

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