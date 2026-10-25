/** Offline verification using the installed CLI. Never starts a model turn. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { isolatedProjectInstructions } from '../server/src/execution/projectInstructions.js';

const binary = process.argv[2] ?? 'codex';
const root = mkdtempSync(join(tmpdir(), 'office-instructions-check-'));
const home = join(root, 'codex-home'),
  project = join(root, 'project'),
  nested = join(project, 'sub'),
  workspace = join(root, 'isolated');
for (const folder of [home, nested]) mkdirSync(folder, { recursive: true });
const env: NodeJS.ProcessEnv = { CODEX_HOME: home };
for (const [key, value] of Object.entries(process.env))
  if (
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE)$/i.test(
      key,
    )
  )
    env[key] = value;
env.HOME = home;
env.USERPROFILE = home;
const git = (...args: string[]) =>
  execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'pipe' });
const render = (folder: string, prompt = 'OFFLINE_INSPECTION_ONLY') =>
  execFileSync(
    binary,
    [
      '-C',
      folder,
      '-c',
      'mcp_servers={}',
      '-c',
      'apps={}',
      '-c',
      'features.plugins=false',
      '-c',
      'web_search="disabled"',
      'debug',
      'prompt-input',
      prompt,
    ],
    {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 4000000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
try {
  git('init');
  writeFileSync(join(home, 'AGENTS.md'), 'FIXTURE_GLOBAL_RULE');
  writeFileSync(join(project, 'AGENTS.md'), 'FIXTURE_ROOT_RULE');
  writeFileSync(join(nested, 'AGENTS.md'), 'FIXTURE_NESTED_RULE');
  writeFileSync(join(root, 'AGENTS.md'), 'FIXTURE_UNRELATED_PARENT');
  writeFileSync(join(project, 'codex.md'), 'FIXTURE_UNCONFIGURED_CODEX');
  let text = render(nested);
  for (const marker of ['FIXTURE_GLOBAL_RULE', 'FIXTURE_ROOT_RULE', 'FIXTURE_NESTED_RULE'])
    assert(text.includes(marker), marker);
  for (const marker of ['FIXTURE_UNRELATED_PARENT', 'FIXTURE_UNCONFIGURED_CODEX'])
    assert(!text.includes(marker), marker);
  console.log(
    'Aprobado: instrucciones globales, raíz y subcarpeta; sin reglas de otro proyecto ni nombres no configurados.',
  );
  writeFileSync(join(home, 'AGENTS.override.md'), 'FIXTURE_GLOBAL_OVERRIDE');
  text = render(nested);
  assert(text.includes('FIXTURE_GLOBAL_OVERRIDE'));
  assert(!text.includes('FIXTURE_GLOBAL_RULE'));
  console.log('Aprobado: prioridad de AGENTS.override.md.');
  git('add', 'AGENTS.md', 'sub/AGENTS.md');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  );
  git('worktree', 'add', '--detach', workspace, 'HEAD');
  text = render(workspace);
  assert(text.includes('FIXTURE_ROOT_RULE'));
  assert.equal(isolatedProjectInstructions(project, workspace), '');
  writeFileSync(join(project, '.git', 'info', 'exclude'), 'AGENTS.override.md\n');
  writeFileSync(join(project, 'AGENTS.override.md'), 'FIXTURE_LOCAL_IGNORED_RULE');
  const supplement = isolatedProjectInstructions(project, workspace);
  assert(supplement.includes('FIXTURE_LOCAL_IGNORED_RULE'));
  text = render(workspace, supplement + 'OFFLINE_INSPECTION_ONLY');
  assert(text.includes('FIXTURE_LOCAL_IGNORED_RULE'));
  console.log(
    'Aprobado: copia Git y conservación de instrucciones locales ignoradas, sin duplicar las ya presentes.',
  );
  console.log('Solo se inspeccionó la entrada al modelo: sin inferencia ni consumo de cuota.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
