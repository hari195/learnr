import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_PROMPT_TEMPLATE,
  DEFAULT_IMAGE_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_VIDEO_PROMPT_TEMPLATE,
  renderImagePrompt,
  renderNotePrompt,
  renderSystemPrompt,
  renderVideoPrompt,
  validateImagePromptTemplate,
  validateNotePromptTemplate,
  validateSystemPromptTemplate,
  validateVideoPromptTemplate,
} from './prompt';
import type { ConversationPage, PageContext } from './types';

const context: PageContext = {
  title: 'Pluralistic Ignorance',
  url: 'https://example.com/article',
  author: 'Ada Reader',
  selectedText: 'A useful passage',
  cleanedMarkdown: '# The page',
  extractionStatus: 'readable',
  pageTheme: 'light',
};

describe('system prompt templates', () => {
  it('renders every supported page placeholder and empty optional values', () => {
    const rendered = renderSystemPrompt('{{title}}|{{url}}|{{author}}|{{publishedDate}}|{{selectedText}}|{{pageContent}}', context);
    expect(rendered).toBe('Pluralistic Ignorance|https://example.com/article|Ada Reader||A useful passage|# The page');
  });

  it('rejects empty prompts and unknown placeholders', () => {
    expect(() => validateSystemPromptTemplate('   ')).toThrow('cannot be empty');
    expect(() => validateSystemPromptTemplate('Read {{headline}}')).toThrow('{{headline}}');
    expect(() => validateSystemPromptTemplate('Read {{page-content}}')).toThrow('{{page-content}}');
  });

  it('provides a valid default that includes page content', () => {
    expect(() => validateSystemPromptTemplate(DEFAULT_SYSTEM_PROMPT_TEMPLATE)).not.toThrow();
    expect(renderSystemPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE, context)).toContain('# The page');
  });

  it('renders labelled linked-page content and source placeholders', () => {
    const second = { ...context, title: 'Second source', url: 'https://example.org/second', cleanedMarkdown: 'Second page evidence' };
    const pages: ConversationPage[] = [
      { id: 'first', context, linkOrigin: 'primary', linkedAt: 1, lastActiveAt: 1 },
      { id: 'second', context: second, linkOrigin: 'manual', linkedAt: 2, lastActiveAt: 2 },
    ];
    const rendered = renderSystemPrompt('{{pageContent}}\nINDEX\n{{linkedPages}}\nSOURCES\n{{sources}}', context, pages, 'first');
    expect(rendered).toContain('## Page 1: Pluralistic Ignorance');
    expect(rendered).toContain('## Page 2: Second source');
    expect(rendered).toContain('Page 2: Second source — https://example.org/second');
    expect(rendered).toContain('  - https://example.org/second');
  });

  it('renders and validates the editable note prompt', () => {
    const messages = [{ id: '1', role: 'user' as const, content: 'My question', createdAt: 1, highlights: [{ id: 'h1', startOffset: 0, endOffset: 2, text: 'My', createdAt: 2 }] }];
    const rendered = renderNotePrompt(
      '{{title}}|{{url}}|{{author}}|{{publishedDate}}|{{selectedText}}|{{pageContent}}|{{conversation}}|{{highlights}}|{{sourceHighlights}}|{{capturedDate}}|{{provider}}|{{model}}|{{noteMaterial}}',
      context,
      messages,
      [{ id: 'source', text: 'Source quote', quote: 'Source quote', prefix: '', suffix: '', documentStart: 0, documentEnd: 12, createdAt: 1, pageFingerprint: 'page' }],
      'openai',
      'gpt-5.6-terra',
      new Date('2026-08-09T12:00:00Z'),
      undefined,
      undefined,
      [{ id: 'keep', type: 'keep', text: 'Preserve my claim', createdAt: 3 }],
    );
    expect(rendered).toContain('Pluralistic Ignorance|https://example.com/article|Ada Reader||A useful passage|# The page|USER: My question|1. USER:\nMy|1. Source quote|2026-08-09|openai|gpt-5.6-terra|KEEP FOR NOTE: Preserve my claim');
    expect(() => validateNotePromptTemplate(DEFAULT_NOTE_PROMPT_TEMPLATE)).not.toThrow();
    expect(DEFAULT_NOTE_PROMPT_TEMPLATE).toContain('---\ntitle: {{title}}');
    expect(() => validateNotePromptTemplate('Use {{headline}}')).toThrow('{{headline}}');
    expect(() => validateNotePromptTemplate(' ')).toThrow('cannot be empty');
    const focused = renderNotePrompt('Focus={{draftFocus}}', context, [], [], 'openrouter', 'model', new Date(), undefined, undefined, [], [], [], 'One causal claim');
    expect(focused).toBe('Focus=One causal claim');
    expect(renderNotePrompt('Legacy custom prompt', context, [], [], 'openrouter', 'model', new Date(), undefined, undefined, [], [], [], 'Atomic focus')).toContain('Requested atomic-note focus:\nAtomic focus');
  });

  it('renders and validates independent image and video prompts', () => {
    const image = { id: 'image', kind: 'image' as const, name: 'diagram.png', mimeType: 'image/png', imageUrl: 'data:image/png;base64,x', source: 'local' as const };
    expect(renderImagePrompt(DEFAULT_IMAGE_PROMPT_TEMPLATE, 'Explain this', context, [], [image])).toContain('Explain this');
    expect(renderVideoPrompt(DEFAULT_VIDEO_PROMPT_TEMPLATE, 'Summarize', { title: 'Lecture', canonicalUrl: 'https://youtube.com/watch?v=abc123' }, [])).toContain('Summarize');
    expect(() => validateImagePromptTemplate('Use {{unknown}}')).toThrow('{{unknown}}');
    expect(() => validateVideoPromptTemplate(' ')).toThrow('cannot be empty');
  });
});
