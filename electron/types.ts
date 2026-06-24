export type ContentCategory = 'broll' | 'intro' | 'outro' | 'diagram' | 'timelapse';

export type MediaType = 'video' | 'image';

export interface MediaAsset {
  id: string;
  category: ContentCategory;
  filePath: string;
  friendlyName: string;
  duration: number;
  thumbnail?: string;
  mediaType: MediaType;
}

/** @deprecated Use MediaAsset */
export type BRollAsset = MediaAsset;

export interface TimelineClip {
  id: string;
  assetId: string;
  startTime: number;
  duration: number;
  track: 'main' | ContentCategory;
}

export interface PulseProject {
  version: 2;
  name: string;
  mainVideoPath: string | null;
  mainVideoDuration: number;
  mediaAssets: MediaAsset[];
  timelineClips: TimelineClip[];
  selectedAssetIds: Partial<Record<ContentCategory, string | null>>;
}