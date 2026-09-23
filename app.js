/* ============================================================
   TiendaAudioBlaze — app.js

   Responsabilidad: cargar el catálogo desde Supabase (lectura anon),
   gestionar la cuenta (supabase-js v2 por CDN, sesión en localStorage),
   montar el botón de PayPal SOLO con sesión iniciada y enviar el
   order_id a la Edge Function con el JWT del usuario.

   La captura, la validación de importe y el email del comprador son
   SIEMPRE server-side (nunca aquí). El Bearer anon no tiene poder de
   compra: la Edge Function exige un `sub` UUID (cuenta real).
   ============================================================ */

'use strict';

// --- Configuración (reemplazar por los valores del proyecto) -------------
// La anon key es pública por diseño; el service-role/key secreta NO va aquí.
const CONFIG = {
  SUPABASE_URL: 'https://kxlbpxprtgupvzyxsuxn.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bGJweHBydGd1cHZ6eXhzdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNTU5NjUsImV4cCI6MjEwNDczMTk2NX0.8wVhispADrPXOSguiyFuWttUOflm5gULpoPO-fKoTM4',
  EDGE_FUNCTION_URL: 'https://kxlbpxprtgupvzyxsuxn.functions.supabase.co/verify-payment',
  CURRENCY: 'USD',                    // moneda de la tienda (precios en $)
  // Tiempo máximo de espera de la Edge Function antes de mostrar error.
  EDGE_TIMEOUT_MS: 15000,

  // --- PayPal: client-id según entorno (sandbox vs live) ------------------
  // Sandbox: desarrollo local y GitHub Pages (testing)
  // Live: dominio personalizado en producción
  PAYPAL_CLIENT_ID_SANDBOX: 'AdDqsKZIajyi2rT-spC0LL72qguV5t7Am8GnSSMAj_Rt17aFhjAAmYs2GB9INr4Fj2HdYGeC0lV08d3J',
  PAYPAL_CLIENT_ID_LIVE: '__REEMPLAZAR_CON_LIVE_CLIENT_ID__',
};

// --- Detección de entorno ----------------------------------------------------
// GitHub Pages y localhost → sandbox. Dominio personalizado → live.
const ENV = (() => {
  const host = window.location.hostname;
  const isDev = host === 'localhost' || host === '127.0.0.1' || host.includes('github.io');
  return {
    isProduction: !isDev,
    isSandbox: isDev,
    paypalClientId: isDev
      ? CONFIG.PAYPAL_CLIENT_ID_SANDBOX
      : CONFIG.PAYPAL_CLIENT_ID_LIVE,
  };
})();

const $ = (sel, root = document) => root.querySelector(sel);

const money = (cents, currency) => {
  const cur = currency || CONFIG.CURRENCY;
  // USD → "$27.00" (formato en-US); otras divisas → formato local.
  const locale = cur === 'USD' ? 'en-US' : 'es-ES';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: cur })
    .format((cents || 0) / 100);
};

// SDK de autenticación (supabase-js v2), lazy vía CDN. Nada de esto en demo.
let _authClient = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`no pude cargar ${src}`));
    document.head.appendChild(s);
  });
}
async function getAuthClient() {
  if (!window.supabase && !_triedAuthSdk) {
    _triedAuthSdk = true;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    } catch { /* sin red → null, modo demo */ }
  }
  if (window.supabase) {
    if (!_authClient) {
      _authClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return _authClient;
  }
  return null;
}
let _triedAuthSdk = false;

/* ------------------------------------------------------------
   Sesión / cuenta
   ------------------------------------------------------------ */
async function getSession() {
  const client = await getAuthClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) console.warn('[auth/session]', error.message);
  return data?.session ?? null;
}

/** Sin sesión → guarda destino y redirige a /login con `?next=`. */
async function requireLogin(next) {
  const session = await getSession();
  if (session) return session;
  const dest = next || buildNext();
  try { sessionStorage.setItem('auth.next', dest); } catch { /* privado */ }
  window.location.href = loginUrl(dest);
  return null;
}

/** Ruta del pack actual (relativa al repo, nunca "/"): packs/<id>.html. */
function buildNext() {
  const id = (window.PACK && window.PACK.id) || 'ansiedad-01';
  return `packs/${id}.html`;
}

// En una landing (window.PACK) la página vive en packs/, así que las rutas
// hacia la raíz del repo (login, registro, gracias) necesitan "../".
const PREFIX = window.PACK ? '../' : '';
const loginUrl = (next) => `${PREFIX}login.html?next=${encodeURIComponent(next)}`;
const registroUrl = (next) => `${PREFIX}registro.html?next=${encodeURIComponent(next)}`;

