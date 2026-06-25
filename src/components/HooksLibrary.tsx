import React, { useMemo, useState } from 'react';
import { MEDIA_DRAG_MIME } from '../types/content';
import type { MediaAsset } from '../types/project';
import { groupHooksForDisplay } from '../lib/hookSort';
import { Modal } from './Modal';
import './HooksLibrary.css';

interface HooksLibraryProps {
  assets: MediaAsset[];
  selectedId: string | null;
  hasVideo: boolean;
  isGeneratingHook: boolean;
  playheadReady: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddAtPlayhead: () => void;
  onImport: () => void;
  onGenerateHookPreview: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function HooksLibrary({
  assets,
  selectedId,
  hasVideo,
  isGeneratingHook,
  playheadReady,
  onSelect,
  onRename,
  onToggleFavorite,
  onAddAtPlayhead,
  onImport,
  onGenerateHookPreview,
}: HooksLibraryProps) {
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  const sections = useMemo(() => groupHooksForDisplay(assets), [assets]);
  const canInsert = playheadReady && !!selectedId;

  const handleDragStart = (e: React.DragEvent, asset: MediaAsset) => {
    e.dataTransfer.setData(
      MEDIA_DRAG_MIME,
      JSON.stringify({ assetId: asset.id, category: asset.category })
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  const confirmRename = () => {
    if (renameModal) {
      onRename(renameModal.id, renameModal.name.trim() || 'Untitled');
      setRenameModal(null);
    }
  };

  return (
    <div className="hooks-library">
      <div className="hooks-toolbar">
        <button
          type="button"
          className="btn btn-accent hooks-generate-btn"
          onClick={onGenerateHookPreview}
          disabled={!hasVideo || isGeneratingHook}
          title={
            hasVideo
              ? 'Analyze main video and place hook clips at the timeline start'
              : 'Import a main video first'
          }
        >
          {isGeneratingHook ? 'Generating hooks…' : 'Generate Hook Preview'}
        </button>
        <button
          type="button"
          className="btn btn-secondary hooks-insert-btn"
          onClick={onAddAtPlayhead}
          disabled={!canInsert}
          title={
            canInsert
              ? 'Insert selected hook at the playhead'
              : 'Click the timeline to set the playhead, then select a hook'
          }
        >
          Add Hook at Playhead
        </button>
        <span className="hooks-drag-hint">Drag hooks onto the Hooks track on the timeline</span>
      </div>

      <div className="hooks-header">
        <h3>Hooks Library</h3>
        <div className="hooks-header-actions">
          <span className="hooks-count">{assets.length}</span>
          <button type="button" className="hooks-import-link" onClick={onImport}>
            Import…
          </button>
        </div>
      </div>

      <div className="hooks-scroll">
        {assets.length === 0 ? (
          <div className="hooks-empty">
            <p>No hooks yet</p>
            <span>
              Upload a video and hooks will generate automatically, or use Generate Hook Preview.
            </span>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.tier} className="hooks-section">
              <div className="hooks-section-label">{section.label}</div>
              <div className="hooks-grid">
                {section.assets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`hooks-card ${selectedId === asset.id ? 'selected' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, asset)}
                    onClick={() => onSelect(asset.id)}
                    title={`${asset.friendlyName} — drag to Hooks track`}
                  >
                    <div className="hooks-card-thumb">
                      {asset.thumbnail ? (
                        <img src={asset.thumbnail} alt={asset.friendlyName} loading="lazy" />
                      ) : (
                        <div className="hooks-thumb-placeholder">⚡</div>
                      )}
                      <button
                        type="button"
                        className={`hooks-fav-btn ${asset.favorite ? 'active' : ''}`}
                        title={asset.favorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(asset.id);
                        }}
                      >
                        {asset.favorite ? '♥' : '♡'}
                      </button>
                    </div>
                    <div className="hooks-card-body">
                      <span className="hooks-name">{asset.friendlyName}</span>
                      <span className="hooks-duration">{formatDuration(asset.duration)}</span>
                    </div>
                    <div className="hooks-card-actions">
                      <button
                        type="button"
                        className="hooks-action-btn"
                        title="Preview"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewAsset(asset);
                        }}
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        className="hooks-action-btn"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameModal({ id: asset.id, name: asset.friendlyName });
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={renameModal !== null}
        title="Rename Hook"
        onClose={() => setRenameModal(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setRenameModal(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmRename}>
              Save
            </button>
          </>
        }
      >
        <input
          className="hooks-rename-input"
          value={renameModal?.name ?? ''}
          onChange={(e) => setRenameModal((m) => (m ? { ...m, name: e.target.value } : null))}
          onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
          autoFocus
        />
      </Modal>

      <Modal
        open={previewAsset !== null}
        title={previewAsset?.friendlyName ?? 'Preview'}
        onClose={() => setPreviewAsset(null)}
      >
        {previewAsset && (
          <video className="hooks-preview-video" src={previewAsset.url} controls autoPlay />
        )}
      </Modal>
    </div>
  );
}