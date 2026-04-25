/* ============================================================
   CONFIGURACIÓN
   ============================================================ */
const API_URL = "http://137.131.147.202:8000";

fetch(`${API_URL}/tu-endpoint`)
  .then(res => res.json())
  .then(data => console.log(data));
const DIAS_PROXIMO_VENCER = 5;

const KEY_TOKEN = 'app_token';
const KEY_USER  = 'app_user';

/* ============================================================
   ESTADO DE LA APLICACIÓN
   ============================================================ */
let alumnos = [];                 // cache local poblado desde la API
let filtroEstado = 'todos';
let busqueda = '';
let editandoId = null;
let pendingDeleteId = null;
let cargando = false;

/* ============================================================
   CLIENTE HTTP
   ============================================================ */
const api = {
  get token() { return localStorage.getItem(KEY_TOKEN); },
  setToken(t) {
    if (t) localStorage.setItem(KEY_TOKEN, t);
    else   localStorage.removeItem(KEY_TOKEN);
  },
  get usuario() { return localStorage.getItem(KEY_USER); },
  setUsuario(u) {
    if (u) localStorage.setItem(KEY_USER, u);
    else   localStorage.removeItem(KEY_USER);
  },

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    let res;
    try {
      res = await fetch(API_URL + path, { ...options, headers });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Verifique que la API esté corriendo.');
    }

    if (res.status === 401) {
      this.setToken(null);
      this.setUsuario(null);
      mostrarLogin();
      throw new Error('Sesión expirada. Vuelva a iniciar sesión.');
    }

    if (res.status === 204) return null;

    let body = null;
    try { body = await res.json(); } catch (_) { /* sin cuerpo */ }

    if (!res.ok) {
      const detail = body && body.detail
        ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
        : `Error ${res.status}`;
      throw new Error(detail);
    }
    return body;
  },

  login(usuario, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password })
    });
  },

  listarAlumnos() {
    const params = new URLSearchParams();
    if (busqueda.trim()) params.set('search', busqueda.trim());
    if (filtroEstado !== 'todos') {
      params.set('estado', filtroEstado === 'al-dia' ? 'al_dia' : filtroEstado);
    }
    const qs = params.toString();
    return this.request(`/api/alumnos${qs ? '?' + qs : ''}`);
  },

  obtenerStats() { return this.request('/api/alumnos/stats'); },

  crearAlumno(data)         { return this.request('/api/alumnos',           { method: 'POST',   body: JSON.stringify(data) }); },
  actualizarAlumno(id, data){ return this.request(`/api/alumnos/${id}`,     { method: 'PUT',    body: JSON.stringify(data) }); },
  eliminarAlumno(id)        { return this.request(`/api/alumnos/${id}`,     { method: 'DELETE' }); },
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
  return new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: 'PYG',
    minimumFractionDigits: 0
  }).format(Number(monto) || 0);
}

// Convierte 'al_dia' (API) ↔ 'al-dia' (CSS / UI)
function estadoCss(estado) { return estado === 'al_dia' ? 'al-dia' : estado; }
function estadoApi(estado) { return estado === 'al-dia' ? 'al_dia' : estado; }

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    </button>
  `;
  const remove = () => toast.remove();
  toast.querySelector('.toast-close').addEventListener('click', remove);
  container.appendChild(toast);
  setTimeout(remove, 3500);
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
  const submitBtn = document.getElementById('login-submit');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando…';

  try {
    const data = await api.login(user, pass);
    api.setToken(data.access_token);
    api.setUsuario(data.usuario);
    await mostrarDashboard();
  } catch (err) {
    showToast(err.message || 'Credenciales incorrectas', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Iniciar sesión';
  }
});

togglePass.addEventListener('click', () => {
  loginPass.type = loginPass.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-logout').addEventListener('click', () => {
  api.setToken(null);
  api.setUsuario(null);
  mostrarLogin();
});

function mostrarLogin() {
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-user').value = '';
  loginPass.value = '';
  const btn = document.getElementById('login-submit');
  btn.disabled = false;
  btn.textContent = 'Iniciar sesión';
  setTimeout(() => document.getElementById('login-user').focus(), 50);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function mostrarDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  const fechaHoy = new Date().toLocaleDateString('es-PY', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
  document.getElementById('header-date').textContent = `Resumen general · ${fechaHoy}`;

  await recargarAlumnos();
}

async function recargarAlumnos() {
  cargando = true;
  renderEstadoCarga();
  try {
    alumnos = await api.listarAlumnos();
  } catch (err) {
    alumnos = [];
    showToast(err.message, 'error');
  } finally {
    cargando = false;
    render();
  }
}

function renderEstadoCarga() {
  const wrap = document.getElementById('table-wrap');
  if (cargando) {
    wrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Cargando registros…</p>
        <p class="empty-sub">Obteniendo datos del servidor</p>
      </div>
    `;
  }
}

