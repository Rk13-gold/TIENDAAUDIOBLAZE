# Checklist — Prueba de pago en PayPal Sandbox (T9)

Paso a paso para validar el flujo completo SIN dinero real. Requiere la cuenta
sandbox (TODO T2).

## 0. Requisitos
- Cuenta Business **sandbox** + cuenta de comprador de prueba en
  `developer.paypal.com` (TODO T2).
- `client-id`/`secret` del sandbox en los secrets de la Edge Function:
  ```bash
  supabase functions secrets set \
    PAYPAL_CLIENT_ID=<sandbox-client-id> \
    PAYPAL_CLIENT_SECRET=<sandbox-secret> \
    PAYPAL_ENV=sandbox
  ```
  (Mientras desarrollas, `PAYPAL_ENV=sandbox`; al lanzar, lo cambias a `live`
  con las credenciales live y el `client-id` del SDK en index.html.)
- `app.js` apuntando a `SUPABASE_URL`, la anon key y la URL de la función.

## 1. Pre-condiciones en la BD
- [ ] `packs` contiene el pack `ansiedad-01` con `price_cents=2700`, `currency=USD`.
- [ ] `orders` vacía (o con la fila esperada del test).
- [ ] El bot de Telegram responde (manda `/start` al bot).

## 2. Flujo feliz (happy path)
1. [ ] Abre la landing → el catálogo se carga desde Supabase (no hardcode).
2. [ ] El hero muestra el precio **$27.00** y «impuestos incluidos».
3. [ ] Pulsa el botón PayPal → approve la orden en el sandbox (paga con el
      comprador de prueba).
4. [ ] Aparece el spinner «Procesando tu pago seguro…» y el botón se deshabilita
      (anti doble-clic).
5. [ ] En unos segundos redirige a `gracias.html`.
6. [ ] En la tabla `orders` hay **una** fila nueva con:
      `buyer_email` = email del payer (no del formulario), `status=completed`,
      `notify_status=sent`, `amount_cents=2700` (27,00 $).
7. [ ] El bot de Telegram notifica con nombre, email, teléfono, pack e importe.
8. [ ] En Supabase, genera el enlace firmado del pack y verifica que se descarga.

## 3. Anti-fraude / bordes
1. [ ] Captura de prueba: tras aprobar en el sandbox, cancelas (no pagas) →
      el flujo debe quedar en la landa sin `orders` nueva y sin cobro.
2. [ ] Importe manipulado: si el importe de la orden no coincide con el pack,
      la función responde 400 y NO captura (revisa el log de la función).
3. [ ] Doble envío del mismo `order_id` → solo una fila (UNIQUE), y el bot NO
      vuelve a notificar.
4. [ ] Telegram caído (revoca el token) → `notify_status=error`, la fila SIGUE
      insertada, y la venta no se pierde.

## 4. Rollback
- [ ] Para una devolución: desde el dashboard de PayPal del sandbox, hacemos el
      refund; luego en `orders` marcamos `status=refunded` (T12/`delivered_at`).