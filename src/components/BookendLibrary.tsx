import React, { useState } from 'react';
import type { LibraryCategory } from '../types/content';
import { MEDIA_DRAG_MIME } from '../types/content';
import type { MediaAsset } from '../types/project';
import { Modal } from './Modal';
import './IntrosOutrosPanel.css';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface BookendLibraryProps {
  title: string;
  icon: string;
  category: Extract<LibraryCategory, 'intro' | 'outro'>;
  assets: MediaAsset[];
  selectedId: string | null;
  emptyHint: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: () => void;
}

export function BookendLibrary({
  title,
  icon,
  category,
  assets,
  selectedId,
  emptyHint,
  onSelect,
  onRename,
  onImport,
}: BookendLibraryProps) {
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

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
    <section className={`bookend-section bookend-section-${category}`}>
      <div className="bookend-section-header">
        <h3>
          <span className="bookend-section-icon">{icon}</span>
          {title}
        </h3>
        <div className="bookend-section-meta">
          <span className="bookend-count">{assets.length}</span>
          <button type="button" className="bookend-import-link" onClick={onImport}>
            Import…
          </button>
        </div>
      </div>

      <div className="bookend-grid-wrap">
        {assets.length === 0 ? (
          <div className="bookend-empty">
            <p>No {title.toLowerCase()} yet</p>
            <span>{emptyHint}</span>
          </div>
        ) : (
          <div className="bookend-grid">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className={`bookend-card ${selectedId === asset.id ? 'selected' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, asset)}
                onClick={() => onSelect(asset.id)}
                title={`${asset.friendlyName} — drag to ${title} track`}
              >
                <div className="bookend-card-thumb">
                  {asset.thumbnail ? (
                    <img src={asset.thumbnail} alt={asset.friendlyName} loading="lazy" />
                  ) : (
                    <div className="bookend-thumb-placeholder">{icon}</div>
                  )}
                </div>
                <div className="bookend-card-body">
                  <span className="bookend-name">{asset.friendlyName}</span>
                  <span className="bookend-duration">{formatDuration(asset.duration)}</span>
                </div>
                <div className="bookend-card-actions">
                  <button
                    type="button"
                    className="bookend-action-btn"
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
                    className="bookend-action-btn"
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
        )}
      </div>

      <Modal
        open={renameModal !== null}
        title={`Rename ${title.slice(0, -1)}`}
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
          className="bookend-rename-input"
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
          <video className="bookend-preview-video" src={previewAsset.url} controls autoPlay />
        )}
      </Modal>
    </section>
  );
}