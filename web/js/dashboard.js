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

const CAN_CHANGE_STATUS =
  ['TOPICO','SUPERVISOR','ADMIN'].includes(SESSION.role);


// ==========================================
// 1.1 ROLES PARA REPORTES (SOLO SUPERVISOR/ADMIN)
// ==========================================
const REPORT_ROLES_ALLOWED = ['SUPERVISOR', 'ADMIN'];

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
// 2.2 UI REPORTES: mostrar/ocultar por rol + descargas
// ==========================================
function setReportsUI() {
  const adminSection = document.getElementById('adminSection');
  const reportsView = document.getElementById('reportsView');
  const reportsBox = document.getElementById('reportsBox');

  const canSeeReports = REPORT_ROLES_ALLOWED.includes(SESSION.role);

  if (adminSection) adminSection.style.display = canSeeReports ? '' : 'none';
  if (reportsBox) reportsBox.style.display = canSeeReports ? 'flex' : 'none';
  if (reportsView && !canSeeReports) reportsView.style.display = 'none';

  bindReportButtons(canSeeReports);
}

function setReportsMsg(text, isError = false) {
  const el = document.getElementById('reportsMsg');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#b91c1c' : '';
}

async function downloadReport(format) {
  const canSeeReports = REPORT_ROLES_ALLOWED.includes(SESSION.role);
  if (!canSeeReports) {
    alert('No tienes permisos para descargar reportes.');
    return;
  }

  try {
    setReportsMsg(`⏳ Generando ${format.toUpperCase()}...`);

    const url = `/reports/incidents/${format}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SESSION.token}` }
    });

    if (!res.ok) {
      if (res.status === 401) {
        safeLSClear();
        window.location.href = '/login.html';
        return;
      }
      const t = await res.text().catch(() => '');
      throw new Error(`Error ${res.status} ${t ? '- ' + t : ''}`);
    }

    const blob = await res.blob();

    const ts = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    const filename = format === 'excel'
      ? `incidentes_${ts}.xlsx`
      : `incidentes_${ts}.pdf`;

    const a = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    setReportsMsg(`✅ Descargado: ${filename}`);
  } catch (e) {
    console.error('❌ Error descargando reporte:', e);
    setReportsMsg(`❌ ${e.message || e.toString()}`, true);
    alert('Error descargando reporte. Revisa consola.');
  }
}

