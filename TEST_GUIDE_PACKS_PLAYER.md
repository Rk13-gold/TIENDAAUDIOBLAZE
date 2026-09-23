# Guía de prueba manual — Reproductor protegido en mis-packs.html

## Prerrequisitos

- Migración 0003 aplicada en Supabase
- Edge Function `get-pack-audio` desplegada
- Al menos un usuario con una compra completada (status = 'completed') en Supabase
- Audio assets cargados en el bucket `packs-private` y registrados en la tabla `audio_assets`

---

## Paso 1: Verificar setup de datos de prueba

### 1.1 Comprobar que `audio_assets` tiene filas

```sql
select * from public.audio_assets where activo = true;
```

Debe devolver al menos un registro por audio que quieras probar.

### 1.2 Comprobar que el bucket `packs-private` contiene los archivos

Desde Supabase Dashboard → Storage → packs-private.
Debe haber archivos en `packs/<slug>/audio-01.mp3` (o similar).

### 1.3 Comprobar que existe una orden completada

```sql
select * from public.orders
where status = 'completed'
  and user_id is not null
limit 5;
```

Debe existir al menos una orden vinculada a un usuario (user_id no nulo).

> **Nota:** Si las órdenes existentes tienen `user_id = null`, el reproductor no las mostrará. Puedes asignar un user_id manualmente:
> ```sql
> update public.orders set user_id = '<UUID_del_usuario>' where user_id is null;
> ```

---

## Paso 2: Probar la carga de la página

1. Abre `mis-packs.html` en el navegador (local o GitHub Pages).
2. **Resultado esperado:** Debes ver una página con título "Mis packs" y el mensaje "Cargando tus packs…" mientras se obtienen los datos.

### 2.1 Sin sesión iniciada

1. Asegúrate de no tener sesión (cierra sesión o borra localStorage).
2. Abre `mis-packs.html`.
3. **Resultado esperado:** Eres redirigido a `login.html` con `?next=mis-packs.html`.

### 2.2 Sin compras

1. Inicia sesión con un usuario que no tenga compras completadas.
2. Abre `mis-packs.html`.
3. **Resultado esperado:** Aparece el mensaje "Aún no tienes packs comprados" y un botón "Ir al catálogo" que lleva a `index.html#catalogo`.

### 2.3 Con compras válidas

1. Inicia sesión con un usuario que tenga al menos una orden completada y audio_assets vinculados.
2. Abre `mis-packs.html`.
3. **Resultado esperado:**
   - Se muestra la barra de audio sticky en la parte superior
   - Aparece al menos una sección de pack con título y miniatura
   - Cada pack muestra una lista de pistas (botones) con número, título, duración e icono de play
   - La primera pista del primer pack aparece resaltada (clase `active`)
   - En el footer de la página se ve la marca de agua con el email del usuario y "acceso personal e intransferible" (opacidad ~0.25)

---

## Paso 3: Probar la reproducción de audio

### 3.1 Reproducir una pista

1. Toca cualquier botón de pista en la playlist.
2. **Resultado esperado:**
   - El botón se resalta (fondo más oscuro, número verde)
   - La barra de audio sticky muestra el reproductor con la pista cargada
   - El audio comienza a reproducirse
   - El resto de botones muestran los controles normales

### 3.2 Avance automático a la siguiente pista

1. Deja que una pista termine (o espera a que termine naturalmente).
2. **Resultado esperado:**
   - Automáticamente comienza a reproducirse la siguiente pista del mismo pack
   - El botón de la pista anterior pierde el resalte, el de la nueva pista se resalta

### 3.3 Avance al siguiente pack

1. Si hay múltiples packs, deja que termine la última pista del primer pack.
2. **Resultado esperado:**
   - Se carga automáticamente la primera pista del siguiente pack
   - La sección del pack anterior pierde el resalte, el nuevo pack se resalta

### 3.4 Salto manual entre pistas

1. Toca cualquier pista de cualquier pack.
2. **Resultado esperado:**
   - La pista seleccionada se resalta y comienza a reproducirse
   - Si estaba reproduciendo otra pista, se detiene y la nueva comienza

