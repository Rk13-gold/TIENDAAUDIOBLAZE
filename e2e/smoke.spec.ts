// ============================================================
// e2e/smoke.spec.ts — STUB de Playwright (T8).
//
// RUTA DE PRUEBA pro forma; NO correr hasta que haya entorno:
//   - PayPal sandbox configurado (TODO T2)
//   - Edge Function desplegada contra el proyecto sandbox
//   - CONFIG de app.js apuntando a ese proyecto
//
// Instalar: npm i -D @playwright/test
// Correr:   npx playwright test
// ============================================================

import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';

test.describe('smoke TiendaAudioBlaze', () => {
  test('el catálogo se carga desde Supabase y muestra el pack #1', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#pack-list .pack-row')).not.toHaveCount(0);
    await expect(page.locator('#hero-precio')).toContainText('€');
  });

  test('gracias.html funciona sin depender de query params', async ({ page }) => {
    await page.goto(`${BASE}/gracias.html`);
    await expect(page.getByText('Pago recibido')).toBeVisible();
    await expect(page.getByText('Revisa tu bandeja de entrada')).toBeVisible();
  });

  // E2E real de pago: el usuario de prueba completa el flujo del sandbox.
  test('flujo happy-path es E2E manual con la cuenta sandbox (ver TODO T2; T9 checklist)', async ({
    page,
  }) => {
    test.skip(); // no hay sandbox configurado todavía
    await page.goto(BASE);
    // El iframe de PayPal del sandbox se rellena con el buyer de prueba.
    await page.waitForSelector('#paypal-button-container iframe', { timeout: 30000 });
  });

  test('el error del catálogo muestra reintento (estado del Pass 2)', async ({ page }) => {
    await page.route('**/rest/v1/packs*', (route) =>
      route.fulfill({ status: 500, body: 'boom' }),
    );
    await page.goto(BASE);
    await expect(page.locator('#catalog-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  });
});