/* ============================================================
   RENDER
   ============================================================ */
// Como filtros y búsqueda se aplican en el backend, los conteos
// para chips y stats los obtenemos sin filtrar (otra request liviana).
let statsCache = { total: 0, vencidos: 0, proximos: 0, al_dia: 0, monto_total: 0 };

async function refrescarStats() {
  try {
    statsCache = await api.obtenerStats();
  } catch (_) { /* mantenemos los previos */ }
  pintarStats();
}

function pintarStats() {
  const s = statsCache;
  document.getElementById('stat-total').textContent     = s.total;
  document.getElementById('stat-vencidos').textContent  = s.vencidos;
  document.getElementById('stat-proximos').textContent  = s.proximos;
  document.getElementById('stat-al-dia').textContent    = s.al_dia;
  document.getElementById('stat-monto-total').textContent = formatearMonto(s.monto_total);

  document.querySelectorAll('.filter-chip').forEach(chip => {
    const f = chip.dataset.filter;
    const count = f === 'todos'   ? s.total
                : f === 'vencido' ? s.vencidos
                : f === 'proximo' ? s.proximos
                : s.al_dia;
    chip.querySelector('.count').textContent = `(${count})`;
    chip.classList.toggle('active', f === filtroEstado);
  });
}

function render() {
  pintarStats();

  const wrap = document.getElementById('table-wrap');
  if (alumnos.length === 0) {
    const sinRegistros = statsCache.total === 0;
    wrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">${sinRegistros ? 'Aún no hay alumnos registrados' : 'Sin resultados'}</p>
        <p class="empty-sub">${sinRegistros ? 'Comience agregando su primer alumno' : 'Ajuste los filtros o la búsqueda'}</p>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <table class="alumnos-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Cédula</th>
            <th class="text-right">Monto</th>
            <th>Vencimiento</th>
            <th>Estado</th>
            <th class="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${alumnos.map(renderFila).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => abrirModalEditar(parseInt(btn.dataset.id, 10)));
    });
    wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => pedirConfirmarBorrado(parseInt(btn.dataset.id, 10)));
    });
  }

  document.getElementById('results-footer').textContent =
    `MOSTRANDO ${alumnos.length} DE ${statsCache.total} REGISTROS · DATOS SINCRONIZADOS CON EL SERVIDOR`;
}

function renderFila(a) {
  const estado = a.estado;                     // 'vencido' | 'proximo' | 'al_dia'
  const dias = a.dias_hasta_vencimiento;
  const cssEstado = estadoCss(estado);

  const labelEstado = estado === 'vencido' ? 'Vencido'
                    : estado === 'proximo' ? 'Por vencer' : 'Al día';

  let subEstado;
  if (estado === 'vencido') {
    const ad = Math.abs(dias);
    subEstado = `hace ${ad} día${ad === 1 ? '' : 's'}`;
  } else if (estado === 'proximo') {
    subEstado = dias === 0 ? 'hoy' : `en ${dias} día${dias === 1 ? '' : 's'}`;
  } else {
    subEstado = `en ${dias} días`;
  }

  return `
    <tr>
      <td class="td-id">#${String(a.id).padStart(3, '0')}</td>
      <td><p class="td-name">${escapeHtml(a.nombre)}</p></td>
      <td class="td-cedula ${!a.cedula ? 'empty' : ''}">${a.cedula ? escapeHtml(a.cedula) : '—'}</td>
      <td class="td-monto">${formatearMonto(a.monto)}</td>
      <td class="td-fecha">${formatearFecha(a.fecha_vencimiento)}</td>
      <td>
        <div class="estado-wrap">
          <span class="estado-badge ${cssEstado}">${labelEstado}</span>
          <span class="estado-sub">${subEstado}</span>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-action="edit" data-id="${a.id}" title="Editar" aria-label="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" data-action="delete" data-id="${a.id}" title="Eliminar" aria-label="Eliminar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `;
}

