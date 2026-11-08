import { collectHighlights, collectSourceHighlights, blockquote } from './highlights';
import { obsidianImageEmbed } from './image-assets';
import { canonicalYoutubeUrl } from './media';
import type { ChatMessage, ConversationArtifact, ImageHighlight, NoteDraft, NoteReference, SourceHighlight, VideoHighlight } from './types';

export function normalizeNoteDraft(value: Partial<NoteDraft> | null | undefined, legacyLinks: NoteReference[] = []): NoteDraft | null {
  if (!value) return null;
  return {
    id: value.id || crypto.randomUUID(),
    focus: value.focus ?? '',
    highlightsMarkdown: value.highlightsMarkdown ?? '',
    capturedHighlightIds: value.capturedHighlightIds ?? [],
    links: value.links ?? legacyLinks,
    aiMarkdown: value.aiMarkdown ?? value.markdown ?? '',
    myNotesMarkdown: value.myNotesMarkdown ?? '',
    markdown: value.markdown ?? '',
    filename: value.filename || 'Untitled note',
    images: value.images ?? [],
    targetSubfolder: value.targetSubfolder ?? '',
    workspaceId: value.workspaceId,
    workspaceName: value.workspaceName,
    responseStats: value.responseStats,
    generationError: value.generationError,
    savedAt: value.savedAt,
    savedPath: value.savedPath,
    // A persisted session has no surviving AbortController after extension reload.
    // Live in-memory draft state preserves the true generating flag separately.
    generating: false,
  };
}

export function normalizeDrafts(values?: Array<Partial<NoteDraft>>, legacy?: Partial<NoteDraft> | null, legacyLinks: NoteReference[] = []): NoteDraft[] {
  const source = values?.length ? values : legacy ? [legacy] : [];
  return source.flatMap((value) => normalizeNoteDraft(value, legacyLinks) ?? []);
}

export function draftNeedsGeneration(draft: Pick<NoteDraft, 'aiMarkdown' | 'generating' | 'generationError'>): boolean {
  return !draft.generating && !draft.aiMarkdown.trim() && !draft.generationError;
}

interface DraftHighlightEntry { id: string; section: string; markdown: string }

function highlightEntries(args: { artifacts: ConversationArtifact[]; sourceHighlights: SourceHighlight[]; messages: ChatMessage[]; images: ImageHighlight[]; videos: VideoHighlight[] }): DraftHighlightEntry[] {
  const kept = args.artifacts.filter((item): item is Extract<ConversationArtifact, { type: 'keep' }> => item.type === 'keep').map((item) => ({ id: `keep:${item.id}`, section: 'Kept', markdown: item.text }));
  const source = collectSourceHighlights(args.sourceHighlights).map((item) => ({ id: `source:${item.id}`, section: 'Source Highlights', markdown: blockquote(item.text) }));
  const chat = collectHighlights(args.messages).map((item) => ({ id: `chat:${item.messageId}:${item.id}`, section: 'Conversation Highlights', markdown: blockquote(item.text) }));
  const images = [...args.images].sort((a, b) => a.createdAt - b.createdAt).map((item) => ({ id: `image:${item.id}`, section: 'Images', markdown: obsidianImageEmbed(item.filename) }));
  const videos = [...args.videos].sort((a, b) => a.createdAt - b.createdAt).map((item) => ({ id: `video:${item.id}`, section: 'Videos', markdown: `- [${item.title.replace(/[\[\]]/g, '')}](${canonicalYoutubeUrl(item.videoId, item.currentTimeSeconds)})` }));
  return [...kept, ...source, ...chat, ...images, ...videos];
}

