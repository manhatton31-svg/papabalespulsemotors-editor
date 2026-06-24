import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import type { OverlayTrack } from '../types/content';
import type { MediaAsset, TimelineClip } from '../types/project';
import type { TimelapseSegment } from '../types/timelapse';

export interface ExportStartResult {
  jobId: string;
  outputPath: string;
  asyncStarted: boolean;
}

export interface ExportProgressEvent {
  jobId: string;
  progress: number;
  elapsedMs: number;
  status: string;
  message?: string;
}

export interface ExportCompleteEvent {
  jobId: string;
  outputPath: string;
  duration: number;
  status: string;
  message?: string;
}

export function subscribeExportProgress(
  onProgress: (event: ExportProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<ExportProgressEvent>('export-progress', (payload) => {
    onProgress(payload.payload);
  });
}

export function subscribeExportComplete(
  onComplete: (event: ExportCompleteEvent) => void
): Promise<UnlistenFn> {
  return listen<ExportCompleteEvent>('export-complete', (payload) => {
    onComplete(payload.payload);
  });
}

interface ExportOverlayClip {
  file_path: string;
  start_time: number;
  duration: number;
  track: string;
  is_image: boolean;
}

const FULL_FRAME_TRACKS: OverlayTrack[] = ['intro', 'outro', 'broll'];

export async function pickExportPath(defaultName: string): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return path ?? null;
}

function buildOverlayClips(
  clips: TimelineClip[],
  assets: MediaAsset[]
): ExportOverlayClip[] {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const result: ExportOverlayClip[] = [];

  for (const clip of clips) {
    if (!FULL_FRAME_TRACKS.includes(clip.track as OverlayTrack)) continue;
    const asset = assetById.get(clip.assetId);
    if (!asset) continue;
    result.push({
      file_path: asset.filePath,
      start_time: clip.startTime,
      duration: clip.duration,
      track: clip.track,
      is_image: asset.mediaType === 'image',
    });
  }

  return result;
}

function buildExportInvokeArgs(params: {
  mainVideoPath: string;
  sourceVideoDuration: number;
  outputPath: string;
  timelapseSegments: TimelapseSegment[];
  timelineClips: TimelineClip[];
  mediaAssets: MediaAsset[];
}) {
  const overlayClips = buildOverlayClips(params.timelineClips, params.mediaAssets);
  return {
    mainPath: params.mainVideoPath,
    outputPath: params.outputPath,
    timelapseSegments: params.timelapseSegments.map((s) => ({
      start_time: s.startTime,
      end_time: s.endTime,
      speed_factor: s.speedFactor,
    })),
    overlayClips,
    sourceDuration:
      params.sourceVideoDuration > 0 ? params.sourceVideoDuration : undefined,
  };
}

/** Starts export in a background thread — app stays fully interactive. */
export async function startBackgroundExport(params: {
  mainVideoPath: string;
  sourceVideoDuration: number;
  projectName: string;
  timelapseSegments: TimelapseSegment[];
  timelineClips: TimelineClip[];
  mediaAssets: MediaAsset[];
  outputPath?: string;
}): Promise<ExportStartResult> {
  if (!isTauri()) {
    throw new Error('MP4 export requires the desktop app');
  }
  if (!params.mainVideoPath) {
    throw new Error('Upload a main video before exporting');
  }

  const outputPath =
    params.outputPath ??
    (await pickExportPath(
      `${params.projectName.replace(/[^\w\-]+/g, '_') || 'export'}.mp4`
    ));

  if (!outputPath) {
    throw new Error('Export cancelled');
  }

  return invoke<ExportStartResult>(
    'start_export_mp4',
    buildExportInvokeArgs({ ...params, outputPath })
  );
}

export async function cancelBackgroundExport(): Promise<void> {
  if (!isTauri()) return;
  await invoke('cancel_export_mp4');
}