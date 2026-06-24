import type { TimelapseSegment } from '../types/timelapse';
import { getTimelapseSegmentAt } from '../types/timelapse';
import { getPlaybackRateAt } from './playback';

const MAX_FRAME_DT = 0.1;

/** Browsers (Chrome, Edge, WebView2) cap native playbackRate around 16×. */
export const MAX_NATIVE_PLAYBACK_RATE = 16;

export function advancePlayheadForTimelapse(
  currentTime: number,
  deltaSeconds: number,
  segments: TimelapseSegment[],
  duration: number
): number {
  if (deltaSeconds <= 0) return currentTime;

  let t = currentTime;
  let remaining = deltaSeconds;

  while (remaining > 0 && t < duration) {
    const rate = getPlaybackRateAt(t, segments);
    const seg = getTimelapseSegmentAt(t, segments);
    const wallBudget = remaining;
    const sourceAdvance = wallBudget * rate;

    if (seg) {
      const room = seg.endTime - t;
      if (sourceAdvance >= room) {
        t = seg.endTime;
        remaining -= room / rate;
      } else {
        t += sourceAdvance;
        remaining = 0;
      }
    } else {
      const nextSeg = segments
        .filter((s) => s.startTime > t)
        .sort((a, b) => a.startTime - b.startTime)[0];
      const room = nextSeg ? nextSeg.startTime - t : duration - t;
      if (sourceAdvance >= room) {
        t += room;
        remaining -= room;
      } else {
        t += sourceAdvance;
        remaining = 0;
      }
    }
  }

  return Math.min(t, duration);
}

export function clampFrameDelta(deltaSeconds: number): number {
  return Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DT);
}

/** Unique key for a timelapse segment — supports many segments at different speeds. */
export function timelapsePlaybackKey(seg: TimelapseSegment | null): string {
  if (!seg || seg.speedFactor <= 1) return 'normal';
  return `${seg.id}:${seg.speedFactor}`;
}

export function targetPlaybackRate(speedFactor: number): number {
  if (speedFactor <= 1) return 1;
  return speedFactor;
}

/** True when preview must supplement native rate (e.g. 32× on a 16× browser cap). */
export function needsUltraPlayback(speedFactor: number): boolean {
  return speedFactor > MAX_NATIVE_PLAYBACK_RATE;
}

/**
 * Apply the highest native rate the browser accepts for the requested speed.
 * Setting 32× directly often resets to 1× — probe and fall back to 16×.
 */
export function resolveNativePlaybackRate(
  video: HTMLVideoElement,
  speedFactor: number
): number {
  if (speedFactor <= 1) return 1;

  const candidates = [speedFactor, MAX_NATIVE_PLAYBACK_RATE, 8, 4, 2, 1].filter(
    (rate, index, arr) => rate >= 1 && rate <= speedFactor && arr.indexOf(rate) === index
  );

  for (const rate of candidates) {
    video.playbackRate = rate;
    const actual = video.playbackRate;
    if (actual >= rate - 0.05) return actual;
  }

  return 1;
}

/** @deprecated Use resolveNativePlaybackRate — kept for callers expecting this name. */
export function previewPlaybackRate(speedFactor: number): number {
  return targetPlaybackRate(speedFactor);
}

/** Wall-clock source position during timelapse preview (all speeds; video may lag behind). */
export function timelapseWallTargetTime(
  seg: TimelapseSegment,
  anchorTime: number,
  wallStartMs: number,
  nowMs: number
): number {
  const wallElapsed = (nowMs - wallStartMs) / 1000;
  return Math.min(seg.endTime, anchorTime + wallElapsed * seg.speedFactor);
}

/** @deprecated Use timelapseWallTargetTime */
export function ultraTargetTime(
  seg: TimelapseSegment,
  anchorTime: number,
  wallStartMs: number,
  nowMs: number
): number {
  return timelapseWallTargetTime(seg, anchorTime, wallStartMs, nowMs);
}

/** Wall-clock source position across one or more timelapse segments (live preview). */
export function wallClockSourceTime(
  anchorTime: number,
  wallStartMs: number,
  nowMs: number,
  segments: TimelapseSegment[],
  duration: number
): number {
  const wallElapsed = (nowMs - wallStartMs) / 1000;
  if (wallElapsed <= 0) return anchorTime;
  return advancePlayheadForTimelapse(anchorTime, wallElapsed, segments, duration);
}

/** Segment membership for exit checks — treats segment end as inside (back-to-back safe). */
export function getTimelapseSegmentForExit(
  time: number,
  segments: TimelapseSegment[]
): TimelapseSegment | null {
  for (const seg of segments) {
    if (time > seg.startTime && time <= seg.endTime) return seg;
  }
  for (const seg of segments) {
    if (Math.abs(time - seg.endTime) < 0.002) return seg;
  }
  return getTimelapseSegmentAt(time, segments);
}

/** True when playback just left a timelapse segment (end boundary). */
export function justExitedTimelapse(
  prevTime: number,
  time: number,
  segments: TimelapseSegment[]
): boolean {
  const prevSeg = getTimelapseSegmentForExit(prevTime, segments);
  if (!prevSeg) return false;
  return time >= prevSeg.endTime - 0.001;
}

/** Source-time nudge equivalent to ~one rendered frame at the given speed. */
export function frameNudgeAtRate(speedFactor: number): number {
  return 0.033 * speedFactor;
}