function appendEntries(markdown: string, entries: DraftHighlightEntry[]): string {
  let next = markdown.trim();
  const sections = new Map<string, string[]>();
  for (const entry of entries) sections.set(entry.section, [...(sections.get(entry.section) ?? []), entry.markdown]);
  for (const [section, blocks] of sections) {
    const heading = `### ${section}`;
    const start = next.indexOf(heading);
    if (start < 0) { next = [next, `${heading}\n\n${blocks.join('\n\n')}`].filter(Boolean).join('\n\n'); continue; }
    const contentStart = start + heading.length;
    const following = next.slice(contentStart).search(/\n###\s+/);
    const end = following < 0 ? next.length : contentStart + following;
    next = [next.slice(0, end).trimEnd(), blocks.join('\n\n'), next.slice(end).trimStart()].filter(Boolean).join('\n\n');
  }
  return next;
}

export function snapshotHighlights(args: { artifacts: ConversationArtifact[]; sourceHighlights: SourceHighlight[]; messages: ChatMessage[]; images: ImageHighlight[]; videos: VideoHighlight[] }): string {
  return appendEntries('', highlightEntries(args));
}

export function snapshotHighlightIds(args: { artifacts: ConversationArtifact[]; sourceHighlights: SourceHighlight[]; messages: ChatMessage[]; images: ImageHighlight[]; videos: VideoHighlight[] }): string[] {
  return highlightEntries(args).map((entry) => entry.id);
}

export function reconcileDraftHighlights(draft: NoteDraft, args: { artifacts: ConversationArtifact[]; sourceHighlights: SourceHighlight[]; messages: ChatMessage[]; images: ImageHighlight[]; videos: VideoHighlight[] }): NoteDraft {
  const entries = highlightEntries(args);
  const captured = new Set(draft.capturedHighlightIds);
  // Legacy drafts have no provenance. Treat matching Markdown as already captured.
  if (!draft.capturedHighlightIds.length && draft.highlightsMarkdown) for (const entry of entries) if (draft.highlightsMarkdown.includes(entry.markdown)) captured.add(entry.id);
  const missing = entries.filter((entry) => !captured.has(entry.id));
  const knownImages = new Set(draft.images.map((image) => image.id));
  const images = [...draft.images, ...args.images.filter((image) => !knownImages.has(image.id))];
  if (!missing.length && captured.size === draft.capturedHighlightIds.length && images.length === draft.images.length) return draft;
  for (const entry of entries) captured.add(entry.id);
  return { ...draft, highlightsMarkdown: appendEntries(draft.highlightsMarkdown, missing), capturedHighlightIds: [...captured], images };
}

export function draftLinkReferences(artifacts: ConversationArtifact[]): NoteReference[] {
  return artifacts.filter((item): item is Extract<ConversationArtifact, { type: 'link' }> => item.type === 'link').map((item) => ({ noteId: item.noteId, embeddingProfileId: item.embeddingProfileId, libraryName: item.libraryName, filename: item.filename, relativePath: item.relativePath, wikilink: item.wikilink }));
}

export function snapshotMyNotes(artifacts: ConversationArtifact[]): string {
  return artifacts.filter((item): item is Extract<ConversationArtifact, { type: 'note' }> => item.type === 'note').map((item) => item.text).join('\n\n');
}

export function normalizeGeneratedDraftMarkdown(value: string): string {
  let normalized = value.replace(/\r\n?/g, '\n').trim();
  const outerFence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(normalized);
  if (outerFence) normalized = outerFence[1].trim();
  const pattern = /(^|\n)---[ \t]*\n([\s\S]*?)\n---[ \t]*(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized))) {
    if (!/^[A-Za-z0-9_-]+\s*:/m.test(match[2])) continue;
    const start = match.index + match[1].length;
    const end = pattern.lastIndex;
    const frontmatter = normalized.slice(start, end).trim();
    const before = normalized.slice(0, start).replace(/```(?:ya?ml|markdown|md)?\s*$/i, '').trim();
    const after = normalized.slice(end).replace(/^\s*```(?:\s*\n|$)/, '').trim();
    return [frontmatter, before, after].filter(Boolean).join('\n\n');
  }
  return normalized;
}

export function composeAttributedMarkdown(draft: Pick<NoteDraft, 'highlightsMarkdown' | 'aiMarkdown' | 'myNotesMarkdown'>): string {
  const ai = normalizeGeneratedDraftMarkdown(draft.aiMarkdown);
  const frontmatter = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(ai)?.[0].trimEnd() ?? '';
  if (ai.startsWith('---') && !frontmatter) throw new Error('The AI-generated draft has invalid YAML frontmatter. Fix it before saving.');
  const aiBody = (frontmatter ? ai.slice(frontmatter.length) : ai).trim();
  const sections = [
    draft.myNotesMarkdown.trim() ? `## My Notes\n\n${draft.myNotesMarkdown.trim()}` : '',
    draft.highlightsMarkdown.trim() ? `## Highlights\n\n${draft.highlightsMarkdown.trim()}` : '',
    `## AI Generated\n\n${aiBody}`,
  ].filter(Boolean).join('\n\n');
  return [frontmatter, sections].filter(Boolean).join('\n\n').trimEnd() + '\n';
}

export function formatResponseDuration(durationMs?: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs! < 0) return null;
  if (durationMs! < 1_000) return `${Math.round(durationMs!)} ms`;
  if (durationMs! < 60_000) return `${(durationMs! / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(durationMs! / 60_000);
  const seconds = Math.floor((durationMs! % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
