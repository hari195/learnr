import { describe, expect, it } from 'vitest';
import { appendHighlightSections, appendHighlightsSection, blockquote, collectHighlights, collectSourceHighlights, formatHighlightsForPrompt, formatSourceHighlightsForPrompt, isDuplicateHighlight, isDuplicateSourceHighlight, normalizeSelection, removeHighlight } from './highlights';
import type { ChatMessage, SourceHighlight } from './types';

const messages: ChatMessage[] = [
  { id: 'user', role: 'user', content: 'A useful question', createdAt: 1, highlights: [{ id: 'later', startOffset: 2, endOffset: 8, text: 'useful', createdAt: 20 }] },
  { id: 'assistant', role: 'assistant', content: 'First line\nSecond line', createdAt: 2, highlights: [{ id: 'earlier', startOffset: 0, endOffset: 22, text: 'First line\nSecond line', createdAt: 10 }] },
];
const sourceHighlights: SourceHighlight[] = [
  { id: 'source-later', text: 'Source second', quote: 'Source second', prefix: 'a', suffix: 'b', documentStart: 20, documentEnd: 33, createdAt: 30, pageFingerprint: 'page' },
  { id: 'source-earlier', text: 'Source first\ncontinued', quote: 'Source first continued', prefix: 'x', suffix: 'y', documentStart: 2, documentEnd: 24, createdAt: 5, pageFingerprint: 'page' },
];

describe('chat and source highlights', () => {
  it('normalizes selected whitespace while preserving adjusted offsets and multiline text', () => {
    expect(normalizeSelection('Before  first\nsecond  after', 6, 22)).toEqual({ startOffset: 8, endOffset: 20, text: 'first\nsecond' });
    expect(normalizeSelection('only spaces', 4, 4)).toBeNull();
  });

  it('rejects duplicate ranges and orders highlights by selection time', () => {
    expect(isDuplicateHighlight(messages[0].highlights, { startOffset: 2, endOffset: 8 })).toBe(true);
    expect(collectHighlights(messages).map(({ id }) => id)).toEqual(['earlier', 'later']);
  });

  it('formats speaker context for the prompt without adding note attribution', () => {
    expect(formatHighlightsForPrompt(messages)).toBe('1. ASSISTANT:\nFirst line\nSecond line\n\n2. USER:\nuseful');
    expect(blockquote('First line\n\nSecond line')).toBe('> First line\n>\n> Second line');
  });

  it('appends source and conversation quotes in separate deterministic sections', () => {
    expect(appendHighlightSections('# Note\n', sourceHighlights, messages)).toBe('# Note\n\n## Source Highlights\n\n> Source first\n> continued\n\n> Source second\n\n## Conversation Highlights\n\n> First line\n> Second line\n\n> useful\n');
    expect(appendHighlightsSection('# Note\n', messages)).toContain('## Conversation Highlights');
    expect(appendHighlightsSection('# Note', [{ id: 'plain', role: 'assistant', content: 'No selection', createdAt: 1 }])).toBe('# Note');
  });

  it('orders, formats, and detects duplicate source anchors', () => {
    expect(collectSourceHighlights(sourceHighlights).map(({ id }) => id)).toEqual(['source-earlier', 'source-later']);
    expect(formatSourceHighlightsForPrompt(sourceHighlights)).toBe('1. Source first\ncontinued\n\n2. Source second');
    expect(isDuplicateSourceHighlight(sourceHighlights, sourceHighlights[0])).toBe(true);
    expect(isDuplicateSourceHighlight(sourceHighlights, { ...sourceHighlights[0], documentStart: 99, documentEnd: 100, prefix: 'different' })).toBe(false);
  });

  it('removes only the chosen conversation highlight', () => {
    const next = removeHighlight(messages, 'earlier');
    expect(next[1].highlights).toBeUndefined();
    expect(next[0].highlights?.[0].id).toBe('later');
  });
});