/* ============================================================
   FILTROS Y BÚSQUEDA  (delegados al servidor con debounce)
   ============================================================ */
let busquedaTimer = null;

document.getElementById('filter-row').addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  filtroEstado = chip.dataset.filter;
  recargarAlumnos();
});

document.getElementById('search-input').addEventListener('input', (e) => {
  busqueda = e.target.value;
  clearTimeout(busquedaTimer);
  busquedaTimer = setTimeout(recargarAlumnos, 250);
});

/* ============================================================
   MODAL: CREAR / EDITAR
   ============================================================ */
const modal = document.getElementById('alumno-modal');
const modalForm = document.getElementById('alumno-form');

function abrirModalCrear() {
  editandoId = null;
  document.getElementById('modal-eyebrow').textContent = 'Nuevo registro';
  document.getElementById('modal-title').textContent = 'Agregar alumno';
  document.getElementById('modal-save').textContent = 'Crear alumno';
  document.getElementById('alumno-id').value = '';
  document.getElementById('alumno-nombre').value = '';
  document.getElementById('alumno-cedula').value = '';
  document.getElementById('alumno-monto').value = '';
  document.getElementById('alumno-fecha').value = '';
  limpiarErrores();
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('alumno-nombre').focus(), 50);
}

function abrirModalEditar(id) {
  const a = alumnos.find(x => x.id === id);
  if (!a) return;
  editandoId = id;
  document.getElementById('modal-eyebrow').textContent = 'Edición';
  document.getElementById('modal-title').textContent = 'Editar alumno';
  document.getElementById('modal-save').textContent = 'Guardar cambios';
  document.getElementById('alumno-id').value = a.id;
  document.getElementById('alumno-nombre').value = a.nombre;
  document.getElementById('alumno-cedula').value = a.cedula || '';
  document.getElementById('alumno-monto').value = a.monto;
  document.getElementById('alumno-fecha').value = a.fecha_vencimiento;
  limpiarErrores();
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('alumno-nombre').focus(), 50);
}

function cerrarModal() {
  modal.classList.add('hidden');
  limpiarErrores();
}

function limpiarErrores() {
  ['nombre', 'monto', 'fecha'].forEach(k => {
    document.getElementById(`error-${k}`).classList.add('hidden');
    document.getElementById(`alumno-${k}`).classList.remove('error');
  });
}

document.getElementById('btn-add').addEventListener('click', abrirModalCrear);
document.getElementById('modal-close').addEventListener('click', cerrarModal);
document.getElementById('modal-cancel').addEventListener('click', cerrarModal);
modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });

modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarErrores();

  const nombre = document.getElementById('alumno-nombre').value.trim();
  const cedula = document.getElementById('alumno-cedula').value.trim();
  const montoStr = document.getElementById('alumno-monto').value;
  const fecha = document.getElementById('alumno-fecha').value;

  let valido = true;
  if (!nombre) {
    document.getElementById('error-nombre').classList.remove('hidden');
    document.getElementById('alumno-nombre').classList.add('error');
    valido = false;
  }
  const monto = Number(montoStr);
  if (!montoStr || isNaN(monto) || monto <= 0) {
    document.getElementById('error-monto').classList.remove('hidden');
    document.getElementById('alumno-monto').classList.add('error');
    valido = false;
  }
  if (!fecha) {
    document.getElementById('error-fecha').classList.remove('hidden');
    document.getElementById('alumno-fecha').classList.add('error');
    valido = false;
  }
  if (!valido) return;

  const saveBtn = document.getElementById('modal-save');
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  const payload = {
    nombre,
    cedula: cedula || null,
    monto,
    fecha_vencimiento: fecha
  };

  try {
    if (editandoId == null) {
      await api.crearAlumno(payload);
      showToast(`Alumno "${nombre}" creado correctamente`, 'success');
    } else {
      await api.actualizarAlumno(editandoId, payload);
      showToast(`Alumno "${nombre}" actualizado`, 'success');
    }
    cerrarModal();
    await refrescarStats();
    await recargarAlumnos();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
});

/* ============================================================
   MODAL: ELIMINAR
   ============================================================ */
const confirmModal = document.getElementById('confirm-modal');

function pedirConfirmarBorrado(id) {
  const a = alumnos.find(x => x.id === id);
  if (!a) return;
  pendingDeleteId = id;
  document.getElementById('confirm-message').textContent =
    `Esta acción eliminará a "${a.nombre}" de forma permanente. ¿Desea continuar?`;
  confirmModal.classList.remove('hidden');
}

function cerrarConfirm() {
  confirmModal.classList.add('hidden');
  pendingDeleteId = null;
}

document.getElementById('confirm-cancel').addEventListener('click', cerrarConfirm);
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) cerrarConfirm(); });

document.getElementById('confirm-ok').addEventListener('click', async () => {
  if (pendingDeleteId == null) return;
  const a = alumnos.find(x => x.id === pendingDeleteId);
  const okBtn = document.getElementById('confirm-ok');
  okBtn.disabled = true;
  okBtn.textContent = 'Eliminando…';
  try {
    await api.eliminarAlumno(pendingDeleteId);
    showToast(`Alumno "${a ? a.nombre : ''}" eliminado`, 'success');
    cerrarConfirm();
    await refrescarStats();
    await recargarAlumnos();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    okBtn.disabled = false;
    okBtn.textContent = 'Eliminar';
  }
});

/* ============================================================
   EXPORTAR A EXCEL (SheetJS)
   ============================================================ */
document.getElementById('btn-export').addEventListener('click', () => {
  if (alumnos.length === 0) {
    showToast('No hay alumnos para exportar', 'error');
    return;
  }

  const datos = alumnos.map(a => ({
    'ID': a.id,
    'Nombre': a.nombre,
    'Cédula': a.cedula || '',
    'Monto (Gs)': Number(a.monto),
    'Fecha de vencimiento': formatearFecha(a.fecha_vencimiento),
    'Estado de pago': a.estado === 'vencido' ? 'Vencido'
                    : a.estado === 'proximo' ? 'Por vencer' : 'Al día'
  }));

  const ws = XLSX.utils.json_to_sheet(datos);
  ws['!cols'] = [
    { wch: 6 }, { wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 14 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Alumnos');

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `alumnos_${fecha}.xlsx`);
  showToast(`Exportados ${datos.length} alumno${datos.length === 1 ? '' : 's'} a Excel`, 'success');
});

/* ============================================================
   ATAJOS DE TECLADO
   ============================================================ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!modal.classList.contains('hidden')) cerrarModal();
    else if (!confirmModal.classList.contains('hidden')) cerrarConfirm();
  }
});

/* ============================================================
   REFRESCO PERIÓDICO DE STATS
   (las fechas avanzan, los estados pueden cambiar)
   ============================================================ */
setInterval(() => {
  if (!document.getElementById('dashboard').classList.contains('hidden')) {
    refrescarStats();
  }
}, 60_000);

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
(async function init() {
  if (api.token) {
    try {
      await mostrarDashboard();
      await refrescarStats();
    } catch (_) {
      mostrarLogin();
    }
  } else {
    document.getElementById('login-user').focus();
  }
})();
