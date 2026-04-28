/* ============================================================
   CONFIGURACIÓN
   ============================================================ */
const API_URL = "https://api.zarpemos.online";

const KEY_TOKEN = 'app_token';
const KEY_USER  = 'app_user';

/* ============================================================
   ESTADO
   ============================================================ */
let alumnos = [];
let stats = null;
let filtroEstado = 'todos';      // estado matrícula
let filtroPago   = 'todos';      // estado pago
let busqueda = '';
let cargando = false;

let editandoAlumnoId = null;
let editandoCuotaId  = null;
let alumnoActualId   = null;     // alumno cuyo modal de cuotas está abierto
let alumnoActualData = null;
let cuotasActuales   = [];

let pagandoCuotaId = null;
let pendingConfirm = null;       // {action, payload, message, label}

/* ============================================================
   CLIENTE HTTP
   ============================================================ */
const api = {
  get token() { return localStorage.getItem(KEY_TOKEN); },
  setToken(t) { t ? localStorage.setItem(KEY_TOKEN, t) : localStorage.removeItem(KEY_TOKEN); },
  setUsuario(u) { u ? localStorage.setItem(KEY_USER, u) : localStorage.removeItem(KEY_USER); },

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    let res;
    try {
      res = await fetch(API_URL + path, { ...options, headers });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor.');
    }

    if (res.status === 401) {
      this.setToken(null); this.setUsuario(null);
      mostrarLogin();
      throw new Error('Sesión expirada. Vuelva a iniciar sesión.');
    }
    if (res.status === 204) return null;

    let body = null;
    try { body = await res.json(); } catch (_) {}

    if (!res.ok) {
      const detail = body && body.detail
        ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
        : `Error ${res.status}`;
      throw new Error(detail);
    }
    return body;
  },

  login(usuario, password) {
    const body = new URLSearchParams();
    body.set('username', usuario);
    body.set('password', password);
    return this.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
  },

  // alumnos
  listarAlumnos() {
    const params = new URLSearchParams();
    if (busqueda.trim()) params.set('search', busqueda.trim());
    if (filtroEstado !== 'todos') params.set('estado', filtroEstado);
    if (filtroPago !== 'todos') params.set('estado_pago', filtroPago);
    const qs = params.toString();
    return this.request(`/api/alumnos${qs ? '?' + qs : ''}`);
  },
  obtenerStats()           { return this.request('/api/alumnos/stats'); },
  obtenerAlumno(id)        { return this.request(`/api/alumnos/${id}`); },
  crearAlumno(data)        { return this.request('/api/alumnos',       { method: 'POST', body: JSON.stringify(data) }); },
  actualizarAlumno(id, d)  { return this.request(`/api/alumnos/${id}`, { method: 'PUT',  body: JSON.stringify(d) }); },
  eliminarAlumno(id)       { return this.request(`/api/alumnos/${id}`, { method: 'DELETE' }); },

  // cuotas
  listarCuotas(alumnoId)    { return this.request(`/api/alumnos/${alumnoId}/cuotas`); },
  crearCuota(alumnoId, d)   { return this.request(`/api/alumnos/${alumnoId}/cuotas`, { method: 'POST', body: JSON.stringify(d) }); },
  actualizarCuota(id, d)    { return this.request(`/api/cuotas/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  pagarCuota(id, d)         { return this.request(`/api/cuotas/${id}/pagar`,        { method: 'POST', body: JSON.stringify(d) }); },
  anularPagoCuota(id)       { return this.request(`/api/cuotas/${id}/anular-pago`,  { method: 'POST', body: '{}' }); },
  eliminarCuota(id)         { return this.request(`/api/cuotas/${id}`, { method: 'DELETE' }); },
  generarMes(d)             { return this.request('/api/cuotas/generar-mes', { method: 'POST', body: JSON.stringify(d) }); },
};

/* ============================================================
   UTILIDADES
   ============================================================ */
function parseFecha(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatearFecha(str) {
  const d = parseFecha(str);
  if (!d) return '—';
  return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatearMonto(monto) {
  return new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', minimumFractionDigits: 0 }).format(Number(monto) || 0);
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function hoyISO() { return new Date().toISOString().slice(0, 10); }

const LABEL_ESTADO_ALUMNO = {
  activo: 'Activo', suspendido: 'Suspendido', retirado: 'Retirado', egresado: 'Egresado',
};
const LABEL_ESTADO_PAGO = {
  vencido: 'Vencido', proximo: 'Por vencer', al_dia: 'Al día', sin_pendientes: 'Sin deuda', pagado: 'Pagado',
};

/* ============================================================
   TOASTS
   ============================================================ */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <p>${escapeHtml(message)}</p>
    <button class="toast-close" aria-label="Cerrar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ============================================================
   LOGIN
   ============================================================ */
const loginForm = document.getElementById('login-form');
const togglePass = document.getElementById('toggle-pass');
const loginPass = document.getElementById('login-pass');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = document.getElementById('login-user').value.trim();
  const pass = loginPass.value;
  const btn = document.getElementById('login-submit');
  btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const data = await api.login(user, pass);
    api.setToken(data.access_token);
    api.setUsuario(data.usuario);
    await mostrarDashboard();
  } catch (err) {
    showToast(err.message || 'Credenciales incorrectas', 'error');
    btn.disabled = false; btn.textContent = 'Iniciar sesión';
  }
});

togglePass.addEventListener('click', () => {
  loginPass.type = loginPass.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-logout').addEventListener('click', () => {
  api.setToken(null); api.setUsuario(null); mostrarLogin();
});

function mostrarLogin() {
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-user').value = '';
  loginPass.value = '';
  const btn = document.getElementById('login-submit');
  btn.disabled = false; btn.textContent = 'Iniciar sesión';
  setTimeout(() => document.getElementById('login-user').focus(), 50);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function mostrarDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('header-date').textContent =
    'Resumen general · ' + new Date().toLocaleDateString('es-PY', { day: '2-digit', month: 'long', year: 'numeric' });
  await Promise.all([refrescarStats(), recargarAlumnos()]);
}

async function refrescarStats() {
  try {
    stats = await api.obtenerStats();
  } catch (_) { return; }
  pintarStats();
}

function pintarStats() {
  if (!stats) return;
  document.getElementById('stat-activos').textContent       = stats.alumnos.activos;
  document.getElementById('stat-total-alumnos').textContent = stats.alumnos.total;
  document.getElementById('stat-vencidos').textContent      = stats.pagos.vencidos;
  document.getElementById('stat-proximos').textContent      = stats.pagos.proximos;
  document.getElementById('stat-pagadas-mes').textContent   = stats.pagos.pagados_mes;
  document.getElementById('stat-deuda-total').textContent   = formatearMonto(stats.deuda_total);
  document.getElementById('stat-recaudado-mes').textContent = formatearMonto(stats.recaudado_mes);
}

async function recargarAlumnos() {
  cargando = true; renderEstadoCarga();
  try {
    alumnos = await api.listarAlumnos();
  } catch (err) {
    alumnos = []; showToast(err.message, 'error');
  } finally {
    cargando = false; render();
  }
}

function renderEstadoCarga() {
  if (!cargando) return;
  document.getElementById('table-wrap').innerHTML = `
    <div class="empty-state">
      <p class="empty-title">Cargando registros…</p>
      <p class="empty-sub">Obteniendo datos del servidor</p>
    </div>`;
}

function render() {
  // chips
  document.querySelectorAll('[data-filter-pago]').forEach(c =>
    c.classList.toggle('active', c.dataset.filterPago === filtroPago));
  document.querySelectorAll('[data-filter-estado]').forEach(c =>
    c.classList.toggle('active', c.dataset.filterEstado === filtroEstado));

  const wrap = document.getElementById('table-wrap');
  if (alumnos.length === 0) {
    const sinRegistros = !stats || stats.alumnos.total === 0;
    wrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">${sinRegistros ? 'Aún no hay alumnos registrados' : 'Sin resultados'}</p>
        <p class="empty-sub">${sinRegistros ? 'Comience agregando su primer alumno' : 'Ajuste los filtros o la búsqueda'}</p>
      </div>`;
  } else {
    wrap.innerHTML = `
      <table class="alumnos-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Alumno</th>
            <th>Contacto</th>
            <th>Estado</th>
            <th class="text-right">Cuota</th>
            <th>Próx. venc.</th>
            <th class="text-right">Deuda</th>
            <th>Pago</th>
            <th class="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>${alumnos.map(renderFila).join('')}</tbody>
      </table>`;

    wrap.querySelectorAll('[data-action="cuotas"]').forEach(b =>
      b.addEventListener('click', () => abrirModalCuotas(parseInt(b.dataset.id, 10))));
    wrap.querySelectorAll('[data-action="edit"]').forEach(b =>
      b.addEventListener('click', () => abrirModalEditarAlumno(parseInt(b.dataset.id, 10))));
    wrap.querySelectorAll('[data-action="delete"]').forEach(b =>
      b.addEventListener('click', () => pedirEliminarAlumno(parseInt(b.dataset.id, 10))));
  }

  document.getElementById('results-footer').textContent =
    `MOSTRANDO ${alumnos.length} DE ${stats ? stats.alumnos.total : alumnos.length} ALUMNOS · DATOS SINCRONIZADOS CON EL SERVIDOR`;
}

