import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaAsset, TimelineClip } from '../types/project';
import {
  clampTime,
  getActiveDiagramAt,
  getActiveFullFrameAt,
  getPlaybackRateAt,
  localTimeInClip,
  type ActiveMediaClip,
} from '../utils/playback';
import {
  frameNudgeAtRate,
  justExitedTimelapse,
  needsUltraPlayback,
  resolveNativePlaybackRate,
  timelapsePlaybackKey,
  timelapseWallTargetTime,
  wallClockSourceTime,
} from '../utils/timelapsePlayback';
import type { TimelapseSegment } from '../types/timelapse';
import {
  bakedTimeToSourceTime,
  getNextTimelapseSegmentAfter,
  getTimelapseSegmentAt,
  sourceTimeToBakedTime,
} from '../types/timelapse';
import { PhoneUploadPanel } from './PhoneUploadPanel';
import './VideoPreview.css';

const UI_TICK_INTERVAL_MS = 50;
const TIMELAPSE_UI_TICK_INTERVAL_MS = 33;
const DIAGRAM_SYNC_INTERVAL_MS = 250;
const STALL_DETECT_MS = 80;
const TIMELAPSE_HARD_RECOVERY_MS = 400;
const END_TOLERANCE_SECONDS = 0.25;
const ENDED_RECOVERY_DEBOUNCE_MS = 40;
/** 32× only — video plays at 16× native; seek when wall-clock playhead drifts ahead. */
const ULTRA_CATCH_UP_DRIFT_SECONDS = 0.45;
const ULTRA_SEEK_INTERVAL_MS = 120;
/** Minimum playhead change to treat as a timeline click/scrub (vs video-driven tick). */
const USER_SCRUB_MIN_DELTA_SECONDS = 0.05;

interface VideoPreviewProps {
  mainVideoUrl: string | null;
  previewVideoUrl?: string | null;
  useBakedPreview?: boolean;
  mainVideoDuration: number;
  bakedPreviewDuration?: number;
  exportDuration?: number;
  mediaAssets: MediaAsset[];
  timelineClips: TimelineClip[];
  timelapseSegments: TimelapseSegment[];
  playhead: number;
  isPlaying: boolean;
  isImporting?: boolean;
  isDragOver?: boolean;
  phoneUploadOpen?: boolean;
  onImportClick?: () => void;
  onPhoneUploadOpen?: () => void;
  onPhoneUploadClose?: () => void;
  onPlayheadTick: (time: number) => void;
  onMainDurationReady: (duration: number) => void;
  onEnded: () => void;
}

