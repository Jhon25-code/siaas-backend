function ensureAuth() {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

document.getElementById('logout').onclick = () => {
  localStorage.clear();
  window.location.href = '/login.html';
};

// ======================
// DATOS DE SESIÓN
// ======================
const SESSION = {
  token: localStorage.getItem('token') || '',
  role: (localStorage.getItem('role') || '').toUpperCase(),
  name: localStorage.getItem('name') || '',
  zone: localStorage.getItem('zone') || '',
  username: localStorage.getItem('username') || '',
};

document.getElementById('who').textContent =
  `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;

const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado para acceder al panel web.');
  localStorage.clear();
  window.location.href = '/login.html';
}

const CAN_CHANGE_STATUS = ['TOPICO', 'SUPERVISOR', 'ADMIN'].includes(SESSION.role);
const IS_ADMIN = SESSION.role === 'ADMIN';

const adminSection = document.getElementById('adminSection');
if (adminSection) adminSection.style.display = IS_ADMIN ? '' : 'none';

// ======================
// ELEMENTOS
// ======================
const usersView = document.getElementById('usersView');
const reportsView = document.getElementById('reportsView');
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');
const legendIS = document.getElementById('legendIS');
const usersTableWrap = document.getElementById('usersTableWrap');
const btnExportCsv = document.getElementById('btnExportCsv');
const reportsMsg = document.getElementById('reportsMsg');

// ======================
// HELPERS
// ======================
function sevColor(sev) {
  if (sev === 'grave') return 'red';
  if (sev === 'medio') return 'orange';
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

function statusLabel(st) {
  if (st === 'NUEVA') return 'NUEVA';
  if (st === 'RECIBIDA') return 'RECIBIDA';
  if (st === 'EN_ATENCION') return 'EN ATENCIÓN';
  if (st === 'CERRADA') return 'CERRADA';
  return st || 'NUEVA';
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('es-PE'); } catch { return '—'; }
}

function diffMin(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

// ======================
// ROUTER
// ======================
function getRoute() {
  const h = (window.location.hash || '#alertas').toLowerCase();
  if (h === '#usuarios') return 'usuarios';
  if (h === '#reportes') return 'reportes';
  if (h === '#historial') return 'historial';
  return 'alertas';
}

function setActiveNav(route) {
  ['tab-alertas','tab-historial','nav-users','nav-reports']
    .map(id => document.getElementById(id))
    .filter(Boolean)
    .forEach(el => el.classList.remove('active'));

  if (route === 'historial') document.getElementById('tab-historial')?.classList.add('active');
  else if (route === 'usuarios') document.getElementById('nav-users')?.classList.add('active');
  else if (route === 'reportes') document.getElementById('nav-reports')?.classList.add('active');
  else document.getElementById('tab-alertas')?.classList.add('active');
}

function showOnly(view) {
  if (usersView) usersView.style.display = view === 'users' ? '' : 'none';
  if (reportsView) reportsView.style.display = view === 'reports' ? '' : 'none';

  const showIncidents = view === 'incidents';
  if (cardsEl) cardsEl.style.display = showIncidents ? '' : 'none';
  if (emptyEl) emptyEl.style.display = showIncidents ? '' : 'none';
  if (legendIS) legendIS.style.display = showIncidents ? '' : 'none';
}

// ======================
// MODAL
// ======================
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');

function openModal(incident) {
  modalTitle.textContent = `Detalle: ${(incident.tipo || '').replaceAll('_',' ')}`;
  modalSub.textContent = `ID: ${incident.id} · ${fmtDate(incident.received_at)}`;

  const label = scoreLabel(incident.smart_score ?? 0);

  modalBody.innerHTML = `
    <div class="detailGrid">
      <div class="detailBox">
        <div class="muted small">Estado</div>
        <div><b>${statusLabel(incident.status)}</b></div>
      </div>
      <div class="detailBox">
        <div class="muted small">Severidad</div>
        <div><b>${label}</b></div>
      </div>
      <div class="detailBox">
        <div class="muted small">GPS</div>
        <div><b>${fmtCoord(incident.latitude)}</b>, <b>${fmtCoord(incident.longitude)}</b></div>
      </div>
    </div>

    ${incident.descripcion ? `
      <div class="detailBox">
        <div class="muted small">Descripción</div>
        <div><b>${incident.descripcion}</b></div>
      </div>
    ` : ''}
  `;

  modal.classList.remove('hidden');
}

document.getElementById('modalCloseBackdrop')?.onclick = closeModal;
document.getElementById('modalCloseBtn')?.onclick = closeModal;
document.getElementById('modalCloseBtn2')?.onclick = closeModal;

function closeModal() {
  modal.classList.add('hidden');
  modalBody.innerHTML = '';
}

// ======================
// RENDER CARDS
// ======================
function renderCards(data, route) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  if (!data.length) {
    emptyEl.textContent = route === 'historial'
      ? 'No hay incidentes cerrados aún.'
      : 'No hay alertas por el momento.';
    return;
  }

  data.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);

    const c = document.createElement('div');
    c.className = 'cardItem';
    c.dataset.id = i.id;

    c.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_',' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
          <div class="statusPill">${statusLabel(i.status)}</div>
        </div>
        <span class="badge ${sevColor(i.severidad)}">${label}</span>
      </div>

      <div class="muted small">Severidad: <b>${label}</b></div>
      ${i.descripcion ? `<div class="muted small">${i.descripcion}</div>` : ''}
      <div class="muted small">Click en la tarjeta para ver detalle</div>
    `;

    c.onclick = async () => {
      const incident = await API.request(`/incidents/${i.id}`);
      openModal(incident);
    };

    cardsEl.appendChild(c);
  });
}

// ======================
// LOAD
// ======================
async function load() {
  const route = getRoute();
  setActiveNav(route);
  showOnly('incidents');

  document.getElementById('title').textContent =
    route === 'historial' ? 'Historial (incidentes cerrados)' : 'Alertas registradas';

  const url = route === 'historial'
    ? '/incidents?status=CERRADA'
    : '/incidents?status=NUEVA,RECIBIDA,EN_ATENCION';

  const data = await API.request(url);
  renderCards(data, route);
}

window.addEventListener('hashchange', load);
load();
setInterval(load, 4000);
