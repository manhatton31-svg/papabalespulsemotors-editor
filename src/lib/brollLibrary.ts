import type { LibraryCategory } from '../types/content';
import type { MediaAsset } from '../types/project';
import {
  addToContentLibrary,
  assetsForCategory,
  loadCategoryLibrary,
  mergeMediaAssets,
  renameContentAsset,
  type ContentImportInput,
} from './contentLibrary';

/** @deprecated Use MediaAsset */
export type { MediaAsset as BRollAsset };

/** @deprecated Use ContentImportInput */
export type BRollImportInput = ContentImportInput;

export async function loadBRollLibrary(): Promise<MediaAsset[]> {
  return loadCategoryLibrary('broll');
}

export async function addBrollToLibrary(imports: ContentImportInput[]): Promise<MediaAsset[]> {
  return addToContentLibrary('broll', imports);
}

export async function renameBrollClip(id: string, friendlyName: string): Promise<boolean> {
  return renameContentAsset('broll', id, friendlyName);
}

export function mergeBrollAssets(existing: MediaAsset[], added: MediaAsset[]): MediaAsset[] {
  return mergeMediaAssets(existing, added);
}

export { assetsForCategory, mergeMediaAssets, addToContentLibrary, renameContentAsset };
export type { ContentImportInput };

export function filterBrollAssets(assets: MediaAsset[]): MediaAsset[] {
  return assetsForCategory(assets, 'broll');
}