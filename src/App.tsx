import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { LeftSidebar, type LeftPanel } from './components/LeftSidebar';
import { RightSidebar, type RightPanel } from './components/RightSidebar';
import { Timeline } from './components/Timeline';
import { VideoPreview } from './components/VideoPreview';
import {
  addToContentLibrary,
  loadAllContentLibraries,
  mergeMediaAssets,
  renameContentAsset,
} from './lib/contentLibrary';
import { generateDiagramFromVideo } from './lib/diagramGenerate';
import {
  buildProject,
  emptySelectedAssetIds,
  hydrateProject,
  openProjectFile,
  saveProjectAs,
  saveProjectToPath,
} from './lib/project';
import { resolveVideoDuration } from './lib/duration';
import {
  cancelBackgroundExport,
  startBackgroundExport,
  subscribeExportComplete,
  subscribeExportProgress,
} from './lib/export';
import { useVideoDropImport } from './hooks/useVideoDropImport';
import { subscribePhoneUploadReceived } from './lib/phoneUpload';
import { loadMainVideoDirect, openMainVideo, openMediaForCategory } from './lib/video';
import type { MainVideoSelection } from './lib/video';
import type { LibraryCategory } from './types/content';
import type { OverlayTrack } from './types/content';
import type { MediaAsset, TimelineClip } from './types/project';
import type { TimelapseSegment, TimelapseSpeed } from './types/timelapse';
import { outputDurationAfterBake } from './types/timelapse';
import './App.css';

