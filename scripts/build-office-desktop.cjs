const { existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32') {
  console.log('Auxiliar de Windows: no compatible con este sistema.');
  process.exit(0);
}
const framework = join(
  process.env.WINDIR || 'C:\\Windows',
  'Microsoft.NET',
  'Framework64',
  'v4.0.30319',
);
const compiler = join(framework, 'csc.exe');
if (!existsSync(compiler)) throw new Error('Falta el compilador .NET Framework de Windows.');
const output = resolve(__dirname, '../dist/native/office-desktop.exe');
mkdirSync(resolve(__dirname, '../dist/native'), { recursive: true });
execFileSync(
  compiler,
  [
    '/nologo',
    '/target:winexe',
    '/out:' + output,
    '/reference:System.Web.Extensions.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:' + join(framework, 'WPF', 'UIAutomationClient.dll'),
    '/reference:' + join(framework, 'WPF', 'UIAutomationTypes.dll'),
    '/reference:' + join(framework, 'WPF', 'WindowsBase.dll'),
    resolve(__dirname, '../server/native/office-desktop.cs'),
  ],
  { windowsHide: true, stdio: 'inherit' },
);
