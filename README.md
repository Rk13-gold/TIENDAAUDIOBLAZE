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

El `client-id` de PayPal que se monta en `app.js` es público.

## Arranque local

1. Instalar el CLI de Supabase: `npm i -g supabase`.
2. `supabase link --project-ref <id>` y `supabase functions secrets set PAYPAL_CLIENT_SECRET ...`.
3. Desplegar la función: `supabase functions deploy verify-payment`.
4. Abrir `index.html` en local (el catálogo se sirve desde Supabase; el `anon` key
   y la URL del proyecto van en `app.js`).