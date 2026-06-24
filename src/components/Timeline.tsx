import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTENT_LIBRARY_CONFIG,
  getVisibleOverlayTracks,
  MEDIA_DRAG_MIME,
  TRACK_DISPLAY_CONFIG,
  type OverlayTrack,
} from '../types/content';
import type { MediaAsset, TimelineClip } from '../types/project';
import type { TimelapseSegment } from '../types/timelapse';
import {
  ABSOLUTE_MAX_ZOOM,
  buildRulerMarks,
  clampZoom,
  getFitZoom,
  getMaxZoom,
  getTimelinePanDelta,
  isTimelinePanWheel,
  resolveTimelineDuration,
  timelineWidthPx,
} from '../utils/timelineMath';
import './Timeline.css';

const TRACK_LABEL_WIDTH = 72;
const TRACK_HEIGHT = 32;
const RULER_HEIGHT = 26;
const OVERVIEW_HEIGHT = 56;
const SNAP_INTERVAL = 0.1;

interface TimelineProps {
  duration: number;
  exportDuration?: number;
  clips: TimelineClip[];
  mediaAssets: MediaAsset[];
  playhead: number;
  isPlaying: boolean;
  hasVideo: boolean;
  selectedClipId: string | null;
  onPlayheadSeek: (time: number) => void;
  onSeekAndPlay: (time: number) => void;
  onTogglePlay: () => void;
  onSkipStart: () => void;
  onSkipEnd: () => void;
  onClipMove: (clipId: string, newStartTime: number) => void;
  onSelectClip: (clipId: string | null) => void;
  onPlaceClip: (track: OverlayTrack, assetId: string, startTime: number) => void;
  onAddClip: () => void;
  timelapseSegments: TimelapseSegment[];
  timelapseModeActive: boolean;
  timelapsePendingStart: number | null;
  diagramModeActive: boolean;
  onTimelapseClick: (time: number) => void;
  /** Phase 1: hide B-roll editing controls */
  phase1?: boolean;
}

