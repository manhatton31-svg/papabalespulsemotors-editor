import React from 'react';
import type { ImportProgress } from '../lib/importSession';
import './ImportProgressBanner.css';

interface ImportProgressBannerProps {
  progress: ImportProgress;
}

export function ImportProgressBanner({ progress }: ImportProgressBannerProps) {
  const hint =
    progress.phase === 'stitching'
      ? `Crossfade transitions (${progress.clipCount} clips) — you can keep using the editor`
      : progress.phase === 'generating-hook'
        ? 'Finding the best moments and placing hooks on your Hooks track'
        : null;

  return (
    <div className="import-pipeline-banner" role="status" aria-live="polite">
      <span className="import-pipeline-spinner" aria-hidden="true" />
      <span className="import-pipeline-label">{progress.message}</span>
      {hint && <span className="import-pipeline-hint">{hint}</span>}
    </div>
  );
}