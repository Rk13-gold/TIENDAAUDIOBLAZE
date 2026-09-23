# Informe: Conexión de PayPal real en landings de packs

## Resumen
El botón de PayPal real ya estaba implementado en el código. Se verificó la configuración y se añadió el manejo de cancelación que faltaba.

## Client-ID configurado
```
AdDqsKZIajyi2rT-spC0LL72qguV5t7Am8GnSSMAj_Rt17aFhjAAmYs2GB9INr4Fj2HdYGeC0lV08d3J
```
- **Tipo**: Sandbox (proporcionado por el usuario)
- **Ubicación**: Todos los 5 archivos HTML que cargan el SDK de PayPal
- **Estado**: ✅ Correcto — coincide con el client-id proporcionado

## Archivos con el SDK de PayPal
| Archivo | Línea |
|---|---|
| `index.html` | 18 |
| `packs/ansiedad-01.html` | 38 |
| `packs/autoestima.html` | 38 |
| `packs/estres-laboral.html` | 38 |
| `packs/sueno-profundo.html` | 38 |

## Flujo del botón de PayPal (app.js)

### `renderPurchasePanel()` — Árbol de decisión (línea 355)
```
┌─ ¿state.demo o falló supabase-js?
│  → Botón demo (simulado, sin cobro)
│
├─ ¿Sin sesión de usuario?
│  → CTA: "Necesitas una cuenta para comprar" + link a login
│
├─ ¿paypal SDK no cargado?
│  → Botón demo (fallback)
│
└─ Todo OK → Botón PayPal real:
     ├─ createOrder: crea orden con precio del pack
     ├─ onApprove → submitOrderToEdge() → redirect a gracias.html
     ├─ onError → showPayError()
     └─ onCancel → showCancelMsg() ✅ NUEVO
```

### Cambios realizados en `app.js` (2 cambios)

**1. `showPayError()` — Restauración del HTML original** (línea 300)
- Ahora preserva el HTML original vía `dataset.originalHtml` antes de sobrescribirlo
- Si se mostró un mensaje de cancelación, al fallar el pago se restaura el error real de PayPal

**2. `showCancelMsg()` — Nueva función** (línea 311)
- Muestra "Pago cancelado por el usuario." en el contenedor `#pay-error`
- Guarda el HTML original para restaurarlo después

**3. `onCancel()` — Ahora con feedback** (línea 447)
- Antes: solo `setSubmitting(false)` — silencioso
- Después: `setSubmitting(false)` + `showCancelMsg()`

## Configuración de Webhooks en PayPal Sandbox

Paso obligatorio para que `verify-payment` reciba notificaciones:
1. Ir a https://developer.paypal.com/dashboard/applications/sandbox
2. Seleccionar la aplicación sandbox
3. Ir a la pestaña **Webhooks**
4. Click **Add Webhook**
5. **Webhook URL**:
   ```
   https://kxlbpxprtgupvzyxsuxn.functions.supabase.co/verify-payment
   ```
6. **Eventos a escuchar**: Seleccionar:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
7. Click **Save**
8. Copiar el **Webhook ID** generado
9. Agregar el Webhook ID a los secrets de Supabase:
   ```bash
   supabase secrets set PAYPAL_WEBHOOK_ID=<el-id-copiado>
   ```
   Si no tienes Supabase CLI instalada, usa el dashboard de Supabase:
   - Ir a https://supabase.com/dashboard/project/kxlbpxprtgupvzyxsuxn
   - Edge Functions → verify-payment → Environment variables
   - Agregar `PAYPAL_WEBHOOK_ID`

## Cuentas Sandbox para pruebas

PayPal crea automáticamente cuentas sandbox. Para verlas:
1. Ir a https://developer.paypal.com/dashboard/applications/sandbox
2. Sección **Accounts** (o Sandbox → Test accounts)
3. Verás algo como:
   - **Comprador**: `sb-xxxxxx@personal.example.com` — para hacer compras de prueba
   - **Vendedor**: `sb-xxxxxx@business.example.com` — la cuenta vinculada al client-id

## Pasos para probar compra real

### Prerrequisitos
1. ✅ Edge Function `verify-payment` desplegada en Supabase
2. ✅ Webhook configurado en PayPal Developer Dashboard
3. ✅ Migración 0003 (tabla `orders`) aplicada en Supabase
4. ✅ Tener una cuenta de usuario registrada en TiendaAudioBlaze

### Flujo de prueba
```bash
# 1. Ir a la landing de un pack:
#    https://rk13-gold.github.io/TIENDAAUDIOBLAZE/packs/ansiedad-01.html

# 2. Iniciar sesión (correo + contraseña registrados en la tienda)

# 3. Click en el botón de PayPal
#    → Se abre ventana de PayPal Sandbox

# 4. Ingresar credenciales de comprador sandbox:
#    Email: sb-xxxxxx@personal.example.com
#    Password: (de la cuenta sandbox)

# 5. Confirmar pago

# 6. Verificar:
#    - Redirección a gracias.html
#    - Orden insertada en Supabase (tabla orders, columna user_id = tu UUID)
#    - Webhook recibido en PayPal Developer Dashboard
```

### Verificación en Supabase
```sql
-- Verificar órdenes creadas
SELECT * FROM orders ORDER BY created_at DESC LIMIT 5;

-- Verificar por usuario específico
SELECT * FROM orders
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'tu-email@ejemplo.com')
ORDER BY created_at DESC;
```

## Archivos modificados
| Archivo | Cambio |
|---|---|
| `app.js` | `showPayError()`: preserva/restaura HTML original `showCancelMsg()`: nueva función `onCancel()`: ahora muestra mensaje al usuario |

## Diagnóstico: ¿Por qué veías "Comprar el pack (demo)"?

El botón de demo aparece cuando se cumple ALGUNA de estas condiciones:
1. **`state.demo === true`**: El catálogo de Supabase no se pudo cargar → la app cae a modo demo
2. **`getAuthClient()` retorna `null`**: El SDK `@supabase/supabase-js` no cargó desde CDN
3. **`typeof paypal === 'undefined'`**: El SDK de PayPal no cargó desde CDN
4. **No hay sesión de usuario activa**: Se muestra el CTA de login (no el botón de demo)

**Para obtener el botón de PayPal real**, inicia sesión y asegúrate de que Supabase y el SDK de Paypal carguen correctamente. Si el problema persiste desde GitHub Pages, verifica las pestañas de red del navegador para identificar qué CDN está fallando.

---
Informe generado el 2026-09-23