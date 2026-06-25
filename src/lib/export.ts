import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { downloadDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import type { OverlayTrack } from '../types/content';
import type { MediaAsset, TimelineClip } from '../types/project';
import type { TimelapseSegment } from '../types/timelapse';
import { getMainClipOffset } from './timelinePlayback';
import { getAppDataDir } from './tauriFs';
import { sanitizeProjectFileName } from './project';

export type ExportQualityPreset = 'high' | 'youtube' | 'fast';
export type ExportResolution = 'original' | '1080p' | '4k';

export interface ExportIncludeOptions {
  broll: boolean;
  introsOutros: boolean;
  timelapse: boolean;
  diagrams: boolean;
}

export interface ExportSettings {
  fileName: string;
  destinationFolder: string;
  qualityPreset: ExportQualityPreset;
  resolution: ExportResolution;
  include: ExportIncludeOptions;
}

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

export const EXPORT_QUALITY_OPTIONS: { id: ExportQualityPreset; label: string; hint: string }[] = [
  { id: 'high', label: 'High Quality', hint: 'Best visual quality, slower encode' },
  { id: 'youtube', label: 'YouTube Optimized', hint: 'Balanced quality with fast-start playback' },
  { id: 'fast', label: 'Fast Export', hint: 'Quickest render, good for drafts' },
];

export const EXPORT_RESOLUTION_OPTIONS: { id: ExportResolution; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: '1080p', label: '1080p' },
  { id: '4k', label: '4K' },
];

export function defaultExportFileName(projectName: string): string {
  const base = sanitizeProjectFileName(projectName || 'export');
  return base.endsWith('.mp4') ? base.slice(0, -4) : base;
}

export function buildExportOutputPath(folder: string, fileName: string): string {
  const trimmedFolder = folder.replace(/[/\\]+$/, '');
  const safeName = sanitizeProjectFileName(fileName.replace(/\.mp4$/i, ''));
  const separator = trimmedFolder.includes('\\') ? '\\' : '/';
  return `${trimmedFolder}${separator}${safeName}.mp4`;
}

export async function getDefaultExportFolder(): Promise<string> {
  try {
    return await downloadDir();
  } catch {
    const appData = await getAppDataDir();
    return `${appData.replace(/[/\\]+$/, '')}/exports`;
  }
}

export async function pickExportFolder(currentFolder?: string): Promise<string | null> {
  const selected = await open({
    title: 'Choose export folder',
    directory: true,
    multiple: false,
    defaultPath: currentFolder,
  });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

export async function openExportFolder(outputPath: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('open_path_in_explorer', { path: outputPath });
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

function buildOverlayClips(
  clips: TimelineClip[],
  assets: MediaAsset[],
  include: ExportIncludeOptions
): ExportOverlayClip[] {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const result: ExportOverlayClip[] = [];

  for (const clip of clips) {
    if (clip.track === 'main' || clip.track === 'timelapse') continue;
    const track = clip.track as OverlayTrack;

    const allowed =
      (track === 'broll' && include.broll) ||
      ((track === 'intro' || track === 'outro') && include.introsOutros) ||
      (track === 'diagram' && include.diagrams);

    if (!allowed) continue;

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
  settings: ExportSettings;
}) {
  const overlayClips = buildOverlayClips(
    params.timelineClips,
    params.mediaAssets,
    params.settings.include
  );

  const timelapseSegments = params.settings.include.timelapse
    ? params.timelapseSegments
    : [];

  const mainTimelineStart = getMainClipOffset(params.timelineClips);

  return {
    mainPath: params.mainVideoPath,
    outputPath: params.outputPath,
    timelapseSegments: timelapseSegments.map((s) => ({
      start_time: s.startTime,
      end_time: s.endTime,
      speed_factor: s.speedFactor,
    })),
    overlayClips,
    sourceDuration:
      params.sourceVideoDuration > 0 ? params.sourceVideoDuration : undefined,
    leadInDuration: mainTimelineStart > 0 ? mainTimelineStart : undefined,
    mainTimelineStart: mainTimelineStart > 0 ? mainTimelineStart : undefined,
    exportSettings: {
      qualityPreset: params.settings.qualityPreset,
      resolution: params.settings.resolution,
    },
  };
}

/** Starts export in a background thread — app stays fully interactive. */
export async function startBackgroundExport(params: {
  mainVideoPath: string;
  sourceVideoDuration: number;
  timelapseSegments: TimelapseSegment[];
  timelineClips: TimelineClip[];
  mediaAssets: MediaAsset[];
  settings: ExportSettings;
}): Promise<ExportStartResult> {
  if (!isTauri()) {
    throw new Error('MP4 export requires the desktop app');
  }
  if (!params.mainVideoPath) {
    throw new Error('Upload a main video before exporting');
  }

  const outputPath = buildExportOutputPath(
    params.settings.destinationFolder,
    params.settings.fileName
  );

  if (!outputPath) {
    throw new Error('Invalid export path');
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