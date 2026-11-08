import { messageTextWithAttachments } from './attachments';
import { formatHighlightsForPrompt, formatSourceHighlightsForPrompt } from './highlights';
import type { ChatAttachment, ChatMessage, ConversationArtifact, ConversationPage, PageContext, ProviderId, SourceHighlight, VideoHighlight, VideoTranscriptContext, YouTubeContext } from './types';
import { artifactsForPrompt } from './artifacts';
import { multiPagePromptContext } from './multi-page';
import { formatVideosForPrompt } from './media';

export const SYSTEM_PROMPT_PLACEHOLDERS = [
  'title',
  'url',
  'author',
  'publishedDate',
  'selectedText',
  'pageContent',
  'linkedPages',
  'sources',
] as const;

type SystemPromptPlaceholder = typeof SYSTEM_PROMPT_PLACEHOLDERS[number];

export const SINGLE_PAGE_DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  'You are learnr, a thoughtful reading partner. Ground every answer in the supplied page.',
  'Distinguish the page\'s claims from your own inference. Be concise but substantive.',
  '',
  'Title: {{title}}',
  'URL: {{url}}',
  'Author: {{author}}',
  'Published: {{publishedDate}}',
  'Reader selection:',
  '{{selectedText}}',
  '',
  'Page content:',
  '{{pageContent}}',
].join('\n');

export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  SINGLE_PAGE_DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  '',
  'Linked page index:',
  '{{linkedPages}}',
  'When several pages are supplied, distinguish their claims and cite the relevant page URL.',
].join('\n');

export const IMAGE_PROMPT_PLACEHOLDERS = ['question', 'conversation', 'title', 'url', 'pageContent', 'imageCount', 'attachmentNames'] as const;
export const VIDEO_PROMPT_PLACEHOLDERS = ['question', 'conversation', 'title', 'url', 'currentTime', 'metadata', 'captions'] as const;

export const DEFAULT_IMAGE_PROMPT_TEMPLATE = [
  'You are learnr\'s image analyst. Answer the reader\'s question from the attached image evidence and supplied reading context.',
  'Describe only details you can actually see. Explicitly identify uncertainty, unreadable text, and any inference.',
  '',
  'Question: {{question}}',
  'Page: {{title}} — {{url}}',
  'Attached images ({{imageCount}}): {{attachmentNames}}',
  '',
  'Page context:',
  '{{pageContent}}',
  '',
  'Conversation:',
  '{{conversation}}',
].join('\n');

export const DEFAULT_VIDEO_PROMPT_TEMPLATE = [
  'You are learnr\'s video analyst. First produce a faithful transcript of the spoken content, including useful timestamps when possible, then answer the reader\'s question from the transcript and visible video evidence.',
  'Clearly distinguish evidence, uncertainty, and inference.',
  '',
  'Question: {{question}}',
  'Video: {{title}}',
  'URL: {{url}}',
  'Current playback time: {{currentTime}}',
  'Metadata:',
  '{{metadata}}',
  'Captions already available:',
  '{{captions}}',
  '',
  'Conversation:',
  '{{conversation}}',
].join('\n');

export const PDF_PROMPT_PLACEHOLDERS = ['filename'] as const;
export const DEFAULT_PDF_PROMPT_TEMPLATE = 'Extract {{filename}} faithfully into Markdown. Preserve headings, lists, tables, page boundaries, captions, and meaningful text in diagrams. Do not summarize or add claims. Return only Markdown.';

export const NOTE_PROMPT_PLACEHOLDERS = [
  ...SYSTEM_PROMPT_PLACEHOLDERS,
  'conversation',
  'highlights',
  'sourceHighlights',
  'capturedDate',
  'provider',
  'model',
  'noteMaterial',
  'videos',
  'draftFocus',
] as const;

export const LEGACY_NOTE_FRONTMATTER_INSTRUCTION = 'Start with valid YAML frontmatter containing exactly these required fields plus optional tags:';
export const NOTE_FRONTMATTER_INSTRUCTION = 'Start at the first character with valid YAML frontmatter delimited by --- lines. Put no heading or prose before it. Use exactly these required fields plus optional tags:';

type NotePromptPlaceholder = typeof NOTE_PROMPT_PLACEHOLDERS[number];

export const PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE = [
  'Create an adaptive Markdown note from the page and the useful insights in the conversation.',
  'Return only Markdown. Do not wrap it in a code fence.',
  NOTE_FRONTMATTER_INSTRUCTION,
  '---',
  'title: {{title}}',
  'source: {{url}}',
  'captured: {{capturedDate}}',
  'provider: {{provider}}',
  'model: {{model}}',
  '---',
  'Then write a clear note shaped around what mattered in the conversation. Do not include a full transcript unless explicitly requested.',
  '',
  'Page:',
  'You are learnr, a thoughtful reading partner. Ground every answer in the supplied page.',
  'Distinguish the page\'s claims from your own inference. Be concise but substantive.',
  '',
  'Title: {{title}}',
  'URL: {{url}}',
  'Author: {{author}}',
  'Published: {{publishedDate}}',
  'Reader selection:',
  '{{selectedText}}',
  '',
  'Page content:',
  '{{pageContent}}',
  '',
  'Conversation:',
  '{{conversation}}',
].join('\n');

