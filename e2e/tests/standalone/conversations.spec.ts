import { expect, test } from '@playwright/test';
import { type ChildProcess, fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

test('saved conversations survive panel reopening and a real server process restart @area:standalone', async ({
  page,
}, testInfo) => {
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
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Equipo', exact: true }).click();
    let panel = page.getByRole('dialog', { name: 'Equipo de agentes' });
    await panel.getByLabel('Carpeta del proyecto', { exact: true }).fill(project);
    await panel.getByText('Guardar proyecto e instrucciones', { exact: true }).click();
    await panel.getByLabel('Nombre del proyecto', { exact: true }).fill('Proyecto recordado');
    await panel
      .getByLabel('Instrucciones del proyecto', { exact: true })
      .fill('Conserva mis instrucciones');
    await panel.getByRole('button', { name: 'Guardar proyecto', exact: true }).click();
    await expect(panel.getByLabel('Proyectos guardados')).toContainText('Proyecto recordado');
    await panel.getByText('Pruebas del proyecto', { exact: true }).click();
    await panel.getByLabel('Aprobar prueba test').check();
    await panel.getByRole('button', { name: 'Guardar aprobación de pruebas' }).click();
    await expect(panel.getByText(/test · Aprobada/)).toBeVisible();
    await panel.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    await panel.getByLabel('Objetivo o tarea').fill('Primera pregunta');
    await panel.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(
      panel
        .getByLabel('Mensajes de la conversación')
        .getByText('Primera pregunta', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Ejecutar cola', exact: true }).click();
    await expect(panel.getByLabel('Mensajes de la conversación')).toContainText(
      'Respuesta guardada de la primera pregunta',
    );
    await panel.getByLabel('Objetivo o tarea').fill('Borrador guardado');
    await panel.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    await panel.getByRole('button', { name: 'Cerrar equipo' }).click();
    await page.getByRole('button', { name: 'Equipo', exact: true }).click();
    panel = page.getByRole('dialog', { name: 'Equipo de agentes' });
    await expect(panel.getByLabel('Objetivo o tarea')).toHaveValue('Borrador guardado');
    await expect(panel.getByLabel('Carpeta del proyecto', { exact: true })).toHaveValue(project);
    expect(readFileSync(path.join(root, 'runs.txt'), 'utf8')).toBe('1');

    await stop(server.child);
    server = await start(root);
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Equipo', exact: true }).click();
    panel = page.getByRole('dialog', { name: 'Equipo de agentes' });
    await expect(panel.getByLabel('Mensajes de la conversación')).toContainText(
      'Respuesta guardada de la primera pregunta',
    );
    await expect(panel.getByLabel('Objetivo o tarea')).toHaveValue('Borrador guardado');
    await expect(panel.getByLabel('Proyectos guardados')).toContainText('Proyecto recordado');
    await panel.getByText('Guardar proyecto e instrucciones', { exact: true }).click();
    await expect(panel.getByLabel('Instrucciones del proyecto', { exact: true })).toHaveValue(
      'Conserva mis instrucciones',
    );
    await panel.getByText('Pruebas del proyecto', { exact: true }).click();
    await expect(panel.getByLabel('Aprobar prueba test')).toBeChecked();
    await panel.getByLabel('Objetivo o tarea').fill('Segunda pregunta');
    await panel.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await panel.getByRole('button', { name: 'Revisado: permitir continuar', exact: true }).click();
    await panel.getByRole('button', { name: 'Ejecutar cola', exact: true }).click();
    await expect(panel.getByLabel('Mensajes de la conversación')).toContainText(
      'Seguimiento con contexto conservado',
    );
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar conversación' }).click();
    expect((await download).suggestedFilename()).toMatch(/^conversacion-.*\.json$/);
    await panel.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    await panel
      .getByLabel('Abrir conversación')
      .selectOption({ label: 'Primera pregunta · Proyecto recordado' });
    await expect(panel.getByLabel('Mensajes de la conversación')).toContainText('Segunda pregunta');
    await page.screenshot({ path: testInfo.outputPath('conversaciones-guardadas.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
  } finally {
    if (server) await stop(server.child);
    rmSync(root, { recursive: true, force: true });
  }
});