/** Solo rutas de la propia tienda: ^[a-z0-9_.-/]+\.html? */
function sanitizeNext(raw) {
  const safe = /^[a-z0-9_./-]+\.html?$/i.test(raw || '') ? raw : 'index.html';
  return safe;
}

/* ------------------------------------------------------------
   Pack-aware por página (landing fija de cada pack, SEO)
   ------------------------------------------------------------ */
function heroPack() {
  if (window.PACK) {
    return {
      id: window.PACK.id,
      name: window.PACK.name || window.PACK.id,
      description: window.PACK.description || '',
      price_cents: window.PACK.price_cents,
      currency: window.PACK.currency || CONFIG.CURRENCY,
      cover: window.PACK.cover || null,
    };
  }
  return state.primary;
}

/* ------------------------------------------------------------
   Catálogo desde Supabase (T5)
   ------------------------------------------------------------ */
async function loadPacks() {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/packs` +
    '?select=id,name,description,cover_path,price_cents,currency&order=sort_order.asc';
  const res = await fetch(url, {
    headers: {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

const LEGACY_COVER = 'assets/covers/ansiedad-01.svg';
function packCover(pack) {
  if (pack.cover_path) return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/covers/${pack.cover_path}`;
  if (pack.cover) return pack.cover;
  if ((pack.id || '').endsWith('ansiedad-01') || pack.id === 'ansiedad-01') return LEGACY_COVER;
  return `assets/covers/${pack.id}.svg`;
}

function packUrl(id) {
  return `packs/${encodeURIComponent(id)}.html`;
}

function renderCatalog(packs) {
  const list = $('#pack-list');
  if (!list) return;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  packs.forEach((pack) => {
    const li = document.createElement('li');

    const img = document.createElement('img');
    img.src = packCover(pack);
    img.alt = `Cubierta de ${pack.name}`;
    img.loading = 'lazy';
    img.width = 64; img.height = 64;

    const info = document.createElement('div');
    info.className = 'row-info';
    const name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = pack.name;
    const desc = document.createElement('p');
    desc.className = 'row-desc';
    desc.textContent = pack.description || '';
    info.append(name, desc);

    const price = document.createElement('span');
    price.className = 'row-price';
    price.textContent = money(pack.price_cents, pack.currency);

    const link = document.createElement('a');
    link.className = 'pack-row';
    link.href = packUrl(pack.id);
    link.setAttribute('aria-label', `Ver el pack ${pack.name}`);
    link.append(img, info, price);

    li.append(link);
    frag.append(li);
  });

  list.append(frag);
}

function renderHero(pack) {
  if (!pack) return;
  const el = $('#hero-precio');
  if (el) el.innerHTML = `${money(pack.price_cents, pack.currency)} <small>impuestos incluidos</small>`;
  const meta = $('.hero-pack .pack-meta');
  if (meta) meta.innerHTML = `<strong>${pack.name}</strong> · entrega en tu correo`;
  const ver = $('#hero-ver-pack');
  if (ver) ver.href = packUrl(pack.id);
}

async function initCatalog() {
  const errBox = $('#catalog-error');
  if (!errBox) return;
  try {
    state.packs = await loadPacks();
    if (!state.packs.length) throw new Error('catálogo vacío');
    state.primary = state.packs[0];
    state.demo = false;
    renderCatalog(state.packs);
    renderHero(state.primary);
    errBox.hidden = true;
  } catch (e) {
    console.warn('[catalogo] carga real falló; modo demo', e);
    // Modo demo: el front se ve completo aunque no haya Supabase configurado.
    state.demo = true;
    state.packs = DEMO.packs;
    state.primary = DEMO.packs[0];
    renderCatalog(DEMO.packs);
    renderHero(DEMO.packs[0]);
    errBox.hidden = true;
  }
}

// --- Modo demo (local, sin Supabase/PayPal reales) --------------------------
const DEMO = {
  packs: [
    {
      id: 'ansiedad-01',
      name: 'Pack Ansiedad 01',
      description: '6 sesiones guiadas para bajar la ansiedad y dormir mejor. Solo escuchar.',
      price_cents: 2700,        // 27,00 $
      currency: 'USD',
    },
    {
      id: 'sueno-profundo',
      name: 'Pack Sueño Profundo',
      description: 'Guias para conciliar el sueño, soltar el día y dormir de un tirón. Solo escuchar.',
      price_cents: 2700,        // 27,00 $
      currency: 'USD',
    },
    {
      id: 'autoestima',
      name: 'Pack Autoestima',
      description: 'Sesiones para callar al crítico interno y recuperar tu confianza. Solo escuchar.',
      price_cents: 1900,        // 19,00 $
      currency: 'USD',
    },
    {
      id: 'estres-laboral',
      name: 'Pack Estrés Laboral',
      description: 'Herramientas de bolsillo para el agobio del trabajo: pausas, respiración y límites. Solo escuchar.',
      price_cents: 3500,        // 35,00 $
      currency: 'USD',
    },
  ],
};

