import { resolveVideoDuration } from './duration';
import { stitchPhoneClips } from './phoneUpload';
import { loadMainVideoDirect, toAssetUrl } from './video';
import type { MainVideoSelection } from './video';
import type { MainVideoPiece } from '../types/project';
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
  mainVideoPieces: MainVideoPiece[];
  clipCount: number;
  projectName: string;
}

export async function buildMainVideoPieces(clips: ImportClipRef[]): Promise<MainVideoPiece[]> {
  return Promise.all(
    clips.map(async (clip) => ({
      sourcePath: clip.sourcePath,
      displayName: cleanProjectName(clip.displayName),
      duration: await resolveVideoDuration(clip.sourcePath, toAssetUrl(clip.sourcePath)),
    }))
  );
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

export interface ResolvedMainVideo {
  mainVideo: MainVideoSelection;
  stitched: boolean;
  stitchError?: string;
}

export async function resolveMainVideoFromClips(
  clips: ImportClipRef[],
  projectName: string,
  onProgress?: ImportProgressHandler
): Promise<ResolvedMainVideo> {
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
    return {
      mainVideo: await loadMainVideoDirect(clips[0].sourcePath),
      stitched: false,
    };
  }

  reportProgress(onProgress, {
    phase: 'stitching',
    message: 'Stitching clips…',
    clipCount: clips.length,
  });
  await yieldToUi();

  const sourcePaths = clips.map((clip) => clip.sourcePath);

  try {
    const stitched = await stitchPhoneClips(sourcePaths, trimmedName);

    reportProgress(onProgress, {
      phase: 'loading-video',
      message: 'Loading stitched video…',
      clipCount: clips.length,
    });
    await yieldToUi();

    return {
      mainVideo: {
        filePath: stitched.filePath,
        url: toAssetUrl(stitched.filePath),
        duration: stitched.duration,
      },
      stitched: true,
    };
  } catch (stitchErr) {
    const stitchError =
      stitchErr instanceof Error ? stitchErr.message : String(stitchErr);

    reportProgress(onProgress, {
      phase: 'loading-video',
      message: 'Stitch failed — loading first clip…',
      clipCount: clips.length,
    });
    await yieldToUi();

    return {
      mainVideo: await loadMainVideoDirect(clips[0].sourcePath),
      stitched: false,
      stitchError,
    };
  }
}

export async function completeClipImportSession(
  clips: ImportClipRef[],
  projectName: string,
  onProgress?: ImportProgressHandler
): Promise<CompletedImportSession> {
  const trimmedName = projectName.trim() || 'Untitled Project';
  const { mainVideo } = await resolveMainVideoFromClips(clips, trimmedName, onProgress);
  const mainVideoPieces = await buildMainVideoPieces(clips);

  return {
    mainVideo,
    mainVideoPieces,
    clipCount: clips.length,
    projectName: trimmedName,
  };
}