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
let filtroEstado = 'todos';
let busqueda = '';
let cargando = false;

let editandoAlumnoId = null;
let editandoPagoId  = null;
let alumnoActualId   = null;
let alumnoActualData = null;
let pagosActuales    = [];

let pendingConfirm = null;

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
    const qs = params.toString();
    return this.request(`/api/alumnos${qs ? '?' + qs : ''}`);
  },
  obtenerAlumno(id)         { return this.request(`/api/alumnos/${id}`); },
  crearAlumno(data)         { return this.request('/api/alumnos',       { method: 'POST', body: JSON.stringify(data) }); },
  actualizarAlumno(id, d)   { return this.request(`/api/alumnos/${id}`, { method: 'PUT',  body: JSON.stringify(d) }); },
  eliminarAlumno(id)        { return this.request(`/api/alumnos/${id}`, { method: 'DELETE' }); },

  // pagos
  listarPagos(alumnoId)     { return this.request(`/api/alumnos/${alumnoId}/pagos`); },
  crearPago(alumnoId, d)    { return this.request(`/api/alumnos/${alumnoId}/pagos`, { method: 'POST', body: JSON.stringify(d) }); },
  actualizarPago(id, d)     { return this.request(`/api/pagos/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  eliminarPago(id)          { return this.request(`/api/pagos/${id}`, { method: 'DELETE' }); },
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
function formatearNumero(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('es-PY');
}
function parsearNumero(s) {
  if (s == null) return NaN;
  const cleaned = String(s).replace(/\./g, '').replace(/,/g, '.').trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}
function attachNumberFormatter(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const raw = inputEl.value.replace(/\D/g, '');
    inputEl.value = raw ? Number(raw).toLocaleString('es-PY') : '';
  });
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function hoyISO() { return new Date().toISOString().slice(0, 10); }

const LABEL_ESTADO = { activo: 'Activo', inactivo: 'Inactivo' };
const LABEL_METODO = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
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
  await recargarAlumnos();
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

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  document.querySelectorAll('[data-filter-estado]').forEach(c =>
    c.classList.toggle('active', c.dataset.filterEstado === filtroEstado));

  const wrap = document.getElementById('table-wrap');
  if (alumnos.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">${busqueda || filtroEstado !== 'todos' ? 'Sin resultados' : 'Aún no hay alumnos registrados'}</p>
        <p class="empty-sub">${busqueda || filtroEstado !== 'todos' ? 'Ajuste los filtros o la búsqueda' : 'Comience agregando su primer alumno'}</p>
      </div>`;
  } else {
    wrap.innerHTML = `
      <table class="alumnos-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Alumno</th>
            <th>Contacto</th>
            <th class="text-right">Cuota</th>
            <th>Estado</th>
            <th>Último pago</th>
            <th class="text-right">Total pagado</th>
            <th class="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>${alumnos.map(renderFila).join('')}</tbody>
      </table>`;

    wrap.querySelectorAll('[data-action="pagos"]').forEach(b =>
      b.addEventListener('click', () => abrirModalPagos(parseInt(b.dataset.id, 10))));
    wrap.querySelectorAll('[data-action="edit"]').forEach(b =>
      b.addEventListener('click', () => abrirModalEditarAlumno(parseInt(b.dataset.id, 10))));
    wrap.querySelectorAll('[data-action="delete"]').forEach(b =>
      b.addEventListener('click', () => pedirEliminarAlumno(parseInt(b.dataset.id, 10))));
  }

  document.getElementById('results-footer').textContent =
    `MOSTRANDO ${alumnos.length} ALUMNO${alumnos.length === 1 ? '' : 'S'} · DATOS SINCRONIZADOS CON EL SERVIDOR`;
}

