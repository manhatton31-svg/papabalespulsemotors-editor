import React, { useEffect, useState } from 'react';
import {
  EXPORT_QUALITY_OPTIONS,
  EXPORT_RESOLUTION_OPTIONS,
  defaultExportFileName,
  getDefaultExportFolder,
  pickExportFolder,
  openExportFolder,
  type ExportIncludeOptions,
  type ExportQualityPreset,
  type ExportResolution,
  type ExportSettings,
} from '../lib/export';
import './ExportSettingsModal.css';

export type ExportModalPhase = 'settings' | 'exporting' | 'complete';

interface ExportSettingsModalProps {
  open: boolean;
  projectName: string;
  phase: ExportModalPhase;
  progress: number | null;
  statusMessage: string | null;
  outputPath: string | null;
  onClose: () => void;
  onStartExport: (settings: ExportSettings) => void;
  onCancelExport: () => void;
}

const DEFAULT_INCLUDE: ExportIncludeOptions = {
  broll: true,
  introsOutros: true,
  timelapse: true,
  diagrams: true,
};

export function ExportSettingsModal({
  open,
  projectName,
  phase,
  progress,
  statusMessage,
  outputPath,
  onClose,
  onStartExport,
  onCancelExport,
}: ExportSettingsModalProps) {
  const [fileName, setFileName] = useState('');
  const [destinationFolder, setDestinationFolder] = useState('');
  const [qualityPreset, setQualityPreset] = useState<ExportQualityPreset>('youtube');
  const [resolution, setResolution] = useState<ExportResolution>('original');
  const [include, setInclude] = useState<ExportIncludeOptions>(DEFAULT_INCLUDE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFileName(defaultExportFileName(projectName));
    setQualityPreset('youtube');
    setResolution('original');
    setInclude(DEFAULT_INCLUDE);
    setError(null);
    getDefaultExportFolder()
      .then(setDestinationFolder)
      .catch(() => setDestinationFolder(''));
  }, [open, projectName]);

  if (!open) return null;

  const handleBrowseFolder = async () => {
    const folder = await pickExportFolder(destinationFolder || undefined);
    if (folder) setDestinationFolder(folder);
  };

  const handleExport = () => {
    const trimmedName = fileName.trim();
    if (!trimmedName) {
      setError('Enter an output filename');
      return;
    }
    if (!destinationFolder.trim()) {
      setError('Choose a destination folder');
      return;
    }
    setError(null);
    onStartExport({
      fileName: trimmedName,
      destinationFolder: destinationFolder.trim(),
      qualityPreset,
      resolution,
      include,
    });
  };

  const handleOpenFolder = async () => {
    if (!outputPath) return;
    try {
      await openExportFolder(outputPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const canClose = phase !== 'exporting';

  return (
    <div className="export-modal-overlay" role="dialog" aria-modal="true">
      <div className="export-modal">
        <button
          type="button"
          className="export-modal-close"
          onClick={onClose}
          disabled={!canClose}
          aria-label="Close"
        >
          ×
        </button>

        <header className="export-modal-header">
          <h2>Export MP4</h2>
          <p>Render your edited timeline to a shareable video file.</p>
        </header>

        {phase === 'settings' && (
          <div className="export-modal-body">
            <div className="export-field">
              <label htmlFor="export-filename">Output filename</label>
              <div className="export-filename-row">
                <input
                  id="export-filename"
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                />
                <span className="export-filename-ext">.mp4</span>
              </div>
            </div>

            <div className="export-field">
              <label htmlFor="export-folder">Destination folder</label>
              <div className="export-folder-row">
                <input
                  id="export-folder"
                  type="text"
                  value={destinationFolder}
                  readOnly
                  placeholder="Choose a folder…"
                />
                <button type="button" className="btn btn-topbar" onClick={handleBrowseFolder}>
                  Browse…
                </button>
              </div>
            </div>

            <div className="export-field-grid">
              <div className="export-field">
                <label htmlFor="export-quality">Quality preset</label>
                <select
                  id="export-quality"
                  value={qualityPreset}
                  onChange={(e) => setQualityPreset(e.target.value as ExportQualityPreset)}
                >
                  {EXPORT_QUALITY_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="export-field-hint">
                  {EXPORT_QUALITY_OPTIONS.find((o) => o.id === qualityPreset)?.hint}
                </span>
              </div>

              <div className="export-field">
                <label htmlFor="export-resolution">Resolution</label>
                <select
                  id="export-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ExportResolution)}
                >
                  {EXPORT_RESOLUTION_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset className="export-include-group">
              <legend>Include in export</legend>
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={include.broll}
                  onChange={(e) => setInclude((prev) => ({ ...prev, broll: e.target.checked }))}
                />
                B-Roll overlays
              </label>
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={include.introsOutros}
                  onChange={(e) =>
                    setInclude((prev) => ({ ...prev, introsOutros: e.target.checked }))
                  }
                />
                Intros / Outros
              </label>
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={include.timelapse}
                  onChange={(e) =>
                    setInclude((prev) => ({ ...prev, timelapse: e.target.checked }))
                  }
                />
                Timelapse segments
              </label>
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={include.diagrams}
                  onChange={(e) =>
                    setInclude((prev) => ({ ...prev, diagrams: e.target.checked }))
                  }
                />
                Diagram overlays
              </label>
            </fieldset>

            {error && <p className="export-modal-error">{error}</p>}

            <button type="button" className="btn btn-accent export-modal-primary" onClick={handleExport}>
              Export MP4
            </button>
          </div>
        )}

        {phase === 'exporting' && (
          <div className="export-modal-body export-modal-progress-view">
            <p className="export-progress-title">Exporting in the background…</p>
            <p className="export-progress-subtitle">
              You can keep editing while the render finishes.
            </p>
            <div className="export-progress-bar-wrap">
              <div
                className="export-progress-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, progress ?? 0))}%` }}
              />
            </div>
            <div className="export-progress-meta">
              <span>{progress != null ? `${Math.round(progress)}%` : 'Starting…'}</span>
              {statusMessage && <span>{statusMessage}</span>}
            </div>
            {outputPath && (
              <p className="export-output-path" title={outputPath}>
                → {outputPath}
              </p>
            )}
            <button type="button" className="btn btn-secondary export-cancel-btn" onClick={onCancelExport}>
              Cancel export
            </button>
          </div>
        )}

        {phase === 'complete' && (
          <div className="export-modal-body export-modal-complete-view">
            <div className="export-complete-icon">✓</div>
            <p className="export-complete-title">Export complete</p>
            <p className="export-complete-subtitle">Your video is ready to upload or share.</p>
            {outputPath && (
              <p className="export-output-path" title={outputPath}>
                {outputPath}
              </p>
            )}
            <div className="export-complete-actions">
              <button type="button" className="btn btn-accent" onClick={handleOpenFolder}>
                Open output folder
              </button>
              <button type="button" className="btn btn-topbar" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}