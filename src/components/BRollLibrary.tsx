import type { MediaAsset } from '../types/project';
import { ContentLibrary } from './ContentLibrary';

interface BRollLibraryProps {
  assets: MediaAsset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: () => void;
  onAddAtPlayhead: () => void;
}

/** B-Roll library — thin wrapper preserving the existing component API. */
export function BRollLibrary(props: BRollLibraryProps) {
  return <ContentLibrary category="broll" {...props} />;
}