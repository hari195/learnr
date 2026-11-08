import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { CHAT_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE, DEFAULT_NOTE_PROMPT_TEMPLATE, DEFAULT_SYSTEM_PROMPT_TEMPLATE, LEGACY_NOTE_FRONTMATTER_INSTRUCTION, MULTI_PAGE_DEFAULT_NOTE_PROMPT_TEMPLATE, PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE } from './prompt';
import { attachSpawnedTab, detachTabFromConversation, handleConnectedTabClosed, loadSession, loadSettings, normalizeSession, normalizeSettings, observeSettings, saveSession, SETTINGS_KEY } from './storage';
import type { ChatSession, PageContext } from './types';
import { emptyUsage } from './usage';

afterEach(() => { vi.unstubAllGlobals(); });

describe('settings migration', () => {
  it('adds the default system prompt to legacy settings', () => {
    const legacy = structuredClone(DEFAULT_SETTINGS) as Partial<typeof DEFAULT_SETTINGS>;
    delete legacy.systemPromptTemplate;
    const migrated = normalizeSettings(legacy);
    expect(migrated.systemPromptTemplate).toBe(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
    expect(migrated.pdfPromptTemplate).toContain('{{filename}}');
    expect(migrated.aiRoles.pdf.model).toBe(migrated.aiRoles.chat.model);
    expect(migrated).toMatchObject({ microphoneDictationEnabled: true, videoAnalysisEnabled: true, imageAnalysisEnabled: true, chatSuggestionsEnabled: true, allowNoteInDraftContext: false, pdfExtractionEnabled: true, pdfExtractionMode: 'countdown', keepSavedDraftsInEditor: true });
  });

  it('migrates note prompting and filename settings without changing current defaults', () => {
    const legacy = structuredClone(DEFAULT_SETTINGS) as Partial<typeof DEFAULT_SETTINGS>;
    delete legacy.notePromptTemplate;
    delete legacy.zettelkastenFilenames;
    delete legacy.autoFollowActiveTab;
    delete legacy.chatSuggestions;
    delete legacy.webSearchEnabled;
    delete legacy.usageWarningsEnabled;
    delete legacy.showChatReplyStats;
    delete legacy.showDraftStats;
    delete legacy.tokenWarnings;
    delete legacy.savedNotes;
    delete legacy.aiRoles;
    delete legacy.guardrails;
    const migrated = normalizeSettings(legacy);
    expect(migrated.notePromptTemplate).toBe(DEFAULT_NOTE_PROMPT_TEMPLATE);
    expect(migrated.zettelkastenFilenames).toBe(true);
    expect(migrated.autoFollowActiveTab).toBe(true);
    expect(migrated.chatSuggestions).toHaveLength(3);
    expect(migrated.webSearchEnabled).toBe(true);
    expect(migrated.usageWarningsEnabled).toBe(true);
    expect(migrated.showChatReplyStats).toBe(true);
    expect(migrated.showDraftStats).toBe(true);
    expect(migrated.tokenWarnings).toEqual({ conversationTokens: 100_000, globalTokens: 1_000_000, globalPeriod: 'month' });
    expect(migrated.savedNotes).toEqual({ embeddingProvider: 'openrouter', embeddingModel: 'openai/text-embedding-3-small', enabledEmbeddingProfileIds: [], embeddingProfileId: '', searchInChat: false });
    expect(migrated.aiRoles.chat).toEqual({ provider: 'openrouter', model: 'openai/gpt-5-mini' });
    expect(migrated.aiRoles.drafting).toEqual({ provider: 'openrouter', model: 'openai/gpt-5-mini' });
    expect(migrated.aiRoles.image).toEqual(migrated.aiRoles.chat);
    expect(migrated.aiRoles.transcription).toEqual({ provider: 'openrouter', model: 'openai/gpt-4o-mini-transcribe' });
    expect(migrated.activateSourceTabOnConversationSelect).toBe(false);
    expect(migrated.sourceContextBudgetTokens).toBe(32_000);
    expect(migrated.guardrails.global.preset).toBe('balanced');
  });

  it('upgrades the former undelimited YAML instruction without replacing other custom prompt text', () => {
    const legacyPrompt = `Custom preface\n${LEGACY_NOTE_FRONTMATTER_INSTRUCTION}\ntitle: {{title}}\nmodel: {{model}}\nThen write the note.`;
    const migrated = normalizeSettings({ ...DEFAULT_SETTINGS, notePromptTemplate: legacyPrompt });
    expect(migrated.notePromptTemplate).toContain('Custom preface');
    expect(migrated.notePromptTemplate).toContain('---\ntitle: {{title}}');
    expect(migrated.notePromptTemplate).toContain('model: {{model}}\n---\nThen write');
  });

  it('normalizes connected-source budgets to valid 32,000-token increments', () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, sourceContextBudgetTokens: 47_000 }).sourceContextBudgetTokens).toBe(32_000);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, sourceContextBudgetTokens: 2_999_999 }).sourceContextBudgetTokens).toBe(2_048_000);
  });

  it('migrates legacy OpenAI roles to OpenRouter model slugs without retaining OpenAI runtime selection', () => {
    const migrated = normalizeSettings({ ...DEFAULT_SETTINGS, defaultProvider: 'openai', providers: {
      ...DEFAULT_SETTINGS.providers,
      openai: { ...DEFAULT_SETTINGS.providers.openai, apiKey: 'sk-legacy-direct-key' },
    }, aiRoles: {
      ...DEFAULT_SETTINGS.aiRoles,
      chat: { provider: 'openai', model: 'gpt-4.1-mini' },
      drafting: { provider: 'openai', model: 'gpt-4.1-mini' },
    } });
    expect(migrated.defaultProvider).toBe('openrouter');
    expect(Object.values(migrated.aiRoles).every((role) => role.provider === 'openrouter')).toBe(true);
    expect(migrated.providers.openai.apiKey).toBe('');
  });

  it('preserves a customized prompt', () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, systemPromptTemplate: 'Custom {{title}}' }).systemPromptTemplate).toBe('Custom {{title}}');
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, notePromptTemplate: 'Custom {{conversation}}' }).notePromptTemplate).toBe('Custom {{conversation}}');
  });

  it('preserves a selected workspace model from the shared OpenRouter catalog', async () => {
    const selectedModel = 'moonshotai/kimi-k2';
    const workspaceSettings = structuredClone(DEFAULT_SETTINGS);
    workspaceSettings.aiRoles.chat.model = selectedModel;
    workspaceSettings.providers.openrouter.availableModels = [];
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async (keys: string[]) => {
      if (keys.includes('learnr.globalSettings')) return { 'learnr.globalSettings': {
        activeWorkspaceId: 'default',
        workspaces: [{ id: 'default', name: 'Default', createdAt: 1, updatedAt: 1 }],
        openRouter: { ...DEFAULT_SETTINGS.providers.openrouter, availableModels: [...DEFAULT_SETTINGS.providers.openrouter.availableModels, selectedModel] },
      } };
      return { 'learnr.workspace.default.settings': workspaceSettings };
    }) } } });

    expect((await loadSettings()).aiRoles.chat.model).toBe(selectedModel);
  });

  it('preserves a saved model even when it is absent from the current catalog', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.aiRoles.chat.model = 'provider/no-longer-listed';
    expect(normalizeSettings(settings).aiRoles.chat.model).toBe('provider/no-longer-listed');
  });

  it('migrates the previous default note prompt to the highlight-aware default', () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, notePromptTemplate: PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE }).notePromptTemplate).toBe(DEFAULT_NOTE_PROMPT_TEMPLATE);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, notePromptTemplate: CHAT_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE }).notePromptTemplate).toBe(DEFAULT_NOTE_PROMPT_TEMPLATE);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, notePromptTemplate: MULTI_PAGE_DEFAULT_NOTE_PROMPT_TEMPLATE }).notePromptTemplate).toBe(DEFAULT_NOTE_PROMPT_TEMPLATE);
  });

  it('propagates local settings changes and removes its listener', () => {
    let listener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    const removeListener = vi.fn();
    vi.stubGlobal('chrome', { storage: { onChanged: {
      addListener: (value: typeof listener) => { listener = value; },
      removeListener,
    } } });
    const onChange = vi.fn();
    const stop = observeSettings(onChange);
    listener?.({ [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, systemPromptTemplate: 'Synced {{title}}' } } }, 'local');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ systemPromptTemplate: 'Synced {{title}}' }));
    stop();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('migrates legacy tab sessions to zero usage', async () => {
    vi.stubGlobal('chrome', { storage: { session: { get: vi.fn().mockResolvedValue({
      'learnr.session.7': { tabId: 7, pageFingerprint: 'page', provider: 'openai', model: 'gpt-5.6-terra', messages: [{ id: 'legacy', role: 'assistant', content: 'No highlights', createdAt: 1 }] },
    }) } } });
    expect((await loadSession(7))?.usage).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      requestCount: 0,
      tokensReported: false,
      costReported: false,
    });
    expect((await loadSession(7))?.messages[0].highlights).toBeUndefined();
    expect((await loadSession(7))?.sourceHighlights).toEqual([]);
    expect((await loadSession(7))?.imageHighlights).toEqual([]);
    expect((await loadSession(7))?.artifacts).toEqual([]);
  });

  it('maps every linked tab to one canonical conversation and detaches closed tabs', async () => {
    const values: Record<string, unknown> = {};
    const get = vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return { ...values };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in values).map((key) => [key, values[key]]));
    });
    const set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); });
    const remove = vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; });
    vi.stubGlobal('chrome', { storage: { session: { get, set, remove } } });
    const context = (title: string): PageContext => ({ title, url: `https://example.com/${title}`, cleanedMarkdown: title, extractionStatus: 'readable', pageTheme: 'light' });
    const session: ChatSession = {
      tabId: 7, historyId: 'conversation', pageFingerprint: 'a', provider: 'openai', model: 'gpt-5.6-terra', messages: [], artifacts: [], sourceHighlights: [], imageHighlights: [], usage: {
        inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, requestCount: 0, tokensReported: false, costReported: false,
      },
      pages: [
        { id: 'a', tabId: 7, context: context('a'), linkOrigin: 'primary', linkedAt: 1, lastActiveAt: 1 },
        { id: 'b', tabId: 8, context: context('b'), linkOrigin: 'manual', linkedAt: 2, lastActiveAt: 2 },
      ],
      activePageId: 'a',
    };
    await saveSession(session);
    expect((await loadSession(8))?.historyId).toBe('conversation');
    const detached = await detachTabFromConversation(7);
    expect(detached?.pages.map((page) => page.id)).toEqual(['b']);
    expect(detached?.activePageId).toBe('b');
    expect(await loadSession(7)).toBeNull();
    expect((await loadSession(8))?.pages).toHaveLength(1);
  });

  it('attaches opener descendants and preserves or queues closed snapshots', async () => {
    const values: Record<string, unknown> = {}; const get = vi.fn(async (keys: string | string[] | null) => { if (keys === null) return { ...values }; const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.filter((key) => key in values).map((key) => [key, values[key]])); }); const set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }); const remove = vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }); vi.stubGlobal('chrome', { storage: { session: { get, set, remove } } });
    const context: PageContext = { title: 'root', url: 'https://example.com', cleanedMarkdown: 'root', extractionStatus: 'readable', pageTheme: 'light' };
    await saveSession({ tabId: 1, workspaceId: 'default', historyId: 'tree', pageFingerprint: 'root', provider: 'openrouter', model: 'm', messages: [], artifacts: [], sourceHighlights: [], imageHighlights: [], usage: emptyUsage(), pages: [{ id: 'root', tabId: 1, context, linkOrigin: 'primary', linkedAt: 1, lastActiveAt: 1 }], activePageId: 'root' });
    const attached = await attachSpawnedTab(1, { id: 2, windowId: 1, index: 1, pinned: false, title: 'child', url: 'https://example.com/child' } as chrome.tabs.Tab);
    expect(attached?.pages[1]).toMatchObject({ tabId: 2, parentPageId: 'root', linkOrigin: 'spawned', contextIncluded: true, pending: false });
    const kept = await handleConnectedTabClosed(2, 'keep'); expect(kept[0].pages[1]).toMatchObject({ tabId: undefined, closeDecisionPending: false }); expect(kept[0].pages[1].closedAt).toEqual(expect.any(Number));
  });
});

describe('draft session migration', () => {
  it('wraps a singular legacy draft in the draft collection', () => {
    const legacy = { tabId: 1, historyId: 'h', pageFingerprint: 'p', provider: 'openrouter', model: 'm', messages: [], artifacts: [], sourceHighlights: [], imageHighlights: [], usage: {}, pages: [], activePageId: '', draft: { markdown: 'Old draft', filename: 'Old', images: [], targetSubfolder: '' } } as unknown as ChatSession;
    const normalized = normalizeSession(legacy);
    expect(normalized.drafts).toHaveLength(1);
    expect(normalized.drafts?.[0].aiMarkdown).toBe('Old draft');
    expect(normalized.activeDraftId).toBe(normalized.drafts?.[0].id);
    expect(normalized.draft).toBeUndefined();
  });
});
