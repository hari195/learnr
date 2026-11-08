import { describe, expect, it } from 'vitest';
import { localUnifiedSearch, mergeSemanticResults } from './unified-search';
import type { ChatHistoryRecord, IndexedNote } from './types';
import { emptyUsage } from './usage';

describe('unified search', () => {
  const note: IndexedNote = { id: 'n1', filename: 'Ideas.md', relativePath: 'Thinking/Ideas.md', title: 'Ideas', markdown: 'Pluralistic ignorance and public belief', modifiedAt: 1, size: 10, contentHash: 'x', updatedAt: 1 };
  const history: ChatHistoryRecord = { id: 'old', title: 'Social signals', url: 'https://example.com/signals', lastInteractedAt: 1, provider: 'openrouter', model: 'm', messages: [{ id: 'hm', role: 'assistant', content: 'A public belief can diverge from private beliefs.', createdAt: 1 }], artifacts: [], sourceHighlights: [], imageHighlights: [], usage: emptyUsage(), context: { title: 'Social signals', url: 'https://example.com/signals', cleanedMarkdown: '', extractionStatus: 'readable', pageTheme: 'light' }, pages: [], activePageId: '' };

  it('searches current messages, artifacts, history, and full note Markdown locally', () => {
    const results = localUnifiedSearch({ query: 'public belief', messages: [{ id: 'm', role: 'user', content: 'What is public belief?', createdAt: 2 }], artifacts: [{ id: 'a', type: 'keep', text: 'Keep this public belief distinction', createdAt: 3 }], history: [history], notes: [note], currentHistoryId: 'current' });
    expect(new Set(results.map((result) => result.kind))).toEqual(new Set(['current', 'history', 'note']));
  });

  it('deduplicates the current history record and semantic note matches', () => {
    expect(localUnifiedSearch({ query: 'belief', messages: [], artifacts: [], history: [history], notes: [], currentHistoryId: 'old' })).toEqual([]);
    const local = localUnifiedSearch({ query: 'belief', messages: [], artifacts: [], history: [], notes: [note], currentHistoryId: 'current' });
    const merged = mergeSemanticResults(local, [{ noteId: 'n1', title: 'Ideas', filename: note.filename, relativePath: note.relativePath, markdown: note.markdown, score: .9 }]);
    expect(merged.filter((result) => result.id === 'note:n1')).toHaveLength(1);
    expect(merged[0]).toMatchObject({ semantic: true });
  });

  it('returns every matching note in relevance order with link metadata', () => {
    const notes = Array.from({ length: 12 }, (_, index): IndexedNote => ({ ...note, id: `n${index}`, filename: `Idea ${index}.md`, relativePath: `Thinking/Idea ${index}.md`, title: index === 7 ? 'belief' : `Idea ${index}`, markdown: `public belief example ${index}` }));
    const results = localUnifiedSearch({ query: 'belief', messages: [], artifacts: [], history: [], notes, currentHistoryId: 'current' });
    expect(results).toHaveLength(12);
    expect(results[0]).toMatchObject({ kind: 'note', title: 'belief', filename: 'Idea 7.md', wikilink: '[[Idea 7]]' });
  });
});
