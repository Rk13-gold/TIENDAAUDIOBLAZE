/* ============================================================
   TiendaAudioBlaze — app.js

   Responsabilidad: cargar el catálogo desde Supabase (lectura anon),
   montar el botón de PayPal y enviar SOLO order_id + teléfono a la
   Edge Function. La captura, la validación de importe y el email del
   comprador son SIEMPRE server-side (nunca aquí).
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
};

const $ = (sel, root = document) => root.querySelector(sel);

const money = (cents, currency) => {
  const cur = currency || CONFIG.CURRENCY;
  // USD → "$27.00" (formato en-US); otras divisas → formato local.
  const locale = cur === 'USD' ? 'en-US' : 'es-ES';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: cur })
    .format((cents || 0) / 100);
};

// --- Modo demo (local, sin Supabase/PayPal reales) --------------------------
// Se activa automáticamente si la carga del catálogo falla (placeholder) o si
// el SDK de PayPal no monta. Permite ver el diseño completo y simular el pago.
const DEMO = {
  packs: [
    {
      id: 'ansiedad-01',
      name: 'Pack Ansiedad 01',
      description: '6 sesiones guiadas para bajar la ansiedad y dormir mejor. Solo escuchar.',
      price_cents: 2700,        // 27,00 $
      currency: 'USD',
    },
  ],
};

const state = {
  packs: [],
  primary: null,     // pack del hero
  submitting: false, // anti doble clic (Pass 2)
};

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

function packCover(pack) {
  // La cubierta vive en assets/ (pública) o en Storage si cover_path está definido.
  return pack.cover_path
    ? `${CONFIG.SUPABASE_URL}/storage/v1/object/public/covers/${pack.cover_path}`
    : 'assets/cover-ansiedad-01.svg';
}

function renderCatalog(packs) {
  const list = $('#pack-list');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  packs.forEach((pack) => {
    const li = document.createElement('li');
    li.className = 'pack-row';

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

    li.append(img, info, price);
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
}

async function initCatalog() {
  const errBox = $('#catalog-error');
  try {
    state.packs = await loadPacks();
    if (!state.packs.length) throw new Error('catálogo vacío');
    state.primary = state.packs[0];
    renderCatalog(state.packs);
    renderHero(state.primary);
    errBox.hidden = true;
  } catch (e) {
    console.warn('[catalogo] carga real falló; modo demo', e);
    // Modo demo: el front se ve completo aunque no haya Supabase configurado.
    state.packs = DEMO.packs;
    state.primary = DEMO.packs[0];
    renderCatalog(DEMO.packs);
    renderHero(DEMO.packs[0]);
    errBox.hidden = true;
  }
}

/* Botón simulado para el modo demo (mismo lenguaje visual que el CTA). */
function renderDemoButton() {
  const holder = $('#paypal-button-container');
  if (!holder) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.type = 'button';
  btn.textContent = 'Comprar el pack (demo) · $27.00';
  btn.addEventListener('click', () => {
    // Simula el onApprove real: spinner, espera breve y redirige a gracias.
    setSubmitting(true);
    $('#pay-error').hidden = true;
    setTimeout(() => { window.location.href = 'gracias.html'; }, 900);
  });
  holder.append(btn);
  if (typeof paypal === 'undefined') {
    // Si no hay SDK, añadimos una nota de que es demo.
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
  status.hidden = !on;
  // Anti doble clic: PayPal deshabilita sus botones; reflejamos el estado.
  document.querySelectorAll('#paypal-button-container button').forEach((b) => {
    b.disabled = on;
  });
}

function showPayError() {
  $('#pay-error').hidden = false;
}

/* ------------------------------------------------------------
   Edge Function: enviar SOLO order_id + teléfono (T1/T3)
   ------------------------------------------------------------ */
async function submitOrderToEdge(orderId, buyerPhone) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.EDGE_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG.EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
   PayPal Smart Buttons
   ------------------------------------------------------------ */
function initPayPal() {
  if (typeof paypal === 'undefined') {
    // Sin SDK (client-id placeholder): modo demo, botón simulado.
    console.warn('PayPal SDK no cargado → modo demo');
    $('#pay-error').hidden = true;
    renderDemoButton();
    return;
  }

  paypal.Buttons({
    style: { shape: 'rect', color: 'gold', layout: 'vertical', label: 'paypal' },

    // La orden se crea con el precio público del pack; el servidor lo re-valida.
    createOrder(data, actions) {
      const pack = state.primary;
      if (!pack) return actions.reject();
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
        await submitOrderToEdge(data.orderID, phone);
        window.location.href = 'gracias.html';
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
    },
  }).render('#paypal-button-container')
    .catch((err) => {
      // client-id inválido / SDK caído: nunca un botón fantasma en silencio.
      // En modo demo local cae a un botón simulado con el mismo flujo.
      console.warn('[paypal render]', err, '→ botón demo');
      $('#pay-error').hidden = true;
      renderDemoButton();
    });
}

/* ------------------------------------------------------------
   Arranque
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initCatalog();
  $('#retry-catalog')?.addEventListener('click', initCatalog);
  initPayPal();
});