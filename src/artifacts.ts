import type { ConversationArtifact, IndexedNote, NoteReference } from './types';

export type ComposerCommand = { type: 'keep' | 'note'; text: string } | { type: 'draft'; focus: string } | { type: 'search'; query: string } | { type: 'link'; query: string } | null;
export function parseComposerCommand(value: string): ComposerCommand {
  const link = /^\/link(?:\s+([\s\S]*))?$/i.exec(value);
  if (link) return { type: 'link', query: link[1]?.trim() ?? '' };
  const search = /^\/search(?:\s+([\s\S]*))?$/i.exec(value);
  if (search) return { type: 'search', query: search[1]?.trim() ?? '' };
  const draft = /^\/draft(?:\s+([\s\S]*))?$/i.exec(value);
  if (draft) return { type: 'draft', focus: draft[1]?.trim() ?? '' };
  const note = /^\/note(?:\s+([\s\S]*))?$/i.exec(value);
  if (note) return { type: 'note', text: note[1]?.trim() ?? '' };
  const keep = /^\/keep(?:\s+([\s\S]*))?$/i.exec(value);
  if (keep) return { type: 'keep', text: keep[1]?.trim() ?? '' };
  return null;
}

export function filterIndexedNotes(notes: IndexedNote[], query: string): IndexedNote[] {
  const normalized = query.trim().toLowerCase();
  return notes.filter((note) => !normalized || `${note.title} ${note.filename} ${note.relativePath}`.toLowerCase().includes(normalized)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function linkReference(artifact: Extract<ConversationArtifact, { type: 'link' }>): NoteReference {
  return { noteId: artifact.noteId, embeddingProfileId: artifact.embeddingProfileId, libraryName: artifact.libraryName, filename: artifact.filename, relativePath: artifact.relativePath, wikilink: artifact.wikilink };
}

export function resolveLinkedNote(artifact: Extract<ConversationArtifact, { type: 'link' }>, notes: IndexedNote[]): IndexedNote | null {
  const exact = notes.filter((note) => note.relativePath === artifact.relativePath && note.filename === artifact.filename);
  const candidates = exact.length ? exact : notes.filter((note) => note.filename === artifact.filename);
  if (candidates.length > 1) throw new Error(`More than one indexed note matches “${artifact.filename}”. Open Search and choose the intended note again.`);
  return candidates[0] ?? null;
}

export function artifactsForPrompt(artifacts: ConversationArtifact[], includePersonalNotes = false): string {
  const visible = artifacts.filter((item) => item.type !== 'note' || includePersonalNotes);
  if (!visible.length) return '(No explicit note material.)';
  return visible.map((item) => item.type === 'keep' ? `KEEP FOR NOTE: ${item.text}` : item.type === 'note' ? `PERSONAL NOTE (preserve meaning; do not rewrite the original section): ${item.text}` : `LINK IN NOTE: ${item.wikilink} (${item.relativePath})`).join('\n\n');
}
