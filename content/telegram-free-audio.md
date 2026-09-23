# 📡 Protocolo: Audio gratuito en Telegram

## Propósito

Publicar muestras de audio gratuitas en el canal de Telegram para que los visitantes puedan **probar antes de comprar**. Cada pack tiene una muestra representativa (no el pack completo) con un enlace a la web para comprar.

---

## Reglas de negocio (desde README.md)

| Tipo | Dónde se entrega | Protección |
|---|---|---|
| Audio gratuito | Telegram | Viral, coste cero, sin control de acceso |
| Audio de pago | Web + Supabase | RLS + signed URLs, solo usuarios con compra verificada |

❌ **Prohibido**: subir packs completos a Telegram. Solo muestras.

---

## Convención de nombres

```
AB-GRATIS-<slug-pack>-v1.mp3
```

Ejemplos:
- `AB-GRATIS-ansiedad-01-v1.mp3`
- `AB-GRATIS-autoestima-v1.mp3`

El slug debe coincidir con el `id` del pack en `window.PACK.id`.

---

## Publicación

1. Subir el archivo MP3 al canal **como audio** (no como documento ni voz).
2. En la **misma publicación**, añadir dos botones inline:
   - `🔊 Audio gratis` → enlace directo al MP3 (se reproduce en Telegram)
   - `📦 Ver pack` → enlace a la página del pack en la web
3. Fijar al canal un **mensaje índice** con la lista de todos los packs disponibles y sus enlaces.

### Ejemplo de caption

```
🌸 Suelta el día con esta guía de respiración.

Perfecta para cuando llegas a casa y no puedes apagar la mente.

Ponla a prueba y, si te gusta, el pack completo tiene 3 sesiones más.

TiendaAudioBlaze
```

Reglas del caption:
- Tuteo siempre.
- Máximo 2 emojis por caption.
- Sin enlaces en el texto del caption (los enlaces van en los botones inline).
- Cerrar con la firma "TiendaAudioBlaze".

---

## Botones inline permitidos

| Botón | Acción | Cuándo usarlo |
|---|---|---|
| `📦 Ver pack` | Enlace a la web del pack | Siempre |
| `🔊 Audio gratis` | Enlace directo al audio | Opcional, para que se abra rápido |

No usar ningún otro tipo de botón (callback, switch_inline_query, etc.).

---

## Mensaje índice (fijado en el canal)

El canal debe tener un **mensaje fijado** que sirva de índice maestro. Formato:

```
🎧 PRUEBA ANTES DE COMPRAR

Elige un pack y escucha su muestra gratis: 2-3 minutos para que decidas si es para ti.

🔹 [Soltar el día](enlace) — Pack Sueño Profundo
🔹 [Pausa anti-agobio](enlace) — Pack Estrés Laboral
🔹 [Callar al crítico](enlace) — Pack Autoestima
🔹 [Respira para la ansiedad](enlace) — Pack Ansiedad

Todos nuestros packs completos están en tiendaaudioblaze.com

TiendaAudioBlaze
```

Actualizarlo cada vez que se añada un nuevo pack.

---

## Notas técnicas

- Los audios se suben manualmente al canal (no hay automatización todavía).
- No hay límite de duración para Telegram, pero las muestras deberían ser de **2 a 3 minutos** para ser efectivas.
- No hay DRM en Telegram; por eso solo se suben **muestras**, nunca packs completos.
- El canal es público. Cualquiera puede unirse y escuchar sin registro.