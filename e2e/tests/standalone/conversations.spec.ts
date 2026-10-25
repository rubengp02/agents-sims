import { expect, type Locator, test } from '@playwright/test';
import { type ChildProcess, fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function showOptions(panel: Locator) {
  if (
    ((await panel.boundingBox())?.width ?? 1280) <= 760 &&
    (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
  )
    await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
  if (
    !(await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').isVisible())
  )
    await panel.getByText('Opciones del encargo', { exact: true }).click();
}
async function showNavigation(panel: Locator) {
  if (!(await panel.getByLabel('Proyecto', { exact: true }).isVisible()))
    await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
}
async function menuAction(panel: Locator, name: string) {
  await panel.getByLabel('Menú de conversación', { exact: true }).click();
  await panel.getByRole('button', { name, exact: true }).click();
}
async function toggleSettings(panel: Locator) {
  if (await panel.getByRole('button', { name: 'Cerrar ajustes', exact: true }).isVisible())
    await panel.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  else await menuAction(panel, 'Ajustes del proyecto');
}

async function start(root: string): Promise<{ child: ChildProcess; url: string }> {
  const child = fork(path.resolve(__dirname, '../../fixtures/conversations-server.ts'), [root], {
    execArgv: ['--import', 'tsx'],
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Fixture server exited: ${code}`)));
    child.once('message', (message) =>
      resolve({ child, url: `http://127.0.0.1:${(message as { port: number }).port}` }),
    );
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Fixture shutdown timeout'));
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.send('stop');
  });
}

test('chat prepares, confirms and executes one message, persists history and scopes TURBO @area:standalone', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000); // Includes multiple server restarts and office recovery cycles.
  const root = mkdtempSync(path.join(tmpdir(), 'office-conversations-browser-'));
  const project = path.join(root, 'project');
  mkdirSync(project);
  writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
  );
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    server = await start(root);
    const missingApi = await page.request.get(`${server.url}/api/unknown-function`);
    expect(missingApi.status()).toBe(404);
    expect((await missingApi.json()).code).toBe('api_not_found');
    await page.goto(server.url);
    let panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel).toBeVisible();
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    await expect(panel.getByRole('button', { name: 'Ejecutar cola', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Cancelar nuevo proyecto', exact: true }).click();
    await expect(panel.getByLabel('Carpeta del proyecto', { exact: true })).toBeHidden();
    await panel.getByRole('button', { name: 'Añadir proyecto', exact: true }).click();
    await expect(
      panel.locator('#chat-add-project').getByLabel('Carpeta del proyecto', { exact: true }),
    ).toBeFocused();
    await page.route('**/api/team/projects/pick-folder', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }),
    );
    await panel.getByRole('button', { name: 'Elegir carpeta…', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText(
      'El servidor de la oficina necesita actualizarse',
    );
    await page.route('**/api/team/projects/pick-folder', (route) =>
      route.fulfill({ json: { path: project } }),
    );
    await panel.getByRole('button', { name: 'Elegir carpeta…', exact: true }).click();
    await expect(panel.getByLabel('Carpeta del proyecto', { exact: true })).toHaveValue(project);
    await page.route('**/api/team/projects/pick-folder', (route) =>
      route.fulfill({ json: { path: null } }),
    );
    await panel.getByRole('button', { name: 'Elegir carpeta…', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Elegir carpeta…', exact: true })).toBeEnabled();
    await expect(panel.getByLabel('Carpeta del proyecto', { exact: true })).toHaveValue(project);
    await panel.getByLabel('Nombre del proyecto', { exact: true }).fill('Proyecto recordado');
    await expect(panel.getByLabel('Instrucciones adicionales', { exact: true })).toBeHidden();
    await panel
      .locator('#chat-add-project')
      .getByText('Ajustes avanzados', { exact: true })
      .click();
    await panel
      .getByLabel('Instrucciones adicionales', { exact: true })
      .fill('Conserva mis instrucciones');
    await panel.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
    await expect(panel.getByLabel('Proyecto', { exact: true })).toHaveCount(1);
    await showNavigation(panel);
    await expect(panel.getByLabel('Proyecto', { exact: true })).toContainText('Proyecto recordado');
    await panel.getByRole('button', { name: 'Añadir proyecto', exact: true }).click();
    await expect(
      panel.locator('#chat-add-project').getByLabel('Carpeta del proyecto', { exact: true }),
    ).toBeFocused();
    await panel.getByRole('button', { name: 'Cancelar nuevo proyecto', exact: true }).click();
    await toggleSettings(panel);
    await panel.getByLabel('Trabajar con autonomía en este proyecto').uncheck();
    await panel.getByText('Pruebas del proyecto', { exact: true }).click();
    await panel.getByLabel('Aprobar prueba test').check();
    await panel.getByRole('button', { name: 'Guardar aprobación de pruebas' }).click();
    await expect(panel.getByText(/test · Aprobada/)).toBeVisible();
    await toggleSettings(panel);
    await panel.getByLabel('Mensaje', { exact: true }).fill('Primera pregunta');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    const confirmation = panel.getByRole('region', { name: 'Confirmar encargo' });
    await expect(confirmation).toContainText('No necesitas introducir límites técnicos');
    await expect(confirmation.getByLabel('Cota de tokens de la tarea')).toHaveCount(0);
    await expect(confirmation).toContainText('Solo lectura');
    await expect(confirmation).toContainText(/cuota/i);
    await expect(
      panel.getByRole('button', { name: 'Confirmar y ejecutar', exact: true }),
    ).toBeEnabled();
    await panel.getByRole('button', { name: 'Confirmar y ejecutar', exact: true }).click();
    await expect(panel.getByRole('log')).toContainText('Respuesta guardada de la primera pregunta');
    await expect(
      panel.getByRole('log').locator('strong').filter({ hasText: 'Propósito y funcionalidades.' }),
    ).toBeVisible();
    await expect(panel.getByRole('log').locator('em')).toHaveText('cursiva');
    await expect(panel.getByRole('log').locator('code')).toHaveText('**texto literal**');
    const autonomy = panel.getByLabel('Presupuesto de autonomía', { exact: true });
    await autonomy.locator('summary').click();
    await expect(autonomy).toContainText('24 tokens registrados en 1 intento');
    await expect(autonomy).toContainText('25% usado');
    await expect(autonomy).toContainText('Hasta el margen de seguridad en esa lectura: 65%');
    await expect(autonomy).toContainText('sin un corte fijo por minutos');
    await expect(panel.getByLabel('Mensaje', { exact: true })).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('presupuesto-autonomia.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
      await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    await expect(panel.getByLabel('Mensaje', { exact: true })).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('presupuesto-autonomia-movil.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await showNavigation(panel);
    const recordedAttempts = readFileSync(path.join(root, 'runs.txt'), 'utf8');
    await autonomy.locator('summary').click();
    expect(readFileSync(path.join(root, 'runs.txt'), 'utf8')).toBe(recordedAttempts);
    await panel.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    await expect(panel.getByLabel('Proyecto', { exact: true })).toHaveCount(1);
    await expect(panel.getByRole('log')).not.toContainText(
      'Respuesta guardada de la primera pregunta',
    );
    await showNavigation(panel);
    await panel
      .getByRole('navigation', { name: 'Conversaciones guardadas' })
      .getByRole('button', { name: 'Primera pregunta', exact: true })
      .click();
    await expect(panel.getByLabel('Proyecto', { exact: true })).toHaveCount(1);
    await expect(panel.getByRole('log').locator('em')).toHaveText('cursiva');
    await showNavigation(panel);
    await expect(
      panel.getByRole('region', { name: 'Estado del encargo' }).locator('.chat-execution-success'),
    ).toHaveText('✓ Completado');
    await panel.getByLabel('Mensaje', { exact: true }).fill('Borrador guardado');
    await panel.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Borrador guardado en este equipo.');
    await menuAction(panel, 'Ver oficina');
    await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
    panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel.getByLabel('Mensaje', { exact: true })).toHaveValue('Borrador guardado');
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    expect(readFileSync(path.join(root, 'runs.txt'), 'utf8')).toBe('1');

    await stop(server.child);
    server = await start(root);
    await page.goto(server.url);
    panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    await expect(panel.getByRole('log')).toContainText('Respuesta guardada de la primera pregunta');
    await expect(panel.getByLabel('Mensaje', { exact: true })).toHaveValue('Borrador guardado');
    await expect(panel.getByLabel('Proyecto', { exact: true })).toHaveCount(1);
    await expect(panel.getByRole('log').locator('em')).toHaveText('cursiva');
    await showNavigation(panel);
    await toggleSettings(panel);
    await expect(panel.getByLabel('Instrucciones adicionales', { exact: true })).toBeHidden();
    const saveUnopened = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/team/projects') && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
    expect((await (await saveUnopened).json()).library.projects[0].instructions).toBe(
      'Conserva mis instrucciones',
    );
    await panel.getByText('Ajustes avanzados', { exact: true }).click();
    await expect(panel.getByLabel('Instrucciones adicionales', { exact: true })).toHaveValue(
      'Conserva mis instrucciones',
    );
    await panel.getByText('Pruebas del proyecto', { exact: true }).click();
    await expect(panel.getByLabel('Aprobar prueba test')).toBeChecked();
    await toggleSettings(panel);
    await panel.getByLabel('Mensaje', { exact: true }).fill('Segunda pregunta');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await panel.getByLabel('He revisado la pausa y quiero continuar con este encargo.').check();
    await panel.getByRole('button', { name: 'Confirmar y ejecutar', exact: true }).click();
    await expect(panel.getByRole('log')).toContainText('Seguimiento con contexto conservado');
    const download = page.waitForEvent('download');
    await menuAction(panel, 'Descargar conversación');
    expect((await download).suggestedFilename()).toMatch(/^conversacion-.*\.json$/);

    await panel.getByLabel('Mensaje', { exact: true }).fill('Cambios solo para este mensaje');
    await panel.getByLabel('Permitir cambios en archivos para este mensaje').check();
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Confirmar encargo' })).toContainText(
      'solo para este encargo',
    );
    await panel.getByRole('button', { name: 'Confirmar y ejecutar', exact: true }).click();
    await expect(
      panel.getByLabel('Permitir cambios en archivos para este mensaje'),
    ).not.toBeChecked();

    await toggleSettings(panel);
    await panel.getByRole('button', { name: 'Activar TURBO', exact: true }).click();
    await expect(panel.getByText(/¿Permitir cambios futuros/)).toBeVisible();
    await panel
      .getByRole('button', { name: 'Sí, activar TURBO en este proyecto', exact: true })
      .click();
    await expect(panel.getByText('TURBO · activado', { exact: true })).toBeVisible();
    await toggleSettings(panel);
    await panel.getByLabel('Mensaje', { exact: true }).fill('Un encargo con TURBO');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Confirmar encargo' })).toContainText(
      'Cambios permitidos por TURBO',
    );
    await panel.getByRole('button', { name: 'Usar cuota y ejecutar', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
    await showOptions(panel);
    await menuAction(panel, 'Ver cola');
    const queue = page.getByRole('dialog', { name: 'Equipo de agentes' });
    await expect(queue.getByRole('button', { name: 'Ejecutar cola', exact: true })).toBeVisible();
    await queue.getByRole('button', { name: 'Volver a la conversación', exact: true }).click();
    await expect(panel.getByRole('log')).toContainText('Segunda pregunta');
    await panel.getByLabel('Menú de conversación', { exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('chat-principal.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
      await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Proyecto', { exact: true })).not.toBeVisible();
    await showNavigation(panel);
    await expect(panel.getByLabel('Proyecto', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('chat-movil.png') });
    // Simulate provider states only; exercise their real rendering without inference.
    for (const [status, tone, label] of [
      ['running', 'working', 'Trabajando'],
      ['failed', 'error', 'Error'],
      ['blocked', 'review', 'Necesita tu revisión'],
      ['paused', 'review', 'En pausa'],
      ['cancelled', 'neutral', 'Cancelado'],
    ]) {
      await page.route('**/api/team', async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        const task = data.tasks.at(-1);
        task.status = status;
        task.reasonCode = status === 'paused' ? 'user_pause' : null;
        const message = data.library.selected.messages
          .filter((m: { kind: string }) => m.kind === 'response')
          .at(-1);
        message.status = status;
        message.reasonCode = task.reasonCode;
        await route.fulfill({ json: data });
      });
      await expect(
        panel
          .getByRole('region', { name: 'Estado del encargo' })
          .locator(`.chat-execution-${tone}`),
      ).toContainText(label);
      await expect(panel.getByLabel('Mensaje', { exact: true })).toBeVisible();
      await expect(panel.getByLabel('Mensaje', { exact: true })).toBeEnabled();
      if (status === 'paused')
        await expect(panel.getByText('Encargo listo', { exact: true })).toHaveCount(0);
      await page.unroute('**/api/team');
    }
    // A historical pause must describe evidence, never accuse the read-only worker.
    await page.route('**/api/team', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const task = data.tasks.at(-1);
      task.status = 'paused';
      task.reasonCode = 'review_changed_files';
      task.explanation = 'Un empleado de solo lectura modificó archivos. Se necesita revisión.';
      const message = data.library.selected.messages
        .filter((m: { kind: string }) => m.kind === 'response')
        .at(-1);
      message.status = 'paused';
      message.reasonCode = task.reasonCode;
      message.content = task.explanation;
      await route.fulfill({ json: data });
    });
    await expect(panel.getByRole('region', { name: 'Estado del encargo' })).toContainText(
      'no permite identificar quién',
    );
    await expect(panel.getByRole('region', { name: 'Estado del encargo' })).toContainText(
      'Revisa los cambios',
    );
    await expect(panel.getByRole('log')).not.toContainText('Un empleado de solo lectura modificó');
    await page.unroute('**/api/team');
    await page.route('**/api/team', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const task = data.tasks.at(-1);
      task.status = 'planned';
      task.reasonCode = null;
      task.budgetReview = null;
      task.estimate = null;
      task.budgetMode = 'manual';
      data.capabilities.budgetReview = true;
      data.budgetReason = null;
      await route.fulfill({ json: data });
    });
    const confirmationWithBudget = panel.getByRole('region', { name: 'Confirmar encargo' });
    await expect(confirmationWithBudget).toContainText('Falta revisar el presupuesto');
    await expect(confirmationWithBudget.getByLabel('Cota de tokens de la tarea')).toBeVisible();
    await expect(
      confirmationWithBudget.getByRole('button', { name: 'Revisar antes de ejecutar' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await expect(
      panel.getByRole('button', { name: 'Usar cuota y ejecutar', exact: true }),
    ).toHaveCount(0);
    await page.unroute('**/api/team');
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
    await showOptions(panel);
    if (!(await panel.getByLabel('Usar presupuesto manual para este encargo').isVisible()))
      await panel.getByText('Ajustes avanzados del encargo', { exact: true }).click();
    await panel.getByLabel('Usar presupuesto manual para este encargo').check();
    await panel
      .getByLabel('Mensaje', { exact: true })
      .fill('Prueba del presupuesto manual opcional');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    const manualConfirmation = panel.getByRole('region', { name: 'Confirmar encargo' });
    await expect(manualConfirmation.getByLabel('Cota de tokens de la tarea')).toBeVisible();
    await manualConfirmation.getByLabel('Cota de tokens de la tarea').fill('1000');
    await manualConfirmation.getByLabel('Cota de duración de la tarea (segundos)').fill('10');
    await manualConfirmation.getByLabel('Máximo de caracteres del contexto').fill('90000');
    await manualConfirmation.getByRole('button', { name: 'Guardar cotas revisadas' }).click();
    await expect(
      manualConfirmation.getByRole('button', { name: 'Usar cuota y ejecutar', exact: true }),
    ).toBeEnabled();
    await manualConfirmation
      .getByRole('button', { name: 'Usar cuota y ejecutar', exact: true })
      .click();
    await expect(
      panel.getByRole('region', { name: 'Estado del encargo' }).locator('.chat-execution-success'),
    ).toContainText('Completado');
    await showOptions(panel);
    if (!(await panel.getByLabel('Usar presupuesto manual para este encargo').isVisible()))
      await panel.getByText('Ajustes avanzados del encargo', { exact: true }).click();
    await panel.getByLabel('Usar presupuesto manual para este encargo').uncheck();
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').check();
    await panel.getByLabel('Mensaje', { exact: true }).fill('Analiza el proyecto con la oficina');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    const officeConfirmation = panel.getByRole('region', { name: 'Confirmar encargo' });
    await expect(officeConfirmation).toContainText('Autorización del objetivo');
    const beforeOffice = Number(readFileSync(path.join(root, 'runs.txt'), 'utf8'));
    await officeConfirmation
      .getByRole('button', { name: 'Usar cuota y ejecutar', exact: true })
      .click();
    await expect(panel.getByRole('log')).toContainText('Objetivo de oficina revisado y terminado');
    await expect(panel.getByRole('log')).toContainText('Entrega del Arquitecto');
    await expect(panel.getByRole('log')).toContainText('Entrega del Tester');
    await panel
      .getByRole('region', { name: 'Estado del encargo' })
      .getByText('Ver detalles', { exact: true })
      .click();
    await expect(panel.getByRole('region', { name: 'Estado del encargo' })).toContainText(
      'aprobación final',
    );
    await expect(panel.getByRole('log')).not.toContainText('OFFICE_DECISION');
    await expect(panel.getByRole('log')).not.toContainText('Entregas y comunicaciones anteriores');
    await expect(
      panel.getByRole('region', { name: 'Estado del encargo' }).locator('.chat-execution-success'),
    ).toContainText('Completado');
    expect(Number(readFileSync(path.join(root, 'runs.txt'), 'utf8')) - beforeOffice).toBe(5);
    await stop(server.child);
    server = await start(root);
    await page.goto(server.url);
    panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel.getByRole('log')).toContainText('Objetivo de oficina revisado y terminado');
    await expect(panel.getByRole('log')).toContainText('Entrega del Arquitecto');
    expect(Number(readFileSync(path.join(root, 'runs.txt'), 'utf8'))).toBe(beforeOffice + 5);
    await showNavigation(panel);
    await toggleSettings(panel);
    await panel.getByLabel('Trabajar con autonomía en este proyecto').check();
    await toggleSettings(panel);
    await showNavigation(panel);
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    await panel
      .getByLabel('Mensaje', { exact: true })
      .fill('Trabaja directamente sin confirmaciones');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect
      .poll(() => Number(readFileSync(path.join(root, 'runs.txt'), 'utf8')))
      .toBe(beforeOffice + 6);
    await expect(panel.getByRole('region', { name: 'Confirmar encargo' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
    await showOptions(panel);
    await expect(
      panel.getByText('Permiso permanente para trabajar en este proyecto'),
    ).toBeAttached();
    await stop(server.child);
    server = await start(root);
    await page.goto(server.url);
    panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel.getByRole('log')).toContainText('Trabaja directamente sin confirmaciones');
    await showOptions(panel);
    await expect(
      panel.getByText('Permiso permanente para trabajar en este proyecto'),
    ).toBeAttached();
    expect(Number(readFileSync(path.join(root, 'runs.txt'), 'utf8'))).toBe(beforeOffice + 6);
    await panel.getByLabel('Mensaje', { exact: true }).fill('Fallo de prueba sin recibo');
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Estado del encargo' })).toContainText(
      'En pausa',
    );
    await expect(panel.getByRole('button', { name: 'Ejecutar', exact: true })).toBeVisible();
    const unknownUsage = await (await page.request.get(`${server.url}/api/team`)).json();
    expect(unknownUsage.usageKnown).toBe(false);
    expect(unknownUsage.budgetReason).toBe('usage_unknown');
    await expect(
      panel.getByLabel('He revisado la pausa y quiero continuar con este encargo.'),
    ).toHaveCount(0);
    await panel.getByRole('button', { name: 'Ejecutar', exact: true }).click();
    await expect(
      panel.getByRole('region', { name: 'Estado del encargo' }).locator('.chat-execution-success'),
    ).toContainText('Completado');
    const recoveredUsage = await (await page.request.get(`${server.url}/api/team`)).json();
    expect(recoveredUsage.usageKnown).toBe(false);
    expect(recoveredUsage.runsUsed).toBe(unknownUsage.runsUsed + 5);
    expect(recoveredUsage.tokensUsed).toBe(unknownUsage.tokensUsed + 120);
  } finally {
    if (server) await stop(server.child);
    rmSync(root, { recursive: true, force: true });
  }
});
