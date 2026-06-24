import { v4 as uuidv4 } from 'uuid';
import type { LibraryCategory } from '../types/content';
import { LIBRARY_CATEGORIES } from '../types/content';
import type { MediaAsset, MediaType } from '../types/project';
import { toAssetUrl } from './video';
import { resolveVideoDuration } from './duration';
import { captureVideoThumbnail } from './thumbnail';
import { getAppDataDir, readTextFile, writeTextFile } from './tauriFs';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp']);

interface LibraryEntry {
  id: string;
  category: LibraryCategory;
  filePath: string;
  friendlyName: string;
  duration: number;
  thumbnail?: string;
  mediaType: MediaType;
  favorite?: boolean;
  useCount?: number;
  lastUsedAt?: number;
}

interface CategoryLibraryFile {
  version: 2;
  clips: LibraryEntry[];
}

function normalizePathKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function defaultFriendlyName(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? 'clip';
  return base.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
}

function detectMediaType(filePath: string): MediaType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : 'video';
}

function libraryFileName(category: LibraryCategory): string {
  return `${category}_library.json`;
}

async function libraryFilePath(category: LibraryCategory): Promise<string> {
  const dir = await getAppDataDir();
  return `${dir}/${libraryFileName(category)}`;
}

async function readCategoryLibrary(category: LibraryCategory): Promise<CategoryLibraryFile> {
  try {
    const path = await libraryFilePath(category);
    const raw = await readTextFile(path);
    const data = JSON.parse(raw) as CategoryLibraryFile;
    if (data.version === 2 && Array.isArray(data.clips)) return data;
  } catch {
    // fresh library
  }
  return { version: 2, clips: [] };
}

async function writeCategoryLibrary(
  category: LibraryCategory,
  library: CategoryLibraryFile
): Promise<void> {
  const path = await libraryFilePath(category);
  await writeTextFile(path, JSON.stringify(library, null, 2));
}

function entryToAsset(entry: LibraryEntry): MediaAsset {
  return {
    id: entry.id,
    category: entry.category,
    filePath: entry.filePath,
    friendlyName: entry.friendlyName,
    duration: entry.duration,
    thumbnail: entry.thumbnail,
    url: toAssetUrl(entry.filePath),
    mediaType: entry.mediaType,
    favorite: entry.favorite,
    useCount: entry.useCount,
    lastUsedAt: entry.lastUsedAt,
  };
}

/** Migrate legacy broll_library.json (no category field) into broll category file. */
async function migrateLegacyBrollLibrary(): Promise<LibraryEntry[]> {
  try {
    const dir = await getAppDataDir();
    const legacyPath = `${dir}/broll_library.json`;
    const raw = await readTextFile(legacyPath);
    const data = JSON.parse(raw) as { version?: number; clips?: Omit<LibraryEntry, 'category' | 'mediaType'>[] };
    if (!Array.isArray(data.clips)) return [];

    const migrated: LibraryEntry[] = data.clips.map((clip) => ({
      id: clip.id,
      category: 'broll',
      filePath: clip.filePath,
      friendlyName: clip.friendlyName,
      duration: clip.duration,
      thumbnail: clip.thumbnail,
      mediaType: detectMediaType(clip.filePath),
    }));

    const library: CategoryLibraryFile = { version: 2, clips: migrated };
    await writeCategoryLibrary('broll', library);
    return migrated;
  } catch {
    return [];
  }
}

export async function loadCategoryLibrary(category: LibraryCategory): Promise<MediaAsset[]> {
  let library = await readCategoryLibrary(category);

  if (category === 'broll' && library.clips.length === 0) {
    const migrated = await migrateLegacyBrollLibrary();
    if (migrated.length > 0) library = { version: 2, clips: migrated };
  }

  const hydrated: MediaAsset[] = [];

  for (const clip of library.clips) {
    let duration = clip.duration;
    const url = toAssetUrl(clip.filePath);
    if (clip.mediaType === 'video' && duration <= 0) {
      duration = await resolveVideoDuration(clip.filePath, url);
      if (duration > 0) clip.duration = duration;
    } else if (clip.mediaType === 'image' && duration <= 0) {
      clip.duration = 10;
      duration = 10;
    }
    hydrated.push(entryToAsset(clip));
  }

  await writeCategoryLibrary(category, library);
  return hydrated;
}

