import { invoke, isTauri } from '@tauri-apps/api/core';
import { getActiveFullFrameAt, localTimeInClip } from '../utils/playback';
import { globalTimeToMainSource } from './timelinePlayback';
import type { MediaAsset, TimelineClip } from '../types/project';

export interface VideoSourceAtTime {
  filePath: string;
  localTime: number;
  sourceLabel: string;
}

export interface ClipBrollPendingStart {
  globalTime: number;
  sourcePath: string;
  localTime: number;
  sourceLabel: string;
}

export interface ClipBrollExtractRequest {
  sourcePath: string;
  startLocal: number;
  endLocal: number;
  defaultName: string;
}

export interface ExtractBrollClipResult {
  filePath: string;
  duration: number;
}

function formatTimeForName(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

export function defaultBrollClipName(sourceLabel: string, localStart: number): string {
  const base = sourceLabel
    .trim()
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32);
  const safeBase = base || 'clip';
  return `${safeBase}_${formatTimeForName(localStart)}`;
}

/** Resolve which source video file and local time are active at a global timeline position. */
export function resolveVideoSourceAtTime(
  globalTime: number,
  clips: TimelineClip[],
  assets: MediaAsset[],
  mainVideoPath: string | null,
  mainClipOffset: number
): VideoSourceAtTime | null {
  const overlay = getActiveFullFrameAt(globalTime, clips, assets);
  if (overlay?.asset.mediaType === 'video') {
    return {
      filePath: overlay.asset.filePath,
      localTime: localTimeInClip(globalTime, overlay.clip),
      sourceLabel: overlay.asset.friendlyName,
    };
  }

  const mainClip = clips.find((c) => c.track === 'main');
  if (!mainVideoPath || !mainClip) return null;

  const mainStart = mainClip.startTime;
  const mainEnd = mainClip.startTime + mainClip.duration;
  if (globalTime >= mainStart && globalTime < mainEnd) {
    return {
      filePath: mainVideoPath,
      localTime: globalTimeToMainSource(globalTime, mainClipOffset),
      sourceLabel: 'Main_Video',
    };
  }

  return null;
}

export async function extractBrollClipFromVideo(
  sourcePath: string,
  startLocal: number,
  endLocal: number,
  friendlyName: string
): Promise<ExtractBrollClipResult> {
  if (!isTauri()) {
    throw new Error('Clip B-Roll requires the desktop app');
  }
  return invoke<ExtractBrollClipResult>('extract_broll_clip', {
    sourcePath,
    start: startLocal,
    end: endLocal,
    friendlyName,
  });
}