import { describe, expect, it } from 'vitest';
import { compareDuplicateKeepers, findExactDuplicateTabs, isDuplicateEligibleUrl } from './duplicate-tabs';
import type { DuplicateTabSummary } from './types';

const tab = (id: number, url: string, patch: Partial<DuplicateTabSummary> = {}): DuplicateTabSummary => ({ id, url, title: `Tab ${id}`, windowId: 1, index: id, groupId: -1, pinned: false, active: false, ...patch });

describe('duplicate tabs', () => {
  it('uses exact complete URL equality including query and fragments', () => {
    const sets = findExactDuplicateTabs([tab(1, 'https://example.com/a?q=1#x'), tab(2, 'https://example.com/a?q=1#x'), tab(3, 'https://example.com/a?q=2#x'), tab(4, 'chrome://settings')]);
    expect(sets).toHaveLength(1);
    expect(sets[0].tabs.map((item) => item.id)).toEqual([1, 2]);
    expect(isDuplicateEligibleUrl('file:///tmp/note.pdf')).toBe(true);
    expect(isDuplicateEligibleUrl('chrome://settings')).toBe(false);
  });

  it('prioritizes pinned, active, grouped, recent, then stable order', () => {
    const tabs = [tab(1, 'https://a.test', { lastAccessed: 500 }), tab(2, 'https://a.test', { groupId: 3 }), tab(3, 'https://a.test', { active: true }), tab(4, 'https://a.test', { pinned: true })];
    expect([...tabs].sort(compareDuplicateKeepers).map((item) => item.id)).toEqual([4, 3, 2, 1]);
    expect(findExactDuplicateTabs(tabs)[0].keeperId).toBe(4);
  });
});