function bindReportButtons(canSeeReports) {
  const btnExportPdf = document.getElementById('btnExportPdf');
  const btnExportExcel = document.getElementById('btnExportExcel');

  const btnReportPdf = document.getElementById('btnReportPdf');
  const btnReportExcel = document.getElementById('btnReportExcel');

  const all = [btnExportPdf, btnExportExcel, btnReportPdf, btnReportExcel].filter(Boolean);
  all.forEach(b => b.disabled = !canSeeReports);

  if (btnExportPdf) btnExportPdf.onclick = () => downloadReport('pdf');
  if (btnExportExcel) btnExportExcel.onclick = () => downloadReport('excel');

  if (btnReportPdf) btnReportPdf.onclick = () => downloadReport('pdf');
  if (btnReportExcel) btnReportExcel.onclick = () => downloadReport('excel');
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
// 7. RENDER TARJETAS (FLUJO PROFESIONAL)
// ==========================================
function renderCards(data) {
  const cardsEl = document.getElementById('cards');
  const emptyEl = document.getElementById('empty');

  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  let filtered = data.map(i => ({
    ...i,
    statusNorm: normalizeStatus(i.status)
  }));

  filtered.sort((a,b)=>
    new Date(b.received_at) - new Date(a.received_at)
  );

  if (!filtered.length) {
    emptyEl.textContent = 'No hay alertas.';
    return;
  }

  filtered.forEach(i => {

    const label = scoreLabel(i.smart_score ?? 0);
    const state = stateUI(i.statusNorm);

    const card = document.createElement('div');
    card.className = 'cardItem';
    card.style.borderLeft =
      `4px solid ${sevColor(label)}`;

    // 🔥 BOTONES PROFESIONALES
    let actionsHTML = '';

    if (CAN_CHANGE_STATUS) {
      if (i.statusNorm === 'ABIERTO') {
        actionsHTML = `
          <div class="actions">
            <button class="btn ok"
              onclick="changeStatus('${i.id}','EN_ATENCION',this)">
              Atender
            </button>
          </div>
        `;
      }

      if (i.statusNorm === 'EN_ATENCION') {
        actionsHTML = `
          <div class="actions">
            <button class="btn danger"
              onclick="changeStatus('${i.id}','CERRADO',this)">
              Cerrar caso
            </button>
          </div>
        `;
      }
    }

    card.innerHTML = `
      <div class="row">
        <div>
          <div class="title">
            ${(i.tipo || '').replaceAll('_',' ')}
          </div>
          <div class="muted small">
            ${fmtDate(i.received_at)}
          </div>
          <span class="stateBadge ${state.cls}">
            ${state.label}
          </span>
        </div>
        <span class="badge ${sevColor(label)}">
          ${label}
        </span>
      </div>

      <div class="muted small">
        📍 ${fmtCoord(i.latitude)},
        ${fmtCoord(i.longitude)}
      </div>

      ${actionsHTML}
    `;

    cardsEl.appendChild(card);
  });
}
// ==========================================
// 8. MAPA (CONTROL DE CENTRADO CORRECTO)
// ==========================================
let userLocated = false;

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
    if (!i.latitude || !i.longitude) return;
    if (normalizeStatus(i.status) === 'CERRADO') return;

    const lat = parseFloat(i.latitude);
    const lng = parseFloat(i.longitude);

    if (isNaN(lat) || isNaN(lng)) return;

    const sc = i.smart_score ?? 0;
    const col = sc >= 51 ? 'red' : sc >= 31 ? 'orange' : 'green';

    L.circleMarker([lat, lng], {
      radius: 10,
      color: 'white',
      weight: 2,
      fillColor: col,
      fillOpacity: 0.9
    }).addTo(markersLayer);

    bounds.push([lat, lng]);
  });

  // 🔥 Solo centrar si el usuario NO fue localizado aún
  if (!userLocated) {
    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }
}

// ==========================================
// 8.1 UBICACIÓN ACTUAL DEL USUARIO
// ==========================================
function locateUser() {
  if (!navigator.geolocation) {
    console.warn("Geolocalización no soportada.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      userLocated = true; // 🔥 MARCAR QUE YA CENTRAMOS EN EL USUARIO

      L.circleMarker([lat, lng], {
        radius: 10,
        color: 'white',
        weight: 2,
        fillColor: 'blue',
        fillOpacity: 0.9
      })
      .addTo(map)
      .bindPopup("📍 Estás aquí")
      .openPopup();

      map.setView([lat, lng], 15);
    },
    (error) => {
      console.warn("Ubicación no disponible:", error.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}


// ==========================================
// 9. SOCKET.IO
// ==========================================
function initSocket() {
  setConnUI('connecting');

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
        safeLSClear();
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

// ==========================================
// 11. NAVEGACIÓN SIMPLE POR HASH (alertas/historial/reportes)
// ==========================================
function applyHashView() {
  const hash = (window.location.hash || '#alertas').toLowerCase();

  const usersView = document.getElementById('usersView');
  const reportsView = document.getElementById('reportsView');
  const title = document.getElementById('title');

  if (usersView) usersView.style.display = 'none';
  if (reportsView) reportsView.style.display = 'none';

  const canSeeReports = REPORT_ROLES_ALLOWED.includes(SESSION.role);

  if (hash.includes('usuarios')) {
    if (title) title.textContent = 'Usuarios';
    if (usersView) usersView.style.display = '';
  } else if (hash.includes('reportes')) {
    if (title) title.textContent = 'Reportes';
    if (reportsView && canSeeReports) reportsView.style.display = '';
    if (reportsView && !canSeeReports) {
      reportsView.style.display = 'none';
      alert('No tienes permisos para ver reportes.');
      window.location.hash = '#alertas';
    }
  } else {
    if (title) title.textContent = 'Alertas registradas';
  }
}

window.addEventListener('hashchange', applyHashView);

// ARRANQUE
setReportsUI();
applyHashView();

initMap();
locateUser();   // primero ubicamos al usuario
load();         // luego cargamos incidentes
initSocket();
setInterval(load, 5000);