function renderFila(a) {
  const labelEstado = LABEL_ESTADO[a.estado] || a.estado;
  const claseEstado = `chip-estado chip-${a.estado}`;
  const contacto = a.telefono || a.email || a.tutor_telefono || '—';
  const contactoSub = a.email && a.telefono ? a.email : '';
  const ultimoPago = a.ultimo_pago_fecha
    ? `${formatearFecha(a.ultimo_pago_fecha)}<span class="td-sub">${formatearMonto(a.ultimo_pago_monto)}</span>`
    : '<span class="text-muted">—</span>';

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
      <td class="td-monto">${formatearMonto(a.monto_mensual)}</td>
      <td><span class="${claseEstado}">${labelEstado}</span></td>
      <td class="td-fecha">${ultimoPago}</td>
      <td class="td-monto td-total">${formatearMonto(a.total_pagado)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-action="pagos" data-id="${a.id}" title="Ver pagos" aria-label="Pagos">
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
  document.getElementById('alumno-monto-mensual').value = formatearNumero(a.monto_mensual);
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
  const visible = estado === 'inactivo';
  document.getElementById('field-fecha-baja').style.display = visible ? '' : 'none';
  document.getElementById('field-motivo-baja').style.display = visible ? '' : 'none';
}
document.getElementById('alumno-estado').addEventListener('change', (e) =>
  toggleCamposBaja(e.target.value));

function cerrarModalAlumno() { alumnoModal.classList.add('hidden'); limpiarErroresAlumno(); }
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
  const monto = parsearNumero(montoStr);

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
    await recargarAlumnos();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   MODAL PAGOS (historial)
   ============================================================ */
const pagosModal = document.getElementById('pagos-modal');

async function abrirModalPagos(alumnoId) {
  alumnoActualId = alumnoId;
  pagosModal.classList.remove('hidden');
  document.getElementById('pagos-list').innerHTML = `
    <div class="empty-state"><p class="empty-title">Cargando…</p></div>`;

  try {
    const [a, pagos] = await Promise.all([api.obtenerAlumno(alumnoId), api.listarPagos(alumnoId)]);
    alumnoActualData = a;
    pagosActuales = pagos;
    pintarHeaderPagos(a);
    renderPagos(pagos);
  } catch (err) {
    showToast(err.message, 'error');
    cerrarModalPagos();
  }
}

function pintarHeaderPagos(a) {
  document.getElementById('pagos-modal-title').textContent = a.nombre;
  document.getElementById('pagos-modal-eyebrow').textContent =
    a.cedula ? `Cédula ${a.cedula}` : 'Historial de pagos';
  document.getElementById('pagos-summary-mensual').textContent = formatearMonto(a.monto_mensual);
  document.getElementById('pagos-summary-total').textContent = formatearMonto(a.total_pagado);
  document.getElementById('pagos-summary-ultimo').textContent = a.ultimo_pago_fecha
    ? formatearFecha(a.ultimo_pago_fecha)
    : '—';
}

function renderPagos(pagos) {
  const list = document.getElementById('pagos-list');
  if (pagos.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Sin pagos registrados</p>
        <p class="empty-sub">Use el botón "Registrar pago" para agregar uno</p>
      </div>`;
    return;
  }

  list.innerHTML = pagos.map(renderItemPago).join('');

  list.querySelectorAll('[data-pago-action="edit"]').forEach(b =>
    b.addEventListener('click', () => abrirModalEditarPago(parseInt(b.dataset.id, 10))));
  list.querySelectorAll('[data-pago-action="delete"]').forEach(b =>
    b.addEventListener('click', () => pedirEliminarPago(parseInt(b.dataset.id, 10))));
}

function renderItemPago(p) {
  const concepto = p.concepto || 'Pago';
  const metodo = p.metodo_pago ? (LABEL_METODO[p.metodo_pago] || p.metodo_pago) : '';

  return `
    <div class="cuota-item pagada">
      <div class="cuota-main">
        <div class="cuota-info">
          <p class="cuota-concepto">${escapeHtml(concepto)}</p>
          <p class="cuota-meta">
            <span>${formatearFecha(p.fecha_pago)}</span>
            ${metodo ? `<span>${escapeHtml(metodo)}</span>` : ''}
          </p>
          ${p.nota ? `<p class="cuota-nota">${escapeHtml(p.nota)}</p>` : ''}
        </div>
        <div class="cuota-monto-block">
          <p class="cuota-monto">${formatearMonto(p.monto)}</p>
        </div>
      </div>
      <div class="cuota-actions">
        <button class="icon-btn" data-pago-action="edit" data-id="${p.id}" title="Editar" aria-label="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-pago-action="delete" data-id="${p.id}" title="Eliminar" aria-label="Eliminar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
}

function cerrarModalPagos() {
  pagosModal.classList.add('hidden');
  alumnoActualId = null;
  alumnoActualData = null;
  pagosActuales = [];
}

document.getElementById('pagos-modal-close').addEventListener('click', cerrarModalPagos);
pagosModal.addEventListener('click', (e) => { if (e.target === pagosModal) cerrarModalPagos(); });
document.getElementById('btn-add-pago').addEventListener('click', () => abrirModalCrearPago());

async function refrescarPagosActuales() {
  if (!alumnoActualId) return;
  try {
    const [a, pagos] = await Promise.all([
      api.obtenerAlumno(alumnoActualId),
      api.listarPagos(alumnoActualId),
    ]);
    alumnoActualData = a;
    pagosActuales = pagos;
    pintarHeaderPagos(a);
    renderPagos(pagos);
  } catch (err) { showToast(err.message, 'error'); }
}

/* ============================================================
   MODAL PAGO FORM (crear/editar)
   ============================================================ */
const pagoFormModal = document.getElementById('pago-form-modal');
const pagoForm = document.getElementById('pago-form');

function abrirModalCrearPago() {
  if (!alumnoActualId || !alumnoActualData) return;
  editandoPagoId = null;
  document.getElementById('pago-form-eyebrow').textContent = 'Nuevo pago';
  document.getElementById('pago-form-title').textContent = `Pago de ${alumnoActualData.nombre}`;
  document.getElementById('pago-form-save').textContent = 'Registrar pago';
  pagoForm.reset();
  document.getElementById('pago-id').value = '';
  document.getElementById('pago-monto').value = formatearNumero(alumnoActualData.monto_mensual);
  document.getElementById('pago-fecha').value = hoyISO();
  document.getElementById('pago-concepto').value = 'Cuota mensual';
  limpiarErroresPago();
  pagoFormModal.classList.remove('hidden');
  setTimeout(() => document.getElementById('pago-monto').focus(), 50);
}

function abrirModalEditarPago(pagoId) {
  const p = pagosActuales.find(x => x.id === pagoId);
  if (!p) return;
  editandoPagoId = pagoId;
  document.getElementById('pago-form-eyebrow').textContent = 'Edición';
  document.getElementById('pago-form-title').textContent = 'Editar pago';
  document.getElementById('pago-form-save').textContent = 'Guardar cambios';
  document.getElementById('pago-id').value = p.id;
  document.getElementById('pago-monto').value = formatearNumero(p.monto);
  document.getElementById('pago-fecha').value = p.fecha_pago;
  document.getElementById('pago-concepto').value = p.concepto || '';
  document.getElementById('pago-metodo').value = p.metodo_pago || '';
  document.getElementById('pago-nota').value = p.nota || '';
  limpiarErroresPago();
  pagoFormModal.classList.remove('hidden');
}

function cerrarModalPagoForm() { pagoFormModal.classList.add('hidden'); limpiarErroresPago(); }
function limpiarErroresPago() {
  ['pago-monto', 'pago-fecha'].forEach(k => {
    const e = document.getElementById(`error-${k}`);
    if (e) e.classList.add('hidden');
    const i = document.getElementById(k);
    if (i) i.classList.remove('error');
  });
}

document.getElementById('pago-form-close').addEventListener('click', cerrarModalPagoForm);
document.getElementById('pago-form-cancel').addEventListener('click', cerrarModalPagoForm);
pagoFormModal.addEventListener('click', (e) => { if (e.target === pagoFormModal) cerrarModalPagoForm(); });

pagoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErroresPago();

  const montoStr = document.getElementById('pago-monto').value;
  const monto = parsearNumero(montoStr);
  const fecha = document.getElementById('pago-fecha').value;
  const concepto = document.getElementById('pago-concepto').value.trim();
  const metodo = document.getElementById('pago-metodo').value;
  const nota = document.getElementById('pago-nota').value.trim();

  let valido = true;
  if (!montoStr || isNaN(monto) || monto <= 0) {
    document.getElementById('error-pago-monto').classList.remove('hidden');
    document.getElementById('pago-monto').classList.add('error');
    valido = false;
  }
  if (!fecha) {
    document.getElementById('error-pago-fecha').classList.remove('hidden');
    document.getElementById('pago-fecha').classList.add('error');
    valido = false;
  }
  if (!valido) return;

  const payload = {
    monto,
    fecha_pago: fecha,
    concepto: concepto || null,
    metodo_pago: metodo || null,
    nota: nota || null,
  };

  const btn = document.getElementById('pago-form-save');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    if (editandoPagoId == null) {
      await api.crearPago(alumnoActualId, payload);
      showToast('Pago registrado', 'success');
    } else {
      await api.actualizarPago(editandoPagoId, payload);
      showToast('Pago actualizado', 'success');
    }
    cerrarModalPagoForm();
    await refrescarPagosActuales();
    await recargarAlumnos();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   ELIMINACIONES
   ============================================================ */
function pedirEliminarAlumno(id) {
  const a = alumnos.find(x => x.id === id);
  abrirConfirm({
    title: '¿Eliminar alumno?',
    message: `Esta acción eliminará a "${a ? a.nombre : ''}" y todos sus pagos. No se puede deshacer.`,
    label: 'Eliminar',
    danger: true,
    action: async () => {
      await api.eliminarAlumno(id);
      showToast(`Alumno "${a ? a.nombre : ''}" eliminado`, 'success');
      await recargarAlumnos();
    },
  });
}

function pedirEliminarPago(pagoId) {
  const p = pagosActuales.find(x => x.id === pagoId);
  abrirConfirm({
    title: '¿Eliminar pago?',
    message: `Se eliminará el pago de ${formatearMonto(p ? p.monto : 0)} del ${p ? formatearFecha(p.fecha_pago) : ''}.`,
    label: 'Eliminar',
    danger: true,
    action: async () => {
      await api.eliminarPago(pagoId);
      showToast('Pago eliminado', 'success');
      await refrescarPagosActuales();
      await recargarAlumnos();
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
   EXPORTAR A EXCEL
   ============================================================ */
const NAVY = 'FF27448C';
const NAVY_DEEP = 'FF1D3470';
const NAVY_TINT = 'FFEEF1F9';
const ROW_ALT = 'FFF6F7FB';
const COLOR_INACTIVO_BG = 'FFF5F5F4';
const COLOR_INACTIVO_FG = 'FF78716C';
const COLOR_ACTIVO_BG   = 'FFEEF1F9';
const COLOR_ACTIVO_FG   = 'FF27448C';
const COLOR_MUTED       = 'FF78716C';
const FORMAT_GS         = '"Gs. "#,##0';

document.getElementById('btn-export').addEventListener('click', async () => {
  if (alumnos.length === 0) { showToast('No hay alumnos para exportar', 'error'); return; }

  const btn = document.getElementById('btn-export');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Generando…';

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Zarpemos';
    wb.created = new Date();

    const ws = wb.addWorksheet('Alumnos', {
      views: [{ state: 'frozen', ySplit: 5 }],
    });

    // Título
    ws.mergeCells('A1:L1');
    const t = ws.getCell('A1');
    t.value = 'Zarpemos · Gestión de Alumnos';
    t.font = { name: 'Inter', size: 22, bold: true, color: { argb: NAVY } };
    t.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(1).height = 34;

    // Subtítulo
    ws.mergeCells('A2:L2');
    const s = ws.getCell('A2');
    s.value = `Reporte generado el ${new Date().toLocaleDateString('es-PY', { day: '2-digit', month: 'long', year: 'numeric' })}`;
    s.font = { name: 'Inter', size: 10, italic: true, color: { argb: COLOR_MUTED } };
    s.alignment = { horizontal: 'left', vertical: 'middle' };

    // Headers (fila 5)
    const columns = [
      { key: 'id',                header: 'ID',            width: 6,  align: 'center' },
      { key: 'nombre',            header: 'Nombre',        width: 32 },
      { key: 'cedula',            header: 'Cédula',        width: 14 },
      { key: 'email',             header: 'Email',         width: 28 },
      { key: 'telefono',          header: 'Teléfono',      width: 14 },
      { key: 'tutor_nombre',      header: 'Tutor',         width: 22 },
      { key: 'tutor_telefono',    header: 'Tel. tutor',    width: 14 },
      { key: 'monto_mensual',     header: 'Cuota mensual', width: 16, format: 'currency', align: 'right' },
      { key: 'estado_label',      header: 'Estado',        width: 12, align: 'center' },
      { key: 'ultimo_pago_fecha', header: 'Último pago',   width: 14, align: 'center' },
      { key: 'pagos_count',       header: 'Nº de pagos',   width: 11, align: 'center' },
      { key: 'total_pagado',      header: 'Total pagado',  width: 16, format: 'currency', align: 'right' },
    ];

    columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

    const headerRow = ws.getRow(5);
    columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { horizontal: c.align || 'left', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: NAVY_DEEP } } };
    });
    headerRow.height = 22;

    // Datos
    alumnos.forEach((a, idx) => {
      const row = ws.getRow(6 + idx);
      const values = {
        id: a.id,
        nombre: a.nombre,
        cedula: a.cedula || '',
        email: a.email || '',
        telefono: a.telefono || '',
        tutor_nombre: a.tutor_nombre || '',
        tutor_telefono: a.tutor_telefono || '',
        monto_mensual: Number(a.monto_mensual),
        estado_label: LABEL_ESTADO[a.estado] || a.estado,
        ultimo_pago_fecha: a.ultimo_pago_fecha ? parseFecha(a.ultimo_pago_fecha) : '',
        pagos_count: a.pagos_count,
        total_pagado: Number(a.total_pagado),
      };

      const altFill = idx % 2 === 1
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } }
        : null;

      columns.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.value = values[col.key];
        cell.font = { name: 'Inter', size: 10 };
        cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
        if (col.format === 'currency') cell.numFmt = FORMAT_GS;
        if (col.key === 'ultimo_pago_fecha') cell.numFmt = 'dd/mm/yyyy';
        if (altFill) cell.fill = altFill;
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE1E5EF' } } };
      });

      // Pintar la celda de estado
      const estadoCell = row.getCell(9);
      const isActivo = a.estado === 'activo';
      estadoCell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: isActivo ? COLOR_ACTIVO_BG : COLOR_INACTIVO_BG }
      };
      estadoCell.font = {
        name: 'Inter', size: 10, bold: true,
        color: { argb: isActivo ? COLOR_ACTIVO_FG : COLOR_INACTIVO_FG }
      };

      row.height = 20;
    });

    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: columns.length } };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alumnos_${hoyISO()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exportados ${alumnos.length} alumno${alumnos.length === 1 ? '' : 's'}`, 'success');
  } catch (err) {
    showToast('Error al generar el archivo: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

/* ============================================================
   ATAJOS DE TECLADO
   ============================================================ */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!pagoFormModal.classList.contains('hidden')) cerrarModalPagoForm();
  else if (!confirmModal.classList.contains('hidden')) cerrarConfirm();
  else if (!alumnoModal.classList.contains('hidden')) cerrarModalAlumno();
  else if (!pagosModal.classList.contains('hidden')) cerrarModalPagos();
});

/* ============================================================
   FORMATTERS DE INPUTS NUMÉRICOS
   ============================================================ */
attachNumberFormatter(document.getElementById('alumno-monto-mensual'));
attachNumberFormatter(document.getElementById('pago-monto'));

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
