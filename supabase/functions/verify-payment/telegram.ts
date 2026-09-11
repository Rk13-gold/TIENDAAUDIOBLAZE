// ============================================================
// telegram.ts — notificación al bot con todos los datos del
// comprador. Si el bot falla, la venta no se pierde: notify_status
// queda en 'error' y se reenvía a mano (T12).
// ============================================================

export interface OrderForNotify {
  buyer_name: string | null;
  buyer_email: string;
  buyer_phone: string | null;
  pack_name: string | null;
  amount_cents: number;
  currency: string;
  paypal_order_id: string;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(cents / 100);

export async function notifyTelegram(
  order: OrderForNotify,
): Promise<'sent' | 'error'> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return 'error';

  // Escape mínimo para parse_mode Markdown: _ * ` > van a texto crudo,
  // si no, un email/URL con _ rompería el entero mensaje.
  const esc = (s: string): string => s.replace(/([_*`\[])/g, '\\$1').replace(/>/g, '\\>');

  // Todos los datos que el fundador necesita para entregar el pack:
  // el email es central (ahí va el enlace de descarga).
  const text = [
    '🛍️ *NUEVA VENTA*',
    `Pack: ${esc(order.pack_name || '—')}`,
    `Importe: ${money(order.amount_cents, order.currency)}`,
    `Email: ${esc(order.buyer_email)}`,
    `Nombre: ${esc(order.buyer_name || '—')}`,
    `Teléfono: ${esc(order.buyer_phone || '—')}`,
    `Order: ${order.paypal_order_id}`,
    'Acción: entrega el enlace firmado a este email.',
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) return 'error';
    return 'sent';
  } catch {
    return 'error';
  }
}