const state = {
  packs: [],
  primary: null,     // pack del hero
  demo: false,       // catálogo local (sin back real)
  submitting: false, // anti doble clic (Pass 2)
  paypalMounted: false,
};

/* Botón simulado para el modo demo (mismo lenguaje visual que el CTA). */
function renderDemoButton(pack) {
  const holder = $('#paypal-button-container');
  if (!holder) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-plan';
  btn.type = 'button';
  btn.textContent = `Comprar el pack (demo) · ${money(pack.price_cents, pack.currency)}`;
  btn.addEventListener('click', () => {
    setSubmitting(true);
    $('#pay-error').hidden = true;
    setTimeout(() => { window.location.href = PREFIX + 'gracias.html'; }, 900);
  });
  holder.append(btn);
  if (typeof paypal === 'undefined') {
    const note = document.createElement('p');
    note.className = 'promise';
    note.textContent = 'Modo demo: no se cobra nada.';
    holder.after(note);
  }
}

/* ------------------------------------------------------------
   Estado de pago (Pass 2): spinner, error nunca silencioso
   ------------------------------------------------------------ */
function setSubmitting(on) {
  state.submitting = on;
  const status = $('#pay-status');
  if (status) status.hidden = !on;
  document.querySelectorAll('#paypal-button-container button').forEach((b) => {
    b.disabled = on;
  });
}

function showPayError() {
  const el = $('#pay-error');
  if (el) {
    if (el.dataset.originalHtml) {
      el.innerHTML = el.dataset.originalHtml;
      delete el.dataset.originalHtml;
    }
    el.hidden = false;
  }
}

function showCancelMsg() {
  const el = $('#pay-error');
  if (el) {
    el.dataset.originalHtml = el.innerHTML;
    el.innerHTML = '<span style="color:var(--muted)">Pago cancelado por el usuario.</span>';
    el.hidden = false;
  }
}

/* ------------------------------------------------------------
   Edge Function: enviar SOLO order_id + teléfono (T1/T3).
   Autorización = JWT del usuario (acceso con su cuenta), jamás el anon.
   ------------------------------------------------------------ */
