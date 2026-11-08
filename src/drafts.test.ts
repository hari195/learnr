import { describe, expect, it } from 'vitest';
import { composeAttributedMarkdown, draftNeedsGeneration, formatResponseDuration, normalizeDrafts, normalizeGeneratedDraftMarkdown, reconcileDraftHighlights, snapshotHighlightIds, snapshotHighlights, snapshotMyNotes } from './drafts';
import type { NoteDraft } from './types';

function draft(patch: Partial<NoteDraft> = {}): NoteDraft {
  return { id: 'd', focus: '', highlightsMarkdown: '', capturedHighlightIds: [], links: [], aiMarkdown: 'AI body', myNotesMarkdown: '', markdown: '', filename: 'Note', images: [], targetSubfolder: '', ...patch };
}

describe('attributed drafts', () => {
  it('requires an explicit generation action for a newly prepared draft', () => {
    expect(draftNeedsGeneration(draft({ aiMarkdown: '', generating: false }))).toBe(true);
    expect(draftNeedsGeneration(draft({ aiMarkdown: '', generating: true }))).toBe(false);
    expect(draftNeedsGeneration(draft({ aiMarkdown: 'Generated' }))).toBe(false);
    expect(draftNeedsGeneration(draft({ aiMarkdown: '', generationError: 'Failed' }))).toBe(false);
  });

  it('keeps frontmatter first and emits only non-empty attributed sections', () => {
    const markdown = composeAttributedMarkdown(draft({ aiMarkdown: '---\ntitle: Test\n---\nGenerated', highlightsMarkdown: '> Exact quote', myNotesMarkdown: 'My exact words' }));
    expect(markdown).toBe('---\ntitle: Test\n---\n\n## My Notes\n\nMy exact words\n\n## Highlights\n\n> Exact quote\n\n## AI Generated\n\nGenerated\n');
    expect(composeAttributedMarkdown(draft())).not.toContain('## Highlights');
  });

  it('moves misplaced or YAML-fenced frontmatter to the beginning', () => {
    expect(normalizeGeneratedDraftMarkdown('# Premature heading\n\n```yaml\n---\ntitle: Test\nsource: https://example.com\n---\n```\n\nBody')).toBe('---\ntitle: Test\nsource: https://example.com\n---\n\n# Premature heading\n\nBody');
    const composed = composeAttributedMarkdown(draft({ aiMarkdown: '# Heading\n\n---\ntitle: Test\n---\n\nBody' }));
    expect(composed.startsWith('---\ntitle: Test\n---\n')).toBe(true);
    expect(composed).toContain('## AI Generated\n\n# Heading\n\nBody');
  });

  it('migrates singular legacy markdown into AI Generated', () => {
    const links = [{ noteId: 'prior', filename: 'Prior.md', relativePath: 'Prior.md', wikilink: '[[Prior]]' }];
    const values = normalizeDrafts(undefined, { markdown: 'Legacy body', filename: 'Legacy', images: [], targetSubfolder: '' }, links);
    expect(values).toHaveLength(1);
    expect(values[0].aiMarkdown).toBe('Legacy body');
    expect(values[0].links).toEqual(links);
  });

  it('preserves saved-draft identity while restoring an editor session', () => {
    const [restored] = normalizeDrafts([draft({ savedAt: 123, savedPath: 'notes/Idea.md', generating: true })]);
    expect(restored).toMatchObject({ savedAt: 123, savedPath: 'notes/Idea.md', generating: false });
  });

  it('keeps /note artifacts in capture order and formats durations', () => {
    expect(snapshotMyNotes([{ id: '2', type: 'note', text: 'Second', createdAt: 2 }, { id: '1', type: 'note', text: 'First', createdAt: 1 }])).toBe('Second\n\nFirst');
    expect(formatResponseDuration(450)).toBe('450 ms');
    expect(formatResponseDuration(12_345)).toBe('12.3 s');
    expect(formatResponseDuration(68_000)).toBe('1m 08s');
  });

  it('reconciles new highlights without duplicating captured or manually removed text', () => {
    const args = { artifacts: [{ id: 'keep-1', type: 'keep' as const, text: 'First idea', createdAt: 1 }], sourceHighlights: [], messages: [], images: [], videos: [] };
    const initial = draft({ highlightsMarkdown: snapshotHighlights(args), capturedHighlightIds: snapshotHighlightIds(args) });
    const laterArgs = { ...args, sourceHighlights: [{ id: 'source-1', text: 'A passage', quote: 'A passage', prefix: '', suffix: '', documentStart: 0, documentEnd: 9, createdAt: 2, pageFingerprint: 'page' }] };
    const reconciled = reconcileDraftHighlights(initial, laterArgs);
    expect(reconciled.highlightsMarkdown).toContain('First idea');
    expect(reconciled.highlightsMarkdown).toContain('> A passage');
    expect(reconcileDraftHighlights(reconciled, laterArgs)).toEqual(reconciled);
    const manuallyRemoved = { ...reconciled, highlightsMarkdown: reconciled.highlightsMarkdown.replace('> A passage', '') };
    expect(reconcileDraftHighlights(manuallyRemoved, laterArgs).highlightsMarkdown).not.toContain('> A passage');
  });

  it('migrates legacy highlight Markdown without duplicating matching material', () => {
    const args = { artifacts: [{ id: 'keep-1', type: 'keep' as const, text: 'Already here', createdAt: 1 }], sourceHighlights: [], messages: [], images: [], videos: [] };
    const reconciled = reconcileDraftHighlights(draft({ highlightsMarkdown: '### Kept\n\nAlready here' }), args);
    expect(reconciled.highlightsMarkdown.match(/Already here/g)).toHaveLength(1);
    expect(reconciled.capturedHighlightIds).toEqual(['keep:keep-1']);
  });

  it('appends late material inside its existing section', () => {
    const first = { id: 'source-1', text: 'First passage', quote: 'First passage', prefix: '', suffix: '', documentStart: 0, documentEnd: 13, createdAt: 1, pageFingerprint: 'page' };
    const second = { ...first, id: 'source-2', text: 'Second passage', quote: 'Second passage', createdAt: 2 };
    const baseArgs = { artifacts: [], sourceHighlights: [first], messages: [{ id: 'm', role: 'assistant' as const, content: 'Reply', createdAt: 2, highlights: [{ id: 'chat-1', text: 'Reply', startOffset: 0, endOffset: 5, createdAt: 2 }] }], images: [], videos: [] };
    const initial = draft({ highlightsMarkdown: snapshotHighlights(baseArgs), capturedHighlightIds: snapshotHighlightIds(baseArgs) });
    const markdown = reconcileDraftHighlights(initial, { ...baseArgs, sourceHighlights: [first, second] }).highlightsMarkdown;
    expect(markdown.indexOf('> Second passage')).toBeLessThan(markdown.indexOf('### Conversation Highlights'));
  });
});
