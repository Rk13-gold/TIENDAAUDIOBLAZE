# Entrega del pack — enlace firmado manual (T11)

Los packs superan 25 MB, por lo que **no se envían por correo adjunto**: se
entregan como **enlace firmado expirable** desde el bucket privado de Supabase.
El email del comprador es el dato central del pedido: ahí llega el enlace.

> Esto es un **procedimiento manual del fundador** (MVP). La automatización
> total (email transaccional + webhook PayPal) es Fase 2, previa ≥1 venta real.

## Cómo entregar (5 min por pedido)

1. **Venta notificada.** El bot de Telegram avisa con nombre, email, teléfono,
   pack e importe (columna `notify_status=sent` en `orders`).
2. **Subir el audio** (si es la primera vez): en Supabase → Storage → bucket
   `audios` (privado) → subir `<pack-id>/<fichero>.zip`.
3. **Generar enlace firmado**:
   - Supabase → Storage → `audios` → clic derecho sobre el fichero →
     **Get URL** (busca la opción signed URL) → elegir caducidad **72 h**.
4. **Enviar por correo al comprador** (desde tu email). Plantilla mínima:

   > Hola [nombre],
   > Gracias por comprar el [pack]. Aquí tienes tu enlace de descarga:
   > [ENLACE FIRMADO]
   > Caduca en 72 horas. Si algo falla, responde a este correo.
   > — TiendaAudioBlaze

5. **Marcar entregado** en Supabase → Table Editor → `orders` → fila del pedido →
   rellenar `delivered_at = now()`.
6. **Cerrar el ticket**: el pedido queda con `delivered_at` relleno; si el
   comprador pide re-descarga, Fase 2 lo resuelve con URL re-usable.

## Si el bot no notificó (`notify_status=error`)
- Revisa `orders` (service-role) por las filas recientes. La venta SÍ está
  registrada aunque Telegram haya fallado. Envía una consulta:
  ```sql
  select paypal_order_id, buyer_email, pack_id, amount_cents, created_at
  from orders order by created_at desc limit 5;
  ```
- Complementa el envío a mano y pon `notify_status='sent'`.

## Si la Edge Function estuvo caída (`fallback edge-down`)
- El dinero sí llega a PayPal aunque la función no responda. Al recuperarte:
  1. Lista los pagos en el dashboard de PayPal (últimas 24 h).
  2. Para cada `order_id` sin fila en `orders`, **crea la fila a mano**
     (service-role Table Editor) con los datos reales del payer de PayPal.
  3. Notifica al bot o al correo con la entrega normal.

## Seguridad (recordatorio)
- El enlace firmado expira y está ligado al fichero. 72 h es un buen balance
  para un pack digital.
- Nunca pongas el fichero en buckets públicos.