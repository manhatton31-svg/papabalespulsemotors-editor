import { FULL_FRAME_PRIORITY, type OverlayTrack, isOverlayTrack } from '../types/content';
import type { MediaAsset, TimelineClip } from '../types/project';
import { getTimelapseSegmentAt } from '../types/timelapse';
import type { TimelapseSegment } from '../types/timelapse';

export interface ActiveMediaClip {
  clip: TimelineClip;
  asset: MediaAsset;
  track: OverlayTrack;
}

function findAsset(assets: MediaAsset[], assetId: string): MediaAsset | undefined {
  return assets.find((a) => a.id === assetId);
}

function clipActiveAt(clip: TimelineClip, time: number): boolean {
  const end = clip.startTime + clip.duration;
  return time >= clip.startTime && time < end;
}

export function getActiveFullFrameAt(
  time: number,
  clips: TimelineClip[],
  assets: MediaAsset[]
): ActiveMediaClip | null {
  let best: ActiveMediaClip | null = null;
  let bestPriority = -1;

  for (const clip of clips) {
    if (!isOverlayTrack(clip.track) || clip.track === 'diagram' || clip.track === 'timelapse') {
      continue;
    }
    if (!clipActiveAt(clip, time)) continue;

    const asset = findAsset(assets, clip.assetId);
    if (!asset) continue;

    const priority = FULL_FRAME_PRIORITY[clip.track];
    if (priority > bestPriority) {
      bestPriority = priority;
      best = { clip, asset, track: clip.track };
    }
  }

  return best;
}

export function getActiveDiagramAt(
  time: number,
  clips: TimelineClip[],
  assets: MediaAsset[]
): ActiveMediaClip | null {
  for (const clip of clips) {
    if (clip.track !== 'diagram') continue;
    if (!clipActiveAt(clip, time)) continue;
    const asset = findAsset(assets, clip.assetId);
    if (asset) return { clip, asset, track: 'diagram' };
  }
  return null;
}

export function getPlaybackRateAt(
  time: number,
  segments: TimelapseSegment[]
): number {
  const seg = getTimelapseSegmentAt(time, segments);
  return seg ? seg.speedFactor : 1;
}

export function clampTime(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(time, duration));
}

export function localTimeInClip(globalTime: number, clip: TimelineClip): number {
  return Math.max(0, globalTime - clip.startTime);
}