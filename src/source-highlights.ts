import type { SourceHighlight } from './types';

const EXCLUDED_SELECTOR = 'script,style,noscript,template,input,textarea,select,option,[contenteditable="true"],[contenteditable="plaintext-only"],#learnr-extension-root,#learnr-source-highlight-action-root';
const BLOCK_SELECTOR = 'address,article,aside,blockquote,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tbody,td,tfoot,th,thead,tr,ul';
const CONTEXT_LENGTH = 64;

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface TextIndex {
  raw: string;
  normalized: string;
  normalizedToRaw: number[];
  segments: TextSegment[];
}

export interface ResolvedSourceHighlights {
  ranges: Range[];
  resolvedIds: string[];
}

export function normalizeSourceQuote(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
}

function normalizedWithMap(raw: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let pendingSpace = -1;
  for (let index = 0; index < raw.length; index += 1) {
    if (/\s/.test(raw[index])) {
      if (text && pendingSpace < 0) pendingSpace = index;
      continue;
    }
    if (pendingSpace >= 0) {
      text += ' ';
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    text += raw[index];
    map.push(index);
  }
  return { text, map };
}

function isAcceptedText(node: Text, root: HTMLElement): boolean {
  const parent = node.parentElement;
  return Boolean(node.data && parent && root.contains(parent) && !parent.closest(EXCLUDED_SELECTOR));
}

function buildTextIndex(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: TextSegment[] = [];
  let raw = '';
  let previousBlock: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!isAcceptedText(node, root)) continue;
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? root;
    if (segments.length && block !== previousBlock) raw += '\n';
    const start = raw.length;
    raw += node.data;
    segments.push({ node, start, end: raw.length });
    previousBlock = block;
  }
  const normalized = normalizedWithMap(raw);
  return { raw, normalized: normalized.text, normalizedToRaw: normalized.map, segments };
}

function intersectingOffsets(range: Range, index: TextIndex): { start: number; end: number } | null {
  const selected = index.segments.filter((segment) => {
    try { return range.intersectsNode(segment.node); } catch { return false; }
  });
  if (!selected.length) return null;
  const first = selected[0];
  const last = selected[selected.length - 1];
  const start = first.start + (range.startContainer === first.node ? range.startOffset : 0);
  const end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.data.length);
  return end > start ? { start, end } : null;
}

function pointForRawOffset(index: TextIndex, offset: number, end = false): { node: Text; offset: number } | null {
  const segment = index.segments.find((candidate) => offset >= candidate.start && (offset < candidate.end || (end && offset === candidate.end)));
  if (!segment) return null;
  return { node: segment.node, offset: Math.max(0, Math.min(segment.node.data.length, offset - segment.start)) };
}

function rangeForNormalizedOffsets(index: TextIndex, start: number, end: number): Range | null {
  if (start < 0 || end <= start || end > index.normalized.length) return null;
  const rawStart = index.normalizedToRaw[start];
  const rawEnd = (index.normalizedToRaw[end - 1] ?? -1) + 1;
  const startPoint = pointForRawOffset(index, rawStart);
  const endPoint = pointForRawOffset(index, rawEnd, true);
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function anchorScore(documentText: string, start: number, highlight: SourceHighlight): number {
  const prefix = documentText.slice(Math.max(0, start - highlight.prefix.length), start);
  const end = start + highlight.quote.length;
  const suffix = documentText.slice(end, end + highlight.suffix.length);
  let score = 0;
  for (let index = 1; index <= Math.min(prefix.length, highlight.prefix.length); index += 1) {
    if (prefix.at(-index) !== highlight.prefix.at(-index)) break;
    score += 1;
  }
  for (let index = 0; index < Math.min(suffix.length, highlight.suffix.length); index += 1) {
    if (suffix[index] !== highlight.suffix[index]) break;
    score += 1;
  }
  return score;
}

export function findSourceHighlightStart(documentText: string, highlight: SourceHighlight): number {
  if (documentText.slice(highlight.documentStart, highlight.documentEnd) === highlight.quote) return highlight.documentStart;
  const candidates: number[] = [];
  for (let cursor = documentText.indexOf(highlight.quote); cursor >= 0; cursor = documentText.indexOf(highlight.quote, cursor + 1)) candidates.push(cursor);
  candidates.sort((left, right) => anchorScore(documentText, right, highlight) - anchorScore(documentText, left, highlight));
  return candidates[0] ?? -1;
}

export function selectionCanBeHighlighted(selection: Selection | null, root: HTMLElement): selection is Selection {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  return Boolean(start && end && root.contains(start) && root.contains(end) && !start.closest(EXCLUDED_SELECTOR) && !end.closest(EXCLUDED_SELECTOR));
}

export function serializeSourceSelection(range: Range, pageFingerprint: string, root = document.body, id = crypto.randomUUID(), createdAt = Date.now()): SourceHighlight | null {
  const index = buildTextIndex(root);
  const offsets = intersectingOffsets(range, index);
  if (!offsets) return null;
  const rawSelection = index.raw.slice(offsets.start, offsets.end);
  const leading = rawSelection.match(/^\s*/)?.[0].length ?? 0;
  const trailing = rawSelection.match(/\s*$/)?.[0].length ?? 0;
  const rawStart = offsets.start + leading;
  const rawEnd = offsets.end - trailing;
  const text = index.raw.slice(rawStart, rawEnd).replace(/\r\n?/g, '\n');
  const quote = normalizeSourceQuote(text);
  if (!quote) return null;
  const documentStart = index.normalizedToRaw.findIndex((offset) => offset >= rawStart);
  if (documentStart < 0) return null;
  const documentEnd = documentStart + quote.length;
  return {
    id,
    text,
    quote,
    prefix: index.normalized.slice(Math.max(0, documentStart - CONTEXT_LENGTH), documentStart),
    suffix: index.normalized.slice(documentEnd, documentEnd + CONTEXT_LENGTH),
    documentStart,
    documentEnd,
    createdAt,
    pageFingerprint,
  };
}

export function resolveSourceHighlights(highlights: SourceHighlight[], pageFingerprint: string, root = document.body): ResolvedSourceHighlights {
  const index = buildTextIndex(root);
  const ranges: Range[] = [];
  const resolvedIds: string[] = [];
  for (const highlight of highlights) {
    if (highlight.pageFingerprint !== pageFingerprint || !highlight.quote) continue;
    const start = findSourceHighlightStart(index.normalized, highlight);
    if (start < 0) continue;
    const range = rangeForNormalizedOffsets(index, start, start + highlight.quote.length);
    if (!range) continue;
    ranges.push(range);
    resolvedIds.push(highlight.id);
  }
  return { ranges, resolvedIds };
}
