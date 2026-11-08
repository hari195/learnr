import type { ChatHighlight, ChatMessage, SourceHighlight } from './types';

export interface CollectedHighlight extends ChatHighlight {
  messageId: string;
  role: ChatMessage['role'];
}

export function normalizeSelection(text: string, startOffset: number, endOffset: number): Omit<ChatHighlight, 'id' | 'createdAt'> | null {
  const safeStart = Math.max(0, Math.min(startOffset, text.length));
  const safeEnd = Math.max(safeStart, Math.min(endOffset, text.length));
  const selected = text.slice(safeStart, safeEnd).replace(/\r\n?/g, '\n');
  const leading = selected.match(/^\s*/)?.[0].length ?? 0;
  const trailing = selected.match(/\s*$/)?.[0].length ?? 0;
  const normalized = selected.slice(leading, selected.length - trailing);
  if (!normalized) return null;
  return { startOffset: safeStart + leading, endOffset: safeEnd - trailing, text: normalized };
}

export function isDuplicateHighlight(highlights: ChatHighlight[] | undefined, candidate: Pick<ChatHighlight, 'startOffset' | 'endOffset'>): boolean {
  return (highlights ?? []).some((highlight) => highlight.startOffset === candidate.startOffset && highlight.endOffset === candidate.endOffset);
}

export function collectHighlights(messages: ChatMessage[]): CollectedHighlight[] {
  return messages.flatMap((message) => (message.highlights ?? []).map((highlight) => ({ ...highlight, messageId: message.id, role: message.role })))
    .sort((left, right) => left.createdAt - right.createdAt);
}

export function formatHighlightsForPrompt(messages: ChatMessage[]): string {
  const highlights = collectHighlights(messages);
  if (!highlights.length) return '(No chat highlights selected.)';
  return highlights.map((highlight, index) => `${index + 1}. ${highlight.role.toUpperCase()}:\n${highlight.text}`).join('\n\n');
}

export function collectSourceHighlights(highlights: SourceHighlight[]): SourceHighlight[] {
  return [...highlights].sort((left, right) => left.createdAt - right.createdAt);
}

export function formatSourceHighlightsForPrompt(highlights: SourceHighlight[]): string {
  const ordered = collectSourceHighlights(highlights);
  if (!ordered.length) return '(No source-page highlights selected.)';
  return ordered.map((highlight, index) => `${index + 1}. ${highlight.text}`).join('\n\n');
}

export function isDuplicateSourceHighlight(highlights: SourceHighlight[], candidate: Pick<SourceHighlight, 'documentStart' | 'documentEnd' | 'quote' | 'prefix' | 'suffix'>): boolean {
  return highlights.some((highlight) =>
    (highlight.documentStart === candidate.documentStart && highlight.documentEnd === candidate.documentEnd)
    || (highlight.quote === candidate.quote && highlight.prefix === candidate.prefix && highlight.suffix === candidate.suffix));
}

export function blockquote(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
}

export function appendHighlightSections(markdown: string, sourceHighlights: SourceHighlight[], messages: ChatMessage[]): string {
  const source = collectSourceHighlights(sourceHighlights);
  const conversation = collectHighlights(messages);
  const sections: string[] = [];
  if (source.length) sections.push(`## Source Highlights\n\n${source.map((highlight) => blockquote(highlight.text)).join('\n\n')}`);
  if (conversation.length) sections.push(`## Conversation Highlights\n\n${conversation.map((highlight) => blockquote(highlight.text)).join('\n\n')}`);
  if (!sections.length) return markdown;
  return `${markdown.trimEnd()}\n\n${sections.join('\n\n')}\n`;
}

/** @deprecated Use appendHighlightSections with an explicit source collection. */
export function appendHighlightsSection(markdown: string, messages: ChatMessage[]): string {
  return appendHighlightSections(markdown, [], messages);
}

export function removeHighlight(messages: ChatMessage[], highlightId: string): ChatMessage[] {
  return messages.map((message) => {
    if (!(message.highlights ?? []).some((highlight) => highlight.id === highlightId)) return message;
    const highlights = (message.highlights ?? []).filter((highlight) => highlight.id !== highlightId);
    return { ...message, ...(highlights.length ? { highlights } : { highlights: undefined }) };
  });
}