export async function loadAllContentLibraries(): Promise<MediaAsset[]> {
  const all: MediaAsset[] = [];
  for (const category of LIBRARY_CATEGORIES) {
    const assets = await loadCategoryLibrary(category);
    all.push(...assets);
  }
  return all;
}

export interface ContentImportInput {
  filePath: string;
  friendlyName?: string;
  duration?: number;
  thumbnail?: string;
  mediaType?: MediaType;
}

export async function addToContentLibrary(
  category: LibraryCategory,
  imports: ContentImportInput[]
): Promise<MediaAsset[]> {
  const library = await readCategoryLibrary(category);
  const added: MediaAsset[] = [];

  for (const imp of imports) {
    const key = normalizePathKey(imp.filePath);
    const existing = library.clips.find((c) => normalizePathKey(c.filePath) === key);
    const url = toAssetUrl(imp.filePath);
    const mediaType = imp.mediaType ?? detectMediaType(imp.filePath);

    let duration = imp.duration ?? 0;
    if (mediaType === 'video') {
      if (duration <= 0) duration = await resolveVideoDuration(imp.filePath, url);
    } else {
      duration = duration > 0 ? duration : 10;
    }

    let thumbnail = imp.thumbnail ?? existing?.thumbnail;
    if (!thumbnail) {
      thumbnail =
        mediaType === 'image' ? url : await captureVideoThumbnail(url);
    }

    const entry: LibraryEntry = {
      id: existing?.id ?? uuidv4(),
      category,
      filePath: imp.filePath,
      friendlyName:
        existing?.friendlyName ?? imp.friendlyName ?? defaultFriendlyName(imp.filePath),
      duration: duration > 0 ? duration : (existing?.duration ?? (mediaType === 'image' ? 10 : 0)),
      thumbnail,
      mediaType,
      favorite: existing?.favorite,
      useCount: existing?.useCount,
      lastUsedAt: existing?.lastUsedAt,
    };

    if (existing) {
      library.clips = library.clips.map((c) =>
        normalizePathKey(c.filePath) === key ? entry : c
      );
    } else {
      library.clips.push(entry);
    }

    added.push(entryToAsset(entry));
  }

  await writeCategoryLibrary(category, library);
  return added;
}

export async function renameContentAsset(
  category: LibraryCategory,
  id: string,
  friendlyName: string
): Promise<boolean> {
  const library = await readCategoryLibrary(category);
  const idx = library.clips.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  library.clips[idx].friendlyName = friendlyName.trim() || 'Untitled';
  await writeCategoryLibrary(category, library);
  return true;
}

export async function toggleBrollFavorite(id: string): Promise<boolean | null> {
  const library = await readCategoryLibrary('broll');
  const idx = library.clips.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const next = !library.clips[idx].favorite;
  library.clips[idx].favorite = next;
  await writeCategoryLibrary('broll', library);
  return next;
}

export async function recordBrollUsage(id: string): Promise<MediaAsset | null> {
  const library = await readCategoryLibrary('broll');
  const idx = library.clips.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const clip = library.clips[idx];
  clip.useCount = (clip.useCount ?? 0) + 1;
  clip.lastUsedAt = Date.now();
  await writeCategoryLibrary('broll', library);
  return entryToAsset(clip);
}

export function mergeMediaAssets(existing: MediaAsset[], added: MediaAsset[]): MediaAsset[] {
  const map = new Map(existing.map((a) => [a.id, a]));
  for (const asset of added) map.set(asset.id, asset);
  return Array.from(map.values());
}

export function assetsForCategory(assets: MediaAsset[], category: LibraryCategory): MediaAsset[] {
  return assets.filter((a) => a.category === category);
}