import type { MediaAsset } from '../types/project';

export type HookSortTier = 'favorites' | 'generated' | 'other';

export interface HookSection {
  tier: HookSortTier;
  label: string;
  assets: MediaAsset[];
}

const TIER_LABELS: Record<HookSortTier, string> = {
  favorites: 'Favorites',
  generated: 'Generated Hooks',
  other: 'All Hooks',
};

const HOOK_NUMBER = /^Hook (\d+)$/;

function hookNumber(name: string): number {
  const match = name.match(HOOK_NUMBER);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function hookTier(asset: MediaAsset): HookSortTier {
  if (asset.favorite) return 'favorites';
  if (HOOK_NUMBER.test(asset.friendlyName)) return 'generated';
  return 'other';
}

function compareHooks(a: MediaAsset, b: MediaAsset): number {
  const numDiff = hookNumber(a.friendlyName) - hookNumber(b.friendlyName);
  if (numDiff !== 0) return numDiff;
  return a.friendlyName.localeCompare(b.friendlyName, undefined, { sensitivity: 'base' });
}

const TIER_ORDER: HookSortTier[] = ['favorites', 'generated', 'other'];

export function groupHooksForDisplay(assets: MediaAsset[]): HookSection[] {
  const sorted = [...assets].sort((a, b) => {
    const tierDiff = TIER_ORDER.indexOf(hookTier(a)) - TIER_ORDER.indexOf(hookTier(b));
    if (tierDiff !== 0) return tierDiff;
    return compareHooks(a, b);
  });

  const sections: HookSection[] = [];
  for (const asset of sorted) {
    const tier = hookTier(asset);
    const last = sections[sections.length - 1];
    if (last && last.tier === tier) {
      last.assets.push(asset);
    } else {
      sections.push({ tier, label: TIER_LABELS[tier], assets: [asset] });
    }
  }
  return sections;
}