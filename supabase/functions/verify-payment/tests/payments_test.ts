// ============================================================
// tests/payments_test.ts — suite unit de la Edge Function (T7).
// 15 ramas de comportamiento con fetch stubbeado. Sin red real.
//
// Ejecutar: deno task test  (requiere Deno instalado).
// ============================================================

import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert';
import handler from '../index.ts';
import { _resetTokenCache } from '../paypal.ts';

// --- JWT fake (sin firma: el gateway del runtime la verificaría en prod) ---

const UID = '11111111-2222-3333-4444-555555555555';

function b64url(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function authHeader(claims: Record<string, unknown> = {}): Record<string, string> {
  const token = `${b64url({ alg: 'HS256' })}.${b64url({ sub: UID, role: 'authenticated', ...claims })}.firma`;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Petición POST con sesión de usuario (JWT fake con sub=UID) por defecto.
// Para los casos 401 se pasa el header de forma explícita (sin Auth / anon / sub malo).
function req(body: Record<string, unknown> | string, headers?: Record<string, string>): Request {
  return new Request('https://fn/verify-payment', {
    method: 'POST',
    headers: headers ?? authHeader(),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// --- stubs ---------------------------------------------------------------

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let captured: Array<{ url: string; init?: RequestInit }> = [];

function installFetch(mock: (req: { url: string; init?: RequestInit }, calls: number) => Response) {
  let calls = 0;
  const orig = globalThis.fetch.bind(globalThis);
  captured = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls += 1;
    captured.push({ url, init });
    const res = mock({ url, init }, calls);
    res.headers.set('Content-Type', 'application/json');
    return Promise.resolve(res);
  }) as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

const ENV = {
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'test-client',
  PAYPAL_CLIENT_SECRET: 'test-secret',
  SUPABASE_URL: 'https://proyecto.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc-test',
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_CHAT_ID: '-100000',
  CORS_ORIGIN: '*',
};

// Deno 2 eliminó el campo `env` de Deno.TestDefinition; se inyecta el
// entorno programáticamente (la tarea `test` ya corre con --allow-env).
for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);

function approvedOrder(packId = 'ansiedad-01', value = '27.00'): Record<string, unknown> {
  return {
    id: 'ORDER-1',
    status: 'APPROVED',
    purchase_units: [{ reference_id: packId, amount: { currency_code: 'USD', value } }],
    payer: { email_address: 'comprador@ejemplo.com', name: { given_name: 'Ana', surname: 'Pérez' } },
  };
}

// --- casos ---------------------------------------------------------------

Deno.test({
  name: '1/15 falta order_id -> 400',
    fn: async () => {
    const restore = installFetch(({ url }) => okJson(url === 'x' ? {} : {}));
    const res = await handler(req({}));
    assertEquals(res.status, 400);
    restore();
  },
});

Deno.test({
  name: '2/15 sin Authorization -> 401 (comprar exige cuenta)',
    fn: async () => {
    const res = await handler(req({ order_id: 'X' }, { 'Content-Type': 'application/json' }));
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: '3/15 Bearer ANON sin sub -> 401 (el anon ya no compra)',
    fn: async () => {
    const res = await handler(req({ order_id: 'X' }, authHeader({ sub: undefined, role: 'anon' })));
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: '4/15 sub que no es UUID -> 401',
    fn: async () => {
    const res = await handler(req({ order_id: 'X' }, authHeader({ sub: 'no-es-un-uuid' })));
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: '5/15 orden no aprobada -> 400',
    fn: async () => {
    const restore = installFetch(() => okJson({ ...approvedOrder(), status: 'VOIDED' }));
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 400);
    restore();
  },
});

Deno.test({
  name: '6/15 importe NO coincide con catálogo -> 400 (anti-fraude 1B)',
    fn: async () => {
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/')) return okJson({ ...approvedOrder('ansiedad-01', '1.00') }); // $1 ≠ $27
      return okJson([{ id: 'ansiedad-01', name: 'Pack Ansiedad 01', price_cents: 2700, currency: 'USD' }]);
    });
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 400);
    restore();
  },
});

Deno.test({
  name: '7/15 pack no existe en BD -> 400',
    fn: async () => {
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/')) return okJson(approvedOrder('pack-inexistente'));
      return okJson([]); // resolvePack vacío
    });
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 400);
    restore();
  },
});

Deno.test({
  name: '8/15 email del comprador vacío -> 400 (nunca del formulario)',
    fn: async () => {
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/')) {
        return okJson({ ...approvedOrder(), payer: { email_address: '' } });
      }
      return okJson([]);
    });
    const res = await handler(req({ order_id: 'X', buyer_phone: '600000000' }));
    assertEquals(res.status, 400);
    restore();
  },
});

