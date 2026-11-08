import { describe, expect, it } from 'vitest';
import { filterRecentHistory, formatHistoryTime, latestHistoryForUrl, sortHistory } from './history';
import type { ChatHistoryRecord } from './types';

function record(id: string, lastInteractedAt: number): ChatHistoryRecord {
  return {
    id, lastInteractedAt, title: id, url: `https://example.com/${id}`, provider: 'openai', model: 'gpt-5.6-terra', messages: [], artifacts: [], sourceHighlights: [], imageHighlights: [],
    usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, requestCount: 0, tokensReported: false, costReported: false },
    context: { title: id, url: `https://example.com/${id}`, cleanedMarkdown: '', extractionStatus: 'readable', pageTheme: 'light' },
    pages: [], activePageId: '',
  };
}

describe('chat history', () => {
  it('orders records by their latest interaction without mutating the input', () => {
    const records = [record('older', 10), record('newest', 30), record('middle', 20)];
    expect(sortHistory(records).map(({ id }) => id)).toEqual(['newest', 'middle', 'older']);
    expect(records.map(({ id }) => id)).toEqual(['older', 'newest', 'middle']);
  });

  it('formats recent interaction times compactly', () => {
    const now = new Date('2026-08-10T12:00:00Z').getTime();
    expect(formatHistoryTime(now - 20_000, now)).toBe('Just now');
    expect(formatHistoryTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatHistoryTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatHistoryTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('finds the latest chat for a URL while ignoring page fragments', () => {
    const records = [record('old', 10), record('latest', 30), record('other', 40)];
    records[0].url = 'https://example.com/article#intro';
    records[1].url = 'https://example.com/article#ending';
    records[2].url = 'https://example.com/other';
    expect(latestHistoryForUrl(records, 'https://example.com/article')).toMatchObject({ id: 'latest' });
  });

  it('restores a conversation from any linked page URL', () => {
    const linked = record('linked', 20);
    expect(latestHistoryForUrl([{ ...linked, pageUrls: ['https://example.com/primary', 'https://other.example/research#section'] }], 'https://other.example/research')).toMatchObject({ id: 'linked' });
  });

  it('filters recent chats across titles and all linked page URLs', () => {
    const titleMatch = record('research-notes', 10);
    titleMatch.title = 'Distributed systems';
    const linkedMatch = { ...record('linked', 30), pageUrls: ['https://example.com/start', 'https://docs.example.dev/consensus'] };
    const unrelated = record('unrelated', 40);
    expect(filterRecentHistory([titleMatch, linkedMatch, unrelated], 'distributed').map(({ id }) => id)).toEqual(['research-notes']);
    expect(filterRecentHistory([titleMatch, linkedMatch, unrelated], 'consensus').map(({ id }) => id)).toEqual(['linked']);
    expect(filterRecentHistory([titleMatch, linkedMatch, unrelated], '').map(({ id }) => id)).toEqual(['unrelated', 'linked', 'research-notes']);
  });
});
