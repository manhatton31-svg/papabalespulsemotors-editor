import type { LibraryCategory } from './content';
import type { TimelapseSegment } from './timelapse';

export type MediaType = 'video' | 'image';

export interface MediaAsset {
  id: string;
  category: LibraryCategory;
  filePath: string;
  friendlyName: string;
  duration: number;
  thumbnail?: string;
  url: string;
  mediaType: MediaType;
  /** B-Roll library metadata */
  favorite?: boolean;
  useCount?: number;
  lastUsedAt?: number;
}

/** @deprecated Use MediaAsset — kept for backward-compatible imports */
export type BRollAsset = MediaAsset;

export interface TimelineClip {
  id: string;
  assetId: string;
  startTime: number;
  duration: number;
  track: import('./content').TimelineTrack;
}

/** Source clips stitched into the main video — not shown in B-Roll Library. */
export interface MainVideoPiece {
  sourcePath: string;
  displayName: string;
  duration?: number;
}

/** Saved in .pulseproj files — `url` is rebuilt on load. */
export type SavedMediaAsset = Omit<MediaAsset, 'url'>;

/** @deprecated Use SavedMediaAsset */
export type SavedBRollAsset = SavedMediaAsset;

export interface PulseProjectV1 {
  version: 1;
  name: string;
  mainVideoPath: string | null;
  mainVideoDuration: number;
  brollAssets: SavedMediaAsset[];
  timelineClips: TimelineClip[];
  selectedBrollId: string | null;
}

export interface PulseProject {
  version: 2;
  name: string;
  mainVideoPath: string | null;
  mainVideoDuration: number;
  mainVideoPieces?: MainVideoPiece[];
  mediaAssets: SavedMediaAsset[];
  timelineClips: TimelineClip[];
  selectedAssetIds: Partial<Record<LibraryCategory, string | null>>;
  timelapseSegments?: TimelapseSegment[];
}

export type AnyPulseProject = PulseProject | PulseProjectV1;