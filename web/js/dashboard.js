function ensureAuth() {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

document.getElementById('logout').onclick = () => {
  localStorage.clear();
  window.location.href = '/login.html';
};

// ================= SESIÓN =================
const SESSION = {
  token: localStorage.getItem('token') || '',
  role: (localStorage.getItem('role') || '').toUpperCase(),
  name: localStorage.getItem('name') || '',
  zone: localStorage.getItem('zone') || '',
};

document.getElementById('who').textContent =
  `${SESSION.name} (${SESSION.role})${SESSION.zone ? ' · ' + SESSION.zone : ''}`;

// ================= ROLES =================
const WEB_ROLES_ALLOWED = ['TOPICO', 'SUPERVISOR', 'ADMIN'];
if (!WEB_ROLES_ALLOWED.includes(SESSION.role)) {
  alert('No autorizado para acceder al panel web.');
  localStorage.clear();
  window.location.href = '/login.html';
}

const CAN_CHANGE_STATUS = WEB_ROLES_ALLOWED.includes(SESSION.role);
const IS_ADMIN = SESSION.role === 'ADMIN';

const adminSection = document.getElementById('adminSection');
if (adminSection) adminSection.style.display = IS_ADMIN ? '' : 'none';

// ================= ELEMENTOS =================
const cardsEl = document.getElementById('cards');
const emptyEl = document.getElementById('empty');

// ================= HELPERS =================
function sevColor(label) {
  if (label === 'Grave') return 'red';
  if (label === 'Medio') return 'orange';
  return 'green';
}

// 👉 CLAVE: solo texto, SIN números
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

// ================= MODAL =================
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');

function openModal(incident) {
  const label = scoreLabel(incident.smart_score ?? 0);

  modalTitle.textContent = `Detalle: ${(incident.tipo || '').replaceAll('_', ' ')}`;
  modalSub.textContent = `ID: ${incident.id} · ${fmtDate(incident.received_at)}`;

  // ❌ NO números
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
        <div>
          <b>${fmtCoord(incident.latitude)}</b>,
          <b>${fmtCoord(incident.longitude)}</b>
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

// ================= TARJETAS =================
function renderCards(data) {
  cardsEl.innerHTML = '';
  emptyEl.textContent = '';

  if (!data.length) {
    emptyEl.textContent = 'No hay alertas por el momento.';
    return;
  }

  data.forEach(i => {
    const label = scoreLabel(i.smart_score ?? 0);

    const card = document.createElement('div');
    card.className = 'cardItem';

    card.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_', ' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
          <div class="statusPill">${statusLabel(i.status)}</div>
        </div>
        <span class="badge ${sevColor(label)}">${label}</span>
      </div>

      <!--  SIN score numérico -->
      <div class="muted small">Severidad: <b>${label}</b></div>
      <div class="muted small">
        GPS: <b>${fmtCoord(i.latitude)}</b>, <b>${fmtCoord(i.longitude)}</b>
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
  const data = await API.request('/incidents');
  renderCards(data);
}

load();
setInterval(load, 4000);
