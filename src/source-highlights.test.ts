import { describe, expect, it } from 'vitest';
import { findSourceHighlightStart, normalizeSourceQuote } from './source-highlights';
import type { SourceHighlight } from './types';

describe('source highlight anchors', () => {
  it('normalizes whitespace for resilient matching without changing stored quote text', () => {
    expect(normalizeSourceQuote('  First line\r\n  second\tline  ')).toBe('First line second line');
    expect(normalizeSourceQuote(' \n\t ')).toBe('');
  });

  it('uses stored offsets first and falls back to the matching surrounding context', () => {
    const base: SourceHighlight = { id: 'h', text: 'same words', quote: 'same words', prefix: 'wanted ', suffix: ' ending', documentStart: 0, documentEnd: 10, createdAt: 1, pageFingerprint: 'page' };
    expect(findSourceHighlightStart('same words elsewhere', base)).toBe(0);
    expect(findSourceHighlightStart('other same words noise wanted same words ending', { ...base, documentStart: 99, documentEnd: 109 })).toBe(30);
    expect(findSourceHighlightStart('passage missing', { ...base, documentStart: 99, documentEnd: 109 })).toBe(-1);
  });
});
