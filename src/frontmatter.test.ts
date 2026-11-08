import { describe, expect, it } from 'vitest';
import { mergeRelatedNoteLinks, mergeWorkspaceFrontmatter } from './frontmatter';
import type { NoteReference } from './types';

const note = (wikilink: string, ambiguous = false): NoteReference => ({ noteId: wikilink, filename: `${wikilink}.md`, relativePath: `${wikilink}.md`, wikilink, ambiguous });

describe('related-note frontmatter', () => {
  it('creates quoted related links when frontmatter is absent', () => {
    expect(mergeRelatedNoteLinks('# Body', [note('[[Prior note]]')])).toBe('---\nrelated:\n  - "[[Prior note]]"\n---\n\n# Body');
  });

  it('merges links without changing other fields and is idempotent', () => {
    const original = '---\ntitle: Current\nrelated:\n  - "[[Existing]]"\ntags:\n  - idea\n---\n# Body';
    const once = mergeRelatedNoteLinks(original, [note('[[Existing]]'), note('[[New note]]')]);
    expect(once).toContain('related:\n  - "[[Existing]]"\n  - "[[New note]]"\ntags:');
    expect(mergeRelatedNoteLinks(once, [note('[[New note]]')])).toBe(once);
  });

  it('rejects scalar related fields and ignores ambiguous links', () => {
    expect(() => mergeRelatedNoteLinks('---\nrelated: "[[One]]"\n---\nBody', [note('[[Two]]')])).toThrow('YAML list');
    expect(mergeRelatedNoteLinks('# Body', [note('[[Duplicate]]', true)])).toBe('# Body');
  });

  it('rejects malformed frontmatter without changing the draft', () => {
    expect(() => mergeRelatedNoteLinks('---\ntitle: Broken\n# body', [note('[[Prior]]')])).toThrow('invalid YAML frontmatter');
    expect(() => mergeRelatedNoteLinks('---\nthis is not yaml\n---\nBody', [note('[[Prior]]')])).toThrow('invalid YAML frontmatter');
  });
});

describe('workspace frontmatter', () => {
  it('creates and updates the quoted workspace field', () => {
    expect(mergeWorkspaceFrontmatter('# Note', 'Research')).toBe('---\nworkspace: "Research"\n---\n\n# Note');
    expect(mergeWorkspaceFrontmatter('---\ntitle: Test\nworkspace: "Old"\n---\nBody', 'New notes')).toContain('workspace: "New notes"');
  });

  it('rejects malformed frontmatter', () => {
    expect(() => mergeWorkspaceFrontmatter('---\ntitle: Broken', 'Research')).toThrow(/invalid YAML/i);
  });
});
