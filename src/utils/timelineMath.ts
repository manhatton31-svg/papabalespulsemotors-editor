/** Max detail-timeline width in pixels — keeps DOM light for 30–60+ min videos */
export const MAX_TIMELINE_PIXELS = 600_000;

export const ABSOLUTE_MIN_ZOOM = 2;
export const ABSOLUTE_MAX_ZOOM = 800;

export function getMaxZoom(duration: number): number {
  if (duration <= 0) return ABSOLUTE_MAX_ZOOM;
  return Math.min(ABSOLUTE_MAX_ZOOM, MAX_TIMELINE_PIXELS / duration);
}

export function getFitZoom(duration: number, laneWidth: number): number {
  if (duration <= 0) return ABSOLUTE_MIN_ZOOM;
  // Allow very low px/s so multi-hour videos fit entirely in the detail view
  return Math.max(0.02, laneWidth / duration);
}

export function clampZoom(zoom: number, duration: number, laneWidth: number): number {
  const min = getFitZoom(duration, laneWidth);
  const max = getMaxZoom(duration);
  return Math.max(min, Math.min(max, zoom));
}

export function timelineWidthPx(duration: number, zoom: number, laneWidth: number): number {
  return Math.max(duration * zoom, laneWidth);
}

/** Authoritative timeline length — never shorter than the main clip or any placed clip. */
export function resolveTimelineDuration(
  duration: number,
  clips: { startTime: number; duration: number; track: string }[]
): number {
  let max = Number.isFinite(duration) && duration > 0 ? duration : 0;
  for (const clip of clips) {
    max = Math.max(max, clip.startTime + clip.duration);
    if (clip.track === 'main') max = Math.max(max, clip.duration);
  }
  return max;
}

const MAJOR_TICK_INTERVALS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800,
];

/** Pick a major tick interval that keeps labels at least minSpacingPx apart. */
export function pickMajorTickInterval(zoom: number, minSpacingPx = 88): number {
  if (zoom <= 0) return 60;
  const desiredSeconds = minSpacingPx / zoom;
  for (const interval of MAJOR_TICK_INTERVALS) {
    if (interval >= desiredSeconds) return interval;
  }
  return MAJOR_TICK_INTERVALS[MAJOR_TICK_INTERVALS.length - 1];
}

export function pickMinorTickInterval(major: number): number {
  if (major >= 60) return major / 4;
  if (major >= 10) return major / 5;
  if (major >= 1) return major / 5;
  return major / 2;
}

export type RulerLabelAlign = 'start' | 'center' | 'end';

export interface RulerMarkSpec {
  time: number;
  kind: 'major' | 'minor';
  label?: string;
  labelAlign?: RulerLabelAlign;
}

const RULER_VIEWPORT_BUFFER_SEC = 30;

function estimateLabelWidth(text: string): number {
  return text.length * 6.5 + 14;
}

