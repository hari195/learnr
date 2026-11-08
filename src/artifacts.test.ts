import { describe, expect, it } from 'vitest';
import { artifactsForPrompt, filterIndexedNotes, parseComposerCommand, resolveLinkedNote } from './artifacts';
import type { IndexedNote } from './types';

describe('chat note-planning artifacts', () => {
  it('parses /keep and /link without treating ordinary prompts as commands', () => {
    expect(parseComposerCommand('/keep  Fix this idea ')).toEqual({ type: 'keep', text: 'Fix this idea' });
    expect(parseComposerCommand('/keep')).toEqual({ type: 'keep', text: '' });
    expect(parseComposerCommand('/link')).toEqual({ type: 'link', query: '' });
    expect(parseComposerCommand('/note  My markdown ')).toEqual({ type: 'note', text: 'My markdown' });
    expect(parseComposerCommand('/draft  One claim ')).toEqual({ type: 'draft', focus: 'One claim' });
    expect(parseComposerCommand('/search  coordination failure ')).toEqual({ type: 'search', query: 'coordination failure' });
    expect(parseComposerCommand('/search')).toEqual({ type: 'search', query: '' });
    expect(parseComposerCommand('/link something')).toEqual({ type: 'link', query: 'something' });
  });

  it('renders labelled artifacts for prompts', () => {
    const artifacts = [{ id: 'k', type: 'keep' as const, text: 'My thesis', createdAt: 1 }, { id: 'n', type: 'note' as const, text: 'Private words', createdAt: 2 }, { id: 'l', type: 'link' as const, noteId: 'n', filename: 'Prior.md', relativePath: 'Ideas/Prior.md', wikilink: '[[Prior]]', createdAt: 3 }];
    expect(artifactsForPrompt(artifacts)).toContain('KEEP FOR NOTE: My thesis\n\nLINK IN NOTE: [[Prior]]');
    expect(artifactsForPrompt(artifacts)).not.toContain('Private words');
    expect(artifactsForPrompt(artifacts, true)).toContain('PERSONAL NOTE');
  });

  it('filters indexed notes by title, filename, and path', () => {
    const note = (id: string, title: string, relativePath: string): IndexedNote => ({ id, title, relativePath, filename: relativePath.split('/').at(-1)!, markdown: '', modifiedAt: 1, size: 0, contentHash: id, updatedAt: 1 });
    const notes = [note('a', 'Alpha concept', 'Ideas/One.md'), note('b', 'Beta', 'Archive/Second.md')];
    expect(filterIndexedNotes(notes, 'alpha').map(({ id }) => id)).toEqual(['a']);
    expect(filterIndexedNotes(notes, 'archive').map(({ id }) => id)).toEqual(['b']);
  });

  it('repairs legacy links by path and rejects ambiguous filename-only matches', () => {
    const note = (id: string, relativePath: string): IndexedNote => ({ id, title: 'Prior', relativePath, filename: 'Prior.md', markdown: '', modifiedAt: 1, size: 0, contentHash: id, updatedAt: 1 });
    const artifact = { id: 'link', type: 'link' as const, noteId: 'legacy-id', filename: 'Prior.md', relativePath: 'Ideas/Prior.md', wikilink: '[[Prior]]', createdAt: 1 };
    expect(resolveLinkedNote(artifact, [note('one', 'Archive/Prior.md'), note('two', 'Ideas/Prior.md')])?.id).toBe('two');
    expect(() => resolveLinkedNote({ ...artifact, relativePath: 'Missing/Prior.md' }, [note('one', 'Archive/Prior.md'), note('two', 'Ideas/Prior.md')])).toThrow('More than one');
  });
});
