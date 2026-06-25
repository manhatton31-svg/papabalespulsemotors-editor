import React from 'react';
import { BRollLibrary } from './BRollLibrary';
import { DiagramPanel } from './DiagramPanel';
import { HooksLibrary } from './HooksLibrary';
import { IntrosPanel } from './IntrosPanel';
import { OutrosPanel } from './OutrosPanel';
import { TimelapsePanel } from './TimelapsePanel';
import { LEFT_NAV_PANELS, type LeftPanel } from '../types/content';
import type { LibraryCategory } from '../types/content';
import type { TimelapseSegment, TimelapseSpeed } from '../types/timelapse';
import type { MainVideoPiece, MediaAsset } from '../types/project';
import './LeftSidebar.css';

export type { LeftPanel };

interface LeftSidebarProps {
  activePanel: LeftPanel;
  onPanelChange: (panel: LeftPanel) => void;
  hasVideo: boolean;
  mediaAssets: MediaAsset[];
  mainVideoPieces?: MainVideoPiece[];
  mainVideoPath?: string | null;
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
  onToggleHookFavorite: (id: string) => void;
  clipBrollModeActive: boolean;
  onToggleClipBrollMode: () => void;
  onCancelClipBrollMode: () => void;
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
  mainVideoPieces = [],
  mainVideoPath = null,
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
  onToggleHookFavorite,
  clipBrollModeActive,
  onToggleClipBrollMode,
  onCancelClipBrollMode,
  onToggleTimelapseMode,
  onTimelapseSpeedChange,
  onRemoveTimelapseSegment,
  onClearTimelapse,
  onGenerateDiagram,
  onGenerateHookPreview,
  onInsertDiagram,
}: LeftSidebarProps) {
  const mainSourcePaths = new Set(
    [
      ...mainVideoPieces.map((piece) => piece.sourcePath),
      ...(mainVideoPath ? [mainVideoPath] : []),
    ].map((path) => path.replace(/\\/g, '/').toLowerCase())
  );
  const brollAssets = mediaAssets.filter(
    (a) =>
      a.category === 'broll' &&
      !mainSourcePaths.has(a.filePath.replace(/\\/g, '/').toLowerCase())
  );
  const introAssets = mediaAssets.filter((a) => a.category === 'intro');
  const hookAssets = mediaAssets.filter((a) => a.category === 'hook');
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
            hasVideo={hasVideo}
            clipBrollModeActive={clipBrollModeActive}
            onSelect={(id) => onSelectAsset('broll', id)}
            onRename={(id, name) => onRenameAsset('broll', id, name)}
            onToggleFavorite={onToggleBrollFavorite}
            onAddAtPlayhead={() => onAddAtPlayhead('broll')}
            onToggleClipBrollMode={onToggleClipBrollMode}
            onCancelClipBrollMode={onCancelClipBrollMode}
          />
        )}
        {activePanel === 'intros' && (
          <IntrosPanel
            introAssets={introAssets}
            selectedId={selectedAssetIds.intro}
            onSelect={(id) => onSelectAsset('intro', id)}
            onRename={(id, name) => onRenameAsset('intro', id, name)}
            onImport={() => onImportContent('intro')}
          />
        )}
        {activePanel === 'hooks' && (
          <HooksLibrary
            assets={hookAssets}
            selectedId={selectedAssetIds.hook}
            hasVideo={hasVideo}
            isGeneratingHook={isGeneratingHook}
            playheadReady={playheadReady}
            onSelect={(id) => onSelectAsset('hook', id)}
            onRename={(id, name) => onRenameAsset('hook', id, name)}
            onToggleFavorite={onToggleHookFavorite}
            onAddAtPlayhead={() => onAddAtPlayhead('hook')}
            onImport={() => onImportContent('hook')}
            onGenerateHookPreview={onGenerateHookPreview}
          />
        )}
        {activePanel === 'outros' && (
          <OutrosPanel
            outroAssets={outroAssets}
            selectedId={selectedAssetIds.outro}
            onSelect={(id) => onSelectAsset('outro', id)}
            onRename={(id, name) => onRenameAsset('outro', id, name)}
            onImport={() => onImportContent('outro')}
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