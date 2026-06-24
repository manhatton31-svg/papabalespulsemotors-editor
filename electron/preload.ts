import { contextBridge, ipcRenderer } from 'electron';
import type { PulseProject } from './types';

type SaveableProject = Omit<PulseProject, never>;

export interface VideoFileInfo {
  filePath: string;
  duration: number;
  url: string;
}

export interface BRollImportInfo {
  filePath: string;
  duration: number;
  thumbnail?: string;
  url: string;
}

export interface HydratedBRollAsset {
  id: string;
  filePath: string;
  friendlyName: string;
  duration: number;
  thumbnail?: string;
  url: string;
}

const api = {
  openVideo: (): Promise<VideoFileInfo | null> => ipcRenderer.invoke('dialog:openVideo'),
  openVideos: (): Promise<BRollImportInfo[]> => ipcRenderer.invoke('dialog:openVideos'),
  saveProjectAs: (project: SaveableProject): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveProjectAs', project),
  saveProjectToPath: (project: SaveableProject, filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('dialog:saveProjectToPath', project, filePath),
  openProject: (): Promise<{ project: SaveableProject; filePath: string } | null> =>
    ipcRenderer.invoke('dialog:openProject'),
  exportMp4: (project: SaveableProject): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('dialog:exportMp4', project),
  loadBRollAssets: (): Promise<HydratedBRollAsset[]> => ipcRenderer.invoke('library:loadAssets'),
  addBRollToLibrary: (
    imports: { filePath: string; friendlyName: string; duration: number; thumbnail?: string }[]
  ): Promise<HydratedBRollAsset[]> => ipcRenderer.invoke('library:addClips', imports),
  renameBRollClip: (id: string, friendlyName: string): Promise<boolean> =>
    ipcRenderer.invoke('library:renameClip', id, friendlyName),
  getDuration: (filePath: string): Promise<number> => ipcRenderer.invoke('video:getDuration', filePath),
  generateThumbnail: (filePath: string): Promise<string | undefined> =>
    ipcRenderer.invoke('video:generateThumbnail', filePath),
  toPulseUrl: (filePath: string): Promise<string> => ipcRenderer.invoke('util:toPulseUrl', filePath),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;