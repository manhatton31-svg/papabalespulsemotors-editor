import { app, BrowserWindow, dialog, ipcMain, net, protocol, type IpcMainInvokeEvent } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import ffmpegPath from 'ffmpeg-static';
import {
  filterValidClips,
  loadLibrary,
  readThumbnailDataUrl,
  renameClip,
  saveLibrary,
  upsertClip,
} from './brollLibrary';
import type { PulseProject } from './types';
import { randomUUID } from 'crypto';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function getAppIcon(): string {
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../public/assets/icon.png'),
    path.join(process.cwd(), 'build/icon.ico'),
    path.join(process.cwd(), 'public/assets/icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function entryToHydratedAsset(entry: {
  id: string;
  filePath: string;
  friendlyName: string;
  duration: number;
  thumbnailPath?: string;
}) {
  if (!fs.existsSync(entry.filePath)) return null;
  return {
    id: entry.id,
    filePath: entry.filePath,
    friendlyName: entry.friendlyName,
    duration: entry.duration,
    thumbnail: readThumbnailDataUrl(entry.thumbnailPath),
    url: toPulseUrl(entry.filePath),
  };
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pulse',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

function toPulseUrl(filePath: string): string {
  const resolved = path.resolve(filePath);
  return `pulse://open?path=${encodeURIComponent(resolved)}`;
}

function pulseUrlToPath(url: string): string {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('path');
    if (fromQuery) return path.normalize(decodeURIComponent(fromQuery));
    const legacy = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return path.normalize(legacy);
  } catch {
    return '';
  }
}

function dialogParent(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
}

function showOpenFilesDialog(
  event: IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const parent = dialogParent(event);
  if (parent) return dialog.showOpenDialog(parent, options);
  return dialog.showOpenDialog(options);
}

function createWindow() {
  const iconPath = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1117',
    title: 'Papa Bales Pulse Motors Editor',
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve(0);
      return;
    }
    const proc = spawn(ffmpegPath, ['-i', filePath], { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      resolve(0);
    }, 8000);
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        resolve(hours * 3600 + minutes * 60 + seconds);
      } else {
        resolve(0);
      }
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(0);
    });
  });
}

function generateThumbnail(filePath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve(undefined);
      return;
    }
    const thumbDir = path.join(app.getPath('temp'), 'pulse-thumbs');
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    const thumbPath = path.join(thumbDir, `${Date.now()}-${path.basename(filePath)}.jpg`);

    const proc = spawn(
      ffmpegPath,
      ['-y', '-i', filePath, '-ss', '00:00:01', '-vframes', '1', '-q:v', '3', thumbPath],
      { windowsHide: true }
    );
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(thumbPath)) {
        const data = fs.readFileSync(thumbPath);
        resolve(`data:image/jpeg;base64,${data.toString('base64')}`);
      } else {
        resolve(undefined);
      }
    });
    proc.on('error', () => resolve(undefined));
  });
}

