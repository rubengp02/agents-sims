import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localDir = path.join(root, '.local-office');
const stateFile = path.join(localDir, 'server.json');
const config = JSON.parse(fs.readFileSync(path.join(root, 'office.config.json'), 'utf8'));
const knownProviders = ['claude', 'hermes', 'codex'];
if (
  !Number.isInteger(config.port) ||
  config.port < 1 ||
  config.port > 65535 ||
  !Array.isArray(config.providers) ||
  !config.providers.length ||
  config.providers.some((id) => !knownProviders.includes(id)) ||
  typeof config.watchAllSessions !== 'boolean'
) {
  throw new Error('Revisa port, providers y watchAllSessions en office.config.json.');
}

const action = process.argv[2] ?? 'start';
if (!['start', 'stop', 'status'].includes(action)) throw new Error('Accion desconocida.');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
const port = action === 'start' ? config.port : (state?.port ?? config.port);
const url = `http://127.0.0.1:${port}`;

async function health() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function openBrowser() {
  const command =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const browser = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  browser.on('error', () => console.log(`Abre esta direccion en tu navegador: ${url}`));
  browser.unref();
}

const current = await health();
if (action === 'status') {
  console.log(
    state && current?.status === 'ok' && current.pid === state.pid
      ? `Oficina en marcha: ${url}`
      : 'Oficina detenida o no gestionada por este lanzador.',
  );
} else if (action === 'stop') {
  if (!state || current?.pid !== state.pid || current?.status !== 'ok') {
    console.log('No hay una oficina propia activa que detener.');
  } else {
    // Windows SIGTERM can terminate Node without running its signal handler.
    // Stop owned CLI children through the local service before killing the host.
    const teamResponse = await fetch(`${url}/api/team`, { signal: AbortSignal.timeout(5000) });
    const team =
      teamResponse.ok && teamResponse.headers.get('content-type')?.includes('application/json')
        ? await teamResponse.json()
        : null;
    if (!team || typeof team.controlToken !== 'string')
      throw new Error('No se puede verificar el cierre de las tareas. La oficina sigue abierta.');
    const stopped = await fetch(`${url}/api/team/shutdown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Office-Control': team.controlToken,
        Origin: url,
      },
      body: '{}',
      signal: AbortSignal.timeout(25_000),
    });
    if (!stopped.ok || (await stopped.json()).stopped !== true)
      throw new Error('No se han detenido las tareas. La oficina sigue abierta.');
    if ((await health())?.pid !== state.pid)
      throw new Error('El proceso de la oficina ha cambiado. No se ha terminado ningún proceso.');
    process.kill(state.pid, 'SIGTERM');
    fs.unlinkSync(stateFile);
    console.log('Oficina detenida. Puedes cerrar el navegador.');
  }
} else if (current) {
  if (current.status !== 'ok' || current.pid !== state?.pid) {
    throw new Error(`El puerto ${port} esta ocupado por otro servidor. No se ha modificado.`);
  }
  console.log(`La oficina ya estaba abierta: ${url}`);
  openBrowser();
} else {
  // Do not create a second office if someone changed the port while it was running.
  if (state && state.port !== port) {
    try {
      process.kill(state.pid, 0);
      throw new Error('Deten primero la oficina antes de cambiar el puerto.');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  const cli = path.join(root, 'dist', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('Falta compilar la aplicacion: ejecuta npm run build.');
  fs.mkdirSync(localDir, { recursive: true });
  const logPath = path.join(localDir, 'server.log');
  const log = fs.openSync(logPath, 'a');
  const args = [
    cli,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--providers',
    config.providers.join(','),
  ];
  args.push(config.watchAllSessions ? '--watch-all-sessions' : '--no-watch-all-sessions');
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  fs.closeSync(log);
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fs.writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port }));
  child.unref();
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await health())?.pid === child.pid) {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    throw new Error(`No se ha podido abrir la oficina. Revisa ${path.relative(root, logPath)}.`);
  }
  console.log(`Oficina lista: ${url}`);
  console.log(`Integraciones activas: ${config.providers.join(', ')}.`);
  openBrowser();
}
