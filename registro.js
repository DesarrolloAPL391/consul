// Formulario de ingreso conectado a Supabase (esquema "consultor", sql/01_consultor.sql).
// Usa CATALOGO y $ de catalogo.js, y SUPABASE_URL / SUPABASE_ANON_KEY / APP_VERSION de config.js.
// Sesión única: la misma de Despachos (registrar_sesion al entrar + heartbeat cada 12 s).

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'consultor-auth' },
});

const permitidos = CATALOGO.filter((c) => c.nivel !== 'ilegal');
const bloqueados = CATALOGO.filter((c) => c.nivel === 'ilegal');

let yo = null;          // contexto del participante (consultor_contexto)
let registros = [];
let hbTimer = null;
let cerrando = false;

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));

const MENSAJES = {
  sesion: 'Tu sesión se cerró: tu cuenta se abrió en otro dispositivo.',
  sin_acceso: 'Tu cuenta no tiene acceso a este programa o fue desactivada.',
};

// ---------- RPC ----------
// Lanza Error con un mensaje legible; si la sesión ya no vale, cierra.
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error('No se pudo conectar con el servidor.');
  if (data && data.ok === false) {
    if (MENSAJES[data.error]) {
      await cerrarSesion(MENSAJES[data.error]);
      throw new Error(MENSAJES[data.error]);
    }
    throw new Error(data.error);
  }
  return data;
}

// ---------- Vistas ----------
function mostrar(vista) {
  $('cargando').hidden = true;
  $('vista-login').hidden = vista !== 'login';
  $('vista-app').hidden = vista !== 'app';
}

async function entrar() {
  const { data, error } = await sb.rpc('consultor_contexto');
  if (error) {
    mostrar('login');
    $('login-error').textContent = 'No se pudo conectar con el servidor.';
    return;
  }
  if (!data?.ok) {
    await sb.auth.signOut({ scope: 'local' });
    mostrar('login');
    $('login-error').textContent = MENSAJES[data?.error] || 'No se pudo iniciar sesión.';
    return;
  }
  yo = data;
  $('yo-alias').textContent = yo.alias;
  $('yo-empresa').textContent = yo.empresa_nombre;
  $('yo-rol').textContent = yo.rol === 'admin' ? 'Administrador' : 'Participante';
  $('centro').value = `${String(yo.empresa).padStart(2, '0')} — ${yo.empresa_nombre}`;
  document.querySelector('[data-tab="participantes"]').hidden = yo.rol !== 'admin';
  irA(tabGuardada());
  mostrar('app');

  clearInterval(hbTimer);
  hbTimer = setInterval(heartbeat, 12000);
  await cargarRegistros();
  if (yo.rol === 'admin') await Promise.all([cargarEmpresas(), cargarParticipantes()]);
}

async function heartbeat() {
  if (!yo) return;
  const { data, error } = await sb.rpc('heartbeat', { p_latencia_ms: null, p_version: APP_VERSION });
  if (error) return; // error de red: no expulsar
  // 'fuera_horario' es el control de turnos de Despachos: no aplica a este programa.
  if (data?.estado === 'reemplazada') cerrarSesion(MENSAJES.sesion);
}

async function cerrarSesion(msg, registrarCierre = false) {
  if (cerrando) return;
  cerrando = true;
  clearInterval(hbTimer);
  hbTimer = null;
  if (registrarCierre) { try { await sb.rpc('registrar_cierre'); } catch { /* sin red */ } }
  await sb.auth.signOut({ scope: 'local' });
  yo = null;
  registros = [];
  $('lista').innerHTML = '';
  $('part-lista').innerHTML = '';
  $('login-pass').value = '';
  $('login-error').textContent = msg || '';
  mostrar('login');
  cerrando = false;
}

// ---------- Pestañas ----------
const TAB_KEY = 'consultor-tab';

function tabGuardada() {
  try { return localStorage.getItem(TAB_KEY) || 'nuevo'; } catch { return 'nuevo'; }
}

function irA(tab) {
  const boton = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (!boton || boton.hidden) tab = 'nuevo';
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* sin almacenamiento */ }
  window.scrollTo({ top: 0 });
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) irA(b.dataset.tab);
});

