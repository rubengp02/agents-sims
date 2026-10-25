import { expect, type Locator, test } from '@playwright/test';
import { type ChildProcess, fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==',
  'base64',
);
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
  let stderr = '';
  child.stdout?.resume();
  child.stderr?.on('data', (data) => {
    stderr += String(data);
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`Fixture exited ${code}: ${stderr.slice(-3000)}`)),
    );
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

test('images persist in draft and history, reach the executor, and tools remain honest @area:standalone', async ({
  page,
}, testInfo) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-tools-browser-'));
  const project = path.join(root, 'project');
  mkdirSync(project);
  writeFileSync(path.join(project, 'app.ts'), '// fixture source');
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    server = await start(root);
    const state = await (await page.request.get(`${server.url}/api/team`)).json();
    const created = await page.request.post(`${server.url}/api/team/projects`, {
      headers: { 'X-Office-Control': state.controlToken },
      data: { project, name: 'Proyecto visual', openConversation: true },
    });
    expect(created.ok()).toBe(true);
    await page.goto(server.url);
    let panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('log')).toContainText('¿En qué trabajamos?');
    await page.screenshot({ path: testInfo.outputPath('chat-vacio-escritorio.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
      await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('chat-vacio-movil.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
    await menuAction(panel, 'Herramientas y conexiones');
    await expect(panel.getByRole('region', { name: 'Herramientas y conexiones' })).toContainText(
      'Sin comprobar',
    );
    await expect(panel.getByRole('region', { name: 'Herramientas y conexiones' })).toContainText(
      'Requiere conexión',
    );
    await menuAction(panel, 'Herramientas y conexiones');
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    await panel.getByLabel('Mensaje', { exact: true }).fill('Comprueba la captura adjunta');
    await page.route(
      '**/api/team/conversations/draft',
      (route) =>
        route.fulfill({ status: 503, json: { message: 'Fallo de almacenamiento simulado' } }),
      { times: 1 },
    );
    await panel
      .getByLabel('Elegir imágenes')
      .setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: png });
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(1);
    await expect(panel.locator('.chat-image-attachments [role="alert"]')).toContainText(
      'Conservamos los adjuntos',
    );
    await panel.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await page.reload();
    panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel.getByLabel('Mensaje', { exact: true })).toHaveValue(
      'Comprueba la captura adjunta',
    );
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(1);
    await panel.getByRole('button', { name: 'Quitar imagen captura.png' }).click();
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(0);
    await panel.getByLabel('Mensaje', { exact: true }).evaluate((element, base64) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'captura.png', {
          type: 'image/png',
        }),
      );
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }),
      );
    }, png.toString('base64'));
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(1);
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Quitar imagen captura.png' }).click();
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(0);
    await panel.locator('.chat-image-attachments').evaluate((element, base64) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'captura.png', {
          type: 'image/png',
        }),
      );
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, png.toString('base64'));
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(1);
    await expect(panel.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await panel.getByLabel('Elegir imágenes').setInputFiles({
      name: 'falsa.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a real image'),
    });
    await expect(panel.locator('.chat-image-attachments [role="alert"]')).toBeVisible();
    await expect(panel.locator('.chat-attachment-list img')).toHaveCount(1);
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    await panel.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(panel.getByRole('log')).toContainText('Respuesta guardada');
    await expect(panel.getByRole('log').getByRole('img', { name: 'captura.png' })).toBeVisible();
    expect(existsSync(path.join(root, 'image-input-verified.txt'))).toBe(true);
    const imageUrl = await panel
      .getByRole('log')
      .getByRole('img', { name: 'captura.png' })
      .getAttribute('src');
    const image = await page.request.get(`${server.url}${imageUrl}`);
    expect(image.ok()).toBe(true);
    expect(await image.body()).toEqual(png);
    await stop(server.child);
    server = await start(root);
    await page.goto(server.url);
    panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await expect(panel.getByRole('log').getByRole('img', { name: 'captura.png' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
      await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    await expect(panel.getByRole('log')).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await panel.getByRole('log').evaluate((element) => {
      element.scrollTop = 0;
    });
    await testInfo.attach('Conversación con imagen persistida en móvil (ejecutor simulado)', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // UI-only approval fixture. Enforcement is covered separately by server runtime tests.
    let pending = true,
      confirmations = 0;
    await page.route('**/api/team', async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      const task = data.tasks.find(
        (t: { conversationId?: string }) => t.conversationId === data.library.selected.id,
      );
      data.toolApprovals = pending
        ? [
            {
              id: 'fixture-approval',
              taskId: task.id,
              tool: 'Enviar mensaje',
              destination: 'Servicio simulado',
              content: '<script>contenido visible</script>',
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/team/tool-approvals/fixture-approval', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ approved: false });
      confirmations++;
      pending = false;
      await route.fulfill({ json: {} });
    });
    await expect(
      panel.getByRole('region', { name: 'Acciones que necesitan confirmación' }),
    ).toContainText('<script>contenido visible</script>');
    await expect(panel.locator('.chat-tool-approvals script')).toHaveCount(0);
    expect(confirmations).toBe(0);
    await panel.getByRole('button', { name: 'Rechazar', exact: true }).click();
    await expect(
      panel.getByRole('region', { name: 'Acciones que necesitan confirmación' }),
    ).toHaveCount(0);
    expect(confirmations).toBe(1);
    let formPending = true;
    await page.route('**/api/team', async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      const task = data.tasks.find(
        (t: { conversationId?: string }) => t.conversationId === data.library.selected.id,
      );
      data.toolApprovals = formPending
        ? [
            {
              id: 'fixture-form',
              taskId: task.id,
              tool: 'Elegir destino',
              destination: 'Servicio simulado',
              content: 'Selecciona las opciones de esta operación',
              createdAt: new Date().toISOString(),
              fields: [
                { name: 'name', label: 'Nombre del recurso', type: 'string', required: true },
                { name: 'count', label: 'Cantidad', type: 'number', required: false },
                { name: 'include', label: 'Incluir detalles', type: 'boolean', required: true },
                {
                  name: 'folder',
                  label: 'Carpeta de destino',
                  type: 'string',
                  required: true,
                  options: ['A', 'B'],
                },
              ],
            },
          ]
        : [];
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/team/tool-approvals/fixture-form', async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        approved: true,
        values: { name: 'Informe', count: 0, include: false, folder: 'B' },
      });
      confirmations++;
      formPending = false;
      await route.fulfill({ json: {} });
    });
    const form = panel.getByRole('region', { name: 'Acciones que necesitan confirmación' });
    await expect(
      form.getByRole('button', { name: 'Confirmar esta acción', exact: true }),
    ).toBeDisabled();
    await form.getByLabel('Nombre del recurso', { exact: true }).fill('Informe');
    await form.getByLabel('Cantidad', { exact: true }).fill('0');
    await form.getByLabel('Incluir detalles', { exact: true }).selectOption('false');
    await form.getByLabel('Carpeta de destino', { exact: true }).selectOption('B');
    await expect(
      form.getByRole('button', { name: 'Confirmar esta acción', exact: true }),
    ).toBeEnabled();
    await form.getByRole('button', { name: 'Confirmar esta acción', exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(confirmations).toBe(2);
    // Long-history rendering only: HTTP/storage/image persistence is exercised above.
    let updates = 0;
    await page.route('**/api/team', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const messages = data.library.selected.messages;
      const last = messages.filter((m: { kind: string }) => m.kind === 'response').at(-1);
      last.content =
        '**Comprobación de lectura.** Texto de una conversación larga con imágenes.\n\n'.repeat(
          80,
        ) + ++updates;
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    const log = panel.getByRole('log');
    await expect(log).toContainText('Comprobación de lectura.');
    await expect.poll(() => log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await log.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    const beforeUpdate = updates;
    await expect.poll(() => updates).toBeGreaterThan(beforeUpdate);
    expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(5);
    await expect(panel.getByLabel('Mensaje', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('chat-largo-imagen-escritorio.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
      await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    await expect(panel.getByLabel('Mensaje', { exact: true })).toBeVisible();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await log.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(log.getByRole('img', { name: 'captura.png' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('chat-largo-imagen-movil.png') });
  } finally {
    if (server) await stop(server.child);
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean conversation keeps composer visible and persists queued edits before immediate steering @area:standalone', async ({
  page,
}, testInfo) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-chat-pending-'));
  const project = path.join(root, 'project');
  mkdirSync(project);
  writeFileSync(path.join(project, 'app.ts'), '// fixture');
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    server = await start(root);
    const initial = await (await page.request.get(server.url + '/api/team')).json();
    expect(
      (
        await page.request.post(server.url + '/api/team/projects', {
          headers: { 'X-Office-Control': initial.controlToken },
          data: { project, name: 'Proyecto sencillo', openConversation: true },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(server.url);
    const panel = page.getByRole('dialog', { name: 'Conversaciones', exact: true });
    await showOptions(panel);
    await panel.getByLabel('El Jefe coordina al equipo hasta completar el objetivo').uncheck();
    const composer = panel.getByLabel('Mensaje', { exact: true });
    await composer.fill('Trabajo lento para comprobar pendientes');
    await composer.press('Enter');
    await expect(panel.getByRole('region', { name: 'Estado del encargo' })).toContainText(
      'Trabajando',
    );
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
    await composer.fill('Primera indicación pendiente');
    await composer.press('Enter');
    const pending = panel.getByRole('region', { name: 'Mensajes pendientes' });
    await expect(pending).toContainText('Primera indicación pendiente');
    await composer.fill('Petición que retiraré');
    await composer.press('Enter');
    const removable = pending.getByRole('article').filter({ hasText: 'Petición que retiraré' });
    await removable.getByRole('button', { name: 'Retirar', exact: true }).click();
    await expect(removable).toHaveCount(0);
    await pending.getByRole('button', { name: 'Editar', exact: true }).click();
    await pending.getByLabel('Editar mensaje pendiente').fill('Indicación pendiente editada');
    await pending.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page.reload();
    await expect(pending).toContainText('Indicación pendiente editada');
    await expect(composer).toBeEnabled();
    expect((await panel.boundingBox())?.width).toBe(1280);
    await page.screenshot({ path: testInfo.outputPath('chat-limpio-escritorio.png') });
    await pending
      .getByRole('button', { name: 'Aplicar ahora el mensaje pendiente', exact: true })
      .click();
    await expect(panel.getByRole('log')).toContainText(
      'Indicación aplicada: Indicación pendiente editada',
    );
    await expect(pending).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'Estado del encargo' })).toContainText(
      'Completado',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    if (await panel.getByLabel('Proyecto', { exact: true }).isVisible())
      await panel.getByRole('button', { name: 'Proyecto e historial', exact: true }).click();
    await composer.fill('Una línea');
    await composer.press('Shift+Enter');
    await composer.press('x');
    await expect(composer).toHaveValue('Una línea\nx');
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('chat-limpio-movil.png') });
  } finally {
    if (server) await stop(server.child);
    rmSync(root, { recursive: true, force: true });
  }
});
