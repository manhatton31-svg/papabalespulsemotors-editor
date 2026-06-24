import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'public', 'assets', 'icon.png');
const sourcePath = path.join(root, 'assets', 'icon.png');
const buildIco = path.join(root, 'build', 'icon.ico');
const tauriIco = path.join(root, 'src-tauri', 'icons', 'icon.ico');

if (!fs.existsSync(pngPath) && !fs.existsSync(sourcePath)) {
  console.error('Missing assets/icon.png or public/assets/icon.png');
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'build'), { recursive: true });

// Ensure public/assets/icon.png is a real PNG
if (!fs.existsSync(pngPath) && fs.existsSync(sourcePath)) {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile('${sourcePath.replace(/\\/g, '\\\\')}'); $img.Save('${pngPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose()`,
    ],
    { encoding: 'utf8' },
  );
  if (ps.status !== 0) {
    console.error(ps.stderr || ps.stdout);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  PATH: [
    path.join(process.env.USERPROFILE || '', '.cargo', 'bin'),
    'C:\\Program Files\\nodejs',
    process.env.PATH || '',
  ].join(';'),
};

const tauri = spawnSync('npx', ['tauri', 'icon', pngPath], {
  encoding: 'utf8',
  cwd: root,
  shell: true,
  env,
});

if (tauri.status !== 0) {
  console.error(tauri.stderr || tauri.stdout);
  process.exit(1);
}

if (!fs.existsSync(tauriIco)) {
  console.error('Tauri icon generation did not produce src-tauri/icons/icon.ico');
  process.exit(1);
}

fs.copyFileSync(tauriIco, buildIco);
const size = fs.statSync(buildIco).size;
console.log(`Built build/icon.ico (${size} bytes) from Tauri icon set`);