export function formatRulerTime(seconds: number, majorInterval: number): string {
  const totalSec = Math.max(0, seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);

  if (majorInterval < 1) {
    const frac = Math.round((totalSec % 1) * 10);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${frac}`;
    if (m > 0) return `${m}:${s.toString().padStart(2, '0')}.${frac}`;
    return `${s}.${frac}s`;
  }

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function chooseLabelAlign(
  localPx: number,
  labelWidth: number,
  visibleLaneWidth: number
): RulerLabelAlign {
  const margin = 8;
  const half = labelWidth / 2;
  if (localPx <= half + margin) return 'start';
  if (localPx >= visibleLaneWidth - half - margin) return 'end';
  return 'center';
}

function labelBoundsLocal(
  localPx: number,
  labelWidth: number,
  align: RulerLabelAlign
): { left: number; right: number } {
  if (align === 'start') return { left: localPx, right: localPx + labelWidth };
  if (align === 'end') return { left: localPx - labelWidth, right: localPx };
  const half = labelWidth / 2;
  return { left: localPx - half, right: localPx + half };
}

function labelFitsInViewport(
  localPx: number,
  labelWidth: number,
  align: RulerLabelAlign,
  visibleLaneWidth: number
): boolean {
  const margin = 4;
  const { left, right } = labelBoundsLocal(localPx, labelWidth, align);
  return left >= -margin && right <= visibleLaneWidth + margin;
}

function snapToGrid(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/** Build non-overlapping ruler ticks for the visible viewport. */
export function buildRulerMarks(params: {
  duration: number;
  zoom: number;
  viewStart: number;
  viewEnd: number;
  scrollLeft: number;
  visibleLaneWidth: number;
  minLabelSpacingPx?: number;
}): RulerMarkSpec[] {
  const {
    duration,
    zoom,
    viewStart,
    viewEnd,
    scrollLeft,
    visibleLaneWidth,
    minLabelSpacingPx = 88,
  } = params;

  if (duration <= 0 || zoom <= 0) {
    return [{ time: 0, kind: 'major', label: '0:00', labelAlign: 'start' }];
  }

  const majorInterval = pickMajorTickInterval(zoom, minLabelSpacingPx);
  const minorInterval = pickMinorTickInterval(majorInterval);
  const showMinor = minorInterval * zoom >= 6;

  const rangeStart = Math.max(0, viewStart - RULER_VIEWPORT_BUFFER_SEC);
  const rangeEnd = Math.min(duration, viewEnd + RULER_VIEWPORT_BUFFER_SEC);

  const marks = new Map<number, RulerMarkSpec>();

  const addMark = (mark: RulerMarkSpec) => {
    const key = Math.round(mark.time * 1000);
    const existing = marks.get(key);
    if (!existing || mark.kind === 'major') marks.set(key, mark);
  };

  // Minor ticks (no labels) — iterate only the visible range
  if (showMinor) {
    const firstMinor = Math.floor(rangeStart / minorInterval);
    const lastMinor = Math.ceil(rangeEnd / minorInterval);
    for (let i = firstMinor; i <= lastMinor; i++) {
      const t = snapToGrid(i * minorInterval);
      if (t < 0 || t > duration + 0.001) continue;
      const onMajor =
        Math.abs(t - Math.round(t / majorInterval) * majorInterval) < minorInterval * 0.1;
      if (!onMajor) addMark({ time: t, kind: 'minor' });
    }
  }

  // Major tick candidates on a clean grid — iterate only the visible range
  const majorTimes: number[] = [];
  const firstMajor = Math.floor(rangeStart / majorInterval) * majorInterval;
  for (let t = firstMajor; t <= rangeEnd + 0.001; t += majorInterval) {
    const snapped = snapToGrid(t);
    if (snapped >= rangeStart - 0.001 && snapped <= rangeEnd + 0.001) {
      majorTimes.push(snapped);
    }
  }

  const endKey = Math.round(duration * 1000);
  const lastMajor = majorTimes[majorTimes.length - 1];
  if (lastMajor === undefined || Math.round(lastMajor * 1000) !== endKey) {
    if (duration >= rangeStart - 0.001 && duration <= rangeEnd + 0.001) {
      majorTimes.push(duration);
    }
  }

  const uniqueMajors = [...new Set(majorTimes.map((t) => Math.round(t * 1000)))]
    .map((k) => k / 1000)
    .sort((a, b) => a - b);

  let lastLabelRightLocal = -Infinity;
  const labelGapPx = 10;

  for (const t of uniqueMajors) {
    const px = t * zoom;
    const localPx = px - scrollLeft;
    const text = formatRulerTime(t, majorInterval);
    const labelWidth = estimateLabelWidth(text);
    const isStart = t <= 0.001;
    const isEnd = Math.abs(t - duration) < 0.05;

    let align: RulerLabelAlign = 'center';
    if (isStart) align = 'start';
    else if (isEnd) align = 'end';
    else align = chooseLabelAlign(localPx, labelWidth, visibleLaneWidth);

    if (!labelFitsInViewport(localPx, labelWidth, align, visibleLaneWidth)) continue;

    const { left, right } = labelBoundsLocal(localPx, labelWidth, align);
    if (left < lastLabelRightLocal + labelGapPx) continue;

    addMark({ time: t, kind: 'major', label: text, labelAlign: align });
    lastLabelRightLocal = right;
  }

  return [...marks.values()].sort((a, b) => a.time - b.time);
}

/** True when the wheel event should pan the timeline horizontally instead of zooming. */
export function isTimelinePanWheel(e: { deltaX: number; deltaY: number; shiftKey: boolean }): boolean {
  const absX = Math.abs(e.deltaX);
  const absY = Math.abs(e.deltaY);
  if (absX > absY && absX > 0.5) return true;
  if (e.shiftKey && absY > 0.5) return true;
  return false;
}

/** Horizontal scroll delta in pixels from a wheel event. */
export function getTimelinePanDelta(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  clientHeight: number;
}): number {
  let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (e.deltaMode === 1) delta *= 16;
  else if (e.deltaMode === 2) delta *= e.clientHeight;
  return delta;
}