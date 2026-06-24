import { invoke, isTauri } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { addToContentLibrary } from './contentLibrary';
import type { MediaAsset, TimelineClip } from '../types/project';

export interface HookClipResult {
  filePath: string;
  duration: number;
  friendlyName: string;
}

export async function extractHookClipsFromVideo(mainVideoPath: string): Promise<HookClipResult[]> {
  if (!isTauri()) {
    throw new Error('Hook preview requires the desktop app');
  }
  if (!mainVideoPath) {
    throw new Error('Load a main video first');
  }
  return invoke<HookClipResult[]>('generate_hook_preview', { mainPath: mainVideoPath });
}

export async function generateHookPreviewAssets(
  mainVideoPath: string
): Promise<MediaAsset[]> {
  const clips = await extractHookClipsFromVideo(mainVideoPath);
  if (clips.length === 0) {
    throw new Error('Could not extract hook clips from this video');
  }

  return addToContentLibrary(
    'intro',
    clips.map((clip) => ({
      filePath: clip.filePath,
      friendlyName: clip.friendlyName,
      duration: clip.duration,
    }))
  );
}

export function buildHookTimelineClips(
  assets: MediaAsset[],
  existingClips: TimelineClip[]
): TimelineClip[] {
  const withoutIntros = existingClips.filter((c) => c.track !== 'intro');
  let cursor = 0;
  const introClips: TimelineClip[] = assets.map((asset) => {
    const clip: TimelineClip = {
      id: uuidv4(),
      assetId: asset.id,
      startTime: cursor,
      duration: asset.duration,
      track: 'intro',
    };
    cursor += asset.duration;
    return clip;
  });
  return [...introClips, ...withoutIntros];
}