export function Timeline({
  duration,
  exportDuration,
  clips,
  mediaAssets,
  playhead,
  isPlaying,
  hasVideo,
  selectedClipId,
  onPlayheadSeek,
  onSeekAndPlay,
  onTogglePlay,
  onSkipStart,
  onSkipEnd,
  onClipMove,
  onSelectClip,
  onPlaceClip,
  onAddClip,
  timelapseSegments,
  timelapseModeActive,
  timelapsePendingStart,
  diagramModeActive,
  onTimelapseClick,
  phase1 = false,
}: TimelineProps) {
  const [zoom, setZoom] = useState(2);
  const [laneWidth, setLaneWidth] = useState(100);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(duration);
  const [scrollLeftPx, setScrollLeftPx] = useState(0);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [detailHovered, setDetailHovered] = useState(false);

  const detailRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overviewLaneRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ clipId: string; startX: number; origStart: number } | null>(null);
  const overviewDragRef = useRef<{ startX: number; origScrollLeft: number } | null>(null);
  const scrubbingRef = useRef(false);
  const pendingMoveRef = useRef<{ clipId: string; startTime: number } | null>(null);
  const rafMoveRef = useRef<number>(0);
  const rafViewRef = useRef<number>(0);
  const zoomRef = useRef(zoom);
  const playheadRef = useRef(playhead);
  const durationRef = useRef(duration);
  const minZoomRef = useRef(2);
  const maxZoomRef = useRef(ABSOLUTE_MAX_ZOOM);
  const detailHoveredRef = useRef(false);
  const prevDurationRef = useRef(duration);
  const prevLaneWidthRef = useRef(laneWidth);
  const wasFitZoomRef = useRef(true);

  const mainClip = clips.find((c) => c.track === 'main');
  const visibleTracks = useMemo(
    () =>
      getVisibleOverlayTracks({
        clips,
        timelapseSegments,
        timelapseModeActive,
        diagramModeActive,
      }),
    [clips, timelapseSegments, timelapseModeActive, diagramModeActive]
  );

  const clipsByTrack = useMemo(() => {
    const map = {} as Partial<Record<OverlayTrack, TimelineClip[]>>;
    for (const track of visibleTracks) {
      if (track !== 'timelapse') {
        map[track] = clips.filter((c) => c.track === track);
      }
    }
    return map;
  }, [clips, visibleTracks]);

  const overlayClips = useMemo(
    () => clips.filter((c) => c.track !== 'main'),
    [clips]
  );
  const timelineDuration = resolveTimelineDuration(duration, clips);

  zoomRef.current = zoom;
  playheadRef.current = playhead;
  durationRef.current = timelineDuration;

  const fitZoom = timelineDuration > 0 ? getFitZoom(timelineDuration, laneWidth) : 2;
  const maxZoom = timelineDuration > 0 ? getMaxZoom(timelineDuration) : ABSOLUTE_MAX_ZOOM;
  minZoomRef.current = fitZoom;
  maxZoomRef.current = maxZoom;

  const timelineWidth = timelineWidthPx(timelineDuration, zoom, laneWidth);
  const timeToPx = (t: number) => t * zoom;
  const pxToTime = (px: number) => px / zoom;

  const getAssetName = (assetId: string) => {
    const asset = mediaAssets.find((a) => a.id === assetId);
    return asset?.friendlyName ?? 'Clip';
  };

  const getMaxScroll = useCallback(() => {
    return Math.max(0, timelineWidth - laneWidth);
  }, [timelineWidth, laneWidth]);

  const updateViewRange = useCallback(() => {
    const el = scrollRef.current;
    const dur = durationRef.current;
    const z = zoomRef.current;
    if (!el || dur <= 0) {
      setViewStart(0);
      setViewEnd(dur);
      setScrollLeftPx(0);
      return;
    }
    const laneW = Math.max(el.clientWidth - TRACK_LABEL_WIDTH, 1);
    const scroll = el.scrollLeft;
    const start = scroll / z;
    const end = start + laneW / z;
    setScrollLeftPx(scroll);
    setViewStart(Math.max(0, start));
    setViewEnd(Math.min(dur, end));
  }, []);

  const scheduleViewRangeUpdate = useCallback(() => {
    if (rafViewRef.current) return;
    rafViewRef.current = requestAnimationFrame(() => {
      rafViewRef.current = 0;
      updateViewRange();
    });
  }, [updateViewRange]);

  const fitToView = useCallback(() => {
    const el = scrollRef.current;
    const dur = durationRef.current;
    if (dur <= 0) return;

    const lw = el ? Math.max(el.clientWidth - TRACK_LABEL_WIDTH, 100) : laneWidth;
    const fit = getFitZoom(dur, lw);
    wasFitZoomRef.current = true;

    if (el) {
      el.scrollLeft = 0;
    }

    setLaneWidth(lw);
    setZoom(fit);
    setScrollLeftPx(0);
    setViewStart(0);
    setViewEnd(dur);
    scheduleViewRangeUpdate();
  }, [laneWidth, scheduleViewRangeUpdate]);

  const clientXToTime = useCallback(
    (clientX: number) => {
      if (!scrollRef.current) return 0;
      const rect = scrollRef.current.getBoundingClientRect();
      const x = clientX - rect.left + scrollRef.current.scrollLeft - TRACK_LABEL_WIDTH;
      return Math.max(0, Math.min(timelineDuration, pxToTime(x)));
    },
    [timelineDuration, zoom]
  );

  const snapTime = (t: number) => Math.round(t / SNAP_INTERVAL) * SNAP_INTERVAL;

  const scrollDetailToTime = useCallback(
    (time: number, center = true) => {
      const el = scrollRef.current;
      if (!el || timelineDuration <= 0) return;
      const target = center ? time * zoom - laneWidth / 2 : time * zoom;
      el.scrollLeft = Math.max(0, Math.min(target, getMaxScroll()));
      scheduleViewRangeUpdate();
    },
    [timelineDuration, zoom, laneWidth, getMaxScroll, scheduleViewRangeUpdate]
  );

  const handleScrubStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.overlay-clip')) return;
    if ((e.target as HTMLElement).closest('.timelapse-region')) return;

    const time = snapTime(clientXToTime(e.clientX));

    if (timelapseModeActive) {
      onTimelapseClick(time);
      return;
    }

    scrubbingRef.current = true;
    onSeekAndPlay(time);
  };

  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip) => {
    if (clip.track === 'main') return;
    e.stopPropagation();
    e.preventDefault();
    onSelectClip(clip.id);
    setDraggingClipId(clip.id);
    draggingRef.current = {
      clipId: clip.id,
      startX: e.clientX,
      origStart: clip.startTime,
    };
  };

  const handleTrackDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(MEDIA_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleTrackDrop = (e: React.DragEvent, track: OverlayTrack) => {
    if (track === 'timelapse') return;
    const raw = e.dataTransfer.getData(MEDIA_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const payload = JSON.parse(raw) as { assetId: string; category: OverlayTrack };
      if (payload.category !== track) return;
      const time = snapTime(clientXToTime(e.clientX));
      onPlaceClip(track, payload.assetId, time);
    } catch {
      // ignore malformed drag payload
    }
  };

  const handleOverviewMouseDown = (e: React.MouseEvent) => {
    if (timelineDuration <= 0 || !overviewLaneRef.current) return;
    if ((e.target as HTMLElement).closest('.overview-viewport')) return;

    const rect = overviewLaneRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * timelineDuration;
    scrollDetailToTime(time, true);
    onSeekAndPlay(snapTime(time));
  };

  const handleOverviewViewportMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    overviewDragRef.current = {
      startX: e.clientX,
      origScrollLeft: scrollRef.current?.scrollLeft ?? 0,
    };
  };

  const flushPendingMove = useCallback(() => {
    if (pendingMoveRef.current) {
      onClipMove(pendingMoveRef.current.clipId, pendingMoveRef.current.startTime);
      pendingMoveRef.current = null;
    }
  }, [onClipMove]);

  const scheduleClipMove = useCallback(
    (clipId: string, startTime: number) => {
      pendingMoveRef.current = { clipId, startTime };
      if (!rafMoveRef.current) {
        rafMoveRef.current = requestAnimationFrame(() => {
          rafMoveRef.current = 0;
          flushPendingMove();
        });
      }
    },
    [flushPendingMove]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (overviewDragRef.current && overviewLaneRef.current && scrollRef.current) {
        const laneW = overviewLaneRef.current.clientWidth;
        const dur = durationRef.current;
        const z = zoomRef.current;
        const detailLaneW = Math.max(scrollRef.current.clientWidth - TRACK_LABEL_WIDTH, 1);
        const maxScroll = Math.max(0, dur * z - detailLaneW);
        const deltaX = e.clientX - overviewDragRef.current.startX;
        const deltaScroll = (deltaX / laneW) * dur * z;
        scrollRef.current.scrollLeft = Math.max(
          0,
          Math.min(overviewDragRef.current.origScrollLeft + deltaScroll, maxScroll)
        );
        scheduleViewRangeUpdate();
        return;
      }

      if (scrubbingRef.current) {
        onPlayheadSeek(snapTime(clientXToTime(e.clientX)));
        return;
      }

      if (draggingRef.current) {
        const drag = draggingRef.current;
        const clip = clips.find((c) => c.id === drag.clipId);
        if (!clip) return;
        const deltaX = e.clientX - drag.startX;
        const deltaTime = deltaX / zoomRef.current;
        let newStart = drag.origStart + deltaTime;
        newStart = Math.max(0, Math.min(newStart, durationRef.current - clip.duration));
        scheduleClipMove(drag.clipId, newStart);
      }
    },
    [clips, clientXToTime, onPlayheadSeek, scheduleClipMove, scheduleViewRangeUpdate]
  );

  const handleMouseUp = useCallback(() => {
    if (overviewDragRef.current) overviewDragRef.current = null;
    if (draggingRef.current) {
      const drag = draggingRef.current;
      const clip = clips.find((c) => c.id === drag.clipId);
      if (clip && pendingMoveRef.current) {
        const snapped = snapTime(pendingMoveRef.current.startTime);
        const clamped = Math.max(0, Math.min(snapped, durationRef.current - clip.duration));
        onClipMove(drag.clipId, clamped);
        pendingMoveRef.current = null;
      }
      setDraggingClipId(null);
    }
    draggingRef.current = null;
    scrubbingRef.current = false;
  }, [clips, onClipMove]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafMoveRef.current) cancelAnimationFrame(rafMoveRef.current);
      if (rafViewRef.current) cancelAnimationFrame(rafViewRef.current);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (!hasVideo || timelineDuration <= 0) return;
    const durationChanged = prevDurationRef.current !== timelineDuration;
    const laneChanged = Math.abs(prevLaneWidthRef.current - laneWidth) > 2;

    if (durationChanged || (laneChanged && wasFitZoomRef.current)) {
      const fit = getFitZoom(timelineDuration, laneWidth);
      wasFitZoomRef.current = true;
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
      setZoom(fit);
      setScrollLeftPx(0);
      setViewStart(0);
      setViewEnd(timelineDuration);
      prevDurationRef.current = timelineDuration;
      prevLaneWidthRef.current = laneWidth;
      scheduleViewRangeUpdate();
      return;
    }

    prevLaneWidthRef.current = laneWidth;
  }, [hasVideo, timelineDuration, laneWidth, scheduleViewRangeUpdate]);

  // Clamp zoom when duration or viewport changes
  useEffect(() => {
    const clamped = clampZoom(zoom, timelineDuration, laneWidth);
    if (Math.abs(clamped - zoom) > 0.01) setZoom(clamped);
  }, [timelineDuration, zoom, laneWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const measureLane = () => {
      const w = Math.max(el.clientWidth - TRACK_LABEL_WIDTH, 100);
      setLaneWidth(w);
    };

    measureLane();
    const onScroll = () => scheduleViewRangeUpdate();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      measureLane();
      scheduleViewRangeUpdate();
    });
    ro.observe(el);
    scheduleViewRangeUpdate();
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scheduleViewRangeUpdate, zoom]);

  const applyZoomAtPoint = useCallback(
    (newZoom: number, clientX: number) => {
      const el = scrollRef.current;
      if (!el) return;

      const oldZoom = zoomRef.current;
      const lw = Math.max(el.clientWidth - TRACK_LABEL_WIDTH, 100);
      const clamped = clampZoom(newZoom, durationRef.current, lw);
      if (Math.abs(clamped - oldZoom) < 0.01) return;

      const rect = el.getBoundingClientRect();
      const laneLeft = rect.left + TRACK_LABEL_WIDTH;

      let timeAtAnchor: number;
      if (clientX < laneLeft) {
        timeAtAnchor = playheadRef.current;
      } else {
        const cursorInLane = clientX - laneLeft + el.scrollLeft;
        timeAtAnchor = cursorInLane / oldZoom;
      }

      wasFitZoomRef.current = Math.abs(clamped - getFitZoom(durationRef.current, lw)) < 0.02;
      setZoom(clamped);

      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        const laneCursor = clientX - laneLeft;
        scrollRef.current.scrollLeft = Math.max(0, timeAtAnchor * clamped - laneCursor);
        scheduleViewRangeUpdate();
      });
    },
    [scheduleViewRangeUpdate]
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!detailHoveredRef.current || !scrollRef.current) return;

      const el = scrollRef.current;

      if (isTimelinePanWheel(e)) {
        e.preventDefault();
        e.stopPropagation();
        const delta = getTimelinePanDelta({
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          shiftKey: e.shiftKey,
          clientHeight: el.clientHeight,
        });
        const detailLaneW = Math.max(el.clientWidth - TRACK_LABEL_WIDTH, 1);
        const maxScroll = Math.max(0, durationRef.current * zoomRef.current - detailLaneW);
        el.scrollLeft = Math.max(0, Math.min(el.scrollLeft + delta, maxScroll));
        scheduleViewRangeUpdate();
        return;
      }

      if (Math.abs(e.deltaY) < 0.5) return;

      e.preventDefault();
      e.stopPropagation();

      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= el.clientHeight;

      wasFitZoomRef.current = false;
      const factor = Math.exp(-delta * 0.003);
      applyZoomAtPoint(zoomRef.current * factor, e.clientX);
    },
    [applyZoomAtPoint, scheduleViewRangeUpdate]
  );

  useEffect(() => {
    const detail = detailRef.current;
    const scroll = scrollRef.current;
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    const targets = [detail, scroll].filter((t): t is HTMLDivElement => t !== null);

    for (const target of targets) {
      target.addEventListener('wheel', handleWheel, opts);
    }
    return () => {
      for (const target of targets) {
        target.removeEventListener('wheel', handleWheel, opts);
      }
    };
  }, [handleWheel]);

  const rulerMarks = useMemo(
    () =>
      buildRulerMarks({
        duration: timelineDuration,
        zoom,
        viewStart,
        viewEnd,
        scrollLeft: scrollLeftPx,
        visibleLaneWidth: laneWidth,
        minLabelSpacingPx: 88,
      }),
    [timelineDuration, zoom, viewStart, viewEnd, scrollLeftPx, laneWidth]
  );

  const viewLeftPct = timelineDuration > 0 ? (viewStart / timelineDuration) * 100 : 0;
  const viewWidthPct =
    timelineDuration > 0 ? ((viewEnd - viewStart) / timelineDuration) * 100 : 100;
  const playheadPct = timelineDuration > 0 ? (playhead / timelineDuration) * 100 : 0;

  const pct = (t: number) => (timelineDuration > 0 ? (t / timelineDuration) * 100 : 0);
  const pctWidth = (d: number) => (timelineDuration > 0 ? (d / timelineDuration) * 100 : 0);

  const hasTimelapseBake =
    exportDuration != null &&
    exportDuration > 0 &&
    Math.abs(exportDuration - timelineDuration) > 0.5;
  const timeSaved =
    hasTimelapseBake && exportDuration != null
      ? Math.max(0, timelineDuration - exportDuration)
      : 0;
  return (
    <div className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <div className="timeline-transport">
            <button
              type="button"
              className="transport-btn"
              onClick={onSkipStart}
              disabled={!hasVideo}
              title="Go to start"
            >
              ⏮
            </button>
            <button
              type="button"
              className="transport-btn transport-btn-play"
              onClick={onTogglePlay}
              disabled={!hasVideo}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="transport-btn"
              onClick={onSkipEnd}
              disabled={!hasVideo}
              title="Go to end"
            >
              ⏭
            </button>
            <span className="transport-time">
              {formatTransportTime(playhead)} / {formatTransportTime(timelineDuration)}
              {exportDuration &&
                exportDuration > 0 &&
                Math.abs(exportDuration - timelineDuration) > 0.5 && (
                  <span className="transport-export-duration" title="Length after timelapse export">
                    {' '}
                    → {formatTransportTime(exportDuration)} export
                  </span>
                )}
            </span>
          </div>
          <span className="timeline-title">Timeline</span>
          {hasTimelapseBake && (
            <div
              className="timeline-bake-info ready"
              title="Export length after timelapse — final bake runs on Export MP4 only"
            >
              <span className="timeline-bake-durations">
                <span className="timeline-bake-source">
                  Source {formatTransportTime(timelineDuration)}
                </span>
                <span className="timeline-bake-arrow">→</span>
                <span className="timeline-bake-export">
                  Export {formatTransportTime(exportDuration!)}
                </span>
                {timeSaved >= 1 && (
                  <span className="timeline-bake-saved">
                    (−{formatTransportTime(timeSaved)})
                  </span>
                )}
              </span>
            </div>
          )}
          {!phase1 && (
            <button type="button" className="btn btn-sm btn-accent" onClick={onAddClip}>
              + Add B-Roll at Playhead
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={fitToView}
            disabled={!hasVideo}
            title="Show full video length"
          >
            Fit to View
          </button>
        </div>
        {detailHovered && hasVideo && (
          <span className="timeline-zoom-hint">Scroll to zoom · Shift+scroll to pan</span>
        )}
      </div>

      <div className="timeline-overview">
        <div className="overview-label" style={{ width: TRACK_LABEL_WIDTH }}>
          OVERVIEW
        </div>
        <div
          className="overview-lane"
          ref={overviewLaneRef}
          style={{ height: OVERVIEW_HEIGHT }}
          onMouseDown={handleOverviewMouseDown}
          onDoubleClick={fitToView}
          title="Click to play · Drag window to pan · Double-click to fit"
        >
          {mainClip && timelineDuration > 0 && (
            <div
              className="overview-clip overview-clip-main"
              style={{ left: '0%', width: '100%' }}
            />
          )}
          {overlayClips.map((clip) => (
            <div
              key={clip.id}
              className={`overview-clip overview-clip-${clip.track}`}
              style={{ left: `${pct(clip.startTime)}%`, width: `${pctWidth(clip.duration)}%` }}
            />
          ))}
          {timelapseSegments.map((seg) => (
            <div
              key={seg.id}
              className="overview-clip overview-clip-timelapse"
              style={{
                left: `${pct(seg.startTime)}%`,
                width: `${pctWidth(seg.endTime - seg.startTime)}%`,
              }}
            />
          ))}
          <div className="overview-playhead" style={{ left: `${playheadPct}%` }} />
          <div
            className="overview-viewport"
            style={{ left: `${viewLeftPct}%`, width: `${Math.max(viewWidthPct, 0.5)}%` }}
            onMouseDown={handleOverviewViewportMouseDown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              fitToView();
            }}
          />
        </div>
      </div>

      <div
        className="timeline-detail"
        ref={detailRef}
        onMouseEnter={() => {
          detailHoveredRef.current = true;
          setDetailHovered(true);
        }}
        onMouseLeave={() => {
          detailHoveredRef.current = false;
          setDetailHovered(false);
        }}
        title={
          timelapseModeActive
            ? 'Timelapse mode — click to mark in/out points'
            : 'Scroll wheel to zoom · Click to play'
        }
      >
        <div className="timeline-scroll" ref={scrollRef} onMouseDown={handleScrubStart}>
          <div className="timeline-inner" style={{ width: timelineWidth + TRACK_LABEL_WIDTH }}>
            <div className="timeline-ruler-row" style={{ height: RULER_HEIGHT }}>
              <div className="track-label-spacer" style={{ width: TRACK_LABEL_WIDTH }} />
              <div className="timeline-ruler" style={{ width: timelineWidth }}>
                {rulerMarks.map((mark, i) => {
                  const px = timeToPx(mark.time);
                  const alignClass =
                    mark.labelAlign === 'start'
                      ? ' ruler-label-start'
                      : mark.labelAlign === 'end'
                        ? ' ruler-label-end'
                        : ' ruler-label-center';
                  return (
                    <div
                      key={`${i}-${mark.time}-${mark.kind}`}
                      className={`ruler-mark ruler-mark-${mark.kind}`}
                      style={{ left: px }}
                    >
                      {mark.label && (
                        <span className={`ruler-label${alignClass}`}>{mark.label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="timeline-track-row">
              <div className="track-label" style={{ width: TRACK_LABEL_WIDTH, height: TRACK_HEIGHT }}>
                MAIN
              </div>
              <div
                className="track-lane main-track"
                style={{ width: timelineWidth, height: TRACK_HEIGHT }}
              >
                {mainClip && timelineDuration > 0 && (
                  <div
                    className="timeline-clip main-clip"
                    style={{
                      left: timeToPx(mainClip.startTime),
                      width: timeToPx(timelineDuration - mainClip.startTime),
                    }}
                  >
                    <span className="clip-label">MAIN VIDEO</span>
                  </div>
                )}
              </div>
            </div>

            {visibleTracks.map((track) => {
              const display = TRACK_DISPLAY_CONFIG[track];
              const trackClips = track === 'timelapse' ? [] : (clipsByTrack[track] ?? []);
              const libConfig =
                track !== 'timelapse' ? CONTENT_LIBRARY_CONFIG[track] : null;

              return (
                <div className="timeline-track-row" key={track}>
                  <div
                    className="track-label"
                    style={{ width: TRACK_LABEL_WIDTH, height: TRACK_HEIGHT }}
                  >
                    {display.shortLabel.toUpperCase()}
                  </div>
                  <div
                    className={`track-lane ${display.trackClass}-track ${timelapseModeActive && track === 'timelapse' ? 'timelapse-mode-lane' : ''}`}
                    style={{ width: timelineWidth, height: TRACK_HEIGHT }}
                    onDragOver={track !== 'timelapse' ? handleTrackDragOver : undefined}
                    onDrop={track !== 'timelapse' ? (e) => handleTrackDrop(e, track) : undefined}
                  >
                    {track === 'timelapse' ? (
                      <>
                        {timelapseSegments.map((seg) => (
                          <div
                            key={seg.id}
                            className="timeline-clip timelapse-region overlay-clip timelapse-clip"
                            style={{
                              left: timeToPx(seg.startTime),
                              width: Math.max(timeToPx(seg.endTime - seg.startTime), 8),
                            }}
                            title={`${seg.speedFactor}× timelapse`}
                          >
                            <span className="clip-label">{seg.speedFactor}×</span>
                          </div>
                        ))}
                        {timelapsePendingStart !== null && (
                          <div
                            className="timelapse-pending-marker"
                            style={{ left: timeToPx(timelapsePendingStart) }}
                          />
                        )}
                      </>
                    ) : (
                      trackClips.map((clip) => (
                        <div
                          key={clip.id}
                          className={`timeline-clip overlay-clip ${libConfig?.trackClass}-clip ${selectedClipId === clip.id ? 'selected' : ''} ${draggingClipId === clip.id ? 'dragging' : ''}`}
                          style={{
                            left: timeToPx(clip.startTime),
                            width: Math.max(timeToPx(clip.duration), 8),
                          }}
                          onMouseDown={(e) => handleClipMouseDown(e, clip)}
                        >
                          <span className="clip-label">{getAssetName(clip.assetId)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}

            <div
              className="playhead-line-full"
              style={{ left: TRACK_LABEL_WIDTH + timeToPx(playhead) }}
            >
              <div className="playhead-head" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTransportTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