export function VideoPreview({
  mainVideoUrl,
  previewVideoUrl,
  useBakedPreview = false,
  mainVideoDuration,
  bakedPreviewDuration = 0,
  exportDuration,
  mediaAssets,
  timelineClips,
  timelapseSegments,
  playhead,
  isPlaying,
  isImporting = false,
  isDragOver = false,
  phoneUploadOpen = false,
  onImportClick,
  onPhoneUploadOpen,
  onPhoneUploadClose,
  onPlayheadTick,
  onMainDurationReady,
  onEnded,
}: VideoPreviewProps) {
  const mainRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const diagramVideoRef = useRef<HTMLVideoElement>(null);
  const playheadRef = useRef(playhead);
  const isPlayingRef = useRef(isPlaying);
  const lastSyncedPlayheadRef = useRef(-1);
  const timelapseSegmentsRef = useRef(timelapseSegments);
  const timelineClipsRef = useRef(timelineClips);
  const mediaAssetsRef = useRef(mediaAssets);
  const durationRef = useRef(mainVideoDuration);
  const playheadFromVideoRef = useRef(false);
  const overlayPlaybackRef = useRef(false);
  const activeOverlayRef = useRef<ActiveMediaClip | null>(null);
  const overlayWallStartRef = useRef(0);
  const activePlaybackKeyRef = useRef<string>('normal');
  const activeEffectiveRateRef = useRef(1);
  const ultraWallStartRef = useRef(0);
  const ultraSourceAnchorRef = useRef(0);
  const lastUiTickRef = useRef(0);
  const prevVideoTimeRef = useRef(-1);
  const playbackStartedRef = useRef(false);
  const lastDiagramSyncMsRef = useRef(0);
  const lastVideoAdvanceMsRef = useRef(0);
  const lastVideoAdvanceTRef = useRef(-1);
  const lastEndedRecoveryMsRef = useRef(0);
  const lastUltraSeekMsRef = useRef(0);
  const maintainPlaybackRef = useRef<() => void>(() => {});
  const useBakedPreviewRef = useRef(useBakedPreview);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayMedia, setOverlayMedia] = useState<{
    url: string;
    mediaType: 'video' | 'image';
    name: string;
  } | null>(null);

  const syncPausedToPlayheadRef = useRef<(time: number) => void>(() => {});
  const seekDuringPlaybackRef = useRef<(time: number) => void>(() => {});
  const handoffToOverlayRef = useRef<(time: number, clip: ActiveMediaClip) => void>(() => {});
  const startMainPlaybackRef = useRef<(time: number) => void>(() => {});
  const clearOverlayPlaybackRef = useRef<() => void>(() => {});
  const syncDiagramElementRef =
    useRef<(time: number, playing: boolean, force?: boolean) => void>(() => {});
  const ensureMainRateOneRef = useRef<(video: HTMLVideoElement) => void>(() => {});
  const tickMainRef = useRef<(time: number) => void>(() => {});

  if (!isPlaying) {
    playheadRef.current = playhead;
  }
  isPlayingRef.current = isPlaying;
  timelapseSegmentsRef.current = timelapseSegments;
  timelineClipsRef.current = timelineClips;
  mediaAssetsRef.current = mediaAssets;
  durationRef.current = mainVideoDuration;
  useBakedPreviewRef.current = useBakedPreview;

  const activePreviewUrl = previewVideoUrl ?? mainVideoUrl;

  const mapSourceToBaked = useCallback((sourceTime: number) => {
    return sourceTimeToBakedTime(sourceTime, timelapseSegmentsRef.current);
  }, []);

  const mapBakedToSource = useCallback((bakedTime: number) => {
    return bakedTimeToSourceTime(bakedTime, timelapseSegmentsRef.current, durationRef.current);
  }, []);

  const activeFullFrame = getActiveFullFrameAt(playhead, timelineClips, mediaAssets);
  const activeDiagram = getActiveDiagramAt(playhead, timelineClips, mediaAssets);
  const activeTimelapse = getTimelapseSegmentAt(playhead, timelapseSegments);
  const showingImageOverlay = overlayVisible && overlayMedia?.mediaType === 'image';

  const publishPlayhead = useCallback(
    (time: number, forceUi = false, inTimelapse = false) => {
      playheadRef.current = time;

      const now = performance.now();
      const tickInterval = inTimelapse ? TIMELAPSE_UI_TICK_INTERVAL_MS : UI_TICK_INTERVAL_MS;
      if (!forceUi && now - lastUiTickRef.current < tickInterval) return;

      lastUiTickRef.current = now;
      lastSyncedPlayheadRef.current = time;
      playheadFromVideoRef.current = true;
      onPlayheadTick(time);
    },
    [onPlayheadTick]
  );

  const ensureMainRateOne = useCallback((video: HTMLVideoElement) => {
    if (video.playbackRate !== 1) video.playbackRate = 1;
    if (!video.preservesPitch) video.preservesPitch = true;
  }, []);

  const resumeMainIfNeeded = useCallback((video: HTMLVideoElement) => {
    if (isPlayingRef.current && video.paused && !overlayPlaybackRef.current) {
      video.play().catch(() => {});
    }
  }, []);

  const seekVideo = useCallback((video: HTMLVideoElement, time: number) => {
    if (!Number.isFinite(time) || time < 0) return;
    const max =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 0.033 : time;
    const target = Math.min(time, max);
    if (Math.abs(video.currentTime - target) <= 0.025) return;
    if (typeof video.fastSeek === 'function') {
      try {
        video.fastSeek(target);
        return;
      } catch {
        // fall through
      }
    }
    video.currentTime = target;
  }, []);

  const clearUltraRefs = useCallback(() => {
    ultraWallStartRef.current = 0;
    ultraSourceAnchorRef.current = 0;
  }, []);

  const startUltraAnchors = useCallback((sourceTime: number) => {
    ultraWallStartRef.current = performance.now();
    ultraSourceAnchorRef.current = sourceTime;
  }, []);

  const applyPlaybackState = useCallback(
    (video: HTMLVideoElement, seg: TimelapseSegment | null, sourceTime: number) => {
      if (useBakedPreviewRef.current) {
        clearUltraRefs();
        activeEffectiveRateRef.current = 1;
        video.preservesPitch = true;
        video.playbackRate = 1;
        return;
      }
      if (!seg || seg.speedFactor <= 1) {
        clearUltraRefs();
        activeEffectiveRateRef.current = 1;
        video.preservesPitch = true;
        video.playbackRate = 1;
        video.muted = false;
        return;
      }

      // Seek-driven timelapse: 1× decode + wall-clock playhead (matches export; avoids frozen video + fast audio).
      video.preservesPitch = true;
      video.playbackRate = 1;
      video.muted = true;
      activeEffectiveRateRef.current = 1;
      startUltraAnchors(sourceTime);
    },
    [clearUltraRefs, startUltraAnchors]
  );

  /** Wall-clock source time during timelapse — video seeks to catch up at 1× decode. */
  const getPublishTime = useCallback((video: HTMLVideoElement, nowMs: number): number => {
    const videoT = video.currentTime;
    const logical = Math.max(videoT, playheadRef.current);
    let seg = getTimelapseSegmentAt(logical, timelapseSegmentsRef.current);

    if ((!seg || seg.speedFactor <= 1) && ultraWallStartRef.current > 0) {
      seg = getTimelapseSegmentAt(ultraSourceAnchorRef.current, timelapseSegmentsRef.current);
    }

    if (!seg || seg.speedFactor <= 1) {
      return Math.max(videoT, logical);
    }

    if (ultraWallStartRef.current > 0) {
      if (needsUltraPlayback(seg.speedFactor)) {
        return timelapseWallTargetTime(
          seg,
          ultraSourceAnchorRef.current,
          ultraWallStartRef.current,
          nowMs
        );
      }
      return wallClockSourceTime(
        ultraSourceAnchorRef.current,
        ultraWallStartRef.current,
        nowMs,
        timelapseSegmentsRef.current,
        durationRef.current
      );
    }

    return videoT;
  }, []);

  const runTimelapseCatchUp = useCallback(
    (video: HTMLVideoElement, nowMs: number): number => {
      const publishT = getPublishTime(video, nowMs);
      const seg =
        getTimelapseSegmentAt(publishT, timelapseSegmentsRef.current) ??
        getTimelapseSegmentAt(video.currentTime, timelapseSegmentsRef.current);
      if (!seg || seg.speedFactor <= 1) return publishT;

      const drift = publishT - video.currentTime;
      const driftThreshold = needsUltraPlayback(seg.speedFactor)
        ? ULTRA_CATCH_UP_DRIFT_SECONDS
        : 0.12;
      const seekInterval = needsUltraPlayback(seg.speedFactor)
        ? ULTRA_SEEK_INTERVAL_MS
        : 80;
      if (drift > driftThreshold && nowMs - lastUltraSeekMsRef.current >= seekInterval) {
        const seekTo = Math.min(publishT, seg.endTime - 0.033);
        seekVideo(video, seekTo);
        lastUltraSeekMsRef.current = nowMs;
        lastVideoAdvanceTRef.current = seekTo;
        lastVideoAdvanceMsRef.current = nowMs;
      }

      if (video.paused || video.ended) {
        video.play().catch(() => {});
      }

      return publishT;
    },
    [getPublishTime, seekVideo]
  );

  /** Apply rate/pitch only when segment or speed changes; resume after every change. */
  const syncPlaybackRate = useCallback(
    (video: HTMLVideoElement, sourceTime: number) => {
      if (useBakedPreviewRef.current) {
        if (activePlaybackKeyRef.current === 'baked') return;
        activePlaybackKeyRef.current = 'baked';
        applyPlaybackState(video, null, sourceTime);
        if (isPlayingRef.current && !overlayPlaybackRef.current) {
          video.play().catch(() => {});
        }
        return;
      }
      const seg = getTimelapseSegmentAt(sourceTime, timelapseSegmentsRef.current);
      const key = timelapsePlaybackKey(seg);
      if (key === activePlaybackKeyRef.current) return;

      activePlaybackKeyRef.current = key;
      applyPlaybackState(video, seg, sourceTime);

      if (isPlayingRef.current && !overlayPlaybackRef.current) {
        video.play().catch(() => {});
      }
    },
    [applyPlaybackState]
  );

  const forceSyncPlaybackRate = useCallback(
    (video: HTMLVideoElement, sourceTime: number) => {
      activePlaybackKeyRef.current = '';
      syncPlaybackRate(video, sourceTime);
    },
    [syncPlaybackRate]
  );

  const handleSegmentBoundary = useCallback(
    (video: HTMLVideoElement, prevT: number, currentT: number) => {
      if (prevT < 0 || !justExitedTimelapse(prevT, currentT, timelapseSegmentsRef.current)) {
        return;
      }

      const prevSeg = getTimelapseSegmentAt(prevT, timelapseSegmentsRef.current);
      const next = getNextTimelapseSegmentAfter(prevT, timelapseSegmentsRef.current);

      if (next && currentT >= next.startTime - 0.05) {
        const handoff = next.startTime + 0.001;
        if (Math.abs(video.currentTime - handoff) > 0.02) {
          seekVideo(video, handoff);
        }
        lastUltraSeekMsRef.current = 0;
        forceSyncPlaybackRate(video, handoff);
        lastVideoAdvanceTRef.current = handoff;
        playheadRef.current = handoff;
        video.play().catch(() => {});
        return;
      }

      if (prevSeg) {
        const resumeAt = Math.min(prevSeg.endTime + 0.001, durationRef.current - 0.033);
        clearUltraRefs();
        activePlaybackKeyRef.current = '';
        applyPlaybackState(video, null, resumeAt);
        seekVideo(video, resumeAt);
        lastVideoAdvanceTRef.current = resumeAt;
        playheadRef.current = resumeAt;
        video.play().catch(() => {});
      }
    },
    [seekVideo, forceSyncPlaybackRate, clearUltraRefs, applyPlaybackState]
  );

  /** Keep 1× decode during timelapse preview (wall-clock seeks drive the playhead). */
  const recoverDriftedRate = useCallback((video: HTMLVideoElement, sourceTime: number) => {
    const seg = getTimelapseSegmentAt(sourceTime, timelapseSegmentsRef.current);
    if (!seg || seg.speedFactor <= 1) {
      if (Math.abs(video.playbackRate - 1) > 0.01) {
        video.preservesPitch = true;
        video.playbackRate = 1;
        activeEffectiveRateRef.current = 1;
      }
      video.muted = false;
      return;
    }

    if (Math.abs(video.playbackRate - 1) > 0.01) {
      video.preservesPitch = true;
      video.playbackRate = 1;
      activeEffectiveRateRef.current = 1;
    }
    video.muted = true;
  }, []);

  const isNearTrueEnd = useCallback((logicalTime: number) => {
    return logicalTime >= durationRef.current - END_TOLERANCE_SECONDS;
  }, []);

  const isInTimelapseAt = useCallback((sourceTime: number) => {
    return getPlaybackRateAt(sourceTime, timelapseSegmentsRef.current) > 1;
  }, []);

  /** After a false `ended`, currentTime is unreliable — use the last known playhead. */
  const resumeAfterFalseEnded = useCallback(
    (video: HTMLVideoElement) => {
      const now = performance.now();
      if (now - lastEndedRecoveryMsRef.current < ENDED_RECOVERY_DEBOUNCE_MS) return true;
      lastEndedRecoveryMsRef.current = now;

      const logical = playheadRef.current;
      if (isNearTrueEnd(logical)) return false;

      const rate = getPlaybackRateAt(logical, timelapseSegmentsRef.current);
      let resumeAt = Math.min(
        logical + frameNudgeAtRate(Math.max(rate, 1)),
        durationRef.current - 0.033
      );

      const nextSeg = getNextTimelapseSegmentAfter(logical, timelapseSegmentsRef.current);
      if (nextSeg && resumeAt >= nextSeg.startTime - 0.02 && resumeAt < nextSeg.endTime) {
        resumeAt = Math.max(resumeAt, nextSeg.startTime + 0.001);
      }

      seekVideo(video, resumeAt);
      const resumeSeg = getTimelapseSegmentAt(resumeAt, timelapseSegmentsRef.current);
      if (resumeSeg && needsUltraPlayback(resumeSeg.speedFactor)) {
        startUltraAnchors(resumeAt);
        lastUltraSeekMsRef.current = 0;
      } else {
        clearUltraRefs();
      }

      forceSyncPlaybackRate(video, resumeAt);
      lastVideoAdvanceTRef.current = resumeAt;
      lastVideoAdvanceMsRef.current = now;
      prevVideoTimeRef.current = resumeAt;
      playheadRef.current = resumeAt;
      video.play().catch(() => {});
      return true;
    },
    [
      forceSyncPlaybackRate,
      isNearTrueEnd,
      startUltraAnchors,
      clearUltraRefs,
      seekVideo,
    ]
  );

  const playOverlayWhenReady = useCallback((overlay: HTMLVideoElement) => {
    const start = () => {
      if (!isPlayingRef.current || !overlayPlaybackRef.current) return;
      overlay.play().catch(() => {});
    };
    if (overlay.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      start();
      return;
    }
    const onReady = () => {
      overlay.removeEventListener('loadeddata', onReady);
      overlay.removeEventListener('canplay', onReady);
      start();
    };
    overlay.addEventListener('loadeddata', onReady);
    overlay.addEventListener('canplay', onReady);
  }, []);

  const syncOverlayElement = useCallback(
    (time: number, fullFrame: ActiveMediaClip) => {
      const overlay = overlayRef.current;
      if (!overlay || fullFrame.asset.mediaType !== 'video') return;
      overlay.playbackRate = 1;
      if (!overlay.preservesPitch) overlay.preservesPitch = true;
      seekVideo(overlay, localTimeInClip(time, fullFrame.clip));
    },
    [seekVideo]
  );

  const syncDiagramElement = useCallback(
    (time: number, playing: boolean, force = false) => {
      const now = performance.now();
      if (!force && now - lastDiagramSyncMsRef.current < DIAGRAM_SYNC_INTERVAL_MS) {
        return;
      }
      lastDiagramSyncMsRef.current = now;

      const diagram = diagramVideoRef.current;
      const active = getActiveDiagramAt(time, timelineClipsRef.current, mediaAssetsRef.current);
      if (!diagram || !active || active.asset.mediaType !== 'video') return;

      const local = localTimeInClip(time, active.clip);
      if (diagram.src !== active.asset.url) {
        diagram.src = active.asset.url;
        seekVideo(diagram, local);
      } else if (force || Math.abs(diagram.currentTime - local) > 0.25) {
        seekVideo(diagram, local);
      }

      if (playing) diagram.play().catch(() => {});
      else diagram.pause();
    },
    [seekVideo]
  );

  const clearOverlayPlayback = useCallback(() => {
    overlayPlaybackRef.current = false;
    activeOverlayRef.current = null;
    overlayWallStartRef.current = 0;
    setOverlayVisible(false);
    setOverlayMedia(null);
    overlayRef.current?.pause();
  }, []);

  const pauseMain = useCallback(
    (main: HTMLVideoElement) => {
      main.pause();
      ensureMainRateOne(main);
    },
    [ensureMainRateOne]
  );

  const handoffToOverlay = useCallback(
    (time: number, fullFrame: ActiveMediaClip) => {
      const main = mainRef.current;
      if (!main || overlayPlaybackRef.current) return;
      if (activeOverlayRef.current?.clip.id === fullFrame.clip.id && overlayVisible) {
        return;
      }

      overlayPlaybackRef.current = true;
      activeOverlayRef.current = fullFrame;
      overlayWallStartRef.current = performance.now();
      setOverlayMedia({
        url: fullFrame.asset.url,
        mediaType: fullFrame.asset.mediaType,
        name: fullFrame.asset.friendlyName,
      });
      setOverlayVisible(true);
      pauseMain(main);

      if (fullFrame.asset.mediaType === 'video') {
        syncOverlayElement(time, fullFrame);
        if (overlayRef.current) {
          playOverlayWhenReady(overlayRef.current);
        }
      }

      publishPlayhead(time, true, false);
    },
    [syncOverlayElement, publishPlayhead, pauseMain, playOverlayWhenReady, overlayVisible]
  );

  const resumeMainAfterOverlay = useCallback(
    (time: number) => {
      const main = mainRef.current;
      if (!main) return;

      clearOverlayPlayback();
      prevVideoTimeRef.current = time;
      lastVideoAdvanceTRef.current = time;
      lastVideoAdvanceMsRef.current = performance.now();

      if (useBakedPreviewRef.current) {
        seekVideo(main, mapSourceToBaked(time));
        ensureMainRateOne(main);
      } else {
        clearUltraRefs();
        if (Math.abs(main.currentTime - time) > 0.08) {
          seekVideo(main, time);
        }
        forceSyncPlaybackRate(main, time);
      }
      main.play().catch(() => {});
    },
    [
      seekVideo,
      forceSyncPlaybackRate,
      clearOverlayPlayback,
      mapSourceToBaked,
      ensureMainRateOne,
      clearUltraRefs,
    ]
  );

  const startMainPlayback = useCallback(
    (time: number) => {
      const main = mainRef.current;
      if (!main) return;

      clearOverlayPlayback();
      clearUltraRefs();
      activePlaybackKeyRef.current = '';
      prevVideoTimeRef.current = time;
      lastVideoAdvanceTRef.current = time;
      lastVideoAdvanceMsRef.current = performance.now();

      if (useBakedPreviewRef.current) {
        seekVideo(main, mapSourceToBaked(time));
        ensureMainRateOne(main);
      } else {
        seekVideo(main, time);
        forceSyncPlaybackRate(main, time);
      }
      main.play().catch(() => {});
    },
    [
      seekVideo,
      forceSyncPlaybackRate,
      clearOverlayPlayback,
      mapSourceToBaked,
      ensureMainRateOne,
      clearUltraRefs,
    ]
  );

  const syncPausedToPlayhead = useCallback(
    (time: number) => {
      const main = mainRef.current;
      if (!main || !mainVideoUrl) return;

      clearOverlayPlayback();
      activePlaybackKeyRef.current = '';
      clearUltraRefs();

      const t = clampTime(time, mainVideoDuration || main.duration || 0);
      const fullFrame = getActiveFullFrameAt(
        t,
        timelineClipsRef.current,
        mediaAssetsRef.current
      );

      if (fullFrame) {
        activeOverlayRef.current = fullFrame;
        setOverlayMedia({
          url: fullFrame.asset.url,
          mediaType: fullFrame.asset.mediaType,
          name: fullFrame.asset.friendlyName,
        });
        setOverlayVisible(true);
        if (fullFrame.asset.mediaType === 'video') {
          syncOverlayElement(t, fullFrame);
        }
        if (useBakedPreviewRef.current) {
          seekVideo(main, mapSourceToBaked(t));
        } else {
          seekVideo(main, t);
        }
        ensureMainRateOne(main);
        main.pause();
      } else if (useBakedPreviewRef.current) {
        seekVideo(main, mapSourceToBaked(t));
        ensureMainRateOne(main);
      } else {
        seekVideo(main, t);
        forceSyncPlaybackRate(main, t);
      }

      prevVideoTimeRef.current = t;
      syncDiagramElement(t, false, true);
      lastSyncedPlayheadRef.current = t;
    },
    [
      mainVideoUrl,
      mainVideoDuration,
      syncOverlayElement,
      seekVideo,
      forceSyncPlaybackRate,
      syncDiagramElement,
      ensureMainRateOne,
      clearOverlayPlayback,
      mapSourceToBaked,
    ]
  );

  const seekDuringPlayback = useCallback(
    (time: number) => {
      const main = mainRef.current;
      if (!main) return;

      const t = clampTime(time, mainVideoDuration || main.duration || 0);
      const fullFrame = getActiveFullFrameAt(
        t,
        timelineClipsRef.current,
        mediaAssetsRef.current
      );

      prevVideoTimeRef.current = t;
      lastVideoAdvanceTRef.current = t;
      lastVideoAdvanceMsRef.current = performance.now();

      if (fullFrame) {
        handoffToOverlay(t, fullFrame);
      } else {
        clearOverlayPlayback();
        startMainPlayback(t);
      }

      syncDiagramElement(t, true, true);
      lastSyncedPlayheadRef.current = t;
    },
    [
      mainVideoDuration,
      handoffToOverlay,
      startMainPlayback,
      syncDiagramElement,
      clearOverlayPlayback,
    ]
  );

  const checkStall = useCallback(
    (main: HTMLVideoElement, t: number, now: number) => {
      if (t > lastVideoAdvanceTRef.current + 0.0005) {
        lastVideoAdvanceTRef.current = t;
        lastVideoAdvanceMsRef.current = now;
        return;
      }

      const stalledMs = now - lastVideoAdvanceMsRef.current;
      if (stalledMs < STALL_DETECT_MS) return;

      const logical = Math.max(t, playheadRef.current);
      recoverDriftedRate(main, logical);
      resumeMainIfNeeded(main);

      if (isInTimelapseAt(logical) && stalledMs >= TIMELAPSE_HARD_RECOVERY_MS) {
        const publishT = getPublishTime(main, now);
        const resumeAt = Math.min(publishT, durationRef.current - 0.033);
        seekVideo(main, resumeAt);
        const resumeSeg = getTimelapseSegmentAt(resumeAt, timelapseSegmentsRef.current);
        if (resumeSeg && needsUltraPlayback(resumeSeg.speedFactor)) {
          startUltraAnchors(resumeAt);
          lastUltraSeekMsRef.current = 0;
        }
        forceSyncPlaybackRate(main, resumeAt);
        lastVideoAdvanceTRef.current = resumeAt;
        lastVideoAdvanceMsRef.current = now;
        playheadRef.current = resumeAt;
        main.play().catch(() => {});
      } else {
        lastVideoAdvanceMsRef.current = now;
      }
    },
    [
      resumeMainIfNeeded,
      recoverDriftedRate,
      forceSyncPlaybackRate,
      isInTimelapseAt,
      seekVideo,
      startUltraAnchors,
      getPublishTime,
    ]
  );

  const tickMainBaked = useCallback(
    (bakedT: number) => {
      const main = mainRef.current;
      if (!main || overlayPlaybackRef.current) return;

      const sourceT = mapBakedToSource(bakedT);
      resumeMainIfNeeded(main);
      prevVideoTimeRef.current = sourceT;

      const fullFrame = getActiveFullFrameAt(
        sourceT,
        timelineClipsRef.current,
        mediaAssetsRef.current
      );

      if (fullFrame && fullFrame.asset.mediaType === 'video') {
        handoffToOverlay(sourceT, fullFrame);
        return;
      }

      publishPlayhead(sourceT, false, false);
      syncDiagramElement(sourceT, true);

      if (isNearTrueEnd(sourceT)) {
        onEnded();
      }
    },
    [
      mapBakedToSource,
      resumeMainIfNeeded,
      handoffToOverlay,
      publishPlayhead,
      syncDiagramElement,
      onEnded,
      isNearTrueEnd,
    ]
  );

  const maintainPlayback = useCallback(() => {
    const main = mainRef.current;
    if (!main || !isPlayingRef.current || overlayPlaybackRef.current) return;

    const now = performance.now();
    const t = main.currentTime;
    if (useBakedPreviewRef.current) {
      resumeMainIfNeeded(main);
      tickMainBaked(t);
      return;
    }

    const logical = Math.max(t, playheadRef.current);
    const activeKey = activePlaybackKeyRef.current;
    const inTimelapse =
      isInTimelapseAt(logical) ||
      (activeKey !== 'normal' && activeKey !== 'baked' && activeKey !== '');

    if (!inTimelapse) {
      prevVideoTimeRef.current = t;
      checkStall(main, t, now);
      return;
    }

    syncPlaybackRate(main, logical);
    recoverDriftedRate(main, logical);
    resumeMainIfNeeded(main);

    const publishT = runTimelapseCatchUp(main, now);
    const prevPublishT = prevVideoTimeRef.current;
    handleSegmentBoundary(main, prevPublishT, publishT);
    prevVideoTimeRef.current = publishT;

    publishPlayhead(publishT, false, true);
    syncDiagramElement(publishT, true);

    const fullFrame = getActiveFullFrameAt(
      publishT,
      timelineClipsRef.current,
      mediaAssetsRef.current
    );
    if (fullFrame && fullFrame.asset.mediaType === 'video') {
      handoffToOverlay(publishT, fullFrame);
      return;
    }

    if (isNearTrueEnd(publishT)) {
      onEnded();
    }
  }, [
    syncPlaybackRate,
    recoverDriftedRate,
    resumeMainIfNeeded,
    publishPlayhead,
    checkStall,
    isInTimelapseAt,
    runTimelapseCatchUp,
    handleSegmentBoundary,
    tickMainBaked,
    syncDiagramElement,
    handoffToOverlay,
    onEnded,
    isNearTrueEnd,
  ]);

  const tickMain = useCallback(
    (t: number) => {
      const main = mainRef.current;
      if (!main || overlayPlaybackRef.current) return;

      if (useBakedPreviewRef.current) {
        tickMainBaked(main.currentTime);
        return;
      }

      const logical = Math.max(t, playheadRef.current);
      if (isInTimelapseAt(logical)) return;

      const now = performance.now();
      const prevT = prevVideoTimeRef.current;

      syncPlaybackRate(main, logical);
      handleSegmentBoundary(main, prevT, t);
      checkStall(main, t, now);
      resumeMainIfNeeded(main);

      const fullFrame = getActiveFullFrameAt(
        logical,
        timelineClipsRef.current,
        mediaAssetsRef.current
      );

      if (fullFrame && fullFrame.asset.mediaType === 'video') {
        handoffToOverlay(logical, fullFrame);
        prevVideoTimeRef.current = t;
        return;
      }

      prevVideoTimeRef.current = t;
      publishPlayhead(t, false, false);
      syncDiagramElement(t, true);

      if (isNearTrueEnd(t) && isNearTrueEnd(playheadRef.current)) {
        onEnded();
      }
    },
    [
      syncPlaybackRate,
      checkStall,
      resumeMainIfNeeded,
      handoffToOverlay,
      publishPlayhead,
      syncDiagramElement,
      onEnded,
      isNearTrueEnd,
      handleSegmentBoundary,
      tickMainBaked,
      isInTimelapseAt,
    ]
  );

  const tickOverlayPlayhead = useCallback(
    (now: number) => {
      const active = activeOverlayRef.current;
      if (!overlayPlaybackRef.current || !active) return;

      let global: number;
      if (active.asset.mediaType === 'video' && overlayRef.current) {
        global = active.clip.startTime + overlayRef.current.currentTime;
        if (overlayRef.current.paused) {
          overlayRef.current.play().catch(() => {});
        }
      } else if (active.asset.mediaType === 'image') {
        global = active.clip.startTime + (now - overlayWallStartRef.current) / 1000;
      } else {
        return;
      }

      publishPlayhead(global, false, false);
      syncDiagramElement(global, true);

      const clipEnd = active.clip.startTime + active.clip.duration;
      if (global >= clipEnd - 0.03) {
        if (clipEnd >= durationRef.current - 0.05) {
          onEnded();
        } else {
          resumeMainAfterOverlay(clipEnd);
          publishPlayhead(clipEnd, true, false);
        }
      }
    },
    [publishPlayhead, syncDiagramElement, onEnded, resumeMainAfterOverlay]
  );

  seekDuringPlaybackRef.current = seekDuringPlayback;
  syncPausedToPlayheadRef.current = syncPausedToPlayhead;
  handoffToOverlayRef.current = handoffToOverlay;
  startMainPlaybackRef.current = startMainPlayback;
  clearOverlayPlaybackRef.current = clearOverlayPlayback;
  syncDiagramElementRef.current = syncDiagramElement;
  ensureMainRateOneRef.current = ensureMainRateOne;
  tickMainRef.current = tickMain;
  maintainPlaybackRef.current = maintainPlayback;

  const resolveMainSeekTime = useCallback(
    (sourceTime: number) => {
      return useBakedPreviewRef.current ? mapSourceToBaked(sourceTime) : sourceTime;
    },
    [mapSourceToBaked]
  );

  useEffect(() => {
    const main = mainRef.current;
    if (!main || !activePreviewUrl) return;

    const sourceT = playheadRef.current;
    const bakedT = resolveMainSeekTime(sourceT);
    prevVideoTimeRef.current = sourceT;
    lastVideoAdvanceTRef.current = sourceT;
    lastSyncedPlayheadRef.current = sourceT;
    if (useBakedPreviewRef.current) {
      activePlaybackKeyRef.current = 'baked';
      clearUltraRefs();
      ensureMainRateOne(main);
    } else {
      activePlaybackKeyRef.current = '';
      clearUltraRefs();
    }

    const syncAfterLoad = () => {
      seekVideo(main, bakedT);
      if (!useBakedPreviewRef.current && getPlaybackRateAt(sourceT, timelapseSegmentsRef.current) > 1) {
        forceSyncPlaybackRate(main, sourceT);
      }
      if (isPlayingRef.current && !overlayPlaybackRef.current) {
        main.play().catch(() => {});
      } else if (!isPlayingRef.current) {
        main.pause();
      }
    };

    if (main.readyState >= HTMLMediaElement.HAVE_METADATA) {
      syncAfterLoad();
      return;
    }

    const onReady = () => {
      main.removeEventListener('loadedmetadata', onReady);
      syncAfterLoad();
    };
    main.addEventListener('loadedmetadata', onReady);
    return () => main.removeEventListener('loadedmetadata', onReady);
  }, [
    activePreviewUrl,
    useBakedPreview,
    resolveMainSeekTime,
    seekVideo,
    ensureMainRateOne,
    clearUltraRefs,
    forceSyncPlaybackRate,
  ]);

  useEffect(() => {
    if (!overlayVisible || overlayMedia?.mediaType !== 'video') return;
    const overlay = overlayRef.current;
    const active = activeOverlayRef.current;
    if (!overlay || !active) return;

    overlay.playbackRate = 1;
    if (!overlay.preservesPitch) overlay.preservesPitch = true;
    seekVideo(overlay, localTimeInClip(playheadRef.current, active.clip));
    if (isPlayingRef.current && overlayPlaybackRef.current) {
      playOverlayWhenReady(overlay);
    }
  }, [overlayMedia, overlayVisible, seekVideo, playOverlayWhenReady]);

  useEffect(() => {
    if (!isPlayingRef.current) {
      syncPausedToPlayheadRef.current(playhead);
      lastSyncedPlayheadRef.current = playhead;
      return;
    }

    if (playheadFromVideoRef.current) {
      playheadFromVideoRef.current = false;
      lastSyncedPlayheadRef.current = playhead;
      return;
    }

    if (Math.abs(playhead - lastSyncedPlayheadRef.current) < USER_SCRUB_MIN_DELTA_SECONDS) {
      return;
    }

    lastSyncedPlayheadRef.current = playhead;
    playheadRef.current = playhead;
    seekDuringPlaybackRef.current(playhead);
  }, [playhead]);

  useEffect(() => {
    const main = mainRef.current;
    const overlay = overlayRef.current;
    if (!main) return;

    if (!isPlaying) {
      playbackStartedRef.current = false;
      clearOverlayPlaybackRef.current();
      activePlaybackKeyRef.current = 'normal';
      activeEffectiveRateRef.current = 1;
      clearUltraRefs();
      main.pause();
      overlay?.pause();
      diagramVideoRef.current?.pause();
      ensureMainRateOneRef.current(main);
      return;
    }

    if (playbackStartedRef.current) return;
    playbackStartedRef.current = true;

    const t = playheadRef.current;
    const fullFrame = getActiveFullFrameAt(t, timelineClipsRef.current, mediaAssetsRef.current);

    if (fullFrame) {
      handoffToOverlayRef.current(t, fullFrame);
    } else {
      clearOverlayPlaybackRef.current();
      startMainPlaybackRef.current(t);
    }

    syncDiagramElementRef.current(t, true, true);
  }, [isPlaying]);

  useEffect(() => {
    const main = mainRef.current;
    const overlay = overlayRef.current;
    if (!main) return;

    const onMainTime = () => {
      if (!isPlayingRef.current || overlayPlaybackRef.current) return;
      tickMainRef.current(main.currentTime);
    };

    const onOverlayTime = () => {
      if (!isPlayingRef.current || !overlay || !overlayPlaybackRef.current) return;
      if (!activeOverlayRef.current) return;
      tickOverlayPlayhead(performance.now());
    };

    main.addEventListener('timeupdate', onMainTime);
    overlay?.addEventListener('timeupdate', onOverlayTime);

    return () => {
      main.removeEventListener('timeupdate', onMainTime);
      overlay?.removeEventListener('timeupdate', onOverlayTime);
    };
  }, [tickOverlayPlayhead]);

  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    const onFrame = (now: number) => {
      if (!isPlayingRef.current) {
        rafId = requestAnimationFrame(onFrame);
        return;
      }

      if (overlayPlaybackRef.current) {
        if (activeOverlayRef.current?.asset.mediaType === 'image') {
          tickOverlayPlayhead(now);
        }
      } else {
        maintainPlaybackRef.current();
      }

      rafId = requestAnimationFrame(onFrame);
    };

    rafId = requestAnimationFrame(onFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, tickOverlayPlayhead]);

  const previewLabel = buildPreviewLabel(
    activeFullFrame,
    activeDiagram,
    activeTimelapse,
    overlayVisible,
    useBakedPreview
  );

  return (
    <div className="video-preview">
      <div className="preview-header">
        <span className="preview-label">{previewLabel}</span>
        <span className="preview-time">
          {formatTime(playhead)} / {formatTime(mainVideoDuration)}
          {exportDuration &&
            exportDuration > 0 &&
            Math.abs(exportDuration - mainVideoDuration) > 0.5 && (
              <span className="preview-export-duration" title="Export length after timelapse">
                {' '}
                → {formatTime(exportDuration)} export
              </span>
            )}
        </span>
      </div>
      <div
        className={`preview-stage ${isDragOver ? 'preview-stage-drag-over' : ''}`}
      >
        {!mainVideoUrl ? (
          <div className="preview-empty">
            <div className="preview-empty-icon">{isImporting ? '…' : '▶'}</div>
            <p>{isImporting ? 'Loading video…' : 'Import a video to start editing'}</p>
            <span className="preview-empty-hint">
              {isImporting
                ? 'Using your phone file directly — no conversion'
                : 'Same Wi‑Fi: send straight from your phone with the QR code — or import from this PC / drag a file here'}
            </span>
            {!isImporting && (onImportClick || onPhoneUploadOpen) && (
              <div className="preview-import-actions">
                {onPhoneUploadOpen && (
                  <button
                    type="button"
                    className="btn btn-accent preview-import-btn"
                    onClick={onPhoneUploadOpen}
                  >
                    Import from Phone
                  </button>
                )}
                {onImportClick && (
                  <button type="button" className="btn btn-topbar preview-import-btn" onClick={onImportClick}>
                    Import from PC
                  </button>
                )}
              </div>
            )}
            {!isImporting && onPhoneUploadClose && (
              <PhoneUploadPanel active={phoneUploadOpen} onClose={onPhoneUploadClose} />
            )}
            {isDragOver && !isImporting && (
              <span className="preview-drop-badge">Drop video to import</span>
            )}
          </div>
        ) : (
          <>
            <video
              ref={mainRef}
              key={activePreviewUrl ?? 'none'}
              className={`preview-video preview-base ${overlayVisible ? 'hidden' : ''}`}
              src={activePreviewUrl ?? undefined}
              preload="auto"
              playsInline
              disablePictureInPicture
              onLoadedMetadata={(e) => {
                const video = e.currentTarget;
                let d = video.duration;
                if (video.seekable.length > 0) {
                  const end = video.seekable.end(video.seekable.length - 1);
                  if (Number.isFinite(end) && end > d) d = end;
                }
                if (Number.isFinite(d) && d > 0 && d !== Infinity) onMainDurationReady(d);
                video.playbackRate = 1;
                if (!video.preservesPitch) video.preservesPitch = true;
                const seekTo = useBakedPreviewRef.current
                  ? mapSourceToBaked(playheadRef.current)
                  : playheadRef.current;
                seekVideo(video, seekTo);
              }}
              onDurationChange={(e) => {
                const video = e.currentTarget;
                let d = video.duration;
                if (video.seekable.length > 0) {
                  const end = video.seekable.end(video.seekable.length - 1);
                  if (Number.isFinite(end) && end > d) d = end;
                }
                if (Number.isFinite(d) && d > 0 && d !== Infinity) onMainDurationReady(d);
              }}
              onRateChange={(e) => {
                const video = e.currentTarget;
                if (useBakedPreviewRef.current) {
                  ensureMainRateOne(video);
                  return;
                }
                if (!isPlayingRef.current || overlayPlaybackRef.current) return;
                if (video.paused) video.play().catch(() => {});
              }}
              onWaiting={(e) => {
                const video = e.currentTarget;
                if (!isPlayingRef.current || overlayPlaybackRef.current) return;
                if (!useBakedPreviewRef.current) {
                  recoverDriftedRate(video, video.currentTime);
                }
                video.play().catch(() => {});
              }}
              onStalled={(e) => {
                const video = e.currentTarget;
                if (!isPlayingRef.current || overlayPlaybackRef.current) return;
                if (!useBakedPreviewRef.current) {
                  recoverDriftedRate(video, video.currentTime);
                }
                video.play().catch(() => {});
              }}
              onPause={(e) => {
                const video = e.currentTarget;
                if (!isPlayingRef.current || overlayPlaybackRef.current) return;
                if (!useBakedPreviewRef.current) {
                  const logical = Math.max(video.currentTime, playheadRef.current);
                  recoverDriftedRate(video, logical);
                  forceSyncPlaybackRate(video, logical);
                }
                video.play().catch(() => {});
              }}
              onEnded={() => {
                const main = mainRef.current;
                if (!main || !isPlayingRef.current || overlayPlaybackRef.current) return;

                const logical = useBakedPreviewRef.current
                  ? mapBakedToSource(main.currentTime)
                  : Math.max(playheadRef.current, main.currentTime);

                if (!isNearTrueEnd(logical)) {
                  resumeAfterFalseEnded(main);
                  return;
                }

                if (
                  !getActiveFullFrameAt(
                    logical,
                    timelineClipsRef.current,
                    mediaAssetsRef.current
                  )
                ) {
                  onEnded();
                }
              }}
            />
            <video
              ref={overlayRef}
              className={`preview-video preview-base ${!overlayVisible || showingImageOverlay ? 'hidden' : ''}`}
              src={overlayMedia?.mediaType === 'video' ? overlayMedia.url : undefined}
              preload="auto"
              playsInline
              disablePictureInPicture
              onLoadedData={(e) => {
                if (
                  isPlayingRef.current &&
                  overlayPlaybackRef.current &&
                  overlayMedia?.mediaType === 'video'
                ) {
                  e.currentTarget.play().catch(() => {});
                }
              }}
              onPause={(e) => {
                if (isPlayingRef.current && overlayPlaybackRef.current) {
                  e.currentTarget.play().catch(() => {});
                }
              }}
            />
            {showingImageOverlay && overlayMedia && (
              <img
                className="preview-video preview-base"
                src={overlayMedia.url}
                alt={overlayMedia.name}
              />
            )}
            {activeDiagram && (
              <div className="preview-diagram-overlay">
                {activeDiagram.asset.mediaType === 'image' ? (
                  <img
                    className="preview-diagram-media"
                    src={activeDiagram.asset.url}
                    alt={activeDiagram.asset.friendlyName}
                  />
                ) : (
                  <video
                    ref={diagramVideoRef}
                    className="preview-diagram-media"
                    src={activeDiagram.asset.url}
                    preload="metadata"
                    playsInline
                    disablePictureInPicture
                    muted
                  />
                )}
                <span className="preview-diagram-badge">{activeDiagram.asset.friendlyName}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function buildPreviewLabel(
  fullFrame: ReturnType<typeof getActiveFullFrameAt>,
  diagram: ReturnType<typeof getActiveDiagramAt>,
  timelapse: TimelapseSegment | null,
  showingOverlay: boolean,
  bakedPreview: boolean
): string {
  const parts: string[] = [];
  if (showingOverlay && fullFrame) {
    parts.push(`${fullFrame.track.toUpperCase()}: ${fullFrame.asset.friendlyName}`);
  } else if (timelapse) {
    const bakedNote = bakedPreview ? ' — smooth baked preview' : '';
    parts.push(`MAIN VIDEO (${timelapse.speedFactor}× TIMELAPSE${bakedNote})`);
  } else {
    parts.push('MAIN VIDEO');
  }
  if (diagram) {
    parts.push(`+ DIAGRAM: ${diagram.asset.friendlyName}`);
  }
  return parts.join(' ');
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