Deno.test({
  name: '9/15 flujo feliz: captura + insert + notify, respuesta ok',
    fn: async () => {
    let captureCalled = false;
    let notifyCalled = false;
    const inserted: Array<Record<string, unknown>> = [];
    const restore = installFetch(({ url, init }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) {
        captureCalled = true;
        return new Response(JSON.stringify({ id: 'ORDER-1', status: 'COMPLETED' }), { status: 201 });
      }
      if (url.includes('/v2/checkout/orders/')) return okJson(approvedOrder());
      if (url.includes('/rest/v1/packs')) return okJson([{ id: 'ansiedad-01', name: 'Pack Ansiedad 01', price_cents: 2700, currency: 'USD' }]);
      if (url.includes('/rest/v1/orders') && url.includes('paypal_order_id=')) return okJson({}); // PATCH notify_status
      if (url.includes('/rest/v1/orders')) { // INSERT
        inserted.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(JSON.stringify([{ id: 'uuid' }]), { status: 201 });
      }
      if (url.includes('api.telegram.org')) { notifyCalled = true; return okJson({ ok: true }); }
      return okJson([]);
    });
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(captureCalled, true);
    assertEquals(notifyCalled, true);
    // Contrato de cuenta: el pedido queda vinculado a la cuenta que lo compró.
    const row = inserted[0] ?? {};
    assertEquals(row.user_id, UID);
    assertEquals(row.paypal_order_id, 'X');
    assertEquals(row.pack_id, 'ansiedad-01');
    restore();
  },
});

Deno.test({
  name: '10/15 reintento idempotente: order ya capturada -> exito, no duplica',
    fn: async () => {
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) {
        return new Response(JSON.stringify({ details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }), { status: 422 });
      }
      if (url.includes('/v2/checkout/orders/')) return okJson(approvedOrder());
      if (url.includes('/rest/v1/packs')) return okJson([{ id: 'ansiedad-01', name: 'Pack Ansiedad 01', price_cents: 2700, currency: 'USD' }]);
      if (url.includes('/rest/v1/orders') && url.includes('paypal_order_id=')) return okJson({}); // PATCH
      if (url.includes('/rest/v1/orders')) return new Response('already exists', { status: 409 }); // INSERT duplicado
      return okJson({});
    });
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 200);
    restore();
  },
});

Deno.test({
  name: '11/15 insert 409 (duplicado) -> respuesta ok pero NO re-notifica',
    fn: async () => {
    let notifyCount = 0;
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) return new Response('{}', { status: 201 });
      if (url.includes('/v2/checkout/orders/')) return okJson(approvedOrder());
      if (url.includes('/rest/v1/packs')) return okJson([{ id: 'ansiedad-01', name: 'Pack Ansiedad 01', price_cents: 2700, currency: 'USD' }]);
      if (url.includes('/rest/v1/orders')) return new Response('already exists', { status: 409 });
      if (url.includes('api.telegram.org')) { notifyCount += 1; return okJson({ ok: true }); }
      if (url.includes('/rest/v1/orders') && captured.at(-1)?.init?.method === 'PATCH') return okJson({});
      return okJson({});
    });
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 200);
    assertEquals(notifyCount, 0); // anti-spam del bot
    restore();
  },
});

Deno.test({
  name: '12/15 Telegram caído -> notificación error, la venta SIGUE ok',
    fn: async () => {
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) return okJson({ access_token: 't', expires_in: 3500 });
      if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) return new Response('{}', { status: 201 });
      if (url.includes('/v2/checkout/orders/')) return okJson(approvedOrder());
      if (url.includes('/rest/v1/packs')) return okJson([{ id: 'ansiedad-01', name: 'Pack Ansiedad 01', price_cents: 2700, currency: 'USD' }]);
      if (url.includes('/rest/v1/orders')) return new Response('[]', { status: 201 });
      if (url.includes('api.telegram.org')) return new Response('gone', { status: 500 });
      return okJson({});
    });
    const res = await handler(req({ order_id: 'X' }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.notify, 'error'); // venta registrada, notify_status=error
    restore();
  },
});

Deno.test({
  name: '13/15 token OAuth se cachea: una sola llamada para 2 requests',
    fn: async () => {
    _resetTokenCache(); // la caché OAuth es a nivel de módulo: empieza en estado limpio
    let oauthCalls = 0;
    const restore = installFetch(({ url }) => {
      if (url.includes('/v1/oauth2/token')) { oauthCalls += 1; return okJson({ access_token: 't', expires_in: 3500 }); }
      if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) return new Response('{}', { status: 201 });
      if (url.includes('/v2/checkout/orders/')) return okJson(approvedOrder());
      if (url.includes('/rest/v1/packs')) return okJson([{ id: 'ansiedad-01', name: 'Pack Ansiedad 01', price_cents: 2700, currency: 'USD' }]);
      if (url.includes('/rest/v1/orders')) return new Response('[]', { status: 201 });
      if (url.includes('api.telegram.org')) return okJson({ ok: true });
      return okJson({});
    });
    await handler(req({ order_id: 'X' }));
    await handler(req({ order_id: 'Y' }));
    assertEquals(oauthCalls, 1); // cacheado entre invocaciones (mismo isolate)
    assertNotEquals(captured.length, 0);
    restore();
  },
});

Deno.test({
  name: '14/15 método GET -> 405',
    fn: async () => {
    const res = await handler(new Request('https://fn', { method: 'GET' }));
    assertEquals(res.status, 405);
  },
});

Deno.test({
  name: '15/15 POST body no JSON -> 400',
    fn: async () => {
    const res = await handler(req('no-json{'));
    assertEquals(res.status, 400);
  },
});