export const CHAT_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE = [
  PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE,
  '',
  'Highlighted chat passages:',
  '{{highlights}}',
  'Treat these selections as high-priority context when shaping the note. Do not create a Highlights section or reproduce them as a quote list; learnr appends the exact selected passages after generation.',
].join('\n');

export const SOURCE_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE = [
  PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE,
  '',
  'Highlighted source-page passages:',
  '{{sourceHighlights}}',
  '',
  'Highlighted conversation passages:',
  '{{highlights}}',
  'Treat both groups as high-priority context when shaping the note. Do not create highlight sections or reproduce them as quote lists; learnr appends the exact selected passages after generation.',
].join('\n');

export const MULTI_PAGE_DEFAULT_NOTE_PROMPT_TEMPLATE = [
  SOURCE_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE,
  '',
  'Linked page index:',
  '{{linkedPages}}',
  'Include all linked source URLs in the YAML frontmatter under a sources list:',
  'sources:',
  '{{sources}}',
].join('\n');

export const EXPLICIT_MATERIAL_DEFAULT_NOTE_PROMPT_TEMPLATE = [
  MULTI_PAGE_DEFAULT_NOTE_PROMPT_TEMPLATE,
  '',
  'Explicit reader material:',
  '{{noteMaterial}}',
  'Integrate every KEEP FOR NOTE item naturally. Preserve its intended claim while correcting grammar and spelling and improving phrasing. Do not place kept items in a mechanical dedicated section.',
  'The LINK IN NOTE items are handled deterministically by learnr; do not invent additional saved-note links.',
].join('\n');

export const DEFAULT_NOTE_PROMPT_TEMPLATE = [
  EXPLICIT_MATERIAL_DEFAULT_NOTE_PROMPT_TEMPLATE,
  '',
  'Requested atomic-note focus:',
  '{{draftFocus}}',
  'When a specific focus is supplied, create one atomic note centered on it and include only relevant source and conversation material. When no focus is supplied, create the complete adaptive note.',
  '',
  'Highlighted and explicitly analyzed videos:',
  '{{videos}}',
  'Use relevant video material as high-priority context, but do not append a transcript. learnr adds deterministic video links after generation.',
].join('\n');

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const ALLOWED_PLACEHOLDERS = new Set<string>(SYSTEM_PROMPT_PLACEHOLDERS);

export function validateSystemPromptTemplate(template: string): void {
  if (!template.trim()) throw new Error('The system prompt cannot be empty.');
  const unknown = Array.from(template.matchAll(PLACEHOLDER_PATTERN))
    .map((match) => match[1])
    .filter((name) => !ALLOWED_PLACEHOLDERS.has(name));
  if (unknown.length) throw new Error(`Unknown prompt placeholder: {{${unknown[0]}}}.`);
}

export function renderSystemPrompt(template: string, context: PageContext, pages?: ConversationPage[], activePageId?: string, sourceBudgetTokens = 32_000): string {
  validateSystemPromptTemplate(template);
  const multi = pages?.length ? multiPagePromptContext(pages, activePageId || pages[0].id, sourceBudgetTokens) : null;
  const effective = multi?.context ?? context;
  const values: Record<SystemPromptPlaceholder, string> = {
    title: effective.title,
    url: effective.url,
    author: effective.author ?? '',
    publishedDate: effective.publishedDate ?? '',
    selectedText: effective.selectedText ?? '',
    pageContent: effective.cleanedMarkdown,
    linkedPages: multi?.linkedPages ?? `Page 1: ${context.title} — ${context.url}`,
    sources: multi?.sources ?? `  - ${context.url}`,
  };
  return template.replace(PLACEHOLDER_PATTERN, (_, name: SystemPromptPlaceholder) => values[name]);
}

export function validateNotePromptTemplate(template: string): void {
  validateTemplate(template, new Set<string>(NOTE_PROMPT_PLACEHOLDERS), 'note-drafting');
}

function validateTemplate(template: string, allowed: Set<string>, label: string): void {
  if (!template.trim()) throw new Error(`The ${label} prompt cannot be empty.`);
  const unknown = Array.from(template.matchAll(PLACEHOLDER_PATTERN))
    .map((match) => match[1])
    .filter((name) => !allowed.has(name));
  if (unknown.length) throw new Error(`Unknown prompt placeholder: {{${unknown[0]}}}.`);
}

function conversationText(messages: ChatMessage[]): string {
  return messages.map((message) => {
    const imageNames = (message.attachments ?? [])
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => attachment.name);
    const images = imageNames.length ? `\n[Attached images: ${imageNames.join(', ')}]` : '';
    return `${message.role.toUpperCase()}: ${messageTextWithAttachments(message)}${images}`;
  }).join('\n\n') || '(No conversation yet; distill the page itself.)';
}

