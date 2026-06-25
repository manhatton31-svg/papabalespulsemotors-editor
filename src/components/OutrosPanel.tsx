import React from 'react';
import { BookendLibrary } from './BookendLibrary';
import type { MediaAsset } from '../types/project';
import './IntrosOutrosPanel.css';

interface OutrosPanelProps {
  outroAssets: MediaAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: () => void;
}

export function OutrosPanel({
  outroAssets,
  selectedId,
  onSelect,
  onRename,
  onImport,
}: OutrosPanelProps) {
  return (
    <div className="intros-outros-panel outros-panel-only">
      <div className="intros-outros-toolbar">
        <span className="intros-outros-hint">Drag outros onto the Outro track on the timeline</span>
      </div>
      <div className="intros-outros-scroll">
        <BookendLibrary
          title="Outros"
          icon="🏁"
          category="outro"
          assets={outroAssets}
          selectedId={selectedId}
          emptyHint="Import branded outro clips"
          onSelect={onSelect}
          onRename={onRename}
          onImport={onImport}
        />
      </div>
    </div>
  );
}