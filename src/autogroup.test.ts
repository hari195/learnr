import { describe, expect, it, vi } from 'vitest';
import { autoGroupColor, autoGroupTabFingerprint, classifyAutoGroupTabs, normalizeAutoGroupLabel, parseAutoGroupResponse, sanitizeAutoGroupUrl, validateAutoGroupAssignments } from './autogroup';
import type { AutoGroupExistingGroup, AutoGroupTabSummary, ProviderUsage } from './types';

const usage: ProviderUsage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 15, costUsd: .001, requestCount: 1, tokensReported: true, costReported: true };
const tab = (id: number, windowId = 1): AutoGroupTabSummary => ({ id, windowId, index: id, title: `Tab ${id}`, url: `https://example.com/topic/${id}`, hostname: 'example.com', fingerprint: `fp-${id}` });

describe('AutoGroup classification', () => {
  it('sanitizes sensitive URL fields and creates stable fingerprints', () => {
    expect(sanitizeAutoGroupUrl('https://user:secret@example.com/path?q=private#token')).toEqual({ url: 'https://example.com/path', hostname: 'example.com' });
    expect(sanitizeAutoGroupUrl('data:text/html,<h1>private content</h1>')).toEqual({ url: 'data:', hostname: 'data' });
    const input = { id: 1, windowId: 2, index: 3, title: 'Page', url: 'https://example.com?q=x', pinned: false, groupId: -1 };
    expect(autoGroupTabFingerprint(input)).toBe(autoGroupTabFingerprint(input));
    expect(autoGroupTabFingerprint({ ...input, url: 'https://example.com?q=y' })).not.toBe(autoGroupTabFingerprint(input));
  });

  it('normalizes new labels, reserves sync, and assigns deterministic colors', () => {
    expect(normalizeAutoGroupLabel('  Space_Exploration News Today Extra ')).toBe('space exploration news');
    expect(normalizeAutoGroupLabel('SYNC')).toBe('unknown');
    expect(normalizeAutoGroupLabel(undefined)).toBe('unknown');
    expect(autoGroupColor('unknown')).toBe('grey');
    expect(autoGroupColor('aviation')).toBe(autoGroupColor('aviation'));
  });

  it('parses fenced JSON and validates existing groups within the same window', () => {
    const groups: AutoGroupExistingGroup[] = [{ id: 4, windowId: 1, title: 'Aviation' }, { id: 8, windowId: 2, title: 'Finance' }, { id: 9, windowId: 1, title: 'unknown' }];
    const response = '```json\n{"assignments":[{"tabId":1,"existingGroupId":4},{"tabId":2,"existingGroupId":8},{"tabId":3,"category":"Aviation"},{"tabId":4}]}\n```';
    expect(parseAutoGroupResponse(response)).toHaveLength(4);
    const result = validateAutoGroupAssignments([tab(1), tab(2, 1), tab(3), tab(4)], groups, response);
    expect(result[0].destination).toEqual({ kind: 'existing', groupId: 4, title: 'Aviation' });
    expect(result[1].destination).toEqual({ kind: 'existing', groupId: 9, title: 'unknown' });
    expect(result[2].destination).toEqual({ kind: 'existing', groupId: 4, title: 'Aviation' });
    expect(result[3].destination).toEqual({ kind: 'existing', groupId: 9, title: 'unknown' });
  });

  it('falls back to unknown for malformed or incomplete model output', () => {
    expect(validateAutoGroupAssignments([tab(1), tab(2)], [], 'not json').map((item) => item.destination)).toEqual([{ kind: 'new', category: 'unknown' }, { kind: 'new', category: 'unknown' }]);
  });

  it('classifies more than 300 tabs in bounded batches and carries categories forward', async () => {
    const complete = vi.fn(async ({ prompt }: { prompt: string }) => {
      const parsed = JSON.parse(prompt) as { tabs: Array<{ tabId: number }>; knownCategories: string[] };
      return { text: JSON.stringify({ assignments: parsed.tabs.map((item) => ({ tabId: item.tabId, category: item.tabId % 2 ? 'space' : 'aviation' })) }), usage };
    });
    const onBatch = vi.fn();
    const result = await classifyAutoGroupTabs({ apiKey: 'key', model: 'model', tabs: Array.from({ length: 305 }, (_, index) => tab(index + 1)), groups: [], complete: complete as never, onBatch });
    expect(result.assignments).toHaveLength(305);
    expect(result.unclassified).toHaveLength(0);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(JSON.parse(complete.mock.calls[1][0].prompt).knownCategories).toEqual(['aviation', 'space']);
    expect(onBatch).toHaveBeenLastCalledWith(4, 4, usage);
  });

  it('times out, retries a smaller batch, and returns recoverable partial results', async () => {
    const complete = vi.fn(() => new Promise<never>(() => undefined));
    const progress = vi.fn();
    const result = await classifyAutoGroupTabs({ apiKey: 'key', model: 'model', tabs: [tab(1), tab(2)], groups: [], complete: complete as never, timeoutMs: 5, onProgress: progress });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.assignments).toEqual([]);
    expect(result.unclassified).toHaveLength(2);
    expect(result.unclassified[0].reason).toBe('timeout');
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'retrying' }));
  });

  it('reconciles one-tab topics and deterministically falls back to misc', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ text: '{"assignments":[{"tabId":1,"category":"rare rocket"},{"tabId":2,"category":"niche bank"}]}', usage })
      .mockRejectedValueOnce(new Error('provider unavailable'));
    const result = await classifyAutoGroupTabs({ apiKey: 'key', model: 'model', tabs: [tab(1), tab(2)], groups: [], complete: complete as never });
    expect(result.assignments.map((item) => item.destination)).toEqual([{ kind: 'new', category: 'misc' }, { kind: 'new', category: 'misc' }]);
    expect(result.assignments.map((item) => item.originalDestination)).toEqual([{ kind: 'new', category: 'rare rocket' }, { kind: 'new', category: 'niche bank' }]);
  });
});