export function validateImagePromptTemplate(template: string): void {
  validateTemplate(template, new Set<string>(IMAGE_PROMPT_PLACEHOLDERS), 'image-analysis');
}

export function validateVideoPromptTemplate(template: string): void {
  validateTemplate(template, new Set<string>(VIDEO_PROMPT_PLACEHOLDERS), 'video-analysis');
}

export function validatePdfPromptTemplate(template: string): void {
  validateTemplate(template, new Set<string>(PDF_PROMPT_PLACEHOLDERS), 'PDF-extraction');
}

export function renderPdfPrompt(template: string, filename: string): string {
  validatePdfPromptTemplate(template);
  return template.replace(PLACEHOLDER_PATTERN, (_, name: typeof PDF_PROMPT_PLACEHOLDERS[number]) => ({ filename })[name]);
}

export function renderImagePrompt(template: string, question: string, context: PageContext, messages: ChatMessage[], attachments: Extract<ChatAttachment, { kind: 'image' }>[]): string {
  validateImagePromptTemplate(template);
  const values: Record<typeof IMAGE_PROMPT_PLACEHOLDERS[number], string> = {
    question: question || 'Describe and analyze the attached image material.',
    conversation: conversationText(messages),
    title: context.title,
    url: context.url,
    pageContent: context.cleanedMarkdown,
    imageCount: String(attachments.length),
    attachmentNames: attachments.map((item) => item.name).join(', '),
  };
  return template.replace(PLACEHOLDER_PATTERN, (_, name: typeof IMAGE_PROMPT_PLACEHOLDERS[number]) => values[name]);
}

export function renderVideoPrompt(template: string, question: string, video: YouTubeContext | { title: string; canonicalUrl: string; currentTimeSeconds?: number }, messages: ChatMessage[]): string {
  validateVideoPromptTemplate(template);
  const rich = video as YouTubeContext;
  const values: Record<typeof VIDEO_PROMPT_PLACEHOLDERS[number], string> = {
    question: question || `Summarize the video “${video.title}”.`,
    conversation: conversationText(messages),
    title: video.title,
    url: video.canonicalUrl,
    currentTime: Number.isFinite(video.currentTimeSeconds) ? `${Math.floor(video.currentTimeSeconds!)} seconds` : '',
    metadata: [rich.channel ? `Channel: ${rich.channel}` : '', rich.description ?? '', Number.isFinite(rich.durationSeconds) ? `Duration: ${Math.floor(rich.durationSeconds!)} seconds` : ''].filter(Boolean).join('\n'),
    captions: rich.captions ?? '',
  };
  return template.replace(PLACEHOLDER_PATTERN, (_, name: typeof VIDEO_PROMPT_PLACEHOLDERS[number]) => values[name]);
}

export function renderNotePrompt(
  template: string,
  context: PageContext,
  messages: ChatMessage[],
  sourceHighlights: SourceHighlight[],
  provider: ProviderId,
  model: string,
  date = new Date(),
  pages?: ConversationPage[],
  activePageId?: string,
  artifacts: ConversationArtifact[] = [],
  videoHighlights: VideoHighlight[] = [],
  videoContexts: VideoTranscriptContext[] = [],
  draftFocus = '',
  includePersonalNotes = false,
  sourceBudgetTokens = 32_000,
): string {
  validateNotePromptTemplate(template);
  const multi = pages?.length ? multiPagePromptContext(pages, activePageId || pages[0].id, sourceBudgetTokens) : null;
  const effective = multi?.context ?? context;
  const values: Record<NotePromptPlaceholder, string> = {
    title: effective.title,
    url: effective.url,
    author: effective.author ?? '',
    publishedDate: effective.publishedDate ?? '',
    selectedText: effective.selectedText ?? '',
    pageContent: effective.cleanedMarkdown,
    linkedPages: multi?.linkedPages ?? `Page 1: ${context.title} — ${context.url}`,
    sources: multi?.sources ?? `  - ${context.url}`,
    conversation: conversationText(messages),
    highlights: formatHighlightsForPrompt(messages),
    sourceHighlights: formatSourceHighlightsForPrompt(sourceHighlights),
    capturedDate: date.toISOString().slice(0, 10),
    provider,
    model,
    noteMaterial: artifactsForPrompt(artifacts, includePersonalNotes),
    videos: formatVideosForPrompt(videoHighlights, videoContexts),
    draftFocus: draftFocus || '(No specific focus; cover the webpage and useful conversation as a whole.)',
  };
  const rendered = template.replace(PLACEHOLDER_PATTERN, (_, name: NotePromptPlaceholder) => values[name]);
  if (!draftFocus || /\{\{\s*draftFocus\s*\}\}/.test(template)) return rendered;
  return `${rendered}\n\nRequested atomic-note focus:\n${draftFocus}\nCreate one atomic note centered on this focus and use only relevant source and conversation material.`;
}
