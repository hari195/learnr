import { describe, expect, it } from 'vitest';
import { countWords, formatTimeSaved, normalizeLifetimeStats, savedNoteStats, usageStats } from './stats';

describe('lifetime statistics', () => {
  it('counts saved-note words and estimates drafting time', () => {
    expect(countWords('one two\nthree')).toBe(3);
    expect(savedNoteStats(Array.from({ length: 80 }, () => 'word').join(' '))).toEqual({ notesSaved: 1, noteWords: 80, timeSavedMinutes: 2 });
  });

  it('normalizes legacy stats and maps provider usage', () => {
    expect(normalizeLifetimeStats({ notesSaved: 2 })).toEqual({ notesSaved: 2, noteWords: 0, totalTokens: 0, totalCostUsd: 0, timeSavedMinutes: 0 });
    expect(usageStats({ inputTokens: 8, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2, totalTokens: 10, costUsd: .01, requestCount: 1, tokensReported: true, costReported: true })).toEqual({ totalTokens: 10, totalCostUsd: .01 });
  });

  it('formats delightful compact time totals', () => {
    expect(formatTimeSaved(.2)).toBe('<1 min');
    expect(formatTimeSaved(42)).toBe('42 min');
    expect(formatTimeSaved(125)).toBe('2h 5m');
  });
});