// ---------- Tema (claro por defecto) ----------
$('tema').addEventListener('click', () => {
  const oscuro = document.documentElement.dataset.theme !== 'dark';
  if (oscuro) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('consultor-tema', oscuro ? 'dark' : 'light'); } catch { /* sin almacenamiento */ }
});

// ---------- Login ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim().toLowerCase();
  const password = $('login-pass').value;
  $('login-error').textContent = '';
  if (!email || !password) { $('login-error').textContent = 'Ingrese correo y contraseña.'; return; }

  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Entrando…';
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      try { await sb.rpc('registrar_intento_fallido', { p_email: email, p_user_agent: navigator.userAgent }); } catch { /* opcional */ }
      $('login-error').textContent = 'Correo o contraseña incorrectos.';
      return;
    }
    // Registra esta sesión como la única vigente (desplaza a las demás).
    try { await sb.rpc('registrar_sesion', { p_gps: null }); } catch { /* lo revisa el heartbeat */ }
    await entrar();
  } finally {
    $('login-btn').disabled = false;
    $('login-btn').textContent = 'Entrar';
  }
});

$('salir').addEventListener('click', () => cerrarSesion('', true));

document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });

// ---------- Selects de novedades ----------
function opcionesNovedad(opcional) {
  const vacia = `<option value="">${opcional ? '— Ninguna —' : '— Seleccione —'}</option>`;
  const ok = permitidos.map((c) => `<option value="${c.code}">${c.code} — ${c.cat}</option>`).join('');
  const no = bloqueados.map((c) => `<option value="${c.code}" disabled>${c.code} — ${c.cat} (prohibido)</option>`).join('');
  return `${vacia}<optgroup label="Faltas laborales">${ok}</optgroup><optgroup label="No permitidas por ley">${no}</optgroup>`;
}

function initSelects() {
  $('nov1').innerHTML = opcionesNovedad(false);
  $('nov2').innerHTML = opcionesNovedad(true);
  $('nov3').innerHTML = opcionesNovedad(true);
  document.querySelectorAll('.nov').forEach((s) => s.addEventListener('change', mostrarHint));
}

function mostrarHint() {
  const codes = [...document.querySelectorAll('.nov')].map((s) => s.value).filter(Boolean);
  $('nov-hint').innerHTML = codes.map((code) => {
    const c = CATALOGO.find((x) => x.code === code);
    return `<strong>${c.code}:</strong> ${escapeHtml(c.crit)}`;
  }).join('<br>');
}

// ---------- Validación ----------
function setError(id, msg) {
  const field = $(id).closest('.field');
  field.classList.toggle('invalid', Boolean(msg));
  field.querySelector('.error').textContent = msg || '';
}

function limpiarErrores(form) {
  form.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('invalid');
    const e = f.querySelector('.error');
    if (e) e.textContent = '';
  });
}

function validar() {
  let ok = true;
  const v = (id) => $(id).value.trim();
  const err = (id, msg) => { setError(id, msg); if (msg) ok = false; };

  err('identificacion', !v('identificacion') ? 'Requerido.'
    : !/^\d{5,12}$/.test(v('identificacion')) ? 'Solo números (5 a 12 dígitos).' : '');
  err('apellidos', v('apellidos') ? '' : 'Requerido.');
  err('nombres', v('nombres') ? '' : 'Requerido.');
  err('inicio', v('inicio') ? '' : 'Requerido.');
  err('fin', !v('fin') ? 'Requerido.'
    : v('inicio') && v('fin') < v('inicio') ? 'Debe ser igual o posterior al inicio.' : '');

  const vistos = new Set();
  ['nov1', 'nov2', 'nov3'].forEach((id) => {
    const code = v(id);
    let msg = '';
    if (id === 'nov1' && !code) msg = 'Seleccione al menos una novedad.';
    else if (code && bloqueados.some((b) => b.code === code)) msg = 'Categoría prohibida.';
    else if (code && vistos.has(code)) msg = 'Novedad repetida.';
    if (code) vistos.add(code);
    err(id, msg);
  });

  err('expediente', v('expediente') ? '' : 'Sin soporte no hay falta que registrar.');
  err('caducidad', !v('caducidad') ? 'Toda anotación debe caducar.'
    : v('fin') && v('caducidad') <= v('fin') ? 'Debe ser posterior a la fecha de fin.' : '');

  const garantias = ['g-investigacion', 'g-descargos', 'g-notificado'].every((id) => $(id).checked);
  $('g-error').textContent = garantias ? '' : 'Sin estas tres garantías el registro no puede guardarse.';
  if (!garantias) ok = false;

  return ok;
}

