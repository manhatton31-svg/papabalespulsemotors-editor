import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { downloadDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { resolveVideoDuration } from './duration';

import type { LibraryCategory } from '../types/content';
import type { MediaType } from '../types/project';

/** Common phone / camera formats (iPhone MOV, Android MP4, etc.) */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'mkv',
  'webm',
  'avi',
  '3gp',
  '3g2',
  'mts',
  'm2ts',
  'ts',
  'mpg',
  'mpeg',
];

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];

export interface MainVideoSelection {
  filePath: string;
  url: string;
  duration: number;
  remuxed?: boolean;
  transcoded?: boolean;
}

export interface VideoImportInfo {
  filePath: string;
  url: string;
  duration: number;
}

interface ImportMainVideoResult {
  filePath: string;
  duration: number;
  remuxed: boolean;
  transcoded: boolean;
}

export function toAssetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

export function isVideoFilePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.includes(ext);
}

/** Load the video file as-is (phone upload path or PC pick) — no conversion step. */
export async function loadMainVideoDirect(sourcePath: string): Promise<MainVideoSelection> {
  if (!isTauri()) {
    throw new Error('Import requires the desktop app');
  }
  if (!isVideoFilePath(sourcePath)) {
    throw new Error('That file is not a supported video format');
  }

  const imported = await invoke<ImportMainVideoResult>('import_main_video', {
    sourcePath,
  });

  const url = toAssetUrl(imported.filePath);
  const duration = Math.max(
    imported.duration,
    await resolveVideoDuration(imported.filePath, url)
  );

  return {
    filePath: imported.filePath,
    url,
    duration,
  };
}

/** Open native file dialog (defaults to Downloads) and return one or more video paths. */
export async function openMainVideos(): Promise<string[]> {
  if (!isTauri()) {
    return [];
  }

  let defaultPath: string | undefined;
  try {
    defaultPath = await downloadDir();
  } catch {
    defaultPath = undefined;
  }

  const selected = await open({
    multiple: true,
    directory: false,
    defaultPath,
    filters: [
      {
        name: 'Phone & camera video',
        extensions: VIDEO_EXTENSIONS,
      },
    ],
    title: 'Import videos from PC',
  });

  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return paths.filter((filePath) => isVideoFilePath(filePath));
}

/** Open native file dialog (defaults to Downloads) and import a single video for editing. */
export async function openMainVideo(): Promise<MainVideoSelection | null> {
  const paths = await openMainVideos();
  if (paths.length === 0) return null;
  return loadMainVideoDirect(paths[0]);
}

function mediaTypeForPath(filePath: string): MediaType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(ext) ? 'image' : 'video';
}

function importTitleForCategory(category: LibraryCategory): string {
  switch (category) {
    case 'broll':
      return 'Import B-Roll';
    case 'intro':
      return 'Import Intro';
    case 'hook':
      return 'Import Hook';
    case 'outro':
      return 'Import Outro';
    case 'diagram':
      return 'Import Diagram';
  }
}

function filtersForCategory(category: LibraryCategory) {
  if (category === 'diagram') {
    return [
      { name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS] },
      { name: 'Images', extensions: IMAGE_EXTENSIONS },
      { name: 'Video', extensions: VIDEO_EXTENSIONS },
    ];
  }
  return [{ name: 'Video', extensions: VIDEO_EXTENSIONS }];
}

export async function openVideos(): Promise<VideoImportInfo[]> {
  return openMediaForCategory('broll');
}

export async function openMediaForCategory(
  category: LibraryCategory
): Promise<VideoImportInfo[]> {
  if (!isTauri()) return [];

  const selected = await open({
    multiple: true,
    directory: false,
    filters: filtersForCategory(category),
    title: importTitleForCategory(category),
  });

  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];

  const imports: VideoImportInfo[] = [];
  for (const filePath of paths) {
    const url = toAssetUrl(filePath);
    const mediaType = mediaTypeForPath(filePath);
    const duration =
      mediaType === 'image' ? 10 : await resolveVideoDuration(filePath, url);
    imports.push({ filePath, url, duration });
  }
  return imports;
}