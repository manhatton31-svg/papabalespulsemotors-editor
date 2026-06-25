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

const HOOK_CLIP_NAME = /^Hook \d+$/;

export function isHookClipAsset(asset: MediaAsset): boolean {
  return asset.category === 'intro' && HOOK_CLIP_NAME.test(asset.friendlyName);
}

/** First saved intro that is not an auto-generated hook segment. */
export function findDefaultIntroAsset(
  mediaAssets: MediaAsset[],
  excludeIds: ReadonlySet<string> = new Set()
): MediaAsset | null {
  return (
    mediaAssets.find(
      (a) => a.category === 'intro' && !excludeIds.has(a.id) && !isHookClipAsset(a)
    ) ?? null
  );
}

export function buildHookTimelineClips(
  hookAssets: MediaAsset[],
  existingClips: TimelineClip[],
  defaultIntroAsset?: MediaAsset | null
): TimelineClip[] {
  const withoutIntros = existingClips.filter((c) => c.track !== 'intro');
  let cursor = 0;
  const introClips: TimelineClip[] = [];

  for (const asset of hookAssets) {
    introClips.push({
      id: uuidv4(),
      assetId: asset.id,
      startTime: cursor,
      duration: asset.duration,
      track: 'intro',
    });
    cursor += asset.duration;
  }

  if (defaultIntroAsset) {
    introClips.push({
      id: uuidv4(),
      assetId: defaultIntroAsset.id,
      startTime: cursor,
      duration: defaultIntroAsset.duration,
      track: 'intro',
    });
    cursor += defaultIntroAsset.duration;
  }

  const mainOffset = cursor;
  const shiftedOthers = withoutIntros.map((clip) => {
    if (clip.track === 'main') {
      return { ...clip, startTime: mainOffset };
    }
    return clip;
  });

  return [...introClips, ...shiftedOthers];
}