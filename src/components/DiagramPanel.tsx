import React, { useState } from 'react';
import type { MediaAsset } from '../types/project';
import { Modal } from './Modal';
import './DiagramPanel.css';

interface DiagramPanelProps {
  hasVideo: boolean;
  diagrams: MediaAsset[];
  selectedDiagramId: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onSelect: (id: string) => void;
  onInsertAtPlayhead: () => void;
  onImport: () => void;
}

export function DiagramPanel({
  hasVideo,
  diagrams,
  selectedDiagramId,
  isGenerating,
  onGenerate,
  onSelect,
  onInsertAtPlayhead,
  onImport,
}: DiagramPanelProps) {
  const [preview, setPreview] = useState<MediaAsset | null>(null);

  return (
    <div className="diagram-panel">
      <div className="diagram-hero">
        <h3>AI Build Diagram</h3>
        <p>
          AI analyzes your main video to produce an accurate schematic of the motor build. Insert it
          on the timeline and add voiceover narration in the right panel.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-sm btn-primary diagram-generate-btn"
        onClick={onGenerate}
        disabled={!hasVideo || isGenerating}
      >
        {isGenerating ? 'Analyzing video…' : '✦ Generate Diagram from Video'}
      </button>

      <button type="button" className="btn btn-sm btn-secondary" onClick={onImport}>
        Import Diagram Image
      </button>

      <button
        type="button"
        className="btn btn-sm btn-accent"
        onClick={onInsertAtPlayhead}
        disabled={!selectedDiagramId}
      >
        Insert at Playhead
      </button>

      <p className="diagram-voiceover-hint">
        After inserting, use the Voiceover panel on the right to narrate over the diagram segment.
      </p>

      <div className="diagram-list-header">
        <span>Diagrams</span>
        <span className="diagram-count">{diagrams.length}</span>
      </div>

      <div className="diagram-list">
        {diagrams.length === 0 ? (
          <div className="diagram-empty">
            <p>No diagrams yet</p>
            <span>Generate from your video or import a schematic</span>
          </div>
        ) : (
          diagrams.map((d) => (
            <div
              key={d.id}
              className={`diagram-item ${selectedDiagramId === d.id ? 'selected' : ''}`}
              onClick={() => onSelect(d.id)}
            >
              <div className="diagram-thumb">
                {d.thumbnail ? (
                  <img src={d.thumbnail} alt={d.friendlyName} />
                ) : (
                  <span>📐</span>
                )}
              </div>
              <div className="diagram-info">
                <span className="diagram-name">{d.friendlyName}</span>
                <span className="diagram-duration">{Math.round(d.duration)}s slot</span>
              </div>
              <button
                type="button"
                className="diagram-preview-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview(d);
                }}
              >
                ▶
              </button>
            </div>
          ))
        )}
      </div>

      <Modal open={preview !== null} title={preview?.friendlyName ?? 'Diagram'} onClose={() => setPreview(null)}>
        {preview && (
          <img className="diagram-preview-image" src={preview.url} alt={preview.friendlyName} />
        )}
      </Modal>
    </div>
  );
}