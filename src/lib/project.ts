import { open, save } from '@tauri-apps/plugin-dialog';
import { v4 as uuidv4 } from 'uuid';
import type { LibraryCategory } from '../types/content';
import { LIBRARY_CATEGORIES } from '../types/content';
import type { TimelapseSegment } from '../types/timelapse';
import type {
  AnyPulseProject,
  MainVideoPiece,
  MediaAsset,
  PulseProject,
  PulseProjectV1,
  TimelineClip,
} from '../types/project';
import { getAppDataDir, readTextFile, writeTextFile } from './tauriFs';
import { toAssetUrl } from './video';
import { cleanProjectName, fileNameWithoutExt } from '../utils/names';

const PROJECT_FILTER = {
  name: 'Pulse Project',
  extensions: ['pulseproj'],
};

export function emptySelectedAssetIds(): Record<LibraryCategory, string | null> {
  return {
    broll: null,
    intro: null,
    hook: null,
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
  mainVideoPieces?: MainVideoPiece[];
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
    mainVideoPieces: params.mainVideoPieces,
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
  mainVideoPieces: MainVideoPiece[];
  mediaAssets: MediaAsset[];
  timelineClips: TimelineClip[];
  selectedAssetIds: Record<LibraryCategory, string | null>;
  timelapseSegments: TimelapseSegment[];
  projectName: string;
}> {
  const normalized = normalizeProject(project);
  const mainVideoPath = normalized.mainVideoPath;
  const mainVideoUrl = mainVideoPath ? toAssetUrl(mainVideoPath) : null;

  const mediaAssets: MediaAsset[] = normalized.mediaAssets.map((asset) => {
    let category = (asset.category ?? 'broll') as LibraryCategory;
    if (category === 'intro' && /^Hook \d+$/.test(asset.friendlyName)) {
      category = 'hook';
    }
    return {
      ...asset,
      category,
      mediaType: asset.mediaType ?? 'video',
      url: toAssetUrl(asset.filePath),
    };
  });

  let timelineClips = [...normalized.timelineClips].filter((c) => c.track !== 'timelapse');

  const hookAssetIds = new Set(
    mediaAssets.filter((a) => a.category === 'hook').map((a) => a.id)
  );
  const legacyHookAssetIds = new Set(
    mediaAssets
      .filter((a) => a.category === 'intro' && /^Hook \d+$/.test(a.friendlyName))
      .map((a) => a.id)
  );
  timelineClips = timelineClips.map((clip) => {
    if (
      clip.track === 'intro' &&
      (hookAssetIds.has(clip.assetId) || legacyHookAssetIds.has(clip.assetId))
    ) {
      return { ...clip, track: 'hook' };
    }
    return clip;
  });
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
    mainVideoPieces: normalized.mainVideoPieces ?? [],
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

const PROJECTS_SUBDIR = 'projects';

/** Dedicated folder for .pulseproj files (inside app data dir). */
export async function getProjectsDir(): Promise<string> {
  const appData = await getAppDataDir();
  return `${appData.replace(/[/\\]+$/, '')}/${PROJECTS_SUBDIR}`;
}

/** Strip characters invalid in Windows/macOS filenames; keep spaces and punctuation like hyphens. */
export function sanitizeProjectFileName(name: string): string {
  const trimmed = name.replace(/[\\/:*?"<>|]/g, '').trim();
  return trimmed || 'Untitled';
}

export function projectFilePathForName(projectsDir: string, name: string): string {
  const separator = projectsDir.includes('\\') ? '\\' : '/';
  return `${projectsDir}${separator}${sanitizeProjectFileName(name)}.pulseproj`;
}

export function suggestedProjectName(
  currentName: string,
  mainVideoPath: string | null
): string {
  if (mainVideoPath) {
    return cleanProjectName(fileNameWithoutExt(mainVideoPath));
  }
  if (currentName && currentName !== 'Untitled') {
    return currentName;
  }
  return 'Untitled Project';
}

/** Save to the default projects folder using the project name as the filename. */
export async function saveProjectToProjectsFolder(
  project: PulseProject,
  projectName: string
): Promise<string> {
  const trimmedName = projectName.trim() || 'Untitled Project';
  const projectsDir = await getProjectsDir();
  const filePath = projectFilePathForName(projectsDir, trimmedName);
  const payload: PulseProject = { ...project, name: trimmedName };
  await writeTextFile(filePath, JSON.stringify(payload, null, 2));
  return filePath;
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
  let defaultPath: string | undefined;
  try {
    defaultPath = await getProjectsDir();
  } catch {
    defaultPath = undefined;
  }

  const path = await open({
    title: 'Open Project',
    multiple: false,
    directory: false,
    defaultPath,
    filters: [PROJECT_FILTER],
  });
  if (!path || Array.isArray(path)) return null;

  const content = await readTextFile(path);
  let project: AnyPulseProject;
  try {
    project = JSON.parse(content) as AnyPulseProject;
  } catch {
    throw new Error('Invalid project file — could not parse .pulseproj');
  }

  if (!project || typeof project !== 'object') {
    throw new Error('Invalid project file — missing project data');
  }

  return { project, filePath: path };
}

export { LIBRARY_CATEGORIES };