import React from 'react';
import {
  TIMELAPSE_SPEED_OPTIONS,
  type TimelapseSegment,
  type TimelapseSpeed,
} from '../types/timelapse';
import './TimelapsePanel.css';

interface TimelapsePanelProps {
  hasVideo: boolean;
  timelapseModeActive: boolean;
  timelapseSpeed: TimelapseSpeed;
  segments: TimelapseSegment[];
  pendingStart: number | null;
  onToggleMode: () => void;
  onSpeedChange: (speed: TimelapseSpeed) => void;
  onRemoveSegment: (id: string) => void;
  onClearAll: () => void;
}

export function TimelapsePanel({
  hasVideo,
  timelapseModeActive,
  timelapseSpeed,
  segments,
  pendingStart,
  onToggleMode,
  onSpeedChange,
  onRemoveSegment,
  onClearAll,
}: TimelapsePanelProps) {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);

  return (
    <div className="timelapse-panel">
      <div className="timelapse-header">
        <h3>Timelapse Regions</h3>
        <p>
          Mark regions on the timeline for live preview while editing. Final bake runs only when
          you export MP4 — zero background encoding on your machine.
        </p>
      </div>

      <button
        type="button"
        className={`btn btn-sm ${timelapseModeActive ? 'btn-accent timelapse-mode-on' : 'btn-primary'}`}
        onClick={onToggleMode}
        disabled={!hasVideo}
      >
        {timelapseModeActive ? '● Timelapse Mode ON' : 'Enable Timelapse Mode'}
      </button>

      {timelapseModeActive && (
        <div className="timelapse-mode-hint">
          {pendingStart === null
            ? 'Click the timeline to set the start point'
            : `Start at ${formatTime(pendingStart)} — click again to set end`}
        </div>
      )}

      <div className="timelapse-speed-row">
        <span className="timelapse-speed-label">Speed</span>
        <div className="timelapse-speed-options">
          {TIMELAPSE_SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={`timelapse-speed-btn ${timelapseSpeed === speed ? 'active' : ''}`}
              onClick={() => onSpeedChange(speed)}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>

      <div className="timelapse-segments-header">
        <span>Regions ({sorted.length})</span>
        {sorted.length > 0 && (
          <button type="button" className="timelapse-clear-btn" onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      <div className="timelapse-segment-list">
        {sorted.length === 0 ? (
          <div className="timelapse-empty">
            <p>No timelapse regions yet</p>
            <span>Enable mode, then click twice on the timeline</span>
          </div>
        ) : (
          sorted.map((seg) => (
            <div key={seg.id} className="timelapse-segment-item">
              <div className="timelapse-segment-times">
                {formatTime(seg.startTime)} → {formatTime(seg.endTime)}
              </div>
              <div className="timelapse-segment-meta">
                <span>{seg.speedFactor}×</span>
                <span>{formatTime(seg.endTime - seg.startTime)} source</span>
              </div>
              <button
                type="button"
                className="timelapse-remove-btn"
                onClick={() => onRemoveSegment(seg.id)}
                title="Remove region"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <p className="timelapse-apply-hint">
        Preview plays timelapse regions at speed in the player. Use Export MP4 for the final baked
        video.
      </p>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}