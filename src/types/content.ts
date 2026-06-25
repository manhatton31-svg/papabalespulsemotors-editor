/** Categories backed by import libraries */
export const LIBRARY_CATEGORIES = ['broll', 'intro', 'hook', 'outro', 'diagram'] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

/** All overlay track types on the timeline */
export const OVERLAY_TRACKS = ['hook', 'intro', 'outro', 'broll', 'timelapse', 'diagram'] as const;

export type OverlayTrack = (typeof OVERLAY_TRACKS)[number];

export type TimelineTrack = 'main' | OverlayTrack;

/** Sidebar panels — timelapse & diagram are tools, not import libraries */
export type LeftPanel = 'broll' | 'intros' | 'hooks' | 'outros' | 'timelapse' | 'diagram';

export const LEFT_NAV_PANELS: { id: LeftPanel; label: string; icon: string }[] = [
  { id: 'broll', label: 'B-Roll Library', icon: '🎬' },
  { id: 'intros', label: 'Intros', icon: '🎞' },
  { id: 'hooks', label: 'Hooks', icon: '⚡' },
  { id: 'outros', label: 'Outros', icon: '🏁' },
  { id: 'timelapse', label: 'Timelapse Tool', icon: '⏱' },
  { id: 'diagram', label: 'Build Diagram', icon: '📐' },
];

/** Higher priority wins when multiple full-frame clips overlap. Diagram is PiP. */
export const FULL_FRAME_PRIORITY: Record<'hook' | 'intro' | 'outro' | 'broll', number> = {
  hook: 45,
  intro: 40,
  outro: 35,
  broll: 30,
};

export interface ContentLibraryConfig {
  category: LibraryCategory;
  label: string;
  shortLabel: string;
  importLabel: string;
  addLabel: string;
  emptyTitle: string;
  emptyHint: string;
  dragHint: string;
  listIcon: string;
  trackClass: string;
}

export const CONTENT_LIBRARY_CONFIG: Record<LibraryCategory, ContentLibraryConfig> = {
  broll: {
    category: 'broll',
    label: 'B-Roll Library',
    shortLabel: 'B-Roll',
    importLabel: 'Import B-Roll',
    addLabel: 'Add at Insert Point',
    emptyTitle: 'No B-roll yet',
    emptyHint: 'Import local videos to build your library',
    dragHint: 'Drag clips onto the B-Roll track',
    listIcon: '🎬',
    trackClass: 'broll',
  },
  intro: {
    category: 'intro',
    label: 'Intros',
    shortLabel: 'Intro',
    importLabel: 'Import Intro',
    addLabel: 'Add at Insert Point',
    emptyTitle: 'No intros yet',
    emptyHint: 'Import branded intro clips',
    dragHint: 'Drag intros onto the Intro track',
    listIcon: '🎞',
    trackClass: 'intro',
  },
  hook: {
    category: 'hook',
    label: 'Hooks',
    shortLabel: 'Hook',
    importLabel: 'Import Hook',
    addLabel: 'Add at Insert Point',
    emptyTitle: 'No hooks yet',
    emptyHint: 'Generate a hook preview or import saved hook clips',
    dragHint: 'Drag hooks onto the Hooks track',
    listIcon: '⚡',
    trackClass: 'hook',
  },
  outro: {
    category: 'outro',
    label: 'Outros',
    shortLabel: 'Outro',
    importLabel: 'Import Outro',
    addLabel: 'Add at Insert Point',
    emptyTitle: 'No outros yet',
    emptyHint: 'Import closing clips',
    dragHint: 'Drag outros onto the Outro track',
    listIcon: '🏁',
    trackClass: 'outro',
  },
  diagram: {
    category: 'diagram',
    label: 'Diagrams',
    shortLabel: 'Diagram',
    importLabel: 'Import Diagram',
    addLabel: 'Insert at Playhead',
    emptyTitle: 'No diagrams yet',
    emptyHint: 'Generate from video or import a schematic',
    dragHint: 'Insert onto the Diagram track',
    listIcon: '📐',
    trackClass: 'diagram',
  },
};

export const TRACK_DISPLAY_CONFIG: Record<
  OverlayTrack,
  { shortLabel: string; trackClass: string }
> = {
  hook: { shortLabel: 'Hooks', trackClass: 'hook' },
  intro: { shortLabel: 'Intro', trackClass: 'intro' },
  outro: { shortLabel: 'Outro', trackClass: 'outro' },
  broll: { shortLabel: 'B-Roll', trackClass: 'broll' },
  timelapse: { shortLabel: 'Timelapse', trackClass: 'timelapse' },
  diagram: { shortLabel: 'Diagram', trackClass: 'diagram' },
};

export const MEDIA_DRAG_MIME = 'application/x-pulse-media-asset';

export function isOverlayTrack(track: TimelineTrack): track is OverlayTrack {
  return track !== 'main';
}

export function isLibraryCategory(track: OverlayTrack): track is LibraryCategory {
  return track !== 'timelapse';
}

/** Tracks visible when they have content or an active editing mode */
export function getVisibleOverlayTracks(params: {
  clips: { track: TimelineTrack }[];
  timelapseSegments: unknown[];
  timelapseModeActive: boolean;
  diagramModeActive: boolean;
}): OverlayTrack[] {
  const tracks: OverlayTrack[] = [];
  const has = (t: OverlayTrack) => params.clips.some((c) => c.track === t);

  if (has('hook')) tracks.push('hook');
  if (has('intro')) tracks.push('intro');
  if (has('outro')) tracks.push('outro');
  if (has('broll')) tracks.push('broll');
  if (params.timelapseSegments.length > 0 || params.timelapseModeActive) {
    tracks.push('timelapse');
  }
  if (has('diagram') || params.diagramModeActive) tracks.push('diagram');

  return tracks;
}