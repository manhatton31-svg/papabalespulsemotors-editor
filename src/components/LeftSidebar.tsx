import React from 'react';
import { BRollLibrary } from './BRollLibrary';
import { DiagramPanel } from './DiagramPanel';
import { IntrosOutrosPanel } from './IntrosOutrosPanel';
import { TimelapsePanel } from './TimelapsePanel';
import { LEFT_NAV_PANELS, type LeftPanel } from '../types/content';
import type { LibraryCategory } from '../types/content';
import type { TimelapseSegment, TimelapseSpeed } from '../types/timelapse';
import type { MediaAsset } from '../types/project';
import './LeftSidebar.css';

export type { LeftPanel };

interface LeftSidebarProps {
  activePanel: LeftPanel;
  onPanelChange: (panel: LeftPanel) => void;
  hasVideo: boolean;
  mediaAssets: MediaAsset[];
  selectedAssetIds: Record<LibraryCategory, string | null>;
  timelapseModeActive: boolean;
  timelapseSpeed: TimelapseSpeed;
  timelapseSegments: TimelapseSegment[];
  timelapsePendingStart: number | null;
  isGeneratingDiagram: boolean;
  isGeneratingHook: boolean;
  onSelectAsset: (category: LibraryCategory, id: string) => void;
  onRenameAsset: (category: LibraryCategory, id: string, name: string) => void;
  playheadReady: boolean;
  onImportContent: (category: LibraryCategory) => void;
  onAddAtPlayhead: (category: LibraryCategory) => void;
  onToggleBrollFavorite: (id: string) => void;
  onToggleTimelapseMode: () => void;
  onTimelapseSpeedChange: (speed: TimelapseSpeed) => void;
  onRemoveTimelapseSegment: (id: string) => void;
  onClearTimelapse: () => void;
  onGenerateDiagram: () => void;
  onGenerateHookPreview: () => void;
  onInsertDiagram: () => void;
}

export function LeftSidebar({
  activePanel,
  onPanelChange,
  hasVideo,
  mediaAssets,
  selectedAssetIds,
  timelapseModeActive,
  timelapseSpeed,
  timelapseSegments,
  timelapsePendingStart,
  isGeneratingDiagram,
  isGeneratingHook,
  onSelectAsset,
  onRenameAsset,
  playheadReady,
  onImportContent,
  onAddAtPlayhead,
  onToggleBrollFavorite,
  onToggleTimelapseMode,
  onTimelapseSpeedChange,
  onRemoveTimelapseSegment,
  onClearTimelapse,
  onGenerateDiagram,
  onGenerateHookPreview,
  onInsertDiagram,
}: LeftSidebarProps) {
  const brollAssets = mediaAssets.filter((a) => a.category === 'broll');
  const introAssets = mediaAssets.filter((a) => a.category === 'intro');
  const outroAssets = mediaAssets.filter((a) => a.category === 'outro');
  const diagramAssets = mediaAssets.filter((a) => a.category === 'diagram');

  return (
    <aside className="left-sidebar">
      <nav className="left-nav">
        {LEFT_NAV_PANELS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`left-nav-btn ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onPanelChange(item.id)}
            title={item.label}
          >
            <span className="left-nav-icon">{item.icon}</span>
            <span className="left-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="left-panel-content">
        {activePanel === 'broll' && (
          <BRollLibrary
            assets={brollAssets}
            selectedId={selectedAssetIds.broll}
            playheadReady={playheadReady}
            onSelect={(id) => onSelectAsset('broll', id)}
            onRename={(id, name) => onRenameAsset('broll', id, name)}
            onToggleFavorite={onToggleBrollFavorite}
            onAddAtPlayhead={() => onAddAtPlayhead('broll')}
          />
        )}
        {activePanel === 'introsOutros' && (
          <IntrosOutrosPanel
            hasVideo={hasVideo}
            introAssets={introAssets}
            outroAssets={outroAssets}
            selectedAssetIds={{
              intro: selectedAssetIds.intro,
              outro: selectedAssetIds.outro,
            }}
            isGeneratingHook={isGeneratingHook}
            onSelectAsset={onSelectAsset}
            onRenameAsset={onRenameAsset}
            onImportContent={onImportContent}
            onGenerateHookPreview={onGenerateHookPreview}
          />
        )}
        {activePanel === 'timelapse' && (
          <TimelapsePanel
            hasVideo={hasVideo}
            timelapseModeActive={timelapseModeActive}
            timelapseSpeed={timelapseSpeed}
            segments={timelapseSegments}
            pendingStart={timelapsePendingStart}
            onToggleMode={onToggleTimelapseMode}
            onSpeedChange={onTimelapseSpeedChange}
            onRemoveSegment={onRemoveTimelapseSegment}
            onClearAll={onClearTimelapse}
          />
        )}
        {activePanel === 'diagram' && (
          <DiagramPanel
            hasVideo={hasVideo}
            diagrams={diagramAssets}
            selectedDiagramId={selectedAssetIds.diagram}
            isGenerating={isGeneratingDiagram}
            onGenerate={onGenerateDiagram}
            onSelect={(id) => onSelectAsset('diagram', id)}
            onInsertAtPlayhead={onInsertDiagram}
            onImport={() => onImportContent('diagram')}
          />
        )}
      </div>
    </aside>
  );
}