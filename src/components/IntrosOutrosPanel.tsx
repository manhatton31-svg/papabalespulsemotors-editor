import React, { useState } from 'react';
import type { LibraryCategory } from '../types/content';
import { MEDIA_DRAG_MIME } from '../types/content';
import type { MediaAsset } from '../types/project';
import { Modal } from './Modal';
import './IntrosOutrosPanel.css';

interface IntrosOutrosPanelProps {
  hasVideo: boolean;
  introAssets: MediaAsset[];
  outroAssets: MediaAsset[];
  selectedAssetIds: { intro: string | null; outro: string | null };
  isGeneratingHook: boolean;
  onSelectAsset: (category: LibraryCategory, id: string) => void;
  onRenameAsset: (category: LibraryCategory, id: string, name: string) => void;
  onImportContent: (category: LibraryCategory) => void;
  onGenerateHookPreview: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface BookendSectionProps {
  title: string;
  icon: string;
  category: 'intro' | 'outro';
  assets: MediaAsset[];
  selectedId: string | null;
  emptyHint: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: () => void;
}

function BookendSection({
  title,
  icon,
  category,
  assets,
  selectedId,
  emptyHint,
  onSelect,
  onRename,
  onImport,
}: BookendSectionProps) {
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

export function IntrosOutrosPanel({
  hasVideo,
  introAssets,
  outroAssets,
  selectedAssetIds,
  isGeneratingHook,
  onSelectAsset,
  onRenameAsset,
  onImportContent,
  onGenerateHookPreview,
}: IntrosOutrosPanelProps) {
  return (
    <div className="intros-outros-panel">
      <div className="intros-outros-toolbar">
        <button
          type="button"
          className="btn btn-accent hook-preview-btn"
          onClick={onGenerateHookPreview}
          disabled={!hasVideo || isGeneratingHook}
          title={
            hasVideo
              ? 'Analyze main video and build a hook montage at the timeline start'
              : 'Import a main video first'
          }
        >
          {isGeneratingHook ? 'Generating hook…' : 'Generate Hook Preview'}
        </button>
        <span className="intros-outros-hint">
          Drag intros and outros onto their tracks on the timeline
        </span>
        <p className="intros-outros-phase-note">Phase 2: AI-generated dynamic intros coming soon</p>
      </div>

      <div className="intros-outros-scroll">
        <BookendSection
          title="Intros"
          icon="🎞"
          category="intro"
          assets={introAssets}
          selectedId={selectedAssetIds.intro}
          emptyHint="Generate a hook preview or import branded intro clips"
          onSelect={(id) => onSelectAsset('intro', id)}
          onRename={(id, name) => onRenameAsset('intro', id, name)}
          onImport={() => onImportContent('intro')}
        />

        <BookendSection
          title="Outros"
          icon="🏁"
          category="outro"
          assets={outroAssets}
          selectedId={selectedAssetIds.outro}
          emptyHint="Import branded outro clips to drag onto the Outro track"
          onSelect={(id) => onSelectAsset('outro', id)}
          onRename={(id, name) => onRenameAsset('outro', id, name)}
          onImport={() => onImportContent('outro')}
        />
      </div>
    </div>
  );
}