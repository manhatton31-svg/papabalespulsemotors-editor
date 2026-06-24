import { invoke, isTauri } from '@tauri-apps/api/core';
import type { TimelapseSegment } from '../types/timelapse';

export interface TimelapseBakeResult {
  jobId: string;
  outputPath: string;
  duration: number;
  asyncStarted: boolean;
}

export interface TimelapseBakeOptions {
  previewMode?: boolean;
  jobId?: string;
}

export async function applyTimelapseToMaster(
  inputPath: string,
  segments: TimelapseSegment[],
  sourceDuration?: number,
  options: TimelapseBakeOptions = {}
): Promise<TimelapseBakeResult> {
  if (!isTauri()) {
    throw new Error('Timelapse baking requires the desktop app');
  }
  if (!inputPath || segments.length === 0) {
    throw new Error('No video or timelapse regions to apply');
  }

  return invoke<TimelapseBakeResult>('apply_timelapse_segments', {
    inputPath,
    segments: segments.map((s) => ({
      start_time: s.startTime,
      end_time: s.endTime,
      speed_factor: s.speedFactor,
    })),
    sourceDuration:
      sourceDuration && sourceDuration > 0 ? sourceDuration : undefined,
    previewMode: options.previewMode ?? true,
    jobId: options.jobId,
  });
}