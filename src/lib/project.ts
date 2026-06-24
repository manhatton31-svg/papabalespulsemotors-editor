import { open, save } from '@tauri-apps/plugin-dialog';
import { v4 as uuidv4 } from 'uuid';
import type { LibraryCategory } from '../types/content';
import { LIBRARY_CATEGORIES } from '../types/content';
import type { TimelapseSegment } from '../types/timelapse';
import type {
  AnyPulseProject,
  MediaAsset,
  PulseProject,
  PulseProjectV1,
  TimelineClip,
} from '../types/project';
import { readTextFile, writeTextFile } from './tauriFs';
import { toAssetUrl } from './video';

const PROJECT_FILTER = {
  name: 'Pulse Project',
  extensions: ['pulseproj'],
};

export function emptySelectedAssetIds(): Record<LibraryCategory, string | null> {
  return {
    broll: null,
    intro: null,
    outro: null,
    diagram: null,
  };
}

function isV1Project(project: AnyPulseProject): project is PulseProjectV1 {
  return project.version === 1;
}

function normalizeProject(project: AnyPulseProject): PulseProject {
  if (!isV1Project(project)) {
    return {
      ...project,
      timelapseSegments: project.timelapseSegments ?? [],
      selectedAssetIds: {
        ...emptySelectedAssetIds(),
        ...project.selectedAssetIds,
      },
    };
  }

  const mediaAssets = (project.brollAssets ?? []).map((asset) => ({
    ...asset,
    category: (asset.category ?? 'broll') as LibraryCategory,
    mediaType: asset.mediaType ?? 'video',
  }));

  const timelineClips = project.timelineClips.filter(
    (c) => c.track !== 'timelapse'
  );

  return {
    version: 2,
    name: project.name,
    mainVideoPath: project.mainVideoPath,
    mainVideoDuration: project.mainVideoDuration,
    mediaAssets,
    timelineClips,
    timelapseSegments: [],
    selectedAssetIds: {
      ...emptySelectedAssetIds(),
      broll: project.selectedBrollId,
    },
  };
}

export function buildProject(params: {
  name: string;
  mainVideoPath: string | null;
  mainVideoDuration: number;
  mediaAssets: MediaAsset[];
  timelineClips: TimelineClip[];
  selectedAssetIds: Partial<Record<LibraryCategory, string | null>>;
  timelapseSegments: TimelapseSegment[];
}): PulseProject {
  return {
    version: 2,
    name: params.name,
    mainVideoPath: params.mainVideoPath,
    mainVideoDuration: params.mainVideoDuration,
    mediaAssets: params.mediaAssets.map(({ url: _url, ...rest }) => rest),
    timelineClips: params.timelineClips,
    timelapseSegments: params.timelapseSegments,
    selectedAssetIds: {
      ...emptySelectedAssetIds(),
      ...params.selectedAssetIds,
    },
  };
}

export async function hydrateProject(project: AnyPulseProject): Promise<{
  mainVideoPath: string | null;
  mainVideoUrl: string | null;
  mainVideoDuration: number;
  mediaAssets: MediaAsset[];
  timelineClips: TimelineClip[];
  selectedAssetIds: Record<LibraryCategory, string | null>;
  timelapseSegments: TimelapseSegment[];
  projectName: string;
}> {
  const normalized = normalizeProject(project);
  const mainVideoPath = normalized.mainVideoPath;
  const mainVideoUrl = mainVideoPath ? toAssetUrl(mainVideoPath) : null;

  const mediaAssets: MediaAsset[] = normalized.mediaAssets.map((asset) => ({
    ...asset,
    category: asset.category ?? 'broll',
    mediaType: asset.mediaType ?? 'video',
    url: toAssetUrl(asset.filePath),
  }));

  let timelineClips = [...normalized.timelineClips].filter((c) => c.track !== 'timelapse');
  const hasMain = timelineClips.some((c) => c.track === 'main');
  if (mainVideoPath && !hasMain) {
    timelineClips.unshift({
      id: uuidv4(),
      assetId: 'main',
      startTime: 0,
      duration: normalized.mainVideoDuration,
      track: 'main',
    });
  } else if (mainVideoPath) {
    timelineClips = timelineClips.map((c) =>
      c.track === 'main' ? { ...c, duration: normalized.mainVideoDuration } : c
    );
  }

  return {
    mainVideoPath,
    mainVideoUrl,
    mainVideoDuration: normalized.mainVideoDuration,
    mediaAssets,
    timelineClips,
    timelapseSegments: normalized.timelapseSegments ?? [],
    selectedAssetIds: {
      ...emptySelectedAssetIds(),
      ...normalized.selectedAssetIds,
    },
    projectName: normalized.name || 'Untitled',
  };
}

export async function saveProjectAs(project: PulseProject): Promise<string | null> {
  const path = await save({
    title: 'Save Project As',
    defaultPath: `${project.name || 'untitled'}.pulseproj`,
    filters: [PROJECT_FILTER],
  });
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(project, null, 2));
  return path;
}

export async function saveProjectToPath(project: PulseProject, filePath: string): Promise<boolean> {
  try {
    await writeTextFile(filePath, JSON.stringify(project, null, 2));
    return true;
  } catch {
    return false;
  }
}

export async function openProjectFile(): Promise<{ project: AnyPulseProject; filePath: string } | null> {
  const path = await open({
    title: 'Open Project',
    multiple: false,
    directory: false,
    filters: [PROJECT_FILTER],
  });
  if (!path || Array.isArray(path)) return null;
  const content = await readTextFile(path);
  const project = JSON.parse(content) as AnyPulseProject;
  return { project, filePath: path };
}

export { LIBRARY_CATEGORIES };