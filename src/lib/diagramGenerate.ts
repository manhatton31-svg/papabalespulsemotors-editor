import { v4 as uuidv4 } from 'uuid';
import type { MediaAsset } from '../types/project';
import { addToContentLibrary } from './contentLibrary';
import { getAppDataDir, writeTextFile } from './tauriFs';
import { toAssetUrl } from './video';

const PLACEHOLDER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
  <rect width="800" height="500" fill="#0d1117"/>
  <rect x="40" y="40" width="720" height="420" rx="8" fill="none" stroke="#2dd4bf" stroke-width="2"/>
  <text x="400" y="80" fill="#2dd4bf" font-family="Segoe UI, sans-serif" font-size="22" font-weight="600" text-anchor="middle">PULSE MOTOR BUILD DIAGRAM</text>
  <circle cx="400" cy="250" r="90" fill="none" stroke="#60a5fa" stroke-width="3"/>
  <circle cx="400" cy="250" r="30" fill="#1c2128" stroke="#2dd4bf" stroke-width="2"/>
  <line x1="400" y1="160" x2="400" y2="100" stroke="#a78bfa" stroke-width="3"/>
  <line x1="490" y1="250" x2="560" y2="250" stroke="#a78bfa" stroke-width="3"/>
  <line x1="400" y1="340" x2="400" y2="400" stroke="#a78bfa" stroke-width="3"/>
  <line x1="310" y1="250" x2="240" y2="250" stroke="#a78bfa" stroke-width="3"/>
  <text x="400" y="460" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="13" text-anchor="middle">AI-generated schematic — refine with voiceover on Diagram track</text>
</svg>`;

/** Prepare an AI build diagram asset from the current video (placeholder until AI API is connected). */
export async function generateDiagramFromVideo(
  mainVideoPath: string | null
): Promise<MediaAsset> {
  const dir = await getAppDataDir();
  const id = uuidv4();
  const filePath = `${dir}/diagrams/ai_build_${id}.svg`;
  await writeTextFile(filePath, PLACEHOLDER_SVG);

  const friendlyName = mainVideoPath
    ? `Build Diagram — ${mainVideoPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'project'}`
    : 'Build Diagram';

  const [asset] = await addToContentLibrary('diagram', [
    {
      filePath,
      friendlyName,
      duration: 15,
      mediaType: 'image',
      thumbnail: toAssetUrl(filePath),
    },
  ]);

  return asset;
}