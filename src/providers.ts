import { messageTextWithAttachments } from './attachments';
import type { ChatMessage, ChatSource, NoteReference, OpenRouterModelMetadata, OpenRouterPricingTier, ProviderAdapter, ProviderFunctionTool, ProviderId, ProviderUsage } from './types';
import { addUsage, emptyUsage, normalizeUsage } from './usage';
import { consumeJsonSse } from './sse';
import { DEFAULT_PDF_PROMPT_TEMPLATE } from './prompt';

export function normalizeProviderError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return new Error('Request cancelled.');
  return error instanceof Error ? error : new Error('The provider request failed.');
}

function safeSource(url: unknown, title: unknown): ChatSource | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return { url: parsed.href, title: typeof title === 'string' && title.trim() ? title.trim() : parsed.hostname };
  } catch { return null; }
}

export function normalizeSources(values: Array<{ url?: unknown; title?: unknown; snippet?: unknown }>): ChatSource[] {
  const unique = new Map<string, ChatSource>();
  for (const value of values) {
    const source = safeSource(value.url, value.title);
    if (source && !unique.has(source.url)) unique.set(source.url, { ...source, ...(typeof value.snippet === 'string' ? { snippet: value.snippet } : {}) });
  }
  return [...unique.values()].slice(0, 5);
}

function openRouterTool(tool: ProviderFunctionTool) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

export function buildOpenRouterChatBody(model: string, systemPrompt: string, messages: ChatMessage[], webSearchEnabled = false, webFetchEnabledOrFunctionTools: boolean | ProviderFunctionTool[] = false, functionTools: ProviderFunctionTool[] = []) {
  const webFetchEnabled = typeof webFetchEnabledOrFunctionTools === 'boolean' ? webFetchEnabledOrFunctionTools : false;
  const resolvedFunctionTools = Array.isArray(webFetchEnabledOrFunctionTools) ? webFetchEnabledOrFunctionTools : functionTools;
  const tools = [
    ...(webSearchEnabled ? [{ type: 'openrouter:web_search', parameters: { engine: 'auto', max_total_results: 5 } }] : []),
    ...(webFetchEnabled ? [{ type: 'openrouter:web_fetch', parameters: { max_uses: 3, max_content_tokens: 20_000 } }] : []),
    ...resolvedFunctionTools.map(openRouterTool),
  ];
  return {
    model,
    stream: true,
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    messages: [{ role: 'system', content: systemPrompt }, ...messages.map((message) => {
      const images = (message.attachments ?? []).filter((attachment) => attachment.kind === 'image');
      if (message.role !== 'user' || !images.length) return { role: message.role, content: messageTextWithAttachments(message) };
      return {
        role: 'user',
        content: [
          { type: 'text', text: messageTextWithAttachments(message) },
          ...images.map((attachment) => ({ type: 'image_url', image_url: { url: attachment.imageUrl } })),
        ],
      };
    })],
  };
}

export function buildOpenRouterPdfBody(model: string, filename: string, fileData: string, prompt = DEFAULT_PDF_PROMPT_TEMPLATE) {
  return { model, stream: true, messages: [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'file', file: { filename, file_data: fileData } },
  ] }] };
}

export function buildOpenRouterVideoBody(model: string, videoUrl: string, prompt: string) {
  return { model, stream: true, messages: [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'video_url', video_url: { url: videoUrl } },
  ] }] };
}

export interface OpenRouterUsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
}

interface OpenRouterModelLike {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number; context_length?: number };
  pricing?: Record<string, unknown> | Array<Record<string, unknown>>;
}

function pricingString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizePricingTier(value: Record<string, unknown>): OpenRouterPricingTier {
  const threshold = value.min_context ?? value.context_length ?? value.threshold;
  return {
    prompt: pricingString(value.prompt), completion: pricingString(value.completion), request: pricingString(value.request),
    image: pricingString(value.image), webSearch: pricingString(value.web_search), internalReasoning: pricingString(value.internal_reasoning),
    inputCacheRead: pricingString(value.input_cache_read), inputCacheWrite: pricingString(value.input_cache_write),
    ...(typeof threshold === 'number' && Number.isFinite(threshold) ? { minContext: threshold } : {}),
  };
}

