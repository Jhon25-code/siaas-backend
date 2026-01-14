function ensureAuth() {
  const token = localStorage.getItem('token');
  if (!token) window.location.href = '/login.html';
}
ensureAuth();

document.getElementById('logout').onclick = () => {
  localStorage.clear();
  window.location.href = '/login.html';
};

document.getElementById('who').textContent =
  `${localStorage.getItem('name') || ''} (${localStorage.getItem('role') || ''})`;

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

/* ---------- tabs ---------- */
function getMode() {
  return (window.location.hash || '#alertas').toLowerCase() === '#historial'
    ? 'historial'
    : 'alertas';
}

function renderTabsUI() {
  const mode = getMode();
  const a = document.getElementById('tab-alertas');
  const h = document.getElementById('tab-historial');
  const title = document.getElementById('title');

  if (mode === 'historial') {
    a.classList.remove('active');
    h.classList.add('active');
    title.textContent = 'Historial (incidentes cerrados)';
  } else {
    h.classList.remove('active');
    a.classList.add('active');
    title.textContent = 'Alertas registradas';
  }
}

function getIncidentsUrlByMode() {
  if (getMode() === 'historial') return '/incidents?status=CERRADA';
  return '/incidents?status=NUEVA,RECIBIDA,EN_ATENCION';
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
  // Llenar cabecera
  modalTitle.textContent = `Detalle: ${(incident.tipo || '').replaceAll('_',' ')}`;
  modalSub.textContent = `ID: ${incident.id} · ${fmtDate(incident.received_at)}`;

  // Render contenido
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

    ${incident.descripcion ? `
      <div class="detailBox">
        <div class="muted small">Descripción</div>
        <div><b>${incident.descripcion}</b></div>
      </div>
    ` : ''}

    ${renderTimeline(incident.history || [])}
  `;

  modalBody.innerHTML = detailHtml;

  // Mostrar modal
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  modalBody.innerHTML = '';
}

modalCloseBackdrop.onclick = closeModal;
modalCloseBtn.onclick = closeModal;
modalCloseBtn2.onclick = closeModal;

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
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

/* ---------- render cards ---------- */
function renderCards(data) {
  const cards = document.getElementById('cards');
  const empty = document.getElementById('empty');
  cards.innerHTML = '';
  empty.textContent = '';

  if (!data.length) {
    empty.textContent = getMode() === 'historial'
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

    const actions = (getMode() === 'alertas') ? nextActionButtons(i) : '';

    // ✅ data-id para abrir modal con click
    c.setAttribute('data-open', '1');
    c.setAttribute('data-id', i.id);

    c.innerHTML = `
      <div class="row">
        <div>
          <div class="title">${(i.tipo || '').replaceAll('_',' ')}</div>
          <div class="muted small">${fmtDate(i.received_at)}</div>
          <div class="statusPill">${statusLabel(st)}</div>
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

  // ✅ abrir modal al click en tarjeta (pero no cuando clickeas botón)
  document.querySelectorAll('.cardItem[data-open="1"]').forEach(card => {
    card.onclick = async (ev) => {
      // si click fue en botón, no abrir modal
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

  // ✅ botones de estado
  if (getMode() === 'alertas') {
    document.querySelectorAll('button[data-id]').forEach(btn => {
      btn.onclick = async (ev) => {
        ev.stopPropagation(); // evita abrir modal
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

/* ---------- load ---------- */
let isLoading = false;

async function load() {
  if (isLoading) return;
  isLoading = true;

  renderTabsUI();

  try {
    const url = getIncidentsUrlByMode();
    let data = await API.request(url);

    if (getMode() === 'historial') {
      data.sort((a,b) => new Date(b.received_at) - new Date(a.received_at));
    } else {
      const rank = { grave: 3, medio: 2, leve: 1 };
      data.sort((a,b) =>
        (rank[b.severidad]||0) - (rank[a.severidad]||0) ||
        (b.smart_score||0) - (a.smart_score||0)
      );
    }

    renderCards(data);

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
setInterval(load, 4000);
