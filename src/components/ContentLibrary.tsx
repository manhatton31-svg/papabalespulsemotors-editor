import React, { useState } from 'react';
import type { LibraryCategory } from '../types/content';
import { CONTENT_LIBRARY_CONFIG, MEDIA_DRAG_MIME } from '../types/content';
import type { MediaAsset } from '../types/project';
import { Modal } from './Modal';
import './ContentLibrary.css';

interface ContentLibraryProps {
  category: LibraryCategory;
  assets: MediaAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: () => void;
  onAddAtPlayhead: () => void;
}

export function ContentLibrary({
  category,
  assets,
  selectedId,
  onSelect,
  onRename,
  onImport,
  onAddAtPlayhead,
}: ContentLibraryProps) {
  const config = CONTENT_LIBRARY_CONFIG[category];
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  const openRename = (asset: MediaAsset) => {
    setRenameModal({ id: asset.id, name: asset.friendlyName });
  };

  const confirmRename = () => {
    if (renameModal) {
      onRename(renameModal.id, renameModal.name.trim() || 'Untitled');
      setRenameModal(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, asset: MediaAsset) => {
    e.dataTransfer.setData(
      MEDIA_DRAG_MIME,
      JSON.stringify({ assetId: asset.id, category: asset.category })
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="content-library">
      <div className="content-toolbar">
        <button type="button" className="btn btn-sm btn-primary" onClick={onImport}>
          {config.importLabel}
        </button>
        <button type="button" className="btn btn-sm btn-accent" onClick={onAddAtPlayhead}>
          {config.addLabel}
        </button>
        <span className="content-drag-hint">{config.dragHint}</span>
      </div>

      <div className="content-header">
        <h3>Clips</h3>
        <span className="content-count">{assets.length}</span>
      </div>

      <div className="content-list">
        {assets.length === 0 ? (
          <div className="content-empty">
            <p>{config.emptyTitle}</p>
            <span>{config.emptyHint}</span>
          </div>
        ) : (
          assets.map((asset) => (
            <div
              key={asset.id}
              className={`content-item ${selectedId === asset.id ? 'selected' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, asset)}
              onClick={() => onSelect(asset.id)}
              title={`${asset.friendlyName} — drag to timeline`}
            >
              <div className="content-thumb">
                {asset.thumbnail ? (
                  <img src={asset.thumbnail} alt={asset.friendlyName} loading="lazy" />
                ) : (
                  <div className="content-thumb-placeholder">{config.listIcon}</div>
                )}
              </div>
              <div className="content-info">
                <span className="content-name">{asset.friendlyName}</span>
                <span className="content-duration">{formatDuration(asset.duration)}</span>
              </div>
              <div className="content-actions">
                <button
                  type="button"
                  className="content-action-btn"
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
                  className="content-action-btn"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRename(asset);
                  }}
                >
                  ✎
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={renameModal !== null}
        title={`Rename ${config.shortLabel}`}
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
          className="rename-input"
          value={renameModal?.name ?? ''}
          onChange={(e) => setRenameModal((m) => (m ? { ...m, name: e.target.value } : null))}
          onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
          autoFocus
          placeholder="e.g. motor_schematic_v2"
        />
      </Modal>

      <Modal
        open={previewAsset !== null}
        title={previewAsset?.friendlyName ?? 'Preview'}
        onClose={() => setPreviewAsset(null)}
      >
        {previewAsset &&
          (previewAsset.mediaType === 'image' ? (
            <img
              className="content-preview-image"
              src={previewAsset.url}
              alt={previewAsset.friendlyName}
            />
          ) : (
            <video className="content-preview-video" src={previewAsset.url} controls autoPlay />
          ))}
      </Modal>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}