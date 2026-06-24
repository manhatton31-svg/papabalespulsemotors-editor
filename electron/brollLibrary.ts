import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface BRollLibraryEntry {
  id: string;
  filePath: string;
  friendlyName: string;
  duration: number;
  thumbnailPath?: string;
}

export interface BRollLibraryFile {
  version: 2;
  clips: BRollLibraryEntry[];
}

const LIBRARY_FILENAME = 'broll_library.json';
const LEGACY_FILENAME = 'broll-library.json';

function libraryPath(): string {
  return path.join(app.getPath('userData'), LIBRARY_FILENAME);
}

function thumbsDir(): string {
  const dir = path.join(app.getPath('userData'), 'thumbnails');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function migrateLegacy(): BRollLibraryFile {
  const legacyPath = path.join(app.getPath('userData'), LEGACY_FILENAME);
  const empty: BRollLibraryFile = { version: 2, clips: [] };
  if (!fs.existsSync(legacyPath)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as {
      names?: Record<string, string>;
    };
    if (!data.names) return empty;
    const clips: BRollLibraryEntry[] = Object.entries(data.names).map(([fp, name]) => ({
      id: `legacy-${normalizePathKey(fp).slice(0, 12)}`,
      filePath: fp,
      friendlyName: name,
      duration: 0,
    }));
    return { version: 2, clips };
  } catch {
    return empty;
  }
}

export function loadLibrary(): BRollLibraryFile {
  const libPath = libraryPath();
  if (!fs.existsSync(libPath)) {
    const migrated = migrateLegacy();
    if (migrated.clips.length > 0) saveLibrary(migrated);
    return migrated;
  }
  try {
    const data = JSON.parse(fs.readFileSync(libPath, 'utf-8')) as BRollLibraryFile;
    if (data.version === 2 && Array.isArray(data.clips)) {
      return data;
    }
  } catch {
    // fall through
  }
  return { version: 2, clips: [] };
}

export function saveLibrary(library: BRollLibraryFile): void {
  fs.writeFileSync(libraryPath(), JSON.stringify(library, null, 2), 'utf-8');
}

export function persistThumbnail(entryId: string, dataUrl: string | undefined): string | undefined {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return undefined;
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return undefined;
  const thumbPath = path.join(thumbsDir(), `${entryId}.jpg`);
  fs.writeFileSync(thumbPath, Buffer.from(match[1], 'base64'));
  return thumbPath;
}

export function readThumbnailDataUrl(thumbnailPath: string | undefined): string | undefined {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return undefined;
  try {
    const data = fs.readFileSync(thumbnailPath);
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch {
    return undefined;
  }
}

export function findClipByPath(library: BRollLibraryFile, filePath: string): BRollLibraryEntry | undefined {
  const key = normalizePathKey(filePath);
  return library.clips.find((c) => normalizePathKey(c.filePath) === key);
}

export function upsertClip(
  library: BRollLibraryFile,
  entry: Omit<BRollLibraryEntry, 'thumbnailPath'> & { thumbnail?: string }
): BRollLibraryEntry {
  const existing = findClipByPath(library, entry.filePath);
  const thumbPath = persistThumbnail(entry.id, entry.thumbnail) ?? existing?.thumbnailPath;

  const record: BRollLibraryEntry = {
    id: existing?.id ?? entry.id,
    filePath: path.resolve(entry.filePath),
    friendlyName: existing?.friendlyName ?? entry.friendlyName,
    duration:
      entry.duration > 0
        ? entry.duration
        : existing?.duration && existing.duration > 0
          ? existing.duration
          : 0,
    thumbnailPath: thumbPath ?? existing?.thumbnailPath,
  };

  if (existing) {
    library.clips = library.clips.map((c) =>
      normalizePathKey(c.filePath) === normalizePathKey(entry.filePath) ? record : c
    );
  } else {
    library.clips.push(record);
  }

  saveLibrary(library);
  return record;
}

export function renameClip(library: BRollLibraryFile, id: string, friendlyName: string): boolean {
  const idx = library.clips.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  library.clips[idx].friendlyName = friendlyName;
  saveLibrary(library);
  return true;
}

export function filterValidClips(library: BRollLibraryFile): BRollLibraryFile {
  const valid = library.clips.filter((c) => fs.existsSync(c.filePath));
  if (valid.length !== library.clips.length) {
    const cleaned = { version: 2 as const, clips: valid };
    saveLibrary(cleaned);
    return cleaned;
  }
  return library;
}