import type { MediaAsset } from '../types/project';

export type BrollSortTier = 'favorites' | 'mostUsed' | 'recent' | 'other';

export interface BrollSection {
  tier: BrollSortTier;
  label: string;
  assets: MediaAsset[];
}

const TIER_LABELS: Record<BrollSortTier, string> = {
  favorites: 'Favorites',
  mostUsed: 'Most Used',
  recent: 'Recently Used',
  other: 'All Clips',
};

function brollTier(asset: MediaAsset): BrollSortTier {
  if (asset.favorite) return 'favorites';
  const useCount = asset.useCount ?? 0;
  if (useCount > 0) return 'mostUsed';
  if (asset.lastUsedAt && asset.lastUsedAt > 0) return 'recent';
  return 'other';
}

function compareWithinTier(a: MediaAsset, b: MediaAsset, tier: BrollSortTier): number {
  if (tier === 'favorites' || tier === 'mostUsed') {
    const useDiff = (b.useCount ?? 0) - (a.useCount ?? 0);
    if (useDiff !== 0) return useDiff;
    const recentDiff = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    if (recentDiff !== 0) return recentDiff;
  } else if (tier === 'recent') {
    const recentDiff = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    if (recentDiff !== 0) return recentDiff;
  }
  return a.friendlyName.localeCompare(b.friendlyName, undefined, { sensitivity: 'base' });
}

const TIER_ORDER: BrollSortTier[] = ['favorites', 'mostUsed', 'recent', 'other'];

export function sortBrollAssets(assets: MediaAsset[]): MediaAsset[] {
  return [...assets].sort((a, b) => {
    const tierA = brollTier(a);
    const tierB = brollTier(b);
    const orderDiff = TIER_ORDER.indexOf(tierA) - TIER_ORDER.indexOf(tierB);
    if (orderDiff !== 0) return orderDiff;
    return compareWithinTier(a, b, tierA);
  });
}

export function groupBrollForDisplay(assets: MediaAsset[]): BrollSection[] {
  const sorted = sortBrollAssets(assets);
  const sections: BrollSection[] = [];

  for (const asset of sorted) {
    const tier = brollTier(asset);
    const last = sections[sections.length - 1];
    if (last && last.tier === tier) {
      last.assets.push(asset);
    } else {
      sections.push({ tier, label: TIER_LABELS[tier], assets: [asset] });
    }
  }

  return sections;
}