// ---------- Registros ----------
function formatoFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

async function cargarRegistros() {
  try {
    const res = await rpc('consultor_registros_listar');
    registros = res.data || [];
    renderLista();
  } catch (e) {
    if (yo) toast(e.message, true);
  }
}

function renderLista() {
  const q = $('buscar').value.trim().toLowerCase();
  const hoy = new Date().toISOString().slice(0, 10);

  const filtrados = registros.filter((r) => !q || [
    r.identificacion, r.apellidos, r.nombres, r.expediente, r.creado_por_email, ...r.novedades,
  ].join(' ').toLowerCase().includes(q));

  $('count').textContent = registros.length || '';
  $('vacio').hidden = filtrados.length > 0;
  $('vacio').textContent = registros.length ? 'Ningún registro coincide con la búsqueda.' : 'Aún no hay registros.';

  $('lista').innerHTML = filtrados.map((r) => {
    const caducado = r.caducidad < hoy;
    return `
      <tr class="${caducado ? 'caducado' : ''}">
        <td class="code">${escapeHtml(r.identificacion)}</td>
        <td>${escapeHtml(r.apellidos)}, ${escapeHtml(r.nombres)}</td>
        <td class="nowrap">${formatoFecha(r.inicio)} – ${formatoFecha(r.fin)}</td>
        <td>${r.novedades.map((c) => `<span class="pill medio" title="${escapeHtml(CATALOGO.find((x) => x.code === c)?.cat)}">${escapeHtml(c)}</span>`).join(' ')}</td>
        <td>${escapeHtml(r.expediente)}</td>
        <td class="nowrap">${formatoFecha(r.caducidad)}${caducado ? ' <span class="pill alto">Caducado</span>' : ''}</td>
        <td class="small muted">${escapeHtml(r.creado_por_email)}</td>
        <td>${r.puede_eliminar ? `<button class="icon-btn" data-id="${escapeHtml(r.id)}" aria-label="Eliminar registro">✕</button>` : ''}</td>
      </tr>`;
  }).join('');
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validar()) { toast('Revise los campos marcados.', true); return; }

  const btn = e.submitter || $('form').querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await rpc('consultor_registro_guardar', { p: {
      identificacion: $('identificacion').value.trim(),
      apellidos: $('apellidos').value.trim(),
      nombres: $('nombres').value.trim(),
      inicio: $('inicio').value,
      fin: $('fin').value,
      novedades: ['nov1', 'nov2', 'nov3'].map((id) => $(id).value).filter(Boolean),
      expediente: $('expediente').value.trim(),
      caducidad: $('caducidad').value,
      investigacion_cerrada: $('g-investigacion').checked,
      descargos: $('g-descargos').checked,
      notificado: $('g-notificado').checked,
    } });
    $('form').reset();
    toast('Registro guardado.');
    await cargarRegistros();
  } catch (err) {
    if (yo) toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('form').addEventListener('reset', () => {
  setTimeout(() => {
    limpiarErrores($('form'));
    $('g-error').textContent = '';
    $('nov-hint').innerHTML = '';
    if (yo) $('centro').value = `${String(yo.empresa).padStart(2, '0')} — ${yo.empresa_nombre}`;
  });
});

$('lista').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn || !confirm('¿Eliminar este registro? Quedará constancia en la bitácora.')) return;
  try {
    await rpc('consultor_registro_eliminar', { p_id: btn.dataset.id });
    toast('Registro eliminado.');
    await cargarRegistros();
  } catch (err) {
    if (yo) toast(err.message, true);
  }
});

$('buscar').addEventListener('input', renderLista);

// ---------- Participantes (solo admin) ----------
async function cargarEmpresas() {
  try {
    const res = await rpc('consultor_empresas');
    $('p-empresa').innerHTML = '<option value="">— Seleccione —</option>' + (res.data || []).map((e) =>
      `<option value="${e.codigo}">${String(e.codigo).padStart(2, '0')} — ${escapeHtml(e.nombre)}</option>`).join('');
  } catch (e) {
    if (yo) toast(e.message, true);
  }
}

