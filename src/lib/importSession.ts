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

export interface CompletedImportSession {
  mainVideo: MainVideoSelection;
  addedBroll: MediaAsset[];
  clipCount: number;
  projectName: string;
}

export async function completeClipImportSession(
  clips: ImportClipRef[],
  projectName: string
): Promise<CompletedImportSession> {
  if (clips.length === 0) {
    throw new Error('No clips to import');
  }

  const trimmedName = projectName.trim() || 'Untitled Project';
  const sourcePaths = clips.map((clip) => clip.sourcePath);
  const stitched = await stitchPhoneClips(sourcePaths, trimmedName);

  const brollImports = await Promise.all(
    clips.map(async (clip) => ({
      filePath: clip.sourcePath,
      friendlyName: cleanProjectName(clip.displayName),
      duration: await resolveVideoDuration(clip.sourcePath, toAssetUrl(clip.sourcePath)),
    }))
  );

  const addedBroll = await addToContentLibrary('broll', brollImports);

  const mainVideo =
    clips.length === 1
      ? await loadMainVideoDirect(stitched.filePath)
      : {
          filePath: stitched.filePath,
          url: toAssetUrl(stitched.filePath),
          duration: stitched.duration,
        };

  return {
    mainVideo,
    addedBroll,
    clipCount: clips.length,
    projectName: trimmedName,
  };
}