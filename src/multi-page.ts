import type { ChatMessage, ConversationPage, OpenRouterModelMetadata, PageContext } from './types';

export const DEFAULT_SOURCE_CONTEXT_BUDGET_TOKENS = 32_000;
export const SOURCE_CONTEXT_BUDGET_STEP = 32_000;
const MIN_OTHER_PAGE_TOKENS = 500;

export interface AllocatedConversationPage extends ConversationPage { contextCharsUsed: number; contextTokensUsed: number; truncated: boolean }

export function projectedTokenCount(text: string, blocks = 0): number {
  let ascii = 0; let nonAscii = '';
  for (const character of text) { if (character.codePointAt(0)! <= 0x7f) ascii += 1; else nonAscii += character; }
  return Math.ceil(ascii / 4) + Math.ceil(new TextEncoder().encode(nonAscii).length / 2) + Math.max(0, blocks) * 4;
}

export function projectedMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + projectedTokenCount(message.content, 1) + (message.attachments ?? []).reduce((inner, attachment) => inner + projectedTokenCount(attachment.kind === 'text' ? attachment.text : attachment.name, 1), 0), 0);
}

export function effectiveSourceBudget(args: { configuredTokens: number; model?: OpenRouterModelMetadata; nonSourceTokens?: number }): { tokens: number; modelAware: boolean; contextLength?: number; outputReserve?: number; safetyMargin?: number } {
  const configured = Math.min(2_048_000, Math.max(SOURCE_CONTEXT_BUDGET_STEP, Math.round(args.configuredTokens / SOURCE_CONTEXT_BUDGET_STEP) * SOURCE_CONTEXT_BUDGET_STEP));
  const contextLength = args.model?.contextLength;
  if (!contextLength) return { tokens: configured, modelAware: false };
  const safetyMargin = Math.ceil(contextLength * .1); const desiredOutput = Math.max(4_096, Math.ceil(contextLength * .1));
  const outputReserve = args.model?.maxCompletionTokens ? Math.min(args.model.maxCompletionTokens, desiredOutput) : 8_192;
  return { tokens: Math.max(0, Math.min(configured, contextLength - (args.nonSourceTokens ?? 0) - safetyMargin - outputReserve)), modelAware: true, contextLength, outputReserve, safetyMargin };
}

function pageOverhead(page: ConversationPage): number { return projectedTokenCount(`## ${page.context.title}\nURL: ${page.context.url}`, 1); }

function prefixForTokens(text: string, tokens: number, overhead: number): string {
  const contentBudget = Math.max(0, tokens - overhead); if (!contentBudget) return '';
  if (projectedTokenCount(text) <= contentBudget) return text;
  let low = 0; let high = text.length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (projectedTokenCount(text.slice(0, middle)) <= contentBudget) low = middle; else high = middle - 1; }
  return text.slice(0, low);
}

function distribute(lengths: number[], budget: number): number[] {
  const allocations = lengths.map(() => 0); let remaining = Math.max(0, budget); let open = lengths.map((_, index) => index);
  while (remaining > 0 && open.length) { const share = Math.max(1, Math.floor(remaining / open.length)); const next: number[] = []; for (const index of open) { const added = Math.min(lengths[index] - allocations[index], share, remaining); allocations[index] += added; remaining -= added; if (allocations[index] < lengths[index]) next.push(index); } open = next; }
  return allocations;
}

export function allocateConversationPages(pages: ConversationPage[], activePageId: string, budget = DEFAULT_SOURCE_CONTEXT_BUDGET_TOKENS): AllocatedConversationPage[] {
  const ordered = pages.filter((page) => page.contextIncluded !== false && !page.pending && page.context.extractionStatus !== 'unavailable').sort((a, b) => a.id === activePageId ? -1 : b.id === activePageId ? 1 : a.linkedAt - b.linkedAt);
  const overheads = ordered.map(pageOverhead); const lengths = ordered.map((page, index) => overheads[index] + projectedTokenCount(page.context.cleanedMarkdown));
  if (lengths.reduce((sum, value) => sum + value, 0) <= budget) return ordered.map((page, index) => ({ ...page, contextCharsUsed: page.context.cleanedMarkdown.length, contextTokensUsed: lengths[index], truncated: false }));
  const activeIndex = Math.max(0, ordered.findIndex((page) => page.id === activePageId)); const activeAllocation = Math.min(lengths[activeIndex] ?? 0, Math.floor(budget * .625));
  const otherIndexes = ordered.map((_, index) => index).filter((index) => index !== activeIndex); const remaining = Math.max(0, budget - activeAllocation);
  const minimums = otherIndexes.map((index) => Math.min(lengths[index], MIN_OTHER_PAGE_TOKENS)); const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  const extras = minimumTotal > remaining ? [] : distribute(otherIndexes.map((index, position) => Math.max(0, lengths[index] - minimums[position])), remaining - minimumTotal);
  const others = minimumTotal > remaining ? distribute(minimums, remaining) : minimums.map((value, index) => value + extras[index]); const allocations = ordered.map(() => 0);
  allocations[activeIndex] = activeAllocation; otherIndexes.forEach((index, position) => { allocations[index] = others[position]; });
  return ordered.map((page, index) => { const content = prefixForTokens(page.context.cleanedMarkdown, allocations[index], overheads[index]); return { ...page, contextCharsUsed: content.length, contextTokensUsed: content ? overheads[index] + projectedTokenCount(content) : 0, truncated: content.length < page.context.cleanedMarkdown.length }; });
}

export function formatAllocatedPages(pages: AllocatedConversationPage[]): string { return pages.map((page, index) => [`## Page ${index + 1}: ${page.context.title}`, `URL: ${page.context.url}`, page.truncated ? `[Context shortened to ${page.contextTokensUsed.toLocaleString()} projected tokens]` : '', page.context.cleanedMarkdown.slice(0, page.contextCharsUsed)].filter(Boolean).join('\n')).join('\n\n'); }

export function multiPagePromptContext(pages: ConversationPage[], activePageId: string, budget = DEFAULT_SOURCE_CONTEXT_BUDGET_TOKENS): { context: PageContext; allocated: AllocatedConversationPage[]; linkedPages: string; sources: string; truncated: boolean } {
  const allocated = allocateConversationPages(pages, activePageId, budget); const active = pages.find((page) => page.id === activePageId) ?? pages[0]; const fallback: PageContext = { title: 'Untitled conversation', url: '', cleanedMarkdown: '', extractionStatus: 'unavailable', pageTheme: 'light' };
  return { context: { ...(active?.context ?? fallback), cleanedMarkdown: formatAllocatedPages(allocated) }, allocated, linkedPages: allocated.map((page, index) => `Page ${index + 1}: ${page.context.title} — ${page.context.url}`).join('\n'), sources: allocated.map((page) => `  - ${page.context.url}`).join('\n'), truncated: allocated.some((page) => page.truncated) };
}
