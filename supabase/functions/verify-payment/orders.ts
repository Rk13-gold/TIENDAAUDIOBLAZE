// ============================================================
// orders.ts — acceso a Supabase (REST con service-role) para el
// catálogo y las órdenes. Todo aquí es server-side nomas.
// ============================================================

export interface PackRow {
  id: string;
  name?: string;
  price_cents: number;
  currency: string;
}

export interface NewOrder {
  user_id: string | null;       // cuenta Supabase Auth que compró (nullable: reconciliaciones manuales)
  paypal_order_id: string;
  pack_id: string | null;
  buyer_name: string | null;
  buyer_email: string;
  buyer_phone: string | null;
  amount_cents: number;
  currency: string;
  raw: unknown;
}

function adminHeaders(): Record<string, string> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/** Precio re-resuelto del pack en la BD (T2): fuente de verdad del importe. */
export async function resolvePack(packId: string): Promise<PackRow | null> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(
    `${url}/rest/v1/packs?select=id,name,price_cents,currency&id=eq.${encodeURIComponent(packId)}&active=eq.true`,
    { headers: adminHeaders() },
  );
  if (!res.ok) throw new Error(`Supabase packs ${res.status}`);
  const rows = await res.json();
  return rows?.length ? rows[0] : null;
}

/**
 * Inserta la fila de la orden. Idempotente:
 * - devuelve { inserted: true } en la primera inserción;
 * - ante conflicto por paypal_order_id UNIQUE (reintento del webhook/cliente)
 *   devuelve { inserted: false, exists: true } — no re-notifica (T12).
 */
export async function insertOrder(order: NewOrder): Promise<{ inserted: boolean }> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(order),
  });
  if (res.status === 201) return { inserted: true };
  if (res.status === 409) return { inserted: false }; // UNIQUE violado
  throw new Error(`Supabase orders ${res.status}: ${await res.text().catch(() => '')}`);
}

/** API/ojo: usado por el fallback edge-down (reconciliación manual). */
export async function orderExists(paypalOrderId: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(
    `${url}/rest/v1/orders?select=id&paypal_order_id=eq.${encodeURIComponent(paypalOrderId)}`,
    { headers: adminHeaders() },
  );
  if (!res.ok) throw new Error(`Supabase orders get ${res.status}`);
  const rows = await res.json();
  return (rows && rows.length > 0) || false;
}