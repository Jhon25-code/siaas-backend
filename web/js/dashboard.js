function ensureAuth() {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

document.getElementById('logout').onclick = () => {
  localStorage.clear();
  window.location.href = '/login.html';
};

// Datos de sesión
const SESSION = {
  token: localStorage.getItem('token') || '',
  role: (localStorage.getItem('role') || '').toUpperCase(),
  name: localStorage.getItem('name') || '',
  zone: localStorage.getItem('zone') || '',
  username: localStorage.getItem('username') || '',
};

// Mostrar "quién"
document.getElementById('who').textContent =
  `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;

/**
 * ✅ Control de acceso por rol
 * Este dashboard es para WEB (TOPICO/SUPERVISOR/ADMIN).
 */
const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado para acceder al panel web.');
  localStorage.clear();
  window.location.href = '/login.html';
}

// ✅ Permiso para cambiar estado
const CAN_CHANGE_STATUS = ['TOPICO', 'SUPERVISOR', 'ADMIN'].includes(SESSION.role);

// ✅ Admin section (usuarios/reportes)
const IS_ADMIN = SESSION.role === 'ADMIN';
const adminSection = document.getElementById('adminSection');
if (adminSection) adminSection.style.display = IS_ADMIN ? '' : 'none';

// Vistas nuevas (dashboard.html nuevo)
const usersView = document.getElementById('usersView');
const reportsView = document.getElementById('reportsView');
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');
const legendIS = document.getElementById('legendIS');
const usersTableWrap = document.getElementById('usersTableWrap');
const btnExportCsv = document.getElementById('btnExportCsv');
const reportsMsg = document.getElementById('reportsMsg');

/* ---------- helpers ---------- */
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

/* ---------- router por hash ---------- */
function getRoute() {
  const h = (window.location.hash || '#alertas').toLowerCase();
  if (h === '#usuarios') return 'usuarios';
  if (h === '#reportes') return 'reportes';
  if (h === '#historial') return 'historial';
  return 'alertas';
}

function setActiveNav(route) {
  // tabs existentes
  const a = document.getElementById('tab-alertas');
  const hi = document.getElementById('tab-historial');

  if (a) a.classList.remove('active');
  if (hi) hi.classList.remove('active');

  // nav admin
  const nu = document.getElementById('nav-users');
  const nr = document.getElementById('nav-reports');
  if (nu) nu.classList.remove('active');
  if (nr) nr.classList.remove('active');

  if (route === 'historial') {
    if (hi) hi.classList.add('active');
  } else if (route === 'usuarios') {
    if (nu) nu.classList.add('active');
  } else if (route === 'reportes') {
    if (nr) nr.classList.add('active');
  } else {
    if (a) a.classList.add('active');
  }
}

function showOnly(view) {
  // view: 'incidents' | 'users' | 'reports'
  if (usersView) usersView.style.display = view === 'users' ? '' : 'none';
  if (reportsView) reportsView.style.display = view === 'reports' ? '' : 'none';

  // Incidentes (cards, empty, legend)
  const showIncidents = view === 'incidents';
  if (cardsEl) cardsEl.style.display = showIncidents ? '' : 'none';
  if (emptyEl) emptyEl.style.display = showIncidents ? '' : 'none';
  if (legendIS) legendIS.style.display = showIncidents ? '' : 'none';
}

/* ---------- modal ---------- */
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const modalCloseBackdrop = document.getElementById('modalCloseBackdrop');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCloseBtn2 = document.getElementById('modalCloseBtn2');

function openModal(incident) {
  modalTitle.textContent = `Detalle: ${(incident.tipo || '').replaceAll('_',' ')}`;
  modalSub.textContent = `ID: ${incident.id} · ${fmtDate(incident.received_at)}${incident.zone ? ' · ' + incident.zone : ''}`;

  const score = incident.smart_score ?? 0;

  const detailHtml = `
    <div class="detailGrid">
      <div class="detailBox">
        <div class="muted small">Estado</div>
        <div><b>${statusLabel(incident.status || 'NUEVA')}</b></div>
      </div>
      <div class="detailBox">
        <div class="muted small">Severidad</div>
        <div><b>${incident.severidad || '—'}</b></div>
      </div>
      <div class="detailBox">
        <div class="muted small">IS (Índice de Severidad)</div>
        <div><b>${score}</b> — ${scoreLabel(score)}</div>
      </div>
      <div class="detailBox">
        <div class="muted small">GPS</div>
        <div><b>${fmtCoord(incident.latitude)}</b>, <b>${fmtCoord(incident.longitude)}</b></div>
      </div>
    </div>

    <div class="detailBox">
      <div class="muted small">Origen</div>
      <div><b>${incident.created_by || 'APP'}</b></div>
    </div>

    ${incident.descripcion ? `
      <div class="detailBox">
        <div class="muted small">Descripción</div>
        <div><b>${incident.descripcion}</b></div>
      </div>
    ` : ''}

    ${renderTimeline(incident.history || [])}
  `;

  modalBody.innerHTML = detailHtml;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  modalBody.innerHTML = '';
}

if (modalCloseBackdrop) modalCloseBackdrop.onclick = closeModal;
if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
if (modalCloseBtn2) modalCloseBtn2.onclick = closeModal;

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal();
});

/* timeline */
function renderTimeline(history = []) {
  if (!history.length) return `<div class="timeline"><div class="muted small">Sin historial.</div></div>`;

  const h = [...history].sort((x, y) => new Date(x.at) - new Date(y.at));

  const items = h.map((x, idx) => {
    const prev = idx > 0 ? h[idx - 1] : null;
    const mins = prev ? diffMin(prev.at, x.at) : null;

    return `
      <div class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-content">
          <div class="tl-row">
            <b>${x.status}</b>
            <span class="muted small">${fmtDate(x.at)}</span>
          </div>
          <div class="muted small">Por: <b>${x.by || '—'}</b></div>
          ${mins !== null ? `<div class="muted small">Δ tiempo: <b>${mins} min</b></div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const total = diffMin(h[0].at, h[h.length - 1].at);
  const slaHtml = total !== null ? `<div class="sla">⏱️ SLA total: <b>${total} min</b></div>` : '';

  return `
    <div class="timeline">
      ${slaHtml}
      ${items}
    </div>
  `;
}

/* ---------- acciones estado ---------- */
function nextActionButtons(i) {
  if (!CAN_CHANGE_STATUS) return '';

  const st = i.status || 'NUEVA';

  if (st === 'NUEVA') {
    return `<button class="btn ok" data-id="${i.id}" data-st="RECIBIDA">Marcar recibida</button>`;
  }
  if (st === 'RECIBIDA') {
    return `<button class="btn primary" data-id="${i.id}" data-st="EN_ATENCION">Iniciar atención</button>`;
  }
  if (st === 'EN_ATENCION') {
    return `<button class="btn danger" data-id="${i.id}" data-st="CERRADA">Cerrar incidente</button>`;
  }
  return '';
}

async function changeStatus(id, status) {
  await API.request(`/incidents/${id}/status`, {
    method: 'PATCH',
    body: { status }
  });
}

/* ---------- render incident cards ---------- */
function renderCards(data, route) {
  const empty = document.getElementById('empty');
  const cards = document.getElementById('cards');
  cards.innerHTML = '';
  empty.textContent = '';

  if (!data.length) {
    empty.textContent = route === 'historial'
      ? 'No hay incidentes cerrados aún.'
      : 'No hay alertas por el momento.';
    return;
  }

  data.forEach(i => {
    const c = document.createElement('div');
    c.className = 'cardItem';

    const score = i.smart_score ?? 0;
    const label = scoreLabel(score);
    const st = i.status || 'NUEVA';

    const gps = `GPS: <b>${fmtCoord(i.latitude)}</b>, <b>${fmtCoord(i.longitude)}</b>`;
    const desc = (i.descripcion || '').trim();

    const actions = (route === 'alertas') ? nextActionButtons(i) : '';

    c.setAttribute('data-open', '1');
    c.setAttribute('data-id', i.id);

    c.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_',' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
          <div class="statusPill">${statusLabel(st)}</div>
          ${i.zone ? `<div class="muted small">Zona: <b>${i.zone}</b></div>` : ''}
          ${i.created_by ? `<div class="muted small">Creado por: <b>${i.created_by}</b></div>` : ''}
        </div>
        <span class="badge ${sevColor(i.severidad)}">${i.severidad}</span>
      </div>

      <div class="muted small">IS (Índice de Severidad): <b>${score}</b> — ${label}</div>
      <div class="muted small">${gps}</div>
      ${desc ? `<div class="muted small">${desc}</div>` : ''}

      ${actions ? `<div class="actions">${actions}</div>` : ''}
      <div class="muted small" style="margin-top:8px;">Click en la tarjeta para ver detalle</div>
    `;

    cards.appendChild(c);
  });

  // abrir modal al click en tarjeta (pero no cuando clickeas botón)
  document.querySelectorAll('.cardItem[data-open="1"]').forEach(card => {
    card.onclick = async (ev) => {
      if (ev.target && ev.target.tagName === 'BUTTON') return;

      const id = card.getAttribute('data-id');
      try {
        const incident = await API.request(`/incidents/${id}`);
        openModal(incident);
      } catch (e) {
        alert('No se pudo cargar el detalle: ' + (e.message || ''));
      }
    };
  });

  // botones de estado
  if (route === 'alertas' && CAN_CHANGE_STATUS) {
    document.querySelectorAll('button[data-id]').forEach(btn => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.id;
        const st = btn.dataset.st;

        try {
          btn.disabled = true;
          btn.textContent = 'Procesando...';
          await changeStatus(id, st);
          await load();
        } catch (e) {
          alert('Error cambiando estado: ' + (e.message || ''));
        }
      };
    });
  }
}

