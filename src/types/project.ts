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
  mediaAssets: SavedMediaAsset[];
  timelineClips: TimelineClip[];
  selectedAssetIds: Partial<Record<LibraryCategory, string | null>>;
  timelapseSegments?: TimelapseSegment[];
}

export type AnyPulseProject = PulseProject | PulseProjectV1;