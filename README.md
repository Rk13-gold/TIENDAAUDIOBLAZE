# TiendaAudioBlaze

Tienda digital de packs de audio de psicología (en español). Landing estática en
GitHub Pages + Supabase (base de datos, Storage, Edge Functions) + PayPal Smart
Buttons + Bot de Telegram que notifica cada compra con los datos del comprador.

La entrega de los packs se hace con **enlace firmado expirable, manual**, desde el
dashboard de Supabase (los packs superan 25 MB, por lo que el correo con adjunto
no sirve).

## Stack

| Capa | Tecnología |
|---|---|
| Front | HTML + CSS + JS estáticos en GitHub Pages |
| Backend | Supabase Edge Functions (Deno/TypeScript) |
| Datos | Supabase Postgres (`packs` y `orders`) + Storage privado |
| Pagos | PayPal Smart Buttons (captura server-side) |
| Notificación | Bot de Telegram (nombre, email, teléfono, pack, importe del comprador) |

## Estructura

```
index.html            landing: hero del pack #1 + catálogo compacto
styles.css            tokens de diseño "Calma terrosa" (variables CSS)
app.js                catálogo desde Supabase + onApprove → Edge Function
gracias.html          confirmación de compra
refunds.html          política de reembolso + desistimiento UE + nota IVA
assets/cover-*.svg    cubiertas generativas de los packs
supabase/
  functions/verify-payment/   Edge Function: OAuth → validate → capture → insert → notify
  migrations/                 esquema SQL (packs, orders, RLS)
```

## Secrets (Edge Function — NUNCA en el cliente)

Estas variables van en los secrets de la Edge Function de Supabase, nunca en
HTML/JS:

- `PAYPAL_CLIENT_SECRET` — secret del app de PayPal (live o sandbox)
- `TELEGRAM_BOT_TOKEN` — token del bot
- `TELEGRAM_CHAT_ID` — chat donde notifica
- `SUPABASE_SERVICE_ROLE_KEY` — clave service-role (solo servidor)
- `CORS_ORIGIN` — dominio del front para CORS (ver más abajo)

El `client-id` de PayPal que se monta en `app.js` es público.

## Arranque local

1. Instalar el CLI de Supabase: `npm i -g supabase`.
2. `supabase link --project-ref <id>`.
3. Configurar secrets:
   ```
   supabase secrets set PAYPAL_CLIENT_SECRET=...
   supabase secrets set TELEGRAM_BOT_TOKEN=...
   supabase secrets set TELEGRAM_CHAT_ID=...
   supabase secrets set CORS_ORIGIN=https://rk13-gold.github.io
   ```
4. Desplegar funciones:
   ```
   supabase functions deploy verify-payment
   supabase functions deploy get-pack-audio --no-verify-jwt
   ```
5. Aplicar migraciones: `supabase db push`.
6. Abrir `index.html` en local (el catálogo se sirve desde Supabase; el `anon` key
   y la URL del proyecto van en `app.js`).

## Reglas de negocio: Audio gratuito vs. audio de pago

| Tipo | Dónde se entrega | Propósito | Protección |
|---|---|---|---|
| **Audio gratuito** | Telegram | Muestras para probar antes de comprar (viral) | Sin DRM — solo muestras, nunca packs completos |
| **Audio de pago** | Web + Supabase | Entrega del pack completo al comprador | RLS (row-level security) + signed URLs expirables |

Principios:
- **Free = Telegram**. Las muestras gratuitas viven en el canal de Telegram. No hay registro ni autenticación para escucharlas.
- **Paid = Web + Supabase**. El pack completo se entrega al comprador validado mediante enlaces firmados (signed URLs) con expiración de 300 segundos, autorizados por la Edge Function `get-pack-audio` que verifica la compra via RLS.
- **No se suben packs completos a Telegram**. Solo muestras representativas de 2 a 3 minutos. Esto es una regla de negocio irreversible: el audio gratuito es gancho, no sustituto.

Canales de presencia:
- **index.html** + todas las páginas de pack: bloque "Prueba antes de comprar" con enlace al canal.
- **gracias.html** + **mis-packs.html**: tarjeta "Únete a la sala de Telegram" como acompañamiento post-compra.

Ver protocolo detallado en [`content/telegram-free-audio.md`](content/telegram-free-audio.md).