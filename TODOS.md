# TODOS — TiendaAudioBlaze

Deferidos en la revisión de ingeniería (2026-09-11). Cada ítem es un alcance real pero no bloquea el MVP (piloto con 1ª venta real).

---

## T1 — Workflow GitHub Actions para desplegar Edge Functions de Supabase

- **What:** GH Actions job que ejecuta `supabase link` + `supabase functions deploy` en push a la rama de producción.
- **Why:** Hoy el deploy de la Edge Function es manual (CLI/dashboard). El doc de diseño difiere esto deliberadamente; el CI lo consolida sin servidor propio.
- **Pros:** Deploy reproducible y verificable por commit; colapsa fricción cuando haya 2+ funciones (Fase 2 añadirá el endpoint de email y el webhook).
- **Cons:** Un paso de infra más antes de validar demanda; requiere el token de acceso a Supabase como secret del repo.
- **Context:** Decisión de la revisión `/plan-eng-review` 2026-09-11. Info: variable `SUPABASE_ACCESS_TOKEN` (secret del repo) + `SUPABASE_PROJECT_ID`. Guarda del CI: assert `supabase --version` en el job.
- **Depends on:** decisión de validación (≥1 venta) o momento previo a Fase 2.

## T2 — Cuenta de prueba (sandbox) de PayPal + setup documentado

- **What:** Crear cuenta **Business sandbox** y cuenta de comprador de prueba en developer.paypal.com, y documentar el setup (credenciales sandbox, RUTA de prueba, moneda) en un README del repo.
- **Why:** La suite de tests decidida (unit de 10 ramas + checklist E2E real) no puede correr sin entorno aislado de PayPal. También evita cobrar compras reales durante las pruebas de integración.
- **Pros:** Entorno aislado para probar fraude (1B importe ≠), duplicados (1D) y el flujo feliz; prerequisito de la suite de tests (3A).
- **Cons:** ~2h de configuración inicial; el sandbox y el live comparten un mismo patrón pero diferente client-id — hay que ser estricto al intercambiar credenciales.
- **Context:** Decisión de la revisión `/plan-eng-review` 2026-09-11. `client-id`/`secret` del sandbox van en los secrets de Edge Function durante desarrollo; los del live se sustituyen al lanzar.
- **Depends on:** ninguna — se puede hacer hoy en paralelo al build (lane C de paralelización).

---

## D1 — /design-consultation para el sistema formal

- **What:** Correr `/design-consultation` cuando haya más páginas (Fase 2: email, "mis packs", dashboard) para un sistema formal con tokens compartidos entre páginas.
- **Why:** Los tokens base del diseño (Pass 5 de /plan-design-review, 2026-09-11) funcionan para 1-3 páginas; un sistema formal evita la deriva visual al crecer.
- **Pros:** Vocabulario visual único cuando el producto crece; evita re-trabajo de token.
- **Cons:** Coste de tiempo cuando se ejecute; innecesario hoy para el MVP.
- **Context:** Dirección visual "Calma terrosa" (cream + pino oscuro + terracota, serif Fraunces + Instrument Sans) ya decidida y documentada en el addendum de diseño del design doc.
- **Depends on:** Fase 2 / decisión de crecer el catálogo.

## D2 — /design-review en vivo tras implementar

- **What:** Tras implementar la landing (T1-T7 de diseño + T1-T13 de ingeniería), correr `/design-review`: auditoría visual en vivo de la página real (contraste, estados, sticky, móvil, focus).
- **Why:** Todos los pases del plan superaron 8; el skill recomienda QA visual sobre código real para cerrar el lazo entre lo especificado y lo desplegado.
- **Pros:** Verifica contra navegador real lo que el plan especificó (estados del Pass 2, a11y del Pass 6); cierra decisiones de detalle.
- **Cons:** Un paso más tras el build; depende de que el build esté completo y desplegable.
- **Context:** Requiere primero el HTML/CSS/JS de la landing y el entorno local/Pages.
- **Depends on:** Build del MVP completo.