// ============================================================
// verify-payment — Edge Function de Supabase (Deno/TypeScript)
//
// Pipeline (T12): autenticar con PayPal → leer la orden → VALIDAR
// importe+divisa contra el precio re-resuelto de packs (T2) →
// CAPTURAR server-side (T1) → insertar la fila (idempotente) →
// notificar a Telegram SOLO si la fila es nueva.
//
// El email del comprador NUNCA viene del formulario: siempre del
// objeto payer que devuelve PayPal.
// ============================================================

import { captureOrder, getOrder, payerEmail, payerName } from './paypal.ts';
import { insertOrder, resolvePack, type NewOrder } from './orders.ts';
import { notifyTelegram } from './telegram.ts';

// CORS: origen del front (GitHub Pages). En producción, el dominio real.
const ALLOWED_ORIGIN = Deno.env.get('CORS_ORIGIN') ?? '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function centsToNumber(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

interface Payload {
  order_id?: string;
  buyer_phone?: string | null;
}

// --- JWT del comprador (identidad en Supabase Auth) -------------------------
// El gateway ya verifica la firma (verify_jwt:true). Aquí solo decodificamos
// el payload para sacar el `sub` (user_id) y exigir que sea un UUID real.
// El Bearer ANON (sin sub) queda rechazado a propósito: comprar exige cuenta.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (part.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null; // JWT mal formado -> equivalen a sin identidad
  }
}

/** user_id del Bearer, o null si falta / no es un UUID -> 401. */
function extractUserId(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? decodeJwtPayload(token) : null;
  const sub = payload?.sub;
  return typeof sub === 'string' && UUID_RE.test(sub) ? sub : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // Compra SOLO con cuenta: sin JWT de usuario válido -> 401.
  const userId = extractUserId(req);
  if (!userId) return json({ error: 'Autenticación requerida' }, 401);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const orderId = payload.order_id;
  if (!orderId || typeof orderId !== 'string') {
    return json({ error: 'Falta order_id' }, 400); // NUNCA confiar en el formulario por sí solo
  }

  try {
    // 1. Ver la orden en PayPal (servidor, no cliente).
    const order = await getOrder(orderId);

    // 2. Validar que esté aprobada y capturable.
    if (!['APPROVED', 'COMPLETED'].includes(order.status)) {
      return json({ error: `Orden no aprobada (${order.status})` }, 400);
    }

    const unit = order.purchase_units?.[0];
    if (!unit) return json({ error: 'Orden sin purchase_units' }, 400);
    const paypalAmount = centsToNumber(unit.amount.value);
    const paypalCurrency = unit.amount.currency_code;
    const packId = unit.reference_id ?? null;

    // 3. VALIDAR importe + divisa contra packs (T2). Re-resolver en la BD.
    const expected: { price_cents: number; currency: string; name?: string } | null = packId
      ? await resolvePack(packId)
      : null;

    let packName: string | null = null;
    if (packId && expected) {
      packName = expected.name ?? null;
      if (expected.price_cents !== paypalAmount || expected.currency !== paypalCurrency) {
        return json({ error: 'Importe/divisa no coincide con el catálogo' }, 400);
      }
    } else if (packId) {
      // pack desconocido o inactivo -> no capturar
      return json({ error: 'Pack no disponible' }, 400);
    } else {
      // Sin reference_id no sabemos qué validar (T2). Nunca capturar a ciegas.
      return json({ error: 'La orden no indica el pack' }, 400);
    }

    const email = payerEmail(order);
    if (!email) return json({ error: 'Falta el email del comprador en PayPal' }, 400);

    // 4. Capturar server-side (T1). Idempotente ante reintentos (T12).
    await captureOrder(orderId);

    // 5. Insertar la fila (idempotente). Reintento -> ya existe -> no re-notificar.
    const row: NewOrder = {
      user_id: userId,
      paypal_order_id: orderId,
      pack_id: packId,
      buyer_name: payerName(order),
      buyer_email: email,
      buyer_phone: payload.buyer_phone ?? null,
      amount_cents: paypalAmount,
      currency: paypalCurrency,
      raw: order,
    };
    const result = await insertOrder(row);

    // 6. Notificar solo si la fila es nueva (anti-spam del bot, T12).
    let notifyStatus: 'sent' | 'error' | 'skipped' = 'skipped';
    if (result.inserted) {
      notifyStatus = await notifyTelegram({
        buyer_name: row.buyer_name,
        buyer_email: row.buyer_email,
        buyer_phone: row.buyer_phone,
        pack_name: packName,
        amount_cents: row.amount_cents,
        currency: row.currency,
        paypal_order_id: orderId,
      });
      // Notificar es best-effort: si el bot falla, la fila queda con notify_status.
      await updateNotifyStatus(orderId, notifyStatus);
    }

    // 7. Responder éxito siempre que la captura y la fila estén bien.
    return json({ ok: true, notify: notifyStatus });
  } catch (e) {
    // Fallback edge-down: si el insert falló tras capturar, la venta ya está
    // en PayPal; se reconcilia manualmente por dashboard (T12). Lo dejamos claro.
    console.error('[verify-payment]', orderId || '?', e);
    return json({ error: 'Error interno verificando el pago' }, 502);
  }
}

// --- ayudante separado para mantener el flujo limpio ---------------------

async function updateNotifyStatus(orderId: string, status: string): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    await fetch(`${url}/rest/v1/orders?paypal_order_id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_status: status }),
    });
  } catch {
    // best-effort
  }
}