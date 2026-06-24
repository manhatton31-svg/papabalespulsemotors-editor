import React from 'react';
import './RightSidebar.css';

export type RightPanel = 'voiceover' | 'effects' | 'livestream';

interface RightSidebarProps {
  activePanel: RightPanel;
  onPanelChange: (panel: RightPanel) => void;
}

const NAV_ITEMS: { id: RightPanel; label: string; icon: string }[] = [
  { id: 'voiceover', label: 'Voiceover', icon: '🎙' },
  { id: 'effects', label: 'Effects', icon: '✨' },
  { id: 'livestream', label: 'Live Stream Setup', icon: '📡' },
];

export function RightSidebar({ activePanel, onPanelChange }: RightSidebarProps) {
  return (
    <aside className="right-sidebar">
      <nav className="right-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`right-nav-btn ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onPanelChange(item.id)}
            title={item.label}
          >
            <span className="right-nav-icon">{item.icon}</span>
            <span className="right-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="right-panel-content">
        {activePanel === 'voiceover' && (
          <PanelContent
            title="Voiceover"
            items={[
              'Record or import narration tracks',
              'Sync voiceover to timeline markers',
              'Adjust volume and fade in/out',
            ]}
            badge="Coming Soon"
          />
        )}
        {activePanel === 'effects' && (
          <PanelContent
            title="Effects"
            items={[
              'Color correction & grading',
              'Transitions between clips',
              'Text overlays and titles',
            ]}
            badge="Coming Soon"
          />
        )}
        {activePanel === 'livestream' && (
          <PanelContent
            title="Live Stream Setup"
            items={[
              'Configure stream output settings',
              'Preview before going live',
              'Connect to streaming platforms',
            ]}
            badge="Coming Soon"
          />
        )}
      </div>
    </aside>
  );
}

function PanelContent({
  title,
  items,
  badge,
}: {
  title: string;
  items: string[];
  badge: string;
}) {
  return (
    <div className="right-panel-inner">
      <div className="right-panel-header">
        <h3>{title}</h3>
        <span className="right-panel-badge">{badge}</span>
      </div>
      <ul className="right-panel-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}