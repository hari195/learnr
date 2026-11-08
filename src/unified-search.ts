import type { ChatHistoryRecord, ConversationArtifact, IndexedNote, ChatMessage, UnifiedSearchResult } from './types';

function normalized(value: string): string { return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
function snippet(value: string, query: string, length = 150): string {
  const clean = value.replace(/\s+/g, ' ').trim(); const index = normalized(clean).indexOf(normalized(query));
  if (index < 0) return clean.slice(0, length);
  const start = Math.max(0, index - 45); const end = Math.min(clean.length, start + length);
  return `${start ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}
function relevance(haystack: string, query: string, title = ''): number {
  const q = normalized(query); if (!q) return 0; const text = normalized(haystack); const heading = normalized(title);
  if (heading === q) return 100; if (heading.startsWith(q)) return 80; if (heading.includes(q)) return 60;
  if (text.includes(q)) return 40;
  const tokens = q.split(' ').filter(Boolean); const hits = tokens.filter((token) => text.includes(token)).length;
  return hits === tokens.length ? 20 + hits : hits;
}

export function localUnifiedSearch(args: { query: string; messages: ChatMessage[]; artifacts: ConversationArtifact[]; history: ChatHistoryRecord[]; notes: IndexedNote[]; currentHistoryId: string }): UnifiedSearchResult[] {
  const { query } = args; if (!query.trim()) return [];
  const results: UnifiedSearchResult[] = [];
  for (const message of args.messages) { const score = relevance(message.content, query); if (score) results.push({ id: `message:${message.id}`, kind: 'current', title: message.role === 'user' ? 'You' : 'learnr', subtitle: 'Current chat', snippet: snippet(message.content, query), messageId: message.id, score }); }
  for (const artifact of args.artifacts) { const text = artifact.type === 'link' ? `${artifact.filename} ${artifact.relativePath}` : artifact.text; const title = artifact.type === 'link' ? artifact.filename : artifact.type === 'note' ? 'My note' : 'Keep for note'; const score = relevance(text, query, title); if (score) results.push({ id: `artifact:${artifact.id}`, kind: 'current', title, subtitle: 'Current chat', snippet: snippet(text, query), artifactId: artifact.id, score }); }
  for (const record of args.history) if (record.id !== args.currentHistoryId) { const text = `${record.title} ${record.url} ${record.messages.map((message) => message.content).join(' ')} ${record.artifacts.map((item) => item.type === 'link' ? item.relativePath : item.text).join(' ')}`; const score = relevance(text, query, `${record.title} ${record.url}`); if (score) results.push({ id: `history:${record.id}`, kind: 'history', title: record.title || 'Untitled page', subtitle: record.url, snippet: snippet(text, query), historyId: record.id, workspaceId: record.workspaceId, score }); }
  for (const note of args.notes) { const text = `${note.title} ${note.filename} ${note.relativePath} ${note.markdown}`; const score = relevance(text, query, `${note.title} ${note.filename} ${note.relativePath}`); const id = note.workspaceId ? `note:${note.workspaceId}:${note.id}` : `note:${note.id}`; if (score) results.push({ id, kind: 'note', title: note.title || note.filename, subtitle: `${note.workspaceName ? `${note.workspaceName} · ` : ''}${note.relativePath}`, snippet: snippet(note.markdown, query), noteId: note.id, filename: note.filename, relativePath: note.relativePath, wikilink: `[[${note.filename.replace(/\.md$/i, '')}]]`, embeddingProfileId: note.workspaceId, libraryName: note.workspaceName, score }); }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function mergeSemanticResults(local: UnifiedSearchResult[], semantic: Array<{ noteId: string; title: string; filename: string; relativePath: string; markdown: string; workspaceId?: string; embeddingProfileId?: string; libraryName?: string; score?: number }>): UnifiedSearchResult[] {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const note of semantic) { const id = `note:${note.embeddingProfileId ?? note.workspaceId ?? ''}:${note.noteId}`; map.set(id, { id, kind: 'note', title: note.title, subtitle: note.relativePath, snippet: snippet(note.markdown, ''), noteId: note.noteId, filename: note.filename, relativePath: note.relativePath, wikilink: `[[${note.filename.replace(/\.md$/i, '')}]]`, workspaceId: note.workspaceId, embeddingProfileId: note.embeddingProfileId, libraryName: note.libraryName, score: 110 + (note.score ?? 0), semantic: true }); }
  return [...map.values()].sort((a, b) => b.score - a.score);
}
