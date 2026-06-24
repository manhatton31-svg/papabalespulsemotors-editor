import React, { useMemo, useState } from 'react';
import type { MediaAsset } from '../types/project';
import { MEDIA_DRAG_MIME } from '../types/content';
import { groupBrollForDisplay } from '../lib/brollSort';
import { Modal } from './Modal';
import './BRollLibrary.css';

interface BRollLibraryProps {
  assets: MediaAsset[];
  selectedId: string | null;
  playheadReady: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string) => void;
  onAddAtPlayhead: () => void;
}

export function BRollLibrary({
  assets,
  selectedId,
  playheadReady,
  onSelect,
  onRename,
  onToggleFavorite,
  onAddAtPlayhead,
}: BRollLibraryProps) {
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  const sections = useMemo(() => groupBrollForDisplay(assets), [assets]);

  const canInsert = playheadReady && !!selectedId;

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
    <div className="broll-library">
      <div className="broll-toolbar">
        <button
          type="button"
          className="btn btn-accent broll-insert-btn"
          onClick={onAddAtPlayhead}
          disabled={!canInsert}
          title={
            canInsert
              ? 'Insert selected clip at the playhead'
              : 'Click the timeline to set the playhead, then select a clip'
          }
        >
          Add B-Roll Right Here
        </button>
        <span className="broll-drag-hint">Drag clips onto the B-Roll track on the timeline</span>
      </div>

      <div className="broll-header">
        <h3>B-Roll Library</h3>
        <span className="broll-count">{assets.length}</span>
      </div>

      <div className="broll-scroll">
        {assets.length === 0 ? (
          <div className="broll-empty">
            <p>No B-roll yet</p>
            <span>Import videos from your phone or PC — clips appear here automatically.</span>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.tier} className="broll-section">
              <div className="broll-section-label">{section.label}</div>
              <div className="broll-grid">
                {section.assets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`broll-card ${selectedId === asset.id ? 'selected' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, asset)}
                    onClick={() => onSelect(asset.id)}
                    title={`${asset.friendlyName} — drag to timeline`}
                  >
                    <div className="broll-card-thumb">
                      {asset.thumbnail ? (
                        <img src={asset.thumbnail} alt={asset.friendlyName} loading="lazy" />
                      ) : (
                        <div className="broll-thumb-placeholder">🎬</div>
                      )}
                      <button
                        type="button"
                        className={`broll-fav-btn ${asset.favorite ? 'active' : ''}`}
                        title={asset.favorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(asset.id);
                        }}
                      >
                        {asset.favorite ? '♥' : '♡'}
                      </button>
                    </div>
                    <div className="broll-card-body">
                      <span className="broll-name">{asset.friendlyName}</span>
                      <span className="broll-duration">{formatDuration(asset.duration)}</span>
                    </div>
                    <div className="broll-card-actions">
                      <button
                        type="button"
                        className="broll-action-btn"
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
                        className="broll-action-btn"
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
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={renameModal !== null}
        title="Rename B-Roll"
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
          placeholder="e.g. motor_closeup"
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
              className="broll-preview-image"
              src={previewAsset.url}
              alt={previewAsset.friendlyName}
            />
          ) : (
            <video className="broll-preview-video" src={previewAsset.url} controls autoPlay />
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