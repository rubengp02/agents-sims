const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

function buildFolderPicker() {
  if (process.platform !== 'win32') return;
  const root = path.resolve(__dirname, '..');
  const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET');
  const compiler = ['Framework64', 'Framework']
    .map((folder) => path.join(framework, folder, 'v4.0.30319', 'csc.exe'))
    .find(existsSync);
  if (!compiler)
    throw new Error('Falta el compilador de .NET Framework para crear el selector de Windows.');
  const destination = path.join(root, 'dist', 'native');
  mkdirSync(destination, { recursive: true });
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll',
      `/out:${path.join(destination, 'office-folder-picker.exe')}`,
      path.join(root, 'server', 'native', 'OfficeFolderPicker.cs'),
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  console.log('✓ Built native Windows folder picker (no console)');
}

module.exports = buildFolderPicker;
if (require.main === module) buildFolderPicker();
