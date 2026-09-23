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

| Variable | Descripción |
|---|---|
| `PAYPAL_CLIENT_ID` | Client-ID de PayPal (sandbox o live) |
| `PAYPAL_CLIENT_SECRET` | Secret del app de PayPal |
| `PAYPAL_ENV` | `sandbox` o `live` — controla la URL base de la API REST |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | Chat donde notifica |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service-role (solo servidor) |
| `CORS_ORIGIN` | Dominio del front para CORS |

## PayPal

### Detección de entorno

El front (app.js) detecta automáticamente el entorno:

```
localhost / 127.0.0.1 ──→ sandbox
*.github.io             ──→ sandbox (testing)
dominio personalizado   ──→ live (producción)
```

El SDK de PayPal se carga **dinámicamente** desde `app.js` con el client-id
correcto según el entorno. No hay script tags estáticos en los HTML.

### Cómo obtener credenciales

1. Ir a https://developer.paypal.com/dashboard/applications

2. **Sandbox** (desarrollo local + GitHub Pages):
   - Ir a https://developer.paypal.com/dashboard/applications/sandbox
   - Crear o usar la app sandbox existente
   - Copiar **Client ID** y **Secret** del panel

3. **Live** (producción):
   - Ir a https://developer.paypal.com/dashboard/applications/live
   - Crear o usar la app live existente
   - Copiar **Client ID** y **Secret**

### Cómo cambiar de sandbox a producción

```bash
# 1. Configurar secrets para sandbox (desarrollo)
supabase secrets set PAYPAL_CLIENT_ID="<sandbox-client-id>"
supabase secrets set PAYPAL_CLIENT_SECRET="<sandbox-secret>"
supabase secrets set PAYPAL_ENV=sandbox

# 2. Probar compras con cuenta sandbox de comprador
#    (https://developer.paypal.com/dashboard/applications/sandbox → Accounts)

# 3. Cuando todo funcione, cambiar a live:
supabase secrets set PAYPAL_CLIENT_ID="<live-client-id>"
supabase secrets set PAYPAL_CLIENT_SECRET="<live-secret>"
supabase secrets set PAYPAL_ENV=live
supabase secrets set CORS_ORIGIN="https://tu-dominio.com"
```

> ⚠️ En `app.js`, cambiar `PAYPAL_CLIENT_ID_LIVE` en el objeto `CONFIG`
> para que el front cargue el SDK con el client-id de producción.

### Webhooks en PayPal

1. Ir a la pestaña **Webhooks** de tu app en PayPal Developer Dashboard
2. Agregar webhook:
   ```
   https://kxlbpxprtgupvzyxsuxn.functions.supabase.co/verify-payment
   ```
3. Eventos: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`
4. Copiar el **Webhook ID** y configurarlo como secret:
   ```bash
   supabase secrets set PAYPAL_WEBHOOK_ID="<webhook-id>"
   ```

## Arranque local

1. Instalar el CLI de Supabase: `npm i -g supabase`.
2. `supabase link --project-ref <id>`.
3. Configurar secrets:
   ```
   supabase secrets set PAYPAL_CLIENT_ID=<sandbox-client-id>
   supabase secrets set PAYPAL_CLIENT_SECRET=<sandbox-secret>
   supabase secrets set PAYPAL_ENV=sandbox
   supabase secrets set TELEGRAM_BOT_TOKEN=...
   supabase secrets set TELEGRAM_CHAT_ID=...
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
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