export default function App() {
  const [mainVideoPath, setMainVideoPath] = useState<string | null>(null);
  const [mainVideoUrl, setMainVideoUrl] = useState<string | null>(null);
  const [sourceVideoPath, setSourceVideoPath] = useState<string | null>(null);
  const [mainVideoDuration, setMainVideoDuration] = useState(0);
  const [sourceVideoDuration, setSourceVideoDuration] = useState(0);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [timelapseSegments, setTimelapseSegments] = useState<TimelapseSegment[]>([]);
  const [timelapseModeActive, setTimelapseModeActive] = useState(false);
  const [timelapsePendingStart, setTimelapsePendingStart] = useState<number | null>(null);
  const [timelapseSpeed, setTimelapseSpeed] = useState<TimelapseSpeed>(8);
  const [backgroundExportActive, setBackgroundExportActive] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(null);
  const [exportOutputPath, setExportOutputPath] = useState<string | null>(null);
  const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState(emptySelectedAssetIds());
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('broll');
  const [rightPanel, setRightPanel] = useState<RightPanel>('voiceover');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Untitled');
  const [statusMsg, setStatusMsg] = useState('');
  const [isImportingVideo, setIsImportingVideo] = useState(false);
  const [isVideoDragOver, setIsVideoDragOver] = useState(false);
  const [phoneUploadOpen, setPhoneUploadOpen] = useState(false);

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 3500);
  };

  useEffect(() => {
    loadAllContentLibraries()
      .then(setMediaAssets)
      .catch(() => showStatus('Could not load media libraries'));
  }, []);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    subscribeExportProgress((event) => {
      if (event.status === 'running') {
        setBackgroundExportActive(true);
        setExportProgress(event.progress);
        if (event.message) setExportStatusMessage(event.message);
      } else if (event.status === 'cancelled') {
        setBackgroundExportActive(false);
        setExportProgress(null);
        setExportStatusMessage(null);
        setExportOutputPath(null);
        showStatus(event.message ?? 'Export cancelled');
      }
    })
      .then((fn) => {
        unlistenProgress = fn;
      })
      .catch(() => {});

    subscribeExportComplete((event) => {
      setBackgroundExportActive(false);
      setExportProgress(null);
      setExportStatusMessage(null);
      setExportOutputPath(null);

      if (event.status === 'completed') {
        const durationNote =
          event.duration > 0 ? ` (${formatShortTime(event.duration)} export length)` : '';
        showStatus(`Export finished${durationNote} → ${event.outputPath}`);
      } else if (event.status === 'failed') {
        showStatus(`Export failed: ${event.message ?? 'Unknown error'}`);
      }
    })
      .then((fn) => {
        unlistenComplete = fn;
      })
      .catch(() => {});

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };
  }, []);

  const timelineSourceDuration = sourceVideoDuration || mainVideoDuration;

  const exportDuration = useMemo(
    () => outputDurationAfterBake(timelineSourceDuration, timelapseSegments),
    [timelineSourceDuration, timelapseSegments]
  );

  const applyMainDuration = useCallback((duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setSourceVideoDuration((prev) => Math.max(prev, duration));
    setMainVideoDuration((prev) => {
      const next = Math.max(prev, duration);
      if (Math.abs(prev - next) < 0.05) return prev;
      setTimelineClips((clips) =>
        clips.map((c) => (c.track === 'main' ? { ...c, duration: next } : c))
      );
      return next;
    });
  }, []);

  const handleMainDurationReady = useCallback(
    (duration: number) => {
      applyMainDuration(duration);
    },
    [applyMainDuration]
  );

  const loadMainVideo = useCallback((result: MainVideoSelection) => {
    const mainClip: TimelineClip = {
      id: uuidv4(),
      assetId: 'main',
      startTime: 0,
      duration: result.duration,
      track: 'main',
    };

    setSourceVideoPath(result.filePath);
    setMainVideoPath(result.filePath);
    setMainVideoUrl(result.url);
    setSourceVideoDuration(result.duration);
    setMainVideoDuration(result.duration);
    setTimelineClips([mainClip]);
    setTimelapseSegments([]);
    setTimelapsePendingStart(null);
    setTimelapseModeActive(false);
    setPlayhead(0);
    setIsPlaying(false);
    setSelectedClipId(null);

    showStatus('Video loaded — ready to edit');
  }, []);

  const importMainVideoFromPath = useCallback(
    async (sourcePath: string) => {
      setIsImportingVideo(true);
      try {
        const result = await loadMainVideoDirect(sourcePath);
        loadMainVideo(result);
      } catch (err) {
        showStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsImportingVideo(false);
        setIsVideoDragOver(false);
      }
    },
    [loadMainVideo]
  );

  const handleUploadMain = async () => {
    if (isImportingVideo) return;
    setIsImportingVideo(true);
    try {
      const result = await openMainVideo();
      if (!result) return;
      loadMainVideo(result);
    } catch (err) {
      showStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsImportingVideo(false);
    }
  };

  useVideoDropImport(
    !mainVideoUrl && !isImportingVideo,
    importMainVideoFromPath,
    setIsVideoDragOver
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribePhoneUploadReceived((event) => {
      setPhoneUploadOpen(false);
      showStatus(`Received ${event.originalName} from phone`);
      importMainVideoFromPath(event.sourcePath);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [importMainVideoFromPath]);

  const handleImportContent = async (category: LibraryCategory) => {
    try {
      const imports = await openMediaForCategory(category);
      if (!imports.length) return;

      const added = await addToContentLibrary(
        category,
        imports.map((item) => ({
          filePath: item.filePath,
          duration: item.duration,
        }))
      );

      setMediaAssets((prev) => mergeMediaAssets(prev, added));
      if (added.length === 1) {
        setSelectedAssetIds((prev) => ({ ...prev, [category]: added[0].id }));
      }
      showStatus(`Imported ${added.length} clip${added.length === 1 ? '' : 's'}`);
    } catch (err) {
      showStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRenameAsset = async (category: LibraryCategory, id: string, name: string) => {
    const ok = await renameContentAsset(category, id, name);
    if (!ok) return;
    setMediaAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, friendlyName: name.trim() || 'Untitled' } : a))
    );
  };

  const placeClipOnTrack = useCallback(
    (track: OverlayTrack, assetId: string, startTime: number) => {
      if (track === 'timelapse') return;
      const asset = mediaAssets.find((a) => a.id === assetId && a.category === track);
      if (!asset) return;

      const clip: TimelineClip = {
        id: uuidv4(),
        assetId: asset.id,
        startTime: Math.max(0, startTime),
        duration: asset.duration,
        track,
      };

      setTimelineClips((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      showStatus(`Placed "${asset.friendlyName}" on timeline`);
    },
    [mediaAssets]
  );

  const handleAddAtPlayhead = (category: LibraryCategory) => {
    const selectedId = selectedAssetIds[category];
    if (!selectedId) {
      showStatus(`Select a ${category} clip in the library first`);
      return;
    }
    placeClipOnTrack(category, selectedId, playhead);
  };

  const handleInsertDiagram = () => {
    handleAddAtPlayhead('diagram');
  };

  const handleGenerateDiagram = async () => {
    if (!mainVideoPath) {
      showStatus('Upload a main video first');
      return;
    }
    setIsGeneratingDiagram(true);
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const asset = await generateDiagramFromVideo(mainVideoPath);
      setMediaAssets((prev) => mergeMediaAssets(prev, [asset]));
      setSelectedAssetIds((prev) => ({ ...prev, diagram: asset.id }));
      showStatus('Build diagram generated — insert at playhead when ready');
    } catch (err) {
      showStatus(`Diagram failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingDiagram(false);
    }
  };

  const handleToggleTimelapseMode = () => {
    setTimelapseModeActive((active) => {
      if (active) setTimelapsePendingStart(null);
      return !active;
    });
    if (!timelapseModeActive) {
      setLeftPanel('timelapse');
      showStatus('Timelapse mode — click timeline to mark start, click again for end');
    }
  };

  const handleTimelapseClick = useCallback(
    (time: number) => {
      if (timelapsePendingStart === null) {
        setTimelapsePendingStart(time);
        setPlayhead(time);
        setIsPlaying(false);
        showStatus(`Timelapse IN at ${formatShortTime(time)}`);
        return;
      }

      const start = Math.min(timelapsePendingStart, time);
      const end = Math.max(timelapsePendingStart, time);
      setTimelapsePendingStart(null);

      if (end - start < 0.25) {
        showStatus('Region too short — try again');
        return;
      }

      const segment: TimelapseSegment = {
        id: uuidv4(),
        startTime: start,
        endTime: end,
        speedFactor: timelapseSpeed,
      };

      setTimelapseSegments((prev) => [...prev, segment]);
      setPlayhead(end);
      showStatus(`Timelapse ${timelapseSpeed}× added — live preview (export bakes on Export MP4)`);
    },
    [timelapsePendingStart, timelapseSpeed]
  );

  const handleClipMove = useCallback((clipId: string, newStartTime: number) => {
    setTimelineClips((clips) =>
      clips.map((c) =>
        c.id === clipId ? { ...c, startTime: Math.max(0, newStartTime) } : c
      )
    );
  }, []);

  const handleSelectClip = useCallback((clipId: string | null) => {
    setSelectedClipId(clipId);
  }, []);

  const handleSelectAsset = useCallback((category: LibraryCategory, id: string) => {
    setSelectedAssetIds((prev) => ({ ...prev, [category]: id }));
  }, []);

  const handlePlayheadSeek = useCallback((time: number) => {
    setPlayhead(time);
  }, []);

  const handleSeekAndPlay = useCallback(
    (time: number) => {
      if (timelapseModeActive) return;
      setPlayhead(time);
      if (mainVideoUrl) setIsPlaying(true);
    },
    [mainVideoUrl, timelapseModeActive]
  );

  const handlePlayheadTick = useCallback((time: number) => {
    setPlayhead(time);
  }, []);

  const togglePlay = () => {
    if (!mainVideoUrl) return;
    if (!isPlaying && playhead >= timelineSourceDuration) setPlayhead(0);
    setIsPlaying((p) => !p);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setPlayhead(timelineSourceDuration);
  };

  const getProjectSnapshot = useCallback(
    () =>
      buildProject({
        name: projectName,
        mainVideoPath,
        mainVideoDuration,
        mediaAssets,
        timelineClips,
        selectedAssetIds,
        timelapseSegments,
      }),
    [
      projectName,
      mainVideoPath,
      mainVideoDuration,
      mediaAssets,
      timelineClips,
      selectedAssetIds,
      timelapseSegments,
    ]
  );

  const handleExportMp4 = async () => {
    if (!mainVideoPath) {
      showStatus('Upload a main video before exporting');
      return;
    }
    if (backgroundExportActive) {
      showStatus('Export already running in the background — keep editing or cancel it');
      return;
    }
    try {
      const result = await startBackgroundExport({
        mainVideoPath: sourceVideoPath ?? mainVideoPath,
        sourceVideoDuration: sourceVideoDuration || mainVideoDuration,
        projectName,
        timelapseSegments,
        timelineClips,
        mediaAssets,
      });
      setBackgroundExportActive(true);
      setExportProgress(0);
      setExportOutputPath(result.outputPath);
      setExportStatusMessage('Queued — preview and editing stay available');
      showStatus(
        `Export started in background → ${result.outputPath}. You can keep watching and editing.`
      );
    } catch (err) {
      showStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancelExport = async () => {
    try {
      await cancelBackgroundExport();
      showStatus('Cancelling background export…');
    } catch (err) {
      showStatus(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSaveProject = async () => {
    try {
      const project = getProjectSnapshot();
      if (projectPath) {
        const ok = await saveProjectToPath(project, projectPath);
        showStatus(ok ? 'Project saved' : 'Save failed');
      } else {
        const path = await saveProjectAs(project);
        if (path) {
          setProjectPath(path);
          showStatus('Project saved');
        }
      }
    } catch (err) {
      showStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenProject = async () => {
    try {
      const result = await openProjectFile();
      if (!result) return;

      let hydrated = await hydrateProject(result.project);

      if (hydrated.mainVideoPath && hydrated.mainVideoUrl) {
        const probed = await resolveVideoDuration(hydrated.mainVideoPath, hydrated.mainVideoUrl);
        if (probed > 0) {
          hydrated = {
            ...hydrated,
            mainVideoDuration: probed,
            timelineClips: hydrated.timelineClips.map((c) =>
              c.track === 'main' ? { ...c, duration: probed } : c
            ),
          };
        }
      }

      setProjectPath(result.filePath);
      setProjectName(hydrated.projectName);
      setSourceVideoPath(hydrated.mainVideoPath);
      setMainVideoPath(hydrated.mainVideoPath);
      setMainVideoUrl(hydrated.mainVideoUrl);
      setSourceVideoDuration(hydrated.mainVideoDuration);
      setMainVideoDuration(hydrated.mainVideoDuration);
      setTimelapseSegments(hydrated.timelapseSegments);
      setTimelapseModeActive(false);
      setTimelapsePendingStart(null);

      if (hydrated.mediaAssets.length > 0) {
        const byCategory = new Map<LibraryCategory, typeof hydrated.mediaAssets>();
        for (const asset of hydrated.mediaAssets) {
          const list = byCategory.get(asset.category) ?? [];
          list.push(asset);
          byCategory.set(asset.category, list);
        }

        let merged = await loadAllContentLibraries();
        for (const [category, assets] of byCategory) {
          const synced = await addToContentLibrary(
            category,
            assets.map((a) => ({
              filePath: a.filePath,
              friendlyName: a.friendlyName,
              duration: a.duration,
              thumbnail: a.thumbnail,
              mediaType: a.mediaType,
            }))
          );
          merged = mergeMediaAssets(merged, synced);
        }
        setMediaAssets(merged);
      } else {
        setMediaAssets(await loadAllContentLibraries());
      }

      setTimelineClips(hydrated.timelineClips);
      setSelectedAssetIds(hydrated.selectedAssetIds);
      setSelectedClipId(null);
      setPlayhead(0);
      setIsPlaying(false);
      showStatus('Project loaded');
    } catch (err) {
      showStatus(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const diagramModeActive = leftPanel === 'diagram';

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <img src="/assets/icon.png" alt="" className="topbar-logo" />
          <span className="brand-name">Papa Bales Pulse Motors Editor</span>
        </div>

        <div className="topbar-actions">
          {!mainVideoUrl && (
            <button
              type="button"
              className="btn btn-topbar-accent"
              onClick={() => setPhoneUploadOpen(true)}
              disabled={isImportingVideo}
            >
              From Phone
            </button>
          )}
          <button
            type="button"
            className="btn btn-topbar"
            onClick={handleUploadMain}
            disabled={isImportingVideo}
          >
            {isImportingVideo ? 'Importing…' : 'Import from PC'}
          </button>
          <button type="button" className="btn btn-topbar" onClick={handleOpenProject}>
            Open Project
          </button>
          <button type="button" className="btn btn-topbar" onClick={handleSaveProject}>
            Save Project
          </button>
          <button
            type="button"
            className="btn btn-topbar btn-accent"
            onClick={handleExportMp4}
            disabled={!mainVideoUrl || backgroundExportActive}
            title="Export runs in the background — keep previewing and editing while it encodes"
          >
            {backgroundExportActive ? 'Export running…' : 'Export MP4'}
          </button>
          {backgroundExportActive && (
            <button
              type="button"
              className="btn btn-topbar"
              onClick={handleCancelExport}
              title="Stop background export"
            >
              Cancel export
            </button>
          )}
        </div>
      </header>

      {backgroundExportActive && (
        <div className="background-export-banner" role="status">
          <span className="background-export-label">
            Background export
            {exportProgress != null ? ` ${Math.round(exportProgress)}%` : ''}
            {exportStatusMessage ? ` — ${exportStatusMessage}` : ''}
          </span>
          {exportOutputPath && (
            <span className="background-export-path" title={exportOutputPath}>
              → {exportOutputPath}
            </span>
          )}
          <span className="background-export-hint">
            Preview and timeline stay live. Encoding uses idle CPU, spaced segments, and temp files
            only.
          </span>
        </div>
      )}

      <div className="main-stage">
        <LeftSidebar
          activePanel={leftPanel}
          onPanelChange={setLeftPanel}
          hasVideo={!!mainVideoUrl}
          mediaAssets={mediaAssets}
          selectedAssetIds={selectedAssetIds}
          timelapseModeActive={timelapseModeActive}
          timelapseSpeed={timelapseSpeed}
          timelapseSegments={timelapseSegments}
          timelapsePendingStart={timelapsePendingStart}
          isGeneratingDiagram={isGeneratingDiagram}
          onSelectAsset={handleSelectAsset}
          onRenameAsset={handleRenameAsset}
          onImportContent={handleImportContent}
          onAddAtPlayhead={handleAddAtPlayhead}
          onToggleTimelapseMode={handleToggleTimelapseMode}
          onTimelapseSpeedChange={setTimelapseSpeed}
          onRemoveTimelapseSegment={(id) =>
            setTimelapseSegments((s) => s.filter((seg) => seg.id !== id))
          }
          onClearTimelapse={() => {
            setTimelapseSegments([]);
            setTimelapsePendingStart(null);
          }}
          onGenerateDiagram={handleGenerateDiagram}
          onInsertDiagram={handleInsertDiagram}
        />

        <div className="center-stage">
          <VideoPreview
            mainVideoUrl={mainVideoUrl}
            mainVideoDuration={timelineSourceDuration}
            exportDuration={exportDuration}
            mediaAssets={mediaAssets}
            timelineClips={timelineClips}
            timelapseSegments={timelapseSegments}
            playhead={playhead}
            isPlaying={isPlaying}
            isImporting={isImportingVideo}
            isDragOver={isVideoDragOver}
            phoneUploadOpen={phoneUploadOpen}
            onImportClick={handleUploadMain}
            onPhoneUploadOpen={() => setPhoneUploadOpen(true)}
            onPhoneUploadClose={() => setPhoneUploadOpen(false)}
            onPlayheadTick={handlePlayheadTick}
            onMainDurationReady={handleMainDurationReady}
            onEnded={handleEnded}
          />
        </div>

        <RightSidebar activePanel={rightPanel} onPanelChange={setRightPanel} />
      </div>

      <div className="bottom-timeline">
        <Timeline
          duration={timelineSourceDuration || 60}
          exportDuration={exportDuration}
          clips={timelineClips}
          mediaAssets={mediaAssets}
          playhead={playhead}
          isPlaying={isPlaying}
          hasVideo={!!mainVideoUrl}
          selectedClipId={selectedClipId}
          onPlayheadSeek={handlePlayheadSeek}
          onSeekAndPlay={handleSeekAndPlay}
          onTogglePlay={togglePlay}
          onSkipStart={() => {
            setPlayhead(0);
            setIsPlaying(false);
          }}
          onSkipEnd={() => {
            setPlayhead(mainVideoDuration);
            setIsPlaying(false);
          }}
          onClipMove={handleClipMove}
          onSelectClip={handleSelectClip}
          onPlaceClip={placeClipOnTrack}
          onAddClip={() => handleAddAtPlayhead('broll')}
          timelapseSegments={timelapseSegments}
          timelapseModeActive={timelapseModeActive}
          timelapsePendingStart={timelapsePendingStart}
          diagramModeActive={diagramModeActive}
          onTimelapseClick={handleTimelapseClick}
        />
      </div>

      {statusMsg && <div className="status-toast">{statusMsg}</div>}
    </div>
  );
}

function formatShortTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}