export function normalizeOpenRouterModel(value: OpenRouterModelLike): OpenRouterModelMetadata | null {
  if (typeof value.id !== 'string' || !value.id) return null;
  const pricingValues = Array.isArray(value.pricing) ? value.pricing : value.pricing ? [value.pricing] : [];
  return {
    id: value.id,
    ...(typeof value.name === 'string' && value.name ? { name: value.name } : {}),
    ...(Number.isFinite(value.context_length ?? value.top_provider?.context_length) ? { contextLength: Number(value.context_length ?? value.top_provider?.context_length) } : {}),
    ...(Number.isFinite(value.top_provider?.max_completion_tokens) ? { maxCompletionTokens: Number(value.top_provider?.max_completion_tokens) } : {}),
    inputModalities: (value.architecture?.input_modalities ?? []).filter((item): item is string => typeof item === 'string'),
    outputModalities: (value.architecture?.output_modalities ?? []).filter((item): item is string => typeof item === 'string'),
    supportedParameters: (value.supported_parameters ?? []).filter((item): item is string => typeof item === 'string'),
    pricing: pricingValues.map(normalizePricingTier),
  };
}

async function readModelCatalog(response: Response, unavailableMessage: string): Promise<OpenRouterModelLike[]> {
  if (!response.ok) throw new Error(unavailableMessage);
  const payload = await response.json().catch(() => null) as { data?: unknown } | null;
  if (!payload || !Array.isArray(payload.data)) throw new Error('OpenRouter returned an invalid model catalog. Try refreshing models again.');
  return payload.data.filter((item): item is OpenRouterModelLike => Boolean(item) && typeof item === 'object');
}

interface OpenRouterToolCall {
  index: number;
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function dedupeNoteReferences(values: NoteReference[]): NoteReference[] {
  const unique = new Map<string, NoteReference>();
  for (const value of values) if (!unique.has(value.noteId)) unique.set(value.noteId, value);
  return [...unique.values()].slice(0, 8);
}

export function providerUsageFromOpenRouter(value?: OpenRouterUsageLike | null): ProviderUsage {
  return normalizeUsage({
    inputTokens: value?.prompt_tokens,
    cachedInputTokens: value?.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: value?.prompt_tokens_details?.cache_write_tokens,
    outputTokens: value?.completion_tokens,
    totalTokens: value?.total_tokens,
    costUsd: value?.cost,
    requestCount: 1,
    tokensReported: Boolean(value && (value.total_tokens != null || value.prompt_tokens != null || value.completion_tokens != null)),
    costReported: Boolean(value && value.cost != null),
  });
}

async function openRouterRequest(apiKey: string, body: object, signal?: AbortSignal): Promise<Response> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://learnr.local',
      'X-Title': 'learnr',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (response.status === 401) throw new Error('That API key was rejected. Check or replace it in Settings.');
    if (response.status === 429) throw new Error('The provider rate limit was reached. Wait a moment and try again.');
    throw new Error(payload.error?.message || `OpenRouter request failed (${response.status}).`);
  }
  return response;
}

export async function completeOpenRouterText(args: { apiKey: string; model: string; systemPrompt: string; prompt: string; signal?: AbortSignal; maxTokens?: number; minimalReasoning?: boolean }): Promise<{ text: string; usage: ProviderUsage }> {
  const response = await openRouterRequest(args.apiKey, {
    model: args.model,
    stream: false,
    ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
    ...(args.minimalReasoning ? { reasoning: { effort: 'minimal', exclude: true } } : {}),
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: args.systemPrompt }, { role: 'user', content: args.prompt }],
  }, args.signal);
  const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>; usage?: OpenRouterUsageLike } | null;
  const content = payload?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : (content ?? []).map((item) => item.text ?? '').join('');
  if (!text.trim()) throw new Error('The AutoGroup model returned no classification.');
  return { text: text.trim(), usage: providerUsageFromOpenRouter(payload?.usage) };
}

class OpenRouterAdapter implements ProviderAdapter {
  async validateKey(apiKey: string) {
    const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error('That OpenRouter API key was rejected.');
  }

  async listModelCatalog(apiKey: string): Promise<OpenRouterModelMetadata[]> {
    const response = await fetch('https://openrouter.ai/api/v1/models/user', { headers: { Authorization: `Bearer ${apiKey}` } });
    const models = await readModelCatalog(response, 'Could not load OpenRouter models.');
    return models.flatMap((model) => { const normalized = normalizeOpenRouterModel(model); return normalized ? [normalized] : []; }).sort((a, b) => a.id.localeCompare(b.id));
  }

  async listModels(apiKey: string): Promise<string[]> {
    return (await this.listModelCatalog(apiKey)).map((model) => model.id);
  }

  async listImageModels(apiKey: string): Promise<string[]> {
    const response = await fetch('https://openrouter.ai/api/v1/models/user', { headers: { Authorization: `Bearer ${apiKey}` } });
    const models = await readModelCatalog(response, 'Could not load OpenRouter image-capable models.');
    return models.filter((item) => item.id && item.architecture?.input_modalities?.includes('image')).map((item) => item.id!).sort();
  }

