import React from 'react';
import { BookendLibrary } from './BookendLibrary';
import type { MediaAsset } from '../types/project';
import './IntrosOutrosPanel.css';

interface IntrosPanelProps {
  introAssets: MediaAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: () => void;
}

export function IntrosPanel({
  introAssets,
  selectedId,
  onSelect,
  onRename,
  onImport,
}: IntrosPanelProps) {
  return (
    <div className="intros-outros-panel intros-panel-only">
      <div className="intros-outros-toolbar">
        <span className="intros-outros-hint">Drag intros onto the Intro track on the timeline</span>
      </div>
      <div className="intros-outros-scroll">
        <BookendLibrary
          title="Intros"
          icon="🎞"
          category="intro"
          assets={introAssets}
          selectedId={selectedId}
          emptyHint="Import branded intro clips"
          onSelect={onSelect}
          onRename={onRename}
          onImport={onImport}
        />
      </div>
    </div>
  );
}