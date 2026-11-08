import type { DuplicateTabSet, DuplicateTabSummary } from './types';

export function isDuplicateEligibleUrl(url: string): boolean {
  try { return ['http:', 'https:', 'file:'].includes(new URL(url).protocol); }
  catch { return false; }
}

export function compareDuplicateKeepers(left: DuplicateTabSummary, right: DuplicateTabSummary): number {
  return Number(right.pinned) - Number(left.pinned)
    || Number(right.active) - Number(left.active)
    || Number(right.groupId >= 0) - Number(left.groupId >= 0)
    || (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0)
    || left.windowId - right.windowId
    || left.index - right.index
    || left.id - right.id;
}

export function findExactDuplicateTabs(tabs: DuplicateTabSummary[]): DuplicateTabSet[] {
  const grouped = new Map<string, DuplicateTabSummary[]>();
  for (const tab of tabs) if (isDuplicateEligibleUrl(tab.url)) grouped.set(tab.url, [...(grouped.get(tab.url) ?? []), tab]);
  return [...grouped.entries()].filter(([, matches]) => matches.length > 1).map(([url, matches]) => {
    const sorted = [...matches].sort(compareDuplicateKeepers);
    return { url, tabs: matches.sort((a, b) => a.windowId - b.windowId || a.index - b.index), keeperId: sorted[0].id };
  }).sort((a, b) => b.tabs.length - a.tabs.length || a.url.localeCompare(b.url));
}