async function submitOrderToEdge(orderId, buyerPhone) {
  const session = await getSession();
  if (!session) {
    const next = buildNext();
    window.location.href = loginUrl(next);
    throw new Error('Sesión perdida: vuelve a iniciar sesión.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.EDGE_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ order_id: orderId, buyer_phone: buyerPhone || null }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Edge ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------
   PayPal SDK: carga dinámica con client-id según entorno
   ------------------------------------------------------------ */
let _paypalLoading = false;
let _paypalLoaded = false;
let _paypalError = false;

function loadPayPalSDK() {
  return new Promise((resolve, reject) => {
    if (_paypalLoaded) { resolve(); return; }
    if (_paypalError) { reject(new Error('PayPal SDK ya falló antes')); return; }
    if (_paypalLoading) {
      // Ya está cargándose; esperar a que termine
      const check = setInterval(() => {
        if (_paypalLoaded) { clearInterval(check); resolve(); }
        if (_paypalError) { clearInterval(check); reject(new Error('PayPal SDK falló')); }
      }, 200);
      return;
    }
    _paypalLoading = true;
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${ENV.paypalClientId}&components=buttons&currency=USD`;
    s.onload = () => { _paypalLoaded = true; _paypalLoading = false; resolve(); };
    s.onerror = () => { _paypalError = true; _paypalLoading = false; reject(new Error('PayPal SDK no disponible')); };
    document.head.appendChild(s);
  });
}

/* ------------------------------------------------------------
   Panel de compra (gate de cuenta + PayPal pro)
   ------------------------------------------------------------ */
async function renderPurchasePanel(pack) {
  const holder = $('#paypal-button-container');
  if (!holder || !pack) return;

  // Limpia cualquier montaje previo (mismo holder para CTA o botón).
  holder.innerHTML = '';
  state.paypalMounted = false;

  // Demo: no hay cuenta real posible → botón local simulado con precio vivo.
  if (state.demo || !(await getAuthClient())) {
    state.demo = true;
    renderDemoButton(pack);
    return;
  }

  const session = await getSession();

  if (!session) {
    // Sin cuenta: NO se monta PayPal. CTA a login ?next=<página actual>.
    const cta = document.createElement('div');
    cta.className = 'login-cta';
    const p = document.createElement('p');
    p.textContent = 'Necesitas una cuenta para comprar. Crea una o entra, son 20 segundos.';
    const btn = document.createElement('a');
    btn.className = 'btn btn-primary';
    btn.href = loginUrl(buildNext());
    btn.textContent = 'Crear cuenta o entrar';
    const note = document.createElement('div');
    note.className = 'auth-nav-whoami';
    note.innerHTML = 'Tus packs comprados quedan guardados en tu cuenta.';
    cta.append(p, btn, note);
    holder.append(cta);
    return;
  }

  // Cargar SDK de PayPal dinámicamente con el client-id del entorno
  try {
    await loadPayPalSDK();
  } catch {
    renderDemoButton(pack);
    return;
  }

  state.paypalMounted = true;
  paypal.Buttons({
    style: {
      shape: 'rect',
      color: 'gold',
      layout: 'vertical',
      height: 55,
      tagline: false,
      disableFunding: ['card', 'venmo'],
      label: 'paypal',
    },

    // La orden se crea con el precio público del pack; el servidor lo re-valida.
    createOrder(data, actions) {
      return actions.order.create({
        purchase_units: [{
          reference_id: pack.id,
          amount: {
            currency_code: pack.currency || CONFIG.CURRENCY,
            value: (pack.price_cents / 100).toFixed(2),
          },
        }],
      });
    },

    // onApprove: NO capturamos aquí. Solo enviamos order_id al servidor.
    async onApprove(data) {
      if (state.submitting) return; // anti doble clic
      setSubmitting(true);
      $('#pay-error').hidden = true;
      const phone = $('#buyer-phone')?.value.trim() || null;
      try {
        // Guardar el nombre del pack para mostrarlo en gracias.html
        const pack = heroPack();
        if (pack && pack.name) {
          sessionStorage.setItem('lastPackName', pack.name);
        }
        await submitOrderToEdge(data.orderID, phone);
        window.location.href = PREFIX + 'gracias.html';
      } catch (e) {
        console.error('[pago]', e);
        setSubmitting(false);
        showPayError(); // nunca en silencio
      }
    },

    onError(err) {
      console.error('[paypal]', err);
      setSubmitting(false);
      showPayError();
    },

    onCancel() {
      setSubmitting(false);
      showCancelMsg();
    },
  }).render('#paypal-button-container')
    .catch((err) => {
      // client-id inválido / SDK caído: nunca un botón fantasma en silencio.
      console.warn('[paypal render]', err, '→ botón demo');
      state.paypalMounted = false;
      $('#pay-error').hidden = true;
      renderDemoButton(pack);
    });
}

/* ------------------------------------------------------------
   Nav de sesión en el header (#auth-nav)
   ------------------------------------------------------------ */
function authNavMarkup(session) {
  if (session) {
    return `
      <a class="link" href="${PREFIX}mis-packs.html">Mis packs</a>
      <button class="btn btn-plan" id="logout-btn" type="button">Salir</button>`;
  }
  return `
      <a class="link" href="${loginUrl(buildNext())}">Entrar</a>
      <a class="btn btn-primary" href="${registroUrl(buildNext())}">Registrarse</a>`;
}

async function renderAuthNav() {
  const host = $('#auth-nav');
  if (!host) return;
  const session = await getSession();
  host.innerHTML = authNavMarkup(session);
  const logout = $('#logout-btn', host);
  if (logout) {
    logout.addEventListener('click', async () => {
      const client = await getAuthClient();
      if (client) await client.auth.signOut();
      window.location.reload();
    });
  }
}

/* ------------------------------------------------------------
   Formularios de registro / login (páginas propia de cuenta)
   ------------------------------------------------------------ */
function bindAuthForms() {
  const signUp = $('#registro-form');
  if (signUp) {
    signUp.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('#registro-error');
      err.hidden = true;
      const email = $('#reg-email').value.trim();
      const password = $('#reg-password').value;
      const fullName = $('#reg-name')?.value.trim() || null;
      if (password.length < 6) {
        err.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        err.hidden = false;
        return;
      }
      const btn = $('#registro-btn');
      btn.disabled = true; btn.textContent = 'Creando cuenta…';
      try {
        const client = await getAuthClient();
        if (!client) throw new Error('Supabase no disponible ahora mismo.');
        const phone = $('#reg-phone')?.value.trim() || null;
        const userData = fullName ? { full_name: fullName } : {};
        if (phone) {
          userData.phone = phone;
        }
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: userData ? { data: userData } : undefined,
        });
        if (error) throw error;
        // si confirm email está activo, la sesión no existe aún → se avisa
        if (!data.session) {
          err.textContent = 'Revisa tu correo y confirma la cuenta para entrar.';
          err.classList.add('is-success');
          err.style.color = 'var(--status-ok)';
          err.hidden = false;
        } else {
          redirectAfterAuth();
        }
      } catch (e) {
        console.error('[registro]', e);
        err.classList.remove('is-success');
        err.style.color = '';
        err.textContent = e.message || 'No pudimos crear la cuenta. Inténtalo de nuevo.';
        err.hidden = false;
        btn.disabled = false; btn.textContent = 'Crear cuenta';
      }
    });
  }

  const signIn = $('#login-form');
  if (signIn) {
    signIn.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('#login-error');
      err.hidden = true;
      const email = $('#login-email').value.trim();
      const password = $('#login-password').value;
      if (!email || !password) {
        err.textContent = 'Escribe tu correo y contraseña.';
        err.hidden = false;
        return;
      }
      const btn = $('#login-btn');
      btn.disabled = true; btn.textContent = 'Entrando…';
      try {
        const client = await getAuthClient();
        if (!client) throw new Error('Supabase no disponible ahora mismo.');
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        redirectAfterAuth();
      } catch (e) {
        console.error('[login]', e);
        err.textContent = e.message || 'Correo o contraseña incorrectos.';
        err.hidden = false;
        btn.disabled = false; btn.textContent = 'Entrar';
      }
    });
  }
}

/** Tras autenticarse: va a ?next= (sanitizado) o al catálogo. */
function redirectAfterAuth() {
  const params = new URLSearchParams(window.location.search);
  const next = sanitizeNext(params.get('next') || sessionStorage.getItem('auth.next'));
  try { sessionStorage.removeItem('auth.next'); } catch { /* privado */ }
  window.location.href = next;
}

/* ------------------------------------------------------------
   Mis packs (solo lectura de tus propios pedidos, RLS owner)
   ------------------------------------------------------------ */
async function initMisPacks() {
  const host = $('#mis-packs');
  if (!host) return;
  const session = await requireLogin('mis-packs.html');
  if (!session) return;

  host.innerHTML = '<p class="promise">Cargando tus packs…</p>';
  try {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/orders` +
      '?select=paypal_order_id,pack_id,buyer_name,amount_cents,currency,created_at,delivered_at' +
      `&user_id=eq.${session.user.id}&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`, // JWT del usuario, RLS
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();

    if (!rows?.length) {
      host.innerHTML = `<p>Aún no tienes packs. <a href="index.html">Ver el catálogo</a>.</p>`;
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'pack-list';
    rows.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'pack-row';
      const info = document.createElement('div');
      info.className = 'row-info';
      const name = document.createElement('div');
      name.className = 'row-name';
      name.textContent = r.pack_id || 'Pack';
      const d = new Date(r.created_at);
      const fecha = isNaN(d) ? '' : ` · comprado el ${d.toLocaleDateString('es-ES')}`;
      const estado = document.createElement('p');
      estado.className = 'row-desc';
      estado.textContent = r.delivered_at ? 'Entregado ✓' : 'En preparación' + fecha;
      info.append(name, estado);
      const price = document.createElement('span');
      price.className = 'row-price';
      price.textContent = money(r.amount_cents, r.currency);
      li.append(info, price);
      ul.append(li);
    });
    host.innerHTML = '';
    host.append(ul);
  } catch (e) {
    console.error('[mis-packs]', e);
    host.innerHTML = '<p class="promise">No pudimos cargar tus packs. Recarga la página.</p>';
  }
}

/* ------------------------------------------------------------
   Arranque
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  initCatalog();
  $('#retry-catalog')?.addEventListener('click', initCatalog);
  bindAuthForms();
  renderAuthNav();
  initMisPacks();
  renderPurchasePanel(heroPack());

  // Una sesión que cambia (login en otra pestaña / expiración) re-renderiza
  // el nav y, si el panel seguía como CTA, monta el botón de verdad.
  const client = await getAuthClient();
  if (client) {
    client.auth.onAuthStateChange(() => {
      renderAuthNav();
      if (!state.paypalMounted) renderPurchasePanel(heroPack());
    });
  }
});