import { addToContentLibrary } from './contentLibrary';
import { resolveVideoDuration } from './duration';
import { stitchPhoneClips } from './phoneUpload';
import { loadMainVideoDirect, toAssetUrl } from './video';
import type { MainVideoSelection } from './video';
import type { MediaAsset } from '../types/project';
import { cleanProjectName } from '../utils/names';

export interface ImportClipRef {
  sourcePath: string;
  displayName: string;
}

export type ImportPhase =
  | 'preparing'
  | 'stitching'
  | 'loading-video'
  | 'adding-broll'
  | 'generating-hook';

export interface ImportProgress {
  phase: ImportPhase;
  message: string;
  clipCount: number;
}

export type ImportProgressHandler = (progress: ImportProgress) => void;

export interface CompletedImportSession {
  mainVideo: MainVideoSelection;
  addedBroll: MediaAsset[];
  clipCount: number;
  projectName: string;
}

/** Yield to the browser so progress UI can paint between heavy steps. */
export async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function reportProgress(
  onProgress: ImportProgressHandler | undefined,
  progress: ImportProgress
): void {
  onProgress?.(progress);
}

export async function resolveMainVideoFromClips(
  clips: ImportClipRef[],
  projectName: string,
  onProgress?: ImportProgressHandler
): Promise<MainVideoSelection> {
  if (clips.length === 0) {
    throw new Error('No clips to import');
  }

  const trimmedName = projectName.trim() || 'Untitled Project';

  if (clips.length === 1) {
    reportProgress(onProgress, {
      phase: 'loading-video',
      message: 'Loading video…',
      clipCount: 1,
    });
    await yieldToUi();
    return loadMainVideoDirect(clips[0].sourcePath);
  }

  reportProgress(onProgress, {
    phase: 'stitching',
    message: `Stitching ${clips.length} clips with crossfade…`,
    clipCount: clips.length,
  });
  await yieldToUi();

  const sourcePaths = clips.map((clip) => clip.sourcePath);
  const stitched = await stitchPhoneClips(sourcePaths, trimmedName);

  reportProgress(onProgress, {
    phase: 'loading-video',
    message: 'Loading stitched video…',
    clipCount: clips.length,
  });
  await yieldToUi();

  return {
    filePath: stitched.filePath,
    url: toAssetUrl(stitched.filePath),
    duration: stitched.duration,
  };
}

export async function addImportClipsToBroll(
  clips: ImportClipRef[],
  onProgress?: ImportProgressHandler
): Promise<MediaAsset[]> {
  reportProgress(onProgress, {
    phase: 'adding-broll',
    message: 'Adding clips to B-Roll Library…',
    clipCount: clips.length,
  });
  await yieldToUi();

  const brollImports = await Promise.all(
    clips.map(async (clip) => ({
      filePath: clip.sourcePath,
      friendlyName: cleanProjectName(clip.displayName),
      duration: await resolveVideoDuration(clip.sourcePath, toAssetUrl(clip.sourcePath)),
    }))
  );

  return addToContentLibrary('broll', brollImports, { skipThumbnails: true });
}

/** @deprecated Use resolveMainVideoFromClips + addImportClipsToBroll for non-blocking flows. */
export async function completeClipImportSession(
  clips: ImportClipRef[],
  projectName: string,
  onProgress?: ImportProgressHandler
): Promise<CompletedImportSession> {
  const trimmedName = projectName.trim() || 'Untitled Project';
  const mainVideo = await resolveMainVideoFromClips(clips, trimmedName, onProgress);
  const addedBroll = await addImportClipsToBroll(clips, onProgress);

  return {
    mainVideo,
    addedBroll,
    clipCount: clips.length,
    projectName: trimmedName,
  };
}