import { invoke, isTauri } from '@tauri-apps/api/core';

function readDurationFromVideo(video: HTMLVideoElement): number {
  let best = 0;
  if (Number.isFinite(video.duration) && video.duration > 0 && video.duration !== Infinity) {
    best = video.duration;
  }
  if (video.seekable.length > 0) {
    const end = video.seekable.end(video.seekable.length - 1);
    if (Number.isFinite(end) && end > best) best = end;
  }
  if (video.buffered.length > 0) {
    const end = video.buffered.end(video.buffered.length - 1);
    if (Number.isFinite(end) && end > best) best = end;
  }
  return best;
}

/** Probe duration via hidden <video> with seekable/buffered fallbacks. */
export function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };

    const check = () => {
      const d = readDurationFromVideo(video);
      if (d > 0) finish(d);
    };

    video.addEventListener('loadedmetadata', check);
    video.addEventListener('durationchange', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('error', () => finish(0));
    setTimeout(() => finish(readDurationFromVideo(video)), 12_000);
  });
}

/** ffprobe/ffmpeg via Tauri, then browser probe as fallback. */
export async function resolveVideoDuration(filePath: string, url: string): Promise<number> {
  let probed = 0;
  if (isTauri() && filePath) {
    try {
      probed = await invoke<number>('get_video_duration', { path: filePath });
    } catch {
      probed = 0;
    }
  }
  const browser = await probeVideoDuration(url);
  return Math.max(probed, browser, 0);
}