function setupIpc() {
  ipcMain.handle('dialog:openVideo', async (event) => {
    const result = await showOpenFilesDialog(event, {
      title: 'Select Main Video',
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (!fs.existsSync(filePath)) return null;
    let duration = await getVideoDuration(filePath);
    if (duration <= 0) duration = await getVideoDuration(filePath);
    return { filePath, duration, url: toPulseUrl(filePath) };
  });

  ipcMain.handle('dialog:openVideos', async (event) => {
    const result = await showOpenFilesDialog(event, {
      title: 'Import B-Roll',
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    const assets = await Promise.all(
      result.filePaths.map(async (filePath) => {
        if (!fs.existsSync(filePath)) return null;
        let duration = await getVideoDuration(filePath);
        if (duration <= 0) duration = await getVideoDuration(filePath);
        const thumbnail = await generateThumbnail(filePath);
        return { filePath, duration, thumbnail, url: toPulseUrl(filePath) };
      })
    );
    return assets.filter((a): a is NonNullable<typeof a> => a !== null);
  });

  ipcMain.handle('dialog:saveProjectAs', async (_e, project: PulseProject) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save Project As',
      defaultPath: `${project.name || 'untitled'}.pulseproj`,
      filters: [{ name: 'Pulse Project', extensions: ['pulseproj'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(project, null, 2), 'utf-8');
    return result.filePath;
  });

  ipcMain.handle('dialog:saveProjectToPath', async (_e, project: PulseProject, filePath: string) => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('library:loadAssets', async () => {
    const library = filterValidClips(loadLibrary());
    let changed = false;
    for (const clip of library.clips) {
      if (clip.duration <= 0 && fs.existsSync(clip.filePath)) {
        const d = await getVideoDuration(clip.filePath);
        if (d > 0) {
          clip.duration = d;
          changed = true;
        }
      }
    }
    if (changed) saveLibrary(library);
    return library.clips
      .map(entryToHydratedAsset)
      .filter((a): a is NonNullable<typeof a> => a !== null);
  });

  ipcMain.handle(
    'library:addClips',
    async (
      _e,
      imports: { filePath: string; friendlyName: string; duration: number; thumbnail?: string }[]
    ) => {
      const library = loadLibrary();
      const added = [];
      for (const imp of imports) {
        if (!fs.existsSync(imp.filePath)) continue;
        let duration = imp.duration;
        if (duration <= 0) {
          duration = await getVideoDuration(imp.filePath);
        }
        added.push(
          upsertClip(library, {
            id: randomUUID(),
            filePath: imp.filePath,
            friendlyName: imp.friendlyName,
            duration,
            thumbnail: imp.thumbnail,
          })
        );
      }
      return added
        .map(entryToHydratedAsset)
        .filter((a): a is NonNullable<typeof a> => a !== null);
    }
  );

  ipcMain.handle('library:renameClip', async (_e, id: string, friendlyName: string) => {
    const library = loadLibrary();
    return renameClip(library, id, friendlyName);
  });

  ipcMain.handle('dialog:openProject', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open Project',
      filters: [{ name: 'Pulse Project', extensions: ['pulseproj'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const project = JSON.parse(content) as PulseProject;
    return { project, filePath: result.filePaths[0] };
  });

  ipcMain.handle('dialog:exportMp4', async (_e, project: PulseProject) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export MP4',
      defaultPath: `${project.name || 'export'}.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
    if (!project.mainVideoPath) return { success: false, error: 'No main video' };
    if (!ffmpegPath) return { success: false, error: 'FFmpeg not available' };

    const brollClips = project.timelineClips
      .filter((c) => c.track === 'broll')
      .sort((a, b) => a.startTime - b.startTime);

    try {
      if (brollClips.length === 0) {
        await runFfmpeg([
          '-y',
          '-i',
          project.mainVideoPath,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          result.filePath,
        ]);
      } else {
        await exportWithBroll(project, brollClips, result.filePath);
      }
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('video:getDuration', async (_e, filePath: string) => {
    return getVideoDuration(filePath);
  });

  ipcMain.handle('video:generateThumbnail', async (_e, filePath: string) => {
    return generateThumbnail(filePath);
  });

  ipcMain.handle('util:toPulseUrl', (_e, filePath: string) => toPulseUrl(filePath));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-500)));
    });
    proc.on('error', reject);
  });
}

function projectAssets(project: PulseProject & { brollAssets?: PulseProject['mediaAssets'] }) {
  if (project.mediaAssets?.length) return project.mediaAssets;
  return project.brollAssets ?? [];
}

async function exportWithBroll(
  project: PulseProject,
  brollClips: PulseProject['timelineClips'],
  outputPath: string
) {
  const mainPath = project.mainVideoPath!;

  let lastLabel = '0:v';
  let overlayChain = '';
  let vi = 1;
  for (const clip of brollClips) {
    const asset = projectAssets(project).find((a) => a.id === clip.assetId);
    if (!asset) continue;
    const end = clip.startTime + clip.duration;
    overlayChain += `[${vi}:v]trim=0:${clip.duration},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[b${vi}];`;
    overlayChain += `[${lastLabel}][b${vi}]overlay=enable='between(t,${clip.startTime},${end})'[o${vi}];`;
    lastLabel = `o${vi}`;
    vi++;
  }

  const filterComplex = overlayChain.slice(0, -1);
  const mapLabel = lastLabel;

  const args = ['-y', '-i', mainPath];
  for (const clip of brollClips) {
    const asset = projectAssets(project).find((a) => a.id === clip.assetId);
    if (asset) args.push('-i', asset.filePath);
  }

  if (filterComplex) {
    args.push('-filter_complex', filterComplex, '-map', `[${mapLabel}]`, '-map', '0:a?');
  } else {
    args.push('-map', '0:v', '-map', '0:a?');
  }

  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', outputPath);
  await runFfmpeg(args);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.papabales.pulse-editor');
    }
    protocol.handle('pulse', (request) => {
      const filePath = pulseUrlToPath(request.url);
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).href);
    });

    setupIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}