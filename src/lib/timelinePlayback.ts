import type { ExportIncludeOptions } from './export';
import { outputDurationAfterBake } from '../types/timelapse';
import type { TimelapseSegment } from '../types/timelapse';
import type { TimelineClip } from '../types/project';
import { resolveTimelineDuration } from '../utils/timelineMath';

export function getMainTimelineClip(clips: TimelineClip[]): TimelineClip | null {
  return clips.find((c) => c.track === 'main') ?? null;
}

/** Global timeline time where the main video track begins (after intro hooks). */
export function getMainClipOffset(clips: TimelineClip[]): number {
  return getMainTimelineClip(clips)?.startTime ?? 0;
}

export function globalTimeToMainSource(globalTime: number, mainOffset: number): number {
  return Math.max(0, globalTime - mainOffset);
}

export function mainSourceToGlobalTime(sourceTime: number, mainOffset: number): number {
  return mainOffset + Math.max(0, sourceTime);
}

/** Preview / editor timeline length (global time). */
export function computePreviewDuration(
  sourceDuration: number,
  timelineClips: TimelineClip[]
): number {
  return resolveTimelineDuration(sourceDuration, timelineClips);
}

/** Final export length: intro/outro lead-in + baked main + extensions past main end. */
export function computeExportDuration(params: {
  sourceDuration: number;
  timelineClips: TimelineClip[];
  timelapseSegments: TimelapseSegment[];
  include: ExportIncludeOptions;
}): number {
  const { sourceDuration, timelineClips, timelapseSegments, include } = params;
  const mainOffset = getMainClipOffset(timelineClips);
  const segments = include.timelapse ? timelapseSegments : [];
  const bakedMain = outputDurationAfterBake(sourceDuration, segments);
  const bakedMainEnd = mainOffset + bakedMain;

  let maxEnd = bakedMainEnd;

  for (const clip of timelineClips) {
    if (clip.track === 'main' || clip.track === 'timelapse') continue;

    const allowed =
      (clip.track === 'broll' && include.broll) ||
      ((clip.track === 'hook' || clip.track === 'intro' || clip.track === 'outro') &&
        include.introsOutros) ||
      (clip.track === 'diagram' && include.diagrams);

    if (!allowed) continue;

    let exportStart = clip.startTime;
    if (clip.track === 'broll' || clip.track === 'diagram') {
      if (clip.startTime >= mainOffset - 0.001) {
        const sourceStart = globalTimeToMainSource(clip.startTime, mainOffset);
        exportStart =
          mainOffset + outputDurationAfterBake(sourceStart, segments);
      }
    }

    maxEnd = Math.max(maxEnd, exportStart + clip.duration);
  }

  return maxEnd;
}