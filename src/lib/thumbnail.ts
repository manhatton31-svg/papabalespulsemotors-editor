/** Capture a small JPEG thumbnail from a streamable video URL. */
export async function captureVideoThumbnail(url: string): Promise<string | undefined> {
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
      video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('load failed'));
        },
        { once: true }
      );
    });

    const seekTo = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(1, video.duration * 0.1)
      : 0.5;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('seek timeout')), 5000);
      video.addEventListener(
        'seeked',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      video.currentTime = seekTo;
    });

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, 160, 90);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}