import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const integration = path.join(root, 'integrations/agent-orchestrator');
const lock = JSON.parse(fs.readFileSync(path.join(integration, 'lock.json'), 'utf8'));
const local = path.join(root, '.local-office/agent-orchestrator');
const source = path.join(local, 'source');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const run = (exe, args, cwd = root, extraEnv = {}) => {
  const result = spawnSync(exe, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8e6,
    env: {
      ...process.env,
      ...extraEnv,
      GOTOOLCHAIN: 'local',
      GOPATH: path.join(local, 'go-cache'),
    },
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || 'Build failed');
  return result.stdout.trim();
};
fs.mkdirSync(local, { recursive: true });
if (!fs.existsSync(source)) {
  run('git', ['clone', '--no-checkout', '--filter=blob:none', lock.repository, source]);
  run('git', ['checkout', '--detach', lock.revision], source);
}
if (run('git', ['rev-parse', 'HEAD'], source) !== lock.revision)
  throw new Error(
    'La copia local tiene otra revisión. No se ha sobrescrito; utiliza una carpeta aislada nueva.',
  );
if (!fs.existsSync(path.join(source, 'backend/go.mod')))
  run('git', ['checkout', '--detach', lock.revision], source);
let go = process.platform === 'win32' ? path.join(local, 'toolchain/go/bin/go.exe') : 'go';
if (!fs.existsSync(go) && process.platform === 'win32') {
  if (process.arch !== 'x64') throw new Error('Esta instalación automática requiere Windows x64.');
  const filename = 'go1.27.3.windows-amd64.zip';
  const archive = path.join(local, filename);
  const response = await fetch(`https://go.dev/dl/${filename}`);
  if (!response.ok) throw new Error('No se puede descargar Go del sitio oficial.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== 'f26081f438319757f8a1b46d7d0b2c5ec7583d4038e485e0aa725cfde7885fff')
    throw new Error('La suma de comprobación de Go no coincide.');
  fs.writeFileSync(archive, bytes);
  const target = path.join(local, 'toolchain');
  fs.mkdirSync(target, { recursive: true });
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Expand-Archive -LiteralPath $env:OFFICE_GO_ARCHIVE -DestinationPath $env:OFFICE_GO_TARGET',
    ],
    root,
    { OFFICE_GO_ARCHIVE: archive, OFFICE_GO_TARGET: target },
  );
  // Windows paths are passed as environment data, never interpolated into shell code.
}
if (!run(go, ['version']).includes(lock.goVersion))
  throw new Error('Se requiere el Go fijado en lock.json.');
const cmd = path.join(source, 'backend/cmd/pixel-office');
fs.mkdirSync(cmd, { recursive: true });
fs.copyFileSync(path.join(integration, 'main.go'), path.join(cmd, 'main.go'));
fs.copyFileSync(
  path.join(integration, 'office_driver.go'),
  path.join(source, 'backend/internal/adapters/chatdriver/codexappserver/pixel_office.go'),
);
fs.mkdirSync(path.join(local, 'bin'), { recursive: true });
const binary = path.join(
  local,
  'bin',
  process.platform === 'win32' ? 'pixel-office-ao.exe' : 'pixel-office-ao',
);
run(go, ['build', '-trimpath', '-o', binary, './cmd/pixel-office'], path.join(source, 'backend'));
const version = JSON.parse(run(binary, ['--version']));
if (version.revision !== lock.revision || version.protocol !== lock.protocol)
  throw new Error('Puente incompatible.');
const fingerprint = sha(
  Buffer.concat(
    ['lock.json', 'main.go', 'office_driver.go'].map((p) =>
      fs.readFileSync(path.join(integration, p)),
    ),
  ),
);
fs.writeFileSync(
  path.join(local, 'build.json'),
  JSON.stringify(
    {
      ...version,
      binaryHash: sha(fs.readFileSync(binary)),
      sourceFingerprint: fingerprint,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Agent Orchestrator preparado. Sin inferencia, sin cambios de cuentas y con revisión fijada.',
);
