// ============================================================
// paypal.ts — cliente mínimo de la API REST de PayPal (orders v2)
// OAuth con caché de token. Sandbox/live según PAYPAL_ENV.
// ============================================================

export interface PaypalOrder {
  id: string;
  status: string; // CREATED | APPROVED | COMPLETED | VOIDED ...
  purchase_units: Array<{
    reference_id?: string;
    amount: { currency_code: string; value: string };
  }>;
  payer?: {
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  };
}

export interface CaptureResult {
  id: string;
  status: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }>;
    };
  }>;
}

export function paypalBase(): string {
  return Deno.env.get('PAYPAL_ENV') === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

// Token OAuth cacheado a nivel de isolate (T12): evita pedir token en cada
// petición. El isolate de Deno se reutiliza entre invocaciones cercanas.
let cached: { token: string; expiresAt: number } | null = null;

/** Solo para tests: reinicia el cache de token (determinismo entre tests del mismo proceso). */
export function _resetTokenCache(): void {
  cached = null;
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const clientId = Deno.env.get('PAYPAL_CLIENT_ID');
  const secret = Deno.env.get('PAYPAL_CLIENT_SECRET');
  if (!clientId || !secret) throw new Error('Falta PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET');

  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal OAuth ${res.status}`);
  const json = await res.json();
  const ttlSec = Number(json.expires_in || 3200);
  cached = { token: json.access_token, expiresAt: Date.now() + (ttlSec - 60) * 1000 };
  return cached.token;
}

export async function getOrder(orderId: string): Promise<PaypalOrder> {
  const token = await getAccessToken();
  const res = await fetch(`${paypalBase()}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal GET order ${res.status}`);
  return res.json();
}

/**
 * Captura la orden SERVER-SIDE (T1). Nunca se captura en el cliente.
 * Un reintento sobre una orden ya capturada se trata como éxito (idempotencia, T12).
 */
export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(`${paypalBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 201 || res.status === 200) {
    return res.json();
  }

  // Reintento idempotente: "ya capturada" no es un fallo.
  const body = await res.json().catch(() => ({}));
  const issue = body?.details?.[0]?.issue;
  if (issue === 'ORDER_ALREADY_CAPTURED') {
    return { id: orderId, status: 'COMPLETED' };
  }
  throw new Error(`PayPal capture ${res.status}: ${issue || body?.name || 'unknown'}`);
}

/** Extrae el email del comprador del objeto payer (SIEMPRE server-side). */
export function payerEmail(order: PaypalOrder): string {
  return order.payer?.email_address || '';
}

export function payerName(order: PaypalOrder): string | null {
  const n = order.payer?.name;
  if (!n) return null;
  return [n.given_name, n.surname].filter(Boolean).join(' ') || null;
}