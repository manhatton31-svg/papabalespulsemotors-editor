import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binariesDir = join(__dirname, '../src-tauri/binaries');

const targets = [
  { triple: 'x86_64-pc-windows-msvc', ext: '.exe' },
  { triple: 'aarch64-pc-windows-msvc', ext: '.exe' },
  { triple: 'x86_64-unknown-linux-gnu', ext: '' },
  { triple: 'aarch64-unknown-linux-gnu', ext: '' },
  { triple: 'x86_64-apple-darwin', ext: '' },
  { triple: 'aarch64-apple-darwin', ext: '' },
];

function copyTool(sourcePath, destPath, label) {
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error(`${label} binary not found at ${sourcePath ?? '(missing path)'}`);
  }
  copyFileSync(sourcePath, destPath);
  console.log(`Synced ${label} -> ${destPath}`);
}

mkdirSync(binariesDir, { recursive: true });

const ffprobePath = ffprobeInstaller.path;
const hostTriple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
const hostExt = process.platform === 'win32' ? '.exe' : '';

copyTool(
  ffmpegPath,
  join(binariesDir, `ffmpeg-${hostTriple}${hostExt}`),
  'ffmpeg'
);
copyTool(
  ffprobePath,
  join(binariesDir, `ffprobe-${hostTriple}${hostExt}`),
  'ffprobe'
);

for (const { triple, ext } of targets) {
  if (triple === hostTriple && ext === hostExt) continue;
  const ffmpegDest = join(binariesDir, `ffmpeg-${triple}${ext}`);
  const ffprobeDest = join(binariesDir, `ffprobe-${triple}${ext}`);
  if (!existsSync(ffmpegDest)) {
    copyTool(ffmpegPath, ffmpegDest, `ffmpeg (${triple})`);
  }
  if (!existsSync(ffprobeDest)) {
    copyTool(ffprobePath, ffprobeDest, `ffprobe (${triple})`);
  }
}