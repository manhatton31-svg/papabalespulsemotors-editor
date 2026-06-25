import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { v4 as uuidv4 } from 'uuid';
import { addToContentLibrary } from './contentLibrary';
import type { MediaAsset, TimelineClip } from '../types/project';

export interface HookClipResult {
  filePath: string;
  duration: number;
  friendlyName: string;
}

export interface HookPreviewProgress {
  jobId: string;
  progress: number;
  status: string;
  message?: string;
}

export interface HookPreviewComplete {
  jobId: string;
  clips: HookClipResult[];
  status: string;
  message?: string;
}

function waitForHookPreviewJob(
  jobId: string,
  onProgress?: (event: HookPreviewProgress) => void
): Promise<HookClipResult[]> {
  return new Promise((resolve, reject) => {
    let unlistenProgress: UnlistenFn | undefined;
    let unlistenComplete: UnlistenFn | undefined;
    let settled = false;

    const cleanup = () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    listen<HookPreviewProgress>('hook-preview-progress', (payload) => {
      if (payload.payload.jobId !== jobId) return;
      onProgress?.(payload.payload);
    })
      .then((fn) => {
        unlistenProgress = fn;
      })
      .catch(() => {});

    listen<HookPreviewComplete>('hook-preview-complete', (payload) => {
      if (payload.payload.jobId !== jobId) return;
      const event = payload.payload;
      if (event.status === 'completed') {
        finish(() => resolve(event.clips));
      } else {
        finish(() => reject(new Error(event.message ?? 'Hook preview failed')));
      }
    })
      .then((fn) => {
        unlistenComplete = fn;
      })
      .catch(() => {
        finish(() => reject(new Error('Could not listen for hook preview completion')));
      });
  });
}

export async function extractHookClipsFromVideo(
  mainVideoPath: string,
  onProgress?: (event: HookPreviewProgress) => void
): Promise<HookClipResult[]> {
  if (!isTauri()) {
    throw new Error('Hook preview requires the desktop app');
  }
  if (!mainVideoPath) {
    throw new Error('Load a main video first');
  }

  const { jobId } = await invoke<{ jobId: string }>('start_generate_hook_preview', {
    mainPath: mainVideoPath,
  });

  return waitForHookPreviewJob(jobId, onProgress);
}

export async function generateHookPreviewAssets(
  mainVideoPath: string,
  onProgress?: (event: HookPreviewProgress) => void
): Promise<MediaAsset[]> {
  const clips = await extractHookClipsFromVideo(mainVideoPath, onProgress);
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