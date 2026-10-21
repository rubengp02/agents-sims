import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Solo comprueba la propuesta local: no inicia agentes ni llama a modelos.
const require = createRequire(new URL('../pixel-office/package.json', import.meta.url));
const { chromium } = require('playwright');
const preview = process.argv[2];
assert.ok(preview, 'Indica la ruta absoluta a la vista previa renderizada.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1200 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(preview).href);
  const frame = page.frameLocator('iframe');
  for (const layout of ['office', 'table']) {
    await page.frames()[1].evaluate((value) => {
      document.querySelectorAll('[data-variant]').forEach((section) => {
        section.hidden = !section.querySelector(`[data-layout="${value}"]`);
      });
    }, layout);
    const panel = frame.locator(`[data-layout="${layout}"]`);
    assert.equal(await panel.locator('[data-scenario]').count(), 1);
    assert.equal(await panel.locator('[data-mode="auto"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await panel.locator('[data-model]').inputValue(), 'gpt-5.6-terra');
    for (const id of ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-6-astra']) {
      assert.equal(
        await panel.locator(`[data-model] option[value="${id}"]`).evaluate((e) => e.disabled),
        true,
      );
    }
    await panel.locator('[data-scenario]').selectOption('low');
    await panel.locator('[data-role="chief"]').click();
    assert.equal(await panel.locator('[data-model]').inputValue(), 'gpt-5.6-luna');
    assert.equal(await panel.locator('[data-effort]').inputValue(), 'low');
    await panel.locator('[data-role="architect"]').click();
    assert.equal(await panel.locator('[data-origin]').textContent(), 'En espera');
    await panel.locator('[data-scenario]').selectOption('high');
    assert.equal(await panel.locator('[data-effort]').inputValue(), 'high');
    await panel.getByText('Límites y modelos permitidos', { exact: true }).click();
    await panel.locator('[data-astra]').check();
    await panel.locator('[data-legacy]').check();
    assert.equal(await panel.locator('[data-model]').inputValue(), 'gpt-5.6-terra');
    await panel.locator('[data-model]').selectOption('gpt-6-astra');
    await panel.locator('[data-effort]').selectOption('low');
    await panel.locator('[data-fix]').click();
    assert.equal(await panel.locator('[data-origin]').textContent(), 'Fijado por ti');
    await panel.locator('[data-astra]').uncheck();
    assert.equal(await panel.locator('[data-model]').inputValue(), 'gpt-5.6-terra');
    await panel.locator('[data-legacy]').uncheck();
    for (const mode of ['manual', 'mixed', 'auto']) {
      await panel.locator(`[data-mode="${mode}"]`).click();
      assert.equal(
        await panel.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'),
        'true',
      );
    }
    await panel.locator('[data-limit="maxRuns"]').fill('4');
    await panel.locator('[data-limit="maxRuns"]').dispatchEvent('change');
    await panel.getByText('Límites y modelos permitidos', { exact: true }).click();
    await panel.locator('[data-scenario]').selectOption('medium');
    await panel.locator('[data-role="developer"]').click();
    for (const width of [1024, 736, 375, 320]) {
      await page.setViewportSize({ width, height: 1200 });
      const metrics = await page.frames()[1].evaluate(() => ({
        w: document.documentElement.clientWidth,
        s: document.documentElement.scrollWidth,
      }));
      assert.ok(metrics.s <= metrics.w + 1, `${layout} a ${width}px: ${JSON.stringify(metrics)}`);
    }
    await page.setViewportSize({ width: 1024, height: 1200 });
    await panel.screenshot({ path: join(dirname(preview), `ahorro-${layout}.png`) });
    checks++;
  }
  assert.deepEqual(errors, []);
  console.log(
    `Correcto: ${checks} vistas, Auto inicial, exclusiones, esfuerzos, espera, excepciones manuales, modos, límites y 8 tamaños. Sin errores JavaScript.`,
  );
} finally {
  await browser.close();
}