async function cargarParticipantes() {
  try {
    const res = await rpc('consultor_participantes_listar');
    $('part-lista').innerHTML = (res.data || []).map((p) => `
      <tr class="${p.activo ? '' : 'caducado'}">
        <td><strong>${escapeHtml(p.alias)}</strong>${p.es_yo ? ' <span class="muted small">(tú)</span>' : ''}</td>
        <td>${escapeHtml(p.email)}</td>
        <td><span class="muted">${String(p.empresa).padStart(2, '0')}</span> ${escapeHtml(p.empresa_nombre)}</td>
        <td>${p.rol === 'admin' ? 'Administrador' : 'Participante'}</td>
        <td class="nowrap">
          <span class="dot ${p.conectado ? 'on' : ''}" title="${p.conectado ? 'Conectado' : 'Desconectado'}"></span>
          ${p.activo ? 'Activo' : 'Inactivo'}
        </td>
        <td class="nowrap">${p.es_yo ? '' : `
          <button class="btn ghost sm" data-accion="estado" data-email="${escapeHtml(p.email)}" data-activo="${p.activo}">${p.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn ghost sm" data-accion="clave" data-email="${escapeHtml(p.email)}">Clave</button>
          <button class="icon-btn" data-accion="eliminar" data-email="${escapeHtml(p.email)}" aria-label="Quitar participante">✕</button>`}
        </td>
      </tr>`).join('');
  } catch (e) {
    if (yo) toast(e.message, true);
  }
}

function claveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

$('p-generar').addEventListener('click', () => { $('p-pass').value = claveAleatoria(); });

$('part-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = $('part-form');
  limpiarErrores(form);
  const email = $('p-email').value.trim().toLowerCase();
  const alias = $('p-alias').value.trim();
  const empresa = Number($('p-empresa').value);
  const pass = $('p-pass').value;

  let ok = true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('p-email', 'Correo inválido.'); ok = false; }
  if (!alias) { setError('p-alias', 'El alias es obligatorio.'); ok = false; }
  if (!empresa) { setError('p-empresa', 'Seleccione una empresa.'); ok = false; }
  if (pass && pass.length < 8) { setError('p-pass', 'Mínimo 8 caracteres.'); ok = false; }
  if (!ok) return;

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const res = await rpc('consultor_participante_crear', {
      p_email: email, p_alias: alias, p_empresa: empresa, p_pass: pass || null,
    });
    form.reset();
    toast(res.cuenta_nueva
      ? `Participante creado. Entrega la clave temporal a ${alias}.`
      : `${alias} añadido: ya tenía cuenta y conserva su clave.`);
    await cargarParticipantes();
  } catch (err) {
    if (yo) toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('part-lista').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  const email = btn.dataset.email;
  try {
    if (btn.dataset.accion === 'estado') {
      const activar = btn.dataset.activo !== 'true';
      await rpc('consultor_participante_actualizar', { p_email: email, p_activo: activar });
      toast(activar ? 'Participante activado.' : 'Participante desactivado.');
    } else if (btn.dataset.accion === 'clave') {
      const pass = prompt(`Nueva clave para ${email} (mínimo 8 caracteres):`, claveAleatoria());
      if (!pass) return;
      await rpc('consultor_participante_clave', { p_email: email, p_pass: pass });
      toast('Clave restablecida. Sus sesiones abiertas se cerraron.');
    } else if (btn.dataset.accion === 'eliminar') {
      if (!confirm(`¿Quitar a ${email} del programa? Sus registros se conservan.`)) return;
      await rpc('consultor_participante_eliminar', { p_email: email });
      toast('Participante eliminado.');
    }
    await cargarParticipantes();
  } catch (err) {
    if (yo) toast(err.message, true);
  }
});

// ---------- Toast ----------
let toastTimer;
function toast(msg, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Inicio ----------
initSelects();
(async () => {
  const { data } = await sb.auth.getSession();
  // En recargas no se vuelve a registrar la sesión: así no se desplaza a sí misma.
  if (data.session) await entrar();
  else mostrar('login');
})();