  async listVideoModels(apiKey: string): Promise<string[]> {
    const response = await fetch('https://openrouter.ai/api/v1/models/user', { headers: { Authorization: `Bearer ${apiKey}` } });
    const models = await readModelCatalog(response, 'Could not load OpenRouter video models.');
    return models.filter((item) => item.id && item.architecture?.input_modalities?.includes('video')).map((item) => item.id!).sort();
  }

  async listTranscriptionModels(apiKey: string): Promise<string[]> {
    const response = await fetch('https://openrouter.ai/api/v1/models?output_modalities=transcription', { headers: { Authorization: `Bearer ${apiKey}` } });
    const models = await readModelCatalog(response, 'Could not load OpenRouter transcription models.');
    return models.flatMap((item) => item.id ? [item.id] : []).sort((a, b) => {
      if (a === 'openai/gpt-4o-mini-transcribe') return -1; if (b === 'openai/gpt-4o-mini-transcribe') return 1; return a.localeCompare(b);
    });
  }

  async listEmbeddingModels(apiKey: string): Promise<string[]> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings/models', { headers: { Authorization: `Bearer ${apiKey}` } });
    const models = await readModelCatalog(response, 'Could not load OpenRouter embedding models.');
    return models.flatMap((item) => item.id ? [item.id] : []).sort();
  }

  async streamChat({ apiKey, model, systemPrompt, messages, webSearchEnabled, webFetchEnabled, functionTools = [], executeTool, signal, onToken }: Parameters<ProviderAdapter['streamChat']>[0]) {
    if (functionTools.length && !await this.modelSupportsTools(apiKey, model, signal)) throw new Error('The selected OpenRouter model does not support function tools. Choose a tool-capable model or turn off saved-note search.');
    const toolGuidance = `${systemPrompt}\n\nWeb tool rules: use web search to discover sources or answer current, open-ended questions. Use web fetch only to read a known URL, a user-supplied URL, or a specific search result in greater depth; do not use web fetch for broad discovery.`;
    const base = buildOpenRouterChatBody(model, toolGuidance, messages, webSearchEnabled, webFetchEnabled, functionTools) as { model: string; stream: boolean; tools?: unknown[]; tool_choice?: string; messages: Array<Record<string, unknown>> };
    const runningMessages = [...base.messages];
    let aggregateUsage = emptyUsage(); let noteToolUsage = emptyUsage(); let sources: ChatSource[] = []; let webSearchRequests = 0; let webFetchRequests = 0; let noteToolRequests = 0; const noteReferences: NoteReference[] = [];
    for (let round = 0; round < 4; round += 1) {
      const response = await openRouterRequest(apiKey, { ...base, messages: runningMessages }, signal);
      let roundUsage = emptyUsage(); let roundText = ''; const toolCalls = new Map<number, OpenRouterToolCall>();
      await consumeJsonSse<{ choices?: Array<{ delta?: { content?: string; tool_calls?: Array<Partial<OpenRouterToolCall> & { function?: Partial<OpenRouterToolCall['function']> }>; annotations?: Array<{ url_citation?: { url?: string; title?: string; content?: string } }> }; message?: { annotations?: Array<{ url_citation?: { url?: string; title?: string; content?: string } }> } }>; usage?: OpenRouterUsageLike & { server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } } }>(response, (event) => {
        const delta = event.choices?.[0]?.delta; const text = delta?.content ?? ''; roundText += text; onToken(text);
        for (const partial of delta?.tool_calls ?? []) {
          const index = partial.index ?? 0; const current = toolCalls.get(index) ?? { index, id: partial.id ?? '', type: 'function', function: { name: '', arguments: '' } };
          if (partial.id) current.id = partial.id;
          current.function.name += partial.function?.name ?? ''; current.function.arguments += partial.function?.arguments ?? ''; toolCalls.set(index, current);
        }
        const annotations = [...(delta?.annotations ?? []), ...(event.choices?.[0]?.message?.annotations ?? [])];
        if (annotations.length) sources = normalizeSources([...sources, ...annotations.map((item) => ({ url: item.url_citation?.url, title: item.url_citation?.title, snippet: item.url_citation?.content }))]);
        if (event.usage) { roundUsage = providerUsageFromOpenRouter(event.usage); webSearchRequests += event.usage.server_tool_use?.web_search_requests ?? 0; webFetchRequests += event.usage.server_tool_use?.web_fetch_requests ?? 0; }
      });
      aggregateUsage = addUsage(aggregateUsage, roundUsage);
      const calls = [...toolCalls.values()];
      if (!calls.length) return { usage: aggregateUsage, sources, webSearchRequests, webFetchRequests, noteToolRequests, noteReferences: dedupeNoteReferences(noteReferences), noteToolUsage };
      if (!executeTool) throw new Error('The model requested a tool that learnr cannot execute.');
      if (round === 3) throw new Error('The saved-note search reached its four-round tool limit. Try a narrower question.');
      runningMessages.push({ role: 'assistant', content: roundText || null, tool_calls: calls.map(({ id, type, function: fn }) => ({ id, type, function: fn })) });
      for (const call of calls) {
        const executed = await executeTool(call.function.name, call.function.arguments || '{}'); noteToolRequests += 1; aggregateUsage = addUsage(aggregateUsage, executed.usage); noteToolUsage = addUsage(noteToolUsage, executed.usage); noteReferences.push(...executed.references);
        runningMessages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: executed.output });
      }
    }
    throw new Error('The saved-note search did not finish.');
  }

  private async modelSupportsTools(apiKey: string, model: string, signal?: AbortSignal): Promise<boolean> {
    const response = await fetch('https://openrouter.ai/api/v1/models/user', { headers: { Authorization: `Bearer ${apiKey}` }, signal });
    const models = await readModelCatalog(response, 'Could not verify whether the selected OpenRouter model supports saved-note tools.');
    return Boolean(models.find((item) => item.id === model)?.supported_parameters?.includes('tools'));
  }

  async streamNote({ apiKey, model, notePrompt, signal, onToken }: Parameters<ProviderAdapter['streamNote']>[0]) {
    const response = await openRouterRequest(apiKey, {
      model,
      stream: true,
      messages: [{ role: 'user', content: notePrompt }],
    }, signal);
    let usage = emptyUsage();
    await consumeJsonSse<{ choices?: Array<{ delta?: { content?: string } }>; usage?: OpenRouterUsageLike }>(response, (event) => {
      onToken(event.choices?.[0]?.delta?.content ?? '');
      if (event.usage) usage = providerUsageFromOpenRouter(event.usage);
    });
    return usage;
  }


  async parsePdf({ apiKey, model, filename, fileData, prompt, signal, onToken }: Parameters<ProviderAdapter['parsePdf']>[0]) {
    return this.streamSimple(apiKey, buildOpenRouterPdfBody(model, filename, fileData, prompt), signal, onToken);
  }

  async streamImage({ apiKey, model, systemPrompt, question, attachments, signal, onToken }: Parameters<NonNullable<ProviderAdapter['streamImage']>>[0]) {
    return this.streamSimple(apiKey, { model, stream: true, messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text', text: question || 'Describe and analyze the attached image material.' }, ...attachments.map((attachment) => ({ type: 'image_url', image_url: { url: attachment.imageUrl } }))] },
    ] }, signal, onToken);
  }

  async streamVideo({ apiKey, model, videoUrl, prompt, signal, onToken }: Parameters<NonNullable<ProviderAdapter['streamVideo']>>[0]) {
    return this.streamSimple(apiKey, buildOpenRouterVideoBody(model, videoUrl, prompt), signal, onToken);
  }

  async transcribeAudio({ apiKey, model, audioBase64, format, signal }: Parameters<NonNullable<ProviderAdapter['transcribeAudio']>>[0]) {
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://learnr.local', 'X-Title': 'learnr' }, body: JSON.stringify({ model, input_audio: { data: audioBase64, format } }), signal });
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: { message?: string } }; throw new Error(payload.error?.message || `OpenRouter transcription failed (${response.status}).`); }
    const payload = await response.json() as { text?: string; usage?: OpenRouterUsageLike };
    if (!payload.text?.trim()) throw new Error('The transcription model returned no text.');
    return { text: payload.text.trim(), usage: providerUsageFromOpenRouter(payload.usage) };
  }

  private async streamSimple(apiKey: string, body: object, signal: AbortSignal, onToken: (token: string) => void): Promise<ProviderUsage> {
    const response = await openRouterRequest(apiKey, body, signal);
    let usage = emptyUsage(); let emitted = '';
    await consumeJsonSse<{ choices?: Array<{ delta?: { content?: string | Array<{ type?: string; text?: string }> }; message?: { content?: string | Array<{ type?: string; text?: string }> } }>; usage?: OpenRouterUsageLike }>(response, (event) => {
      const contentText = (value: string | Array<{ type?: string; text?: string }> | undefined) => typeof value === 'string' ? value : (value ?? []).map((item) => item.text ?? '').join('');
      const delta = contentText(event.choices?.[0]?.delta?.content); if (delta) { emitted += delta; onToken(delta); }
      const final = contentText(event.choices?.[0]?.message?.content); if (final && !emitted) { emitted = final; onToken(final); }
      if (event.usage) usage = providerUsageFromOpenRouter(event.usage);
    });
    return usage;
  }
}

export function getProvider(id: ProviderId): ProviderAdapter {
  if (id !== 'openrouter') throw new Error('learnr now uses OpenRouter for every AI operation. Reopen Settings to migrate this role.');
  return new OpenRouterAdapter();
}