/* ---------- usuarios (ADMIN) ---------- */
function renderUsersTable(users) {
  if (!usersTableWrap) return;

  if (!users.length) {
    usersTableWrap.innerHTML = `<p class="muted">No hay usuarios.</p>`;
    return;
  }

  const rows = users.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td>${u.name || ''}</td>
      <td>${u.role}</td>
      <td>${u.zone ?? ''}</td>
    </tr>
  `).join('');

  usersTableWrap.innerHTML = `
    <div style="overflow:auto;">
      <table class="tbl" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">ID</th>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Usuario</th>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Nombre</th>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Rol</th>
            <th style="text-align:left; padding:8px; border-bottom:1px solid #eee;">Zona</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

async function loadUsers() {
  if (!IS_ADMIN) {
    alert('Solo ADMIN puede ver usuarios.');
    window.location.hash = '#alertas';
    return;
  }
  showOnly('users');
  document.getElementById('title').textContent = 'Gestión de usuarios';

  try {
    const users = await API.request('/users');
    renderUsersTable(users);
  } catch (e) {
    if (usersTableWrap) usersTableWrap.innerHTML = `<p class="muted">Error: ${e.message || ''}</p>`;
  }
}

/* ---------- reportes (ADMIN) ---------- */
function setupReports() {
  if (!btnExportCsv) return;

  btnExportCsv.onclick = () => {
    if (!IS_ADMIN) {
      alert('Solo ADMIN puede exportar reportes.');
      return;
    }

    // ✅ descarga directa (si implementas /reports/incidents.csv en backend)
    // Si todavía no existe, te devolverá 404.
    const a = document.createElement('a');
    a.href = '/reports/incidents.csv';
    a.target = '_blank';
    a.click();

    if (reportsMsg) {
      reportsMsg.textContent = 'Si no descarga, implementa el endpoint /reports/incidents.csv en backend.';
    }
  };
}

async function loadReports() {
  if (!IS_ADMIN) {
    alert('Solo ADMIN puede ver reportes.');
    window.location.hash = '#alertas';
    return;
  }
  showOnly('reports');
  document.getElementById('title').textContent = 'Reportes';
  setupReports();
}

/* ---------- incidentes ---------- */
function getIncidentsUrlByRoute(route) {
  if (route === 'historial') return '/incidents?status=CERRADA';
  return '/incidents?status=NUEVA,RECIBIDA,EN_ATENCION';
}

let isLoading = false;

async function load() {
  const route = getRoute();
  setActiveNav(route);

  // Rutas admin
  if (route === 'usuarios') return loadUsers();
  if (route === 'reportes') return loadReports();

  // Incidentes (alertas / historial)
  showOnly('incidents');

  if (isLoading) return;
  isLoading = true;

  // Título
  document.getElementById('title').textContent =
    route === 'historial' ? 'Historial (incidentes cerrados)' : 'Alertas registradas';

  try {
    const url = getIncidentsUrlByRoute(route);
    let data = await API.request(url);

    if (route === 'historial') {
      data.sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
    } else {
      const rank = { grave: 3, medio: 2, leve: 1 };
      data.sort((a, b) =>
        (rank[b.severidad] || 0) - (rank[a.severidad] || 0) ||
        (b.smart_score || 0) - (a.smart_score || 0)
      );
    }

    renderCards(data, route);

  } catch (e) {
    const empty = document.getElementById('empty');
    empty.textContent = 'Error cargando: ' + (e.message || '');

    if ((e.message || '').toLowerCase().includes('token')) {
      localStorage.clear();
      window.location.href = '/login.html';
    }
  } finally {
    isLoading = false;
  }
}

window.addEventListener('hashchange', () => load());

// Inicial
load();
setInterval(() => {
  const route = getRoute();
  // refresco automático solo para alertas/historial
  if (route === 'alertas' || route === 'historial') load();
}, 4000);
