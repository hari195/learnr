import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenRouterChatBody, buildOpenRouterPdfBody, buildOpenRouterVideoBody, completeOpenRouterText, getProvider, normalizeOpenRouterModel, normalizeProviderError, providerUsageFromOpenRouter } from './providers';
import type { ChatMessage } from './types';

describe('OpenRouter provider handling', () => {
  const messages: ChatMessage[] = [{ id: '1', role: 'user', content: 'Question', createdAt: 1 }];

  it('uses the rendered prompt and provider-native web search', () => {
    expect(buildOpenRouterChatBody('openai/gpt-5', 'Custom system', messages).messages[0]).toEqual({ role: 'system', content: 'Custom system' });
    expect(buildOpenRouterChatBody('openai/gpt-5', 'System', messages, true)).toMatchObject({ tools: [{ type: 'openrouter:web_search', parameters: { engine: 'auto', max_total_results: 5 } }] });
    expect(buildOpenRouterChatBody('openai/gpt-5', 'System', messages, false)).not.toHaveProperty('tools');
  });

  it('allows saved-note functions and web search to coexist', () => {
    const functions = [{ name: 'search_saved_notes' as const, description: 'Search notes', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }];
    const request = buildOpenRouterChatBody('openai/gpt-5', 'System', messages, true, functions) as { tools: Array<Record<string, unknown>> };
    expect(request.tools).toEqual([expect.objectContaining({ type: 'openrouter:web_search' }), expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'search_saved_notes' }) })]);
  });

  it('configures web fetch independently with conservative limits', () => {
    const request = buildOpenRouterChatBody('openai/gpt-5', 'System', messages, false, true) as { tools: Array<Record<string, unknown>> };
    expect(request.tools).toEqual([{ type: 'openrouter:web_fetch', parameters: { max_uses: 3, max_content_tokens: 20_000 } }]);
  });

  it('maps image and text attachments to OpenRouter multimodal input', () => {
    const attached: ChatMessage[] = [{ id: '2', role: 'user', content: 'Compare these', createdAt: 2, attachments: [
      { id: 'i', kind: 'image', name: 'chart.png', mimeType: 'image/png', imageUrl: 'data:image/png;base64,abc', source: 'local' },
      { id: 't', kind: 'text', name: 'note.md', mimeType: 'text/markdown', text: '# Prior note', source: 'local' },
    ] }];
    const request = buildOpenRouterChatBody('openai/gpt-5', 'System', attached) as { messages: Array<{ content: unknown }> };
    expect(request.messages[1].content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('# Prior note') }), expect.objectContaining({ type: 'image_url' })]);
  });

  it('builds automatic PDF parsing and explicit YouTube requests', () => {
    const automatic = buildOpenRouterPdfBody('google/gemini', 'paper.pdf', 'data:application/pdf;base64,abc');
    expect(automatic).not.toHaveProperty('plugins');
    expect(automatic).toMatchObject({ messages: [{ content: [expect.objectContaining({ type: 'text' }), expect.objectContaining({ type: 'file' })] }] });
    expect(buildOpenRouterVideoBody('google/gemini', 'https://www.youtube.com/watch?v=abc123XYZ_0', 'Transcribe')).toMatchObject({ messages: [{ content: [expect.objectContaining({ type: 'text', text: 'Transcribe' }), { type: 'video_url', video_url: { url: 'https://www.youtube.com/watch?v=abc123XYZ_0' } }] }] });
  });

  it('normalizes cancellation and OpenRouter-reported usage/cost', () => {
    expect(normalizeProviderError(new DOMException('Stopped', 'AbortError')).message).toBe('Request cancelled.');
    expect(providerUsageFromOpenRouter({ prompt_tokens: 90, completion_tokens: 10, total_tokens: 100, cost: .0012 })).toEqual({ inputTokens: 90, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 100, costUsd: .0012, requestCount: 1, tokensReported: true, costReported: true });
    expect(providerUsageFromOpenRouter()).toMatchObject({ totalTokens: 0, costUsd: 0, requestCount: 1, tokensReported: false, costReported: false });
  });

  it('returns non-streaming text and exact usage for AutoGroup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"assignments":[]}' } }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24, cost: .0003 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await completeOpenRouterText({ apiKey: 'key', model: 'openai/gpt-5-mini', systemPrompt: 'System', prompt: 'Tabs' });
    expect(result).toMatchObject({ text: '{"assignments":[]}', usage: { totalTokens: 24, costUsd: .0003, tokensReported: true, costReported: true } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'openai/gpt-5-mini', stream: false, messages: [{ role: 'system', content: 'System' }, { role: 'user', content: 'Tabs' }] });
  });

  it('sends in-memory audio to OpenRouter transcription and normalizes usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Dictated thought', usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, cost: .0001 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getProvider('openrouter').transcribeAudio!({ apiKey: 'key', model: 'openai/gpt-4o-mini-transcribe', audioBase64: 'YWJj', format: 'webm', signal: new AbortController().signal });
    expect(result).toMatchObject({ text: 'Dictated thought', usage: { totalTokens: 6, costUsd: .0001 } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: 'openai/gpt-4o-mini-transcribe', input_audio: { data: 'YWJj', format: 'webm' } });
  });

  it('validates model-catalog responses and ignores malformed entries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'z/model' }, null, {}, { id: 'a/model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = getProvider('openrouter');
    await expect(provider.listModels('key')).resolves.toEqual(['a/model', 'z/model']);
    await expect(provider.listModels('key')).rejects.toThrow('invalid model catalog');
  });

  it('preserves model context, output, modalities, parameters, and pricing metadata', () => {
    expect(normalizeOpenRouterModel({ id: 'vendor/model', name: 'Model', context_length: 128_000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools'], top_provider: { max_completion_tokens: 16_000 }, pricing: [{ prompt: '0.000001', completion: '0.000002' }, { min_context: 64_000, prompt: '0.000003', completion: '0.000004' }] })).toEqual({ id: 'vendor/model', name: 'Model', contextLength: 128_000, maxCompletionTokens: 16_000, inputModalities: ['text', 'image'], outputModalities: ['text'], supportedParameters: ['tools'], pricing: [{ prompt: '0.000001', completion: '0.000002', request: undefined, image: undefined, webSearch: undefined, internalReasoning: undefined, inputCacheRead: undefined, inputCacheWrite: undefined }, { prompt: '0.000003', completion: '0.000004', request: undefined, image: undefined, webSearch: undefined, internalReasoning: undefined, inputCacheRead: undefined, inputCacheWrite: undefined, minContext: 64_000 }] });
  });

  it('emits a final streamed token even when the provider omits the trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"Complete"}}]}', { status: 200 })));
    const onToken = vi.fn();

    await getProvider('openrouter').streamNote({ apiKey: 'key', model: 'model', notePrompt: 'Draft', signal: new AbortController().signal, onToken });

    expect(onToken).toHaveBeenCalledWith('Complete');
  });
});

afterEach(() => vi.unstubAllGlobals());
