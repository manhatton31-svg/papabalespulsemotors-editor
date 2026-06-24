import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauri } from '@tauri-apps/api/core';
import { isVideoFilePath } from '../lib/video';

export function useVideoDropImport(
  enabled: boolean,
  onDrop: (filePath: string) => void,
  onDragStateChange?: (dragging: boolean) => void
) {
  useEffect(() => {
    if (!enabled || !isTauri()) return;

    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          onDragStateChange?.(true);
          return;
        }
        if (payload.type === 'leave') {
          onDragStateChange?.(false);
          return;
        }
        if (payload.type === 'drop') {
          onDragStateChange?.(false);
          const video = payload.paths.find((p) => isVideoFilePath(p));
          if (video) onDrop(video);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
      onDragStateChange?.(false);
    };
  }, [enabled, onDrop, onDragStateChange]);
}