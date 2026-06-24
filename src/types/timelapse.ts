export interface TimelapseSegment {
  id: string;
  startTime: number;
  endTime: number;
  speedFactor: number;
}

export const TIMELAPSE_SPEED_OPTIONS = [4, 8, 16, 32] as const;

export type TimelapseSpeed = (typeof TIMELAPSE_SPEED_OPTIONS)[number];

export function segmentDuration(seg: TimelapseSegment): number {
  return Math.max(0, seg.endTime - seg.startTime);
}

export function getTimelapseSegmentAt(
  time: number,
  segments: TimelapseSegment[]
): TimelapseSegment | null {
  if (segments.length === 0) return null;
  // Prefer a segment that starts exactly here so back-to-back regions hand off cleanly.
  for (const seg of segments) {
    if (Math.abs(time - seg.startTime) < 0.0005) return seg;
  }
  for (const seg of segments) {
    if (time >= seg.startTime && time < seg.endTime) return seg;
  }
  return null;
}

/** Next timelapse segment after a source time (for seamless multi-segment playback). */
export function getNextTimelapseSegmentAfter(
  time: number,
  segments: TimelapseSegment[]
): TimelapseSegment | null {
  let next: TimelapseSegment | null = null;
  for (const seg of segments) {
    if (seg.startTime <= time) continue;
    if (!next || seg.startTime < next.startTime) next = seg;
  }
  return next;
}

export function outputDurationAfterBake(
  sourceDuration: number,
  segments: TimelapseSegment[]
): number {
  if (segments.length === 0) return sourceDuration;
  return sourceTimeToBakedTime(sourceDuration, segments);
}

/** Map source timeline position → baked preview position. */
export function sourceTimeToBakedTime(
  sourceTime: number,
  segments: TimelapseSegment[]
): number {
  if (segments.length === 0) return sourceTime;

  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  let baked = 0;
  let sourceCursor = 0;

  for (const seg of sorted) {
    if (sourceTime <= seg.startTime) {
      return baked + (sourceTime - sourceCursor);
    }

    if (seg.startTime > sourceCursor) {
      baked += seg.startTime - sourceCursor;
      sourceCursor = seg.startTime;
    }

    if (sourceTime < seg.endTime) {
      return baked + (sourceTime - seg.startTime) / seg.speedFactor;
    }

    baked += segmentDuration(seg) / seg.speedFactor;
    sourceCursor = seg.endTime;
  }

  return baked + Math.max(0, sourceTime - sourceCursor);
}

/** Map baked preview position → source timeline position. */
export function bakedTimeToSourceTime(
  bakedTime: number,
  segments: TimelapseSegment[],
  sourceDuration: number
): number {
  if (segments.length === 0) return Math.min(bakedTime, sourceDuration);

  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  let bakedCursor = 0;
  let sourceCursor = 0;

  for (const seg of sorted) {
    const gapLen = seg.startTime - sourceCursor;
    if (gapLen > 0) {
      if (bakedTime < bakedCursor + gapLen) {
        return sourceCursor + (bakedTime - bakedCursor);
      }
      bakedCursor += gapLen;
      sourceCursor = seg.startTime;
    }

    const segBakedLen = segmentDuration(seg) / seg.speedFactor;
    if (bakedTime < bakedCursor + segBakedLen) {
      return seg.startTime + (bakedTime - bakedCursor) * seg.speedFactor;
    }

    bakedCursor += segBakedLen;
    sourceCursor = seg.endTime;
  }

  const tailLen = Math.max(0, sourceDuration - sourceCursor);
  return sourceCursor + Math.min(bakedTime - bakedCursor, tailLen);
}