function renderFila(a) {
  const labelPago = LABEL_ESTADO_PAGO[a.estado_pago] || a.estado_pago;
  const cssPago   = a.estado_pago === 'al_dia' ? 'al-dia' :
                    a.estado_pago === 'sin_pendientes' ? 'sin-pendientes' : a.estado_pago;
  const labelEstado = LABEL_ESTADO_ALUMNO[a.estado] || a.estado;
  const claseEstado = `chip-estado chip-${a.estado}`;
  const contacto = a.telefono || a.email || a.tutor_telefono || '—';
  const contactoSub = a.email && a.telefono ? a.email : '';
  const proxVenc = a.proximo_vencimiento ? formatearFecha(a.proximo_vencimiento) : '—';
  const deuda = Number(a.deuda_pendiente) > 0 ? formatearMonto(a.deuda_pendiente) : '—';

  return `
    <tr>
      <td class="td-id">#${String(a.id).padStart(3, '0')}</td>
      <td>
        <p class="td-name">${escapeHtml(a.nombre)}</p>
        ${a.cedula ? `<p class="td-sub">${escapeHtml(a.cedula)}</p>` : ''}
      </td>
      <td>
        <p class="td-contacto">${escapeHtml(contacto)}</p>
        ${contactoSub ? `<p class="td-sub">${escapeHtml(contactoSub)}</p>` : ''}
      </td>
      <td><span class="${claseEstado}">${labelEstado}</span></td>
      <td class="td-monto">${formatearMonto(a.monto_mensual)}</td>
      <td class="td-fecha">${proxVenc}</td>
      <td class="td-monto ${Number(a.deuda_pendiente) > 0 ? 'deuda' : ''}">${deuda}</td>
      <td>
        <div class="estado-wrap">
          <span class="estado-badge ${cssPago}">${labelPago}</span>
          ${a.cuotas_pendientes > 0
            ? `<span class="estado-sub">${a.cuotas_pendientes} cuota${a.cuotas_pendientes === 1 ? '' : 's'} pend.</span>`
            : ''}
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-action="cuotas" data-id="${a.id}" title="Ver cuotas" aria-label="Cuotas">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </button>
          <button class="icon-btn" data-action="edit" data-id="${a.id}" title="Editar" aria-label="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" data-id="${a.id}" title="Eliminar" aria-label="Eliminar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
}

/* ============================================================
   FILTROS Y BÚSQUEDA
   ============================================================ */
let busquedaTimer = null;
document.getElementById('filter-row-pago').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter-pago]');
  if (!chip) return;
  filtroPago = chip.dataset.filterPago;
  recargarAlumnos();
});
document.getElementById('filter-row-estado').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter-estado]');
  if (!chip) return;
  filtroEstado = chip.dataset.filterEstado;
  recargarAlumnos();
});
document.getElementById('search-input').addEventListener('input', (e) => {
  busqueda = e.target.value;
  clearTimeout(busquedaTimer);
  busquedaTimer = setTimeout(recargarAlumnos, 250);
});

/* ============================================================
   MODAL ALUMNO (crear/editar)
   ============================================================ */
const alumnoModal = document.getElementById('alumno-modal');
const alumnoForm  = document.getElementById('alumno-form');

function abrirModalCrearAlumno() {
  editandoAlumnoId = null;
  document.getElementById('modal-eyebrow').textContent = 'Nuevo registro';
  document.getElementById('modal-title').textContent = 'Agregar alumno';
  document.getElementById('modal-save').textContent = 'Crear alumno';
  alumnoForm.reset();
  document.getElementById('alumno-id').value = '';
  document.getElementById('alumno-estado').value = 'activo';
  document.getElementById('alumno-fecha-alta').value = hoyISO();
  toggleCamposBaja('activo');
  limpiarErroresAlumno();
  alumnoModal.classList.remove('hidden');
  setTimeout(() => document.getElementById('alumno-nombre').focus(), 50);
}

async function abrirModalEditarAlumno(id) {
  let a;
  try { a = await api.obtenerAlumno(id); }
  catch (err) { showToast(err.message, 'error'); return; }

  editandoAlumnoId = id;
  document.getElementById('modal-eyebrow').textContent = 'Edición';
  document.getElementById('modal-title').textContent = 'Editar alumno';
  document.getElementById('modal-save').textContent = 'Guardar cambios';
  document.getElementById('alumno-id').value = a.id;
  document.getElementById('alumno-nombre').value = a.nombre || '';
  document.getElementById('alumno-cedula').value = a.cedula || '';
  document.getElementById('alumno-telefono').value = a.telefono || '';
  document.getElementById('alumno-email').value = a.email || '';
  document.getElementById('alumno-tutor-nombre').value = a.tutor_nombre || '';
  document.getElementById('alumno-tutor-telefono').value = a.tutor_telefono || '';
  document.getElementById('alumno-tutor-email').value = a.tutor_email || '';
  document.getElementById('alumno-monto-mensual').value = a.monto_mensual;
  document.getElementById('alumno-estado').value = a.estado;
  document.getElementById('alumno-fecha-alta').value = a.fecha_alta || '';
  document.getElementById('alumno-fecha-baja').value = a.fecha_baja || '';
  document.getElementById('alumno-motivo-baja').value = a.motivo_baja || '';
  toggleCamposBaja(a.estado);
  limpiarErroresAlumno();
  alumnoModal.classList.remove('hidden');
  setTimeout(() => document.getElementById('alumno-nombre').focus(), 50);
}

function toggleCamposBaja(estado) {
  const visible = estado === 'retirado' || estado === 'egresado' || estado === 'suspendido';
  document.getElementById('field-fecha-baja').style.display = visible ? '' : 'none';
  document.getElementById('field-motivo-baja').style.display = visible ? '' : 'none';
}
document.getElementById('alumno-estado').addEventListener('change', (e) =>
  toggleCamposBaja(e.target.value));

function cerrarModalAlumno() {
  alumnoModal.classList.add('hidden');
  limpiarErroresAlumno();
}
function limpiarErroresAlumno() {
  ['nombre', 'monto-mensual'].forEach(k => {
    const e = document.getElementById(`error-${k}`);
    if (e) e.classList.add('hidden');
    const i = document.getElementById(`alumno-${k}`);
    if (i) i.classList.remove('error');
  });
}

document.getElementById('btn-add').addEventListener('click', abrirModalCrearAlumno);
document.getElementById('modal-close').addEventListener('click', cerrarModalAlumno);
document.getElementById('modal-cancel').addEventListener('click', cerrarModalAlumno);
alumnoModal.addEventListener('click', (e) => { if (e.target === alumnoModal) cerrarModalAlumno(); });

alumnoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresAlumno();

  const nombre = document.getElementById('alumno-nombre').value.trim();
  const montoStr = document.getElementById('alumno-monto-mensual').value;
  const monto = Number(montoStr);

  let valido = true;
  if (!nombre) {
    document.getElementById('error-nombre').classList.remove('hidden');
    document.getElementById('alumno-nombre').classList.add('error');
    valido = false;
  }
  if (!montoStr || isNaN(monto) || monto <= 0) {
    document.getElementById('error-monto-mensual').classList.remove('hidden');
    document.getElementById('alumno-monto-mensual').classList.add('error');
    valido = false;
  }
  if (!valido) return;

  const payload = {
    nombre,
    cedula: document.getElementById('alumno-cedula').value.trim() || null,
    email: document.getElementById('alumno-email').value.trim() || null,
    telefono: document.getElementById('alumno-telefono').value.trim() || null,
    tutor_nombre: document.getElementById('alumno-tutor-nombre').value.trim() || null,
    tutor_telefono: document.getElementById('alumno-tutor-telefono').value.trim() || null,
    tutor_email: document.getElementById('alumno-tutor-email').value.trim() || null,
    monto_mensual: monto,
    estado: document.getElementById('alumno-estado').value,
    fecha_alta: document.getElementById('alumno-fecha-alta').value || null,
    fecha_baja: document.getElementById('alumno-fecha-baja').value || null,
    motivo_baja: document.getElementById('alumno-motivo-baja').value.trim() || null,
  };

  const btn = document.getElementById('modal-save');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    if (editandoAlumnoId == null) {
      await api.crearAlumno(payload);
      showToast(`Alumno "${nombre}" creado`, 'success');
    } else {
      await api.actualizarAlumno(editandoAlumnoId, payload);
      showToast(`Alumno "${nombre}" actualizado`, 'success');
    }
    cerrarModalAlumno();
    await Promise.all([refrescarStats(), recargarAlumnos()]);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   MODAL CUOTAS DEL ALUMNO
   ============================================================ */
const cuotasModal = document.getElementById('cuotas-modal');

async function abrirModalCuotas(alumnoId) {
  alumnoActualId = alumnoId;
  cuotasModal.classList.remove('hidden');
  document.getElementById('cuotas-list').innerHTML = `
    <div class="empty-state"><p class="empty-title">Cargando…</p></div>`;

  try {
    const [a, cuotas] = await Promise.all([api.obtenerAlumno(alumnoId), api.listarCuotas(alumnoId)]);
    alumnoActualData = a;
    cuotasActuales = cuotas;
    pintarHeaderCuotas(a);
    renderCuotas(cuotas);
  } catch (err) {
    showToast(err.message, 'error');
    cerrarModalCuotas();
  }
}

function pintarHeaderCuotas(a) {
  document.getElementById('cuotas-modal-title').textContent = a.nombre;
  document.getElementById('cuotas-modal-eyebrow').textContent =
    a.cedula ? `Cédula ${a.cedula}` : 'Historial de pagos';
  document.getElementById('cuotas-summary-mensual').textContent = formatearMonto(a.monto_mensual);
  document.getElementById('cuotas-summary-deuda').textContent = formatearMonto(a.deuda_pendiente);
  document.getElementById('cuotas-summary-vencidas').textContent = a.cuotas_vencidas;
}

function renderCuotas(cuotas) {
  const list = document.getElementById('cuotas-list');
  if (cuotas.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Sin cuotas registradas</p>
        <p class="empty-sub">Agregue una cuota con el botón de arriba</p>
      </div>`;
    return;
  }

  list.innerHTML = cuotas.map(renderItemCuota).join('');

  list.querySelectorAll('[data-cuota-action="pagar"]').forEach(b =>
    b.addEventListener('click', () => abrirModalPago(parseInt(b.dataset.id, 10))));
  list.querySelectorAll('[data-cuota-action="anular"]').forEach(b =>
    b.addEventListener('click', () => pedirAnularPago(parseInt(b.dataset.id, 10))));
  list.querySelectorAll('[data-cuota-action="edit"]').forEach(b =>
    b.addEventListener('click', () => abrirModalEditarCuota(parseInt(b.dataset.id, 10))));
  list.querySelectorAll('[data-cuota-action="delete"]').forEach(b =>
    b.addEventListener('click', () => pedirEliminarCuota(parseInt(b.dataset.id, 10))));
}

function renderItemCuota(c) {
  const cssEstado = c.estado_pago === 'al_dia' ? 'al-dia' : c.estado_pago;
  const labelEstado = LABEL_ESTADO_PAGO[c.estado_pago] || c.estado_pago;
  const periodo = c.periodo ? c.periodo : '—';
  const pagoInfo = c.pagado
    ? `<p class="cuota-pago-info">Pagado el ${formatearFecha(c.fecha_pago)}${c.metodo_pago ? ' · ' + escapeHtml(c.metodo_pago) : ''}${c.monto_pagado != null ? ' · ' + formatearMonto(c.monto_pagado) : ''}</p>`
    : '';

  return `
    <div class="cuota-item ${c.pagado ? 'pagada' : ''}">
      <div class="cuota-main">
        <div class="cuota-info">
          <p class="cuota-concepto">${escapeHtml(c.concepto)}</p>
          <p class="cuota-meta">
            <span>Período: ${escapeHtml(periodo)}</span>
            <span>Vence: ${formatearFecha(c.fecha_vencimiento)}</span>
          </p>
          ${pagoInfo}
          ${c.nota ? `<p class="cuota-nota">${escapeHtml(c.nota)}</p>` : ''}
        </div>
        <div class="cuota-monto-block">
          <p class="cuota-monto">${formatearMonto(c.monto)}</p>
          <span class="estado-badge ${cssEstado}">${labelEstado}</span>
        </div>
      </div>
      <div class="cuota-actions">
        ${c.pagado
          ? `<button class="btn btn-secondary btn-sm" data-cuota-action="anular" data-id="${c.id}">Anular pago</button>`
          : `<button class="btn btn-primary btn-sm" data-cuota-action="pagar" data-id="${c.id}">Marcar pagada</button>`}
        <button class="icon-btn" data-cuota-action="edit" data-id="${c.id}" title="Editar" aria-label="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-cuota-action="delete" data-id="${c.id}" title="Eliminar" aria-label="Eliminar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
}

function cerrarModalCuotas() {
  cuotasModal.classList.add('hidden');
  alumnoActualId = null;
  alumnoActualData = null;
  cuotasActuales = [];
}

document.getElementById('cuotas-modal-close').addEventListener('click', cerrarModalCuotas);
cuotasModal.addEventListener('click', (e) => { if (e.target === cuotasModal) cerrarModalCuotas(); });
document.getElementById('btn-add-cuota').addEventListener('click', () => abrirModalCrearCuota());

async function refrescarCuotasActuales() {
  if (!alumnoActualId) return;
  try {
    const [a, cuotas] = await Promise.all([
      api.obtenerAlumno(alumnoActualId),
      api.listarCuotas(alumnoActualId),
    ]);
    alumnoActualData = a;
    cuotasActuales = cuotas;
    pintarHeaderCuotas(a);
    renderCuotas(cuotas);
  } catch (err) { showToast(err.message, 'error'); }
}

/* ============================================================
   MODAL CREAR/EDITAR CUOTA
   ============================================================ */
const cuotaFormModal = document.getElementById('cuota-form-modal');
const cuotaForm = document.getElementById('cuota-form');

function abrirModalCrearCuota() {
  if (!alumnoActualId || !alumnoActualData) return;
  editandoCuotaId = null;
  document.getElementById('cuota-form-eyebrow').textContent = 'Nueva cuota';
  document.getElementById('cuota-form-title').textContent = `Cuota para ${alumnoActualData.nombre}`;
  document.getElementById('cuota-form-save').textContent = 'Crear cuota';
  cuotaForm.reset();
  document.getElementById('cuota-id').value = '';
  document.getElementById('cuota-concepto').value = 'Cuota mensual';
  document.getElementById('cuota-monto').value = alumnoActualData.monto_mensual;
  limpiarErroresCuota();
  cuotaFormModal.classList.remove('hidden');
  setTimeout(() => document.getElementById('cuota-concepto').focus(), 50);
}

function abrirModalEditarCuota(cuotaId) {
  const c = cuotasActuales.find(x => x.id === cuotaId);
  if (!c) return;
  editandoCuotaId = cuotaId;
  document.getElementById('cuota-form-eyebrow').textContent = 'Edición';
  document.getElementById('cuota-form-title').textContent = 'Editar cuota';
  document.getElementById('cuota-form-save').textContent = 'Guardar cambios';
  document.getElementById('cuota-id').value = c.id;
  document.getElementById('cuota-concepto').value = c.concepto;
  document.getElementById('cuota-monto').value = c.monto;
  document.getElementById('cuota-fecha-vencimiento').value = c.fecha_vencimiento;
  document.getElementById('cuota-periodo').value = c.periodo || '';
  document.getElementById('cuota-nota').value = c.nota || '';
  limpiarErroresCuota();
  cuotaFormModal.classList.remove('hidden');
}

function cerrarModalCuotaForm() {
  cuotaFormModal.classList.add('hidden');
  limpiarErroresCuota();
}
function limpiarErroresCuota() {
  ['cuota-concepto', 'cuota-monto', 'cuota-fecha'].forEach(k => {
    const e = document.getElementById(`error-${k}`);
    if (e) e.classList.add('hidden');
  });
  ['cuota-concepto', 'cuota-monto', 'cuota-fecha-vencimiento'].forEach(k => {
    const i = document.getElementById(k);
    if (i) i.classList.remove('error');
  });
}

document.getElementById('cuota-form-close').addEventListener('click', cerrarModalCuotaForm);
document.getElementById('cuota-form-cancel').addEventListener('click', cerrarModalCuotaForm);
cuotaFormModal.addEventListener('click', (e) => { if (e.target === cuotaFormModal) cerrarModalCuotaForm(); });

cuotaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresCuota();

  const concepto = document.getElementById('cuota-concepto').value.trim();
  const montoStr = document.getElementById('cuota-monto').value;
  const monto = Number(montoStr);
  const fecha = document.getElementById('cuota-fecha-vencimiento').value;
  const periodo = document.getElementById('cuota-periodo').value.trim();
  const nota = document.getElementById('cuota-nota').value.trim();

  let valido = true;
  if (!concepto) {
    document.getElementById('error-cuota-concepto').classList.remove('hidden');
    document.getElementById('cuota-concepto').classList.add('error');
    valido = false;
  }
  if (!montoStr || isNaN(monto) || monto <= 0) {
    document.getElementById('error-cuota-monto').classList.remove('hidden');
    document.getElementById('cuota-monto').classList.add('error');
    valido = false;
  }
  if (!fecha) {
    document.getElementById('error-cuota-fecha').classList.remove('hidden');
    document.getElementById('cuota-fecha-vencimiento').classList.add('error');
    valido = false;
  }
  if (periodo && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    showToast('El período debe tener el formato YYYY-MM (ej: 2026-05)', 'error');
    valido = false;
  }
  if (!valido) return;

  const payload = {
    concepto, monto,
    fecha_vencimiento: fecha,
    periodo: periodo || null,
    nota: nota || null,
  };
  const btn = document.getElementById('cuota-form-save');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    if (editandoCuotaId == null) {
      await api.crearCuota(alumnoActualId, payload);
      showToast('Cuota creada', 'success');
    } else {
      await api.actualizarCuota(editandoCuotaId, payload);
      showToast('Cuota actualizada', 'success');
    }
    cerrarModalCuotaForm();
    await refrescarCuotasActuales();
    await Promise.all([refrescarStats(), recargarAlumnos()]);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   MODAL PAGO
   ============================================================ */
const pagoModal = document.getElementById('pago-modal');
const pagoForm = document.getElementById('pago-form');

function abrirModalPago(cuotaId) {
  const c = cuotasActuales.find(x => x.id === cuotaId);
  if (!c) return;
  pagandoCuotaId = cuotaId;
  document.getElementById('pago-title').textContent = `Pagar: ${c.concepto}`;
  document.getElementById('pago-cuota-id').value = cuotaId;
  document.getElementById('pago-monto').value = c.monto;
  document.getElementById('pago-fecha').value = hoyISO();
  document.getElementById('pago-metodo').value = '';
  document.getElementById('error-pago-monto').classList.add('hidden');
  document.getElementById('pago-monto').classList.remove('error');
  pagoModal.classList.remove('hidden');
}

function cerrarModalPago() {
  pagoModal.classList.add('hidden');
  pagandoCuotaId = null;
}

document.getElementById('pago-close').addEventListener('click', cerrarModalPago);
document.getElementById('pago-cancel').addEventListener('click', cerrarModalPago);
pagoModal.addEventListener('click', (e) => { if (e.target === pagoModal) cerrarModalPago(); });

pagoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const montoStr = document.getElementById('pago-monto').value;
  const monto = Number(montoStr);
  const fecha = document.getElementById('pago-fecha').value;
  const metodo = document.getElementById('pago-metodo').value;

  if (!montoStr || isNaN(monto) || monto <= 0) {
    document.getElementById('error-pago-monto').classList.remove('hidden');
    document.getElementById('pago-monto').classList.add('error');
    return;
  }

  const btn = document.getElementById('pago-save');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Confirmando…';
  try {
    await api.pagarCuota(pagandoCuotaId, {
      monto_pagado: monto,
      fecha_pago: fecha || null,
      metodo_pago: metodo || null,
    });
    showToast('Pago registrado', 'success');
    cerrarModalPago();
    await refrescarCuotasActuales();
    await Promise.all([refrescarStats(), recargarAlumnos()]);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

function pedirAnularPago(cuotaId) {
  abrirConfirm({
    title: '¿Anular el pago?',
    message: 'La cuota volverá a estado pendiente.',
    label: 'Anular pago',
    danger: true,
    action: async () => {
      await api.anularPagoCuota(cuotaId);
      showToast('Pago anulado', 'success');
      await refrescarCuotasActuales();
      await Promise.all([refrescarStats(), recargarAlumnos()]);
    },
  });
}

function pedirEliminarCuota(cuotaId) {
  const c = cuotasActuales.find(x => x.id === cuotaId);
  abrirConfirm({
    title: '¿Eliminar cuota?',
    message: `Se eliminará "${c ? c.concepto : ''}" de forma permanente.`,
    label: 'Eliminar',
    danger: true,
    action: async () => {
      await api.eliminarCuota(cuotaId);
      showToast('Cuota eliminada', 'success');
      await refrescarCuotasActuales();
      await Promise.all([refrescarStats(), recargarAlumnos()]);
    },
  });
}

function pedirEliminarAlumno(id) {
  const a = alumnos.find(x => x.id === id);
  abrirConfirm({
    title: '¿Eliminar alumno?',
    message: `Esta acción eliminará a "${a ? a.nombre : ''}" y todas sus cuotas. No se puede deshacer.`,
    label: 'Eliminar',
    danger: true,
    action: async () => {
      await api.eliminarAlumno(id);
      showToast(`Alumno "${a ? a.nombre : ''}" eliminado`, 'success');
      await Promise.all([refrescarStats(), recargarAlumnos()]);
    },
  });
}

/* ============================================================
   MODAL CONFIRMAR (genérico)
   ============================================================ */
const confirmModal = document.getElementById('confirm-modal');

function abrirConfirm({ title, message, label, danger, action }) {
  pendingConfirm = { action };
  document.getElementById('confirm-title').textContent = title || '¿Confirmar?';
  document.getElementById('confirm-message').textContent = message || '';
  const okBtn = document.getElementById('confirm-ok');
  okBtn.textContent = label || 'Confirmar';
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  confirmModal.classList.remove('hidden');
}
function cerrarConfirm() { confirmModal.classList.add('hidden'); pendingConfirm = null; }

document.getElementById('confirm-cancel').addEventListener('click', cerrarConfirm);
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) cerrarConfirm(); });

document.getElementById('confirm-ok').addEventListener('click', async () => {
  if (!pendingConfirm) return;
  const { action } = pendingConfirm;
  const btn = document.getElementById('confirm-ok');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Procesando…';
  try {
    await action();
    cerrarConfirm();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   MODAL GENERAR MES
   ============================================================ */
const generarModal = document.getElementById('generar-modal');
const generarForm  = document.getElementById('generar-form');

document.getElementById('btn-generar-mes').addEventListener('click', () => {
  generarForm.reset();
  document.getElementById('generar-concepto').value = 'Cuota mensual';
  // Sugerir el mes próximo
  const hoy = new Date();
  const proxMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
  document.getElementById('generar-periodo').value =
    `${proxMes.getFullYear()}-${String(proxMes.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('generar-fecha').value =
    `${proxMes.getFullYear()}-${String(proxMes.getMonth() + 1).padStart(2, '0')}-10`;
  document.getElementById('error-generar-periodo').classList.add('hidden');
  document.getElementById('error-generar-fecha').classList.add('hidden');
  generarModal.classList.remove('hidden');
});

document.getElementById('generar-close').addEventListener('click', () => generarModal.classList.add('hidden'));
document.getElementById('generar-cancel').addEventListener('click', () => generarModal.classList.add('hidden'));
generarModal.addEventListener('click', (e) => { if (e.target === generarModal) generarModal.classList.add('hidden'); });

generarForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const periodo = document.getElementById('generar-periodo').value.trim();
  const fecha = document.getElementById('generar-fecha').value;
  const concepto = document.getElementById('generar-concepto').value.trim() || 'Cuota mensual';

  let valido = true;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) {
    document.getElementById('error-generar-periodo').classList.remove('hidden');
    valido = false;
  }
  if (!fecha) {
    document.getElementById('error-generar-fecha').classList.remove('hidden');
    valido = false;
  }
  if (!valido) return;

  const btn = document.getElementById('generar-save');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generando…';
  try {
    const r = await api.generarMes({ periodo, fecha_vencimiento: fecha, concepto });
    showToast(`${r.creadas} cuota${r.creadas === 1 ? '' : 's'} creada${r.creadas === 1 ? '' : 's'}, ${r.omitidas} omitida${r.omitidas === 1 ? '' : 's'}`, 'success');
    generarModal.classList.add('hidden');
    await Promise.all([refrescarStats(), recargarAlumnos()]);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   EXPORTAR A EXCEL
   ============================================================ */
document.getElementById('btn-export').addEventListener('click', () => {
  if (alumnos.length === 0) { showToast('No hay alumnos para exportar', 'error'); return; }
  const datos = alumnos.map(a => ({
    'ID': a.id,
    'Nombre': a.nombre,
    'Cédula': a.cedula || '',
    'Email': a.email || '',
    'Teléfono': a.telefono || '',
    'Tutor': a.tutor_nombre || '',
    'Tel. tutor': a.tutor_telefono || '',
    'Cuota mensual (Gs)': Number(a.monto_mensual),
    'Estado matrícula': LABEL_ESTADO_ALUMNO[a.estado] || a.estado,
    'Estado pago': LABEL_ESTADO_PAGO[a.estado_pago] || a.estado_pago,
    'Cuotas vencidas': a.cuotas_vencidas,
    'Cuotas pendientes': a.cuotas_pendientes,
    'Deuda pendiente (Gs)': Number(a.deuda_pendiente),
    'Próximo vencimiento': a.proximo_vencimiento ? formatearFecha(a.proximo_vencimiento) : '',
    'Fecha de alta': a.fecha_alta ? formatearFecha(a.fecha_alta) : '',
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Alumnos');
  XLSX.writeFile(wb, `alumnos_${hoyISO()}.xlsx`);
  showToast(`Exportados ${datos.length} alumno${datos.length === 1 ? '' : 's'}`, 'success');
});

/* ============================================================
   ATAJOS DE TECLADO
   ============================================================ */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!pagoModal.classList.contains('hidden')) cerrarModalPago();
  else if (!cuotaFormModal.classList.contains('hidden')) cerrarModalCuotaForm();
  else if (!confirmModal.classList.contains('hidden')) cerrarConfirm();
  else if (!generarModal.classList.contains('hidden')) generarModal.classList.add('hidden');
  else if (!alumnoModal.classList.contains('hidden')) cerrarModalAlumno();
  else if (!cuotasModal.classList.contains('hidden')) cerrarModalCuotas();
});

/* ============================================================
   AUTOREFRESH
   ============================================================ */
setInterval(() => {
  if (!document.getElementById('dashboard').classList.contains('hidden')) refrescarStats();
}, 60_000);

/* ============================================================
   INIT
   ============================================================ */
(async function init() {
  if (api.token) {
    try { await mostrarDashboard(); }
    catch (_) { mostrarLogin(); }
  } else {
    document.getElementById('login-user').focus();
  }
})();