---

## Paso 4: Probar seguridad UX

### 4.1 controlsList="nodownload"

1. Abre las herramientas de desarrollo del navegador (F12).
2. Selecciona el elemento `<audio id="pack-audio">` en el inspector.
3. **Resultado esperado:** El atributo `controlslist` contiene `"nodownload"`.
4. Visualmente: el menú de descarga no debería aparecer en los controles del reproductor.

### 4.2 Menú contextual desactivado

1. Haz clic derecho sobre cualquier parte del área del reproductor (lista de pistas).
2. **Resultado esperado:** El menú contextual del navegador no aparece (o aparece bloqueado).

### 4.3 Marca de agua visible

1. Desplázate al final de la página.
2. **Resultado esperado:**
   - En la parte inferior fija se muestra: `<email> · acceso personal e intransferible`
   - Tiene una opacidad de ~0.25 (se ve semi-transparente)
   - No interfiere con clics (pointer-events: none)

---

## Paso 5: Probar estados de error

### 5.1 Error de firma (Edge Function caída o URL inválida)

1. Detén la Edge Function `get-pack-audio` (desde Supabase Dashboard → Edge Functions → pausar).
2. Toca una pista para reproducir.
3. **Resultado esperado:**
   - El botón de la pista muestra un mensaje de error: "Error al reproducir. Toca para reintentar."
   - Aparece un icono de error (signo de exclamación en rojo)
4. Reactiva la Edge Function y toca el botón de error.
5. **Resultado esperado:** La pista se reproduce correctamente.

### 5.2 Sesión expirada (token inválido)

1. Abre las herramientas de desarrollo → Aplicación → Almacenamiento local.
2. Elimina o modifica el token de sesión de Supabase (clave que contenga `supabase-auth`).
3. Recarga la página o toca una pista.
4. **Resultado esperado:** Eres redirigido a `login.html` con `?next=mis-packs.html`.

### 5.3 Sin conexión a internet

1. Desconecta la red (WiFi / cable).
2. Toca una pista.
3. **Resultado esperado:**
   - Aparece el mensaje de error en el botón de la pista
   - Al reconectar y tocar el botón de error, la pista se reproduce

---

## Paso 6: Probar respuesta móvil

### 6.1 Vista responsive

1. Abre las herramientas de desarrollo → vista responsive (o redimensiona la ventana a 375px de ancho).
2. **Resultado esperado:**
   - La barra de audio sticky ocupa todo el ancho
   - Los botones de pista se ven completos con número, título, duración e icono
   - La marca de agua se ve en la parte inferior sin solaparse con el contenido
   - No hay scroll horizontal ni elementos cortados

### 6.2 Toque en móvil

1. En vista responsive, toca varias pistas.
2. **Resultado esperado:**
   - La reproducción funciona igual que en desktop
   - Los botones responden al toque
   - No hay retrasos notables

---

## Paso 7: Probar disclaimer psicoeducativo

1. Desplázate al final del contenido pero antes de la marca de agua.
2. **Resultado esperado:** Aparece el texto de descargo:
   > "Descargo de responsabilidad: Los packs de audio están diseñados para fines de bienestar y educación psicológica. No sustituyen terapia, diagnóstico o tratamiento médico profesional…"

---

## Resumen de criterios de aceptación

| # | Criterio | Estado (✔/✘) |
|---|----------|-------------|
| 1 | Redirección a login sin sesión | |
| 2 | Mensaje "sin compras" + CTA al catálogo | |
| 3 | Lista de packs con títulos y miniatura | |
| 4 | Playlist con título, número y duración | |
| 5 | Reproducción al tocar pista | |
| 6 | Avance automático a siguiente pista | |
| 7 | Avance automático al siguiente pack | |
| 8 | controlsList="nodownload" | |
| 9 | Menú contextual desactivado | |
| 10 | Marca de agua con email + "acceso personal e intransferible" | |
| 11 | Mensaje de error + reintento al fallar firma | |
| 12 | Redirección a login si sesión expira | |
| 13 | Diseño mobile-first (375px) | |
| 14 | Disclaimer psicoeducativo visible | |