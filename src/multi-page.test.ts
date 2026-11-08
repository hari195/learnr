import { describe, expect, it } from 'vitest';
import { allocateConversationPages, effectiveSourceBudget, formatAllocatedPages, multiPagePromptContext, projectedMessagesTokens, projectedTokenCount } from './multi-page';
import type { ConversationPage } from './types';

function page(id: string, length: number, linkedAt: number): ConversationPage {
  return { id, context: { title: id, url: `https://example.com/${id}`, cleanedMarkdown: id.repeat(length).slice(0, length), extractionStatus: 'readable', pageTheme: 'light' }, linkOrigin: 'manual', linkedAt, lastActiveAt: linkedAt };
}

describe('multi-page context allocation', () => {
  it('preserves complete labelled pages below the shared cap', () => {
    const allocated = allocateConversationPages([page('a', 10, 1), page('b', 20, 2)], 'b');
    expect(allocated.map((item) => item.id)).toEqual(['b', 'a']);
    expect(allocated.every((item) => !item.truncated)).toBe(true);
    expect(formatAllocatedPages(allocated)).toContain('## Page 1: b');
  });

  it('prioritizes the active page and remains within 32,000 projected tokens', () => {
    const allocated = allocateConversationPages([page('active', 200_000, 1), page('other-a', 200_000, 2), page('other-b', 200_000, 3)], 'active');
    expect(allocated[0].contextTokensUsed).toBe(20_000);
    expect(allocated[1].contextTokensUsed).toBe(6_000);
    expect(allocated[2].contextTokensUsed).toBe(6_000);
    expect(allocated.reduce((sum, item) => sum + item.contextTokensUsed, 0)).toBe(32_000);
    expect(allocated.every((item) => item.truncated)).toBe(true);
  });

  it('exposes source lists and a truncation flag', () => {
    const result = multiPagePromptContext([page('a', 200_000, 1), page('b', 100_000, 2)], 'a');
    expect(result.sources).toContain('https://example.com/b');
    expect(result.linkedPages).toContain('Page 2');
    expect(result.truncated).toBe(true);
  });

  it('projects ASCII, multilingual text, emoji, and structured blocks deterministically', () => {
    expect(projectedTokenCount('abcdefgh')).toBe(2);
    expect(projectedTokenCount('é')).toBe(1);
    expect(projectedTokenCount('😀')).toBe(2);
    expect(projectedTokenCount('abcd', 2)).toBe(9);
    expect(projectedMessagesTokens([{ id: 'm', role: 'user', content: 'abcdefgh', createdAt: 1 }])).toBe(6);
  });

  it('lowers the configured source budget using model context and reserves', () => {
    expect(effectiveSourceBudget({ configuredTokens: 64_000 }).tokens).toBe(64_000);
    expect(effectiveSourceBudget({ configuredTokens: 64_000, nonSourceTokens: 10_000, model: { id: 'm', contextLength: 40_000, maxCompletionTokens: 8_000, inputModalities: [], outputModalities: [], supportedParameters: [], pricing: [] } })).toMatchObject({ tokens: 21_904, modelAware: true, safetyMargin: 4_000, outputReserve: 4_096 });
  });
});
