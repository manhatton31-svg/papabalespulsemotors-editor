import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const ps = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fix-icon.ps1')],
  { encoding: 'utf8', cwd: root },
);

if (ps.status !== 0) {
  console.error(ps.stderr || ps.stdout);
  process.exit(1);
}
if (ps.stdout.trim()) console.log(ps.stdout.trim());

const build = spawnSync('node', [path.join(__dirname, 'build-icon.mjs')], {
  encoding: 'utf8',
  cwd: root,
});

if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}
console.log(build.stdout.trim());