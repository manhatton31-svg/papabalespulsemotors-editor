import React, { useState } from 'react';
import type { LibraryCategory } from '../types/content';
import type { MediaAsset } from '../types/project';
import { ContentLibrary } from './ContentLibrary';
import './IntrosOutrosPanel.css';

type BookendTab = 'intro' | 'outro';

interface IntrosOutrosPanelProps {
  mediaAssets: MediaAsset[];
  selectedAssetIds: { intro: string | null; outro: string | null };
  onSelectAsset: (category: LibraryCategory, id: string) => void;
  onRenameAsset: (category: LibraryCategory, id: string, name: string) => void;
  onImportContent: (category: LibraryCategory) => void;
  onAddAtPlayhead: (category: LibraryCategory) => void;
}

export function IntrosOutrosPanel({
  mediaAssets,
  selectedAssetIds,
  onSelectAsset,
  onRenameAsset,
  onImportContent,
  onAddAtPlayhead,
}: IntrosOutrosPanelProps) {
  const [tab, setTab] = useState<BookendTab>('intro');

  const assetsFor = (category: BookendTab) =>
    mediaAssets.filter((a) => a.category === category);

  return (
    <div className="intros-outros-panel">
      <div className="bookend-tabs">
        <button
          type="button"
          className={`bookend-tab ${tab === 'intro' ? 'active' : ''}`}
          onClick={() => setTab('intro')}
        >
          🎞 Intros
        </button>
        <button
          type="button"
          className={`bookend-tab ${tab === 'outro' ? 'active' : ''}`}
          onClick={() => setTab('outro')}
        >
          🏁 Outros
        </button>
      </div>
      <ContentLibrary
        category={tab}
        assets={assetsFor(tab)}
        selectedId={selectedAssetIds[tab]}
        onSelect={(id) => onSelectAsset(tab, id)}
        onRename={(id, name) => onRenameAsset(tab, id, name)}
        onImport={() => onImportContent(tab)}
        onAddAtPlayhead={() => onAddAtPlayhead(tab)}
      />
    </div>
  );
}