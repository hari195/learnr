import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, ENABLED_FEATURE_DEFAULTS } from './defaults';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function setup(target: 'arc' | 'chromium', configuredLibrary = false) {
  vi.resetModules();
  vi.stubGlobal('__LEARNR_BROWSER_TARGET__', target);
  const workspace = structuredClone(DEFAULT_SETTINGS);
  for (const key of Object.keys(ENABLED_FEATURE_DEFAULTS) as Array<keyof typeof ENABLED_FEATURE_DEFAULTS>) workspace[key] = false;
  workspace.chatSuggestions = ['Custom one', 'Custom two', 'Custom three'];
  workspace.systemPromptTemplate = 'My custom prompt';
  workspace.aiRoles.chat.model = 'custom/model';
  if (configuredLibrary) workspace.savedNotes.enabledEmbeddingProfileIds = ['my-library'];
  const data: Record<string, unknown> = {
    'learnr.globalSettings': {
      activeWorkspaceId: 'default', workspaces: [{ id: 'default', name: 'Default', createdAt: 1, updatedAt: 1 }],
      openRouter: { ...DEFAULT_SETTINGS.providers.openrouter, apiKey: 'existing-key' },
      keyboardShortcutsEnabled: false, slashCommandsEnabled: false,
    },
    'learnr.workspace.default.settings': workspace,
  };
  const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); });
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]))), set,
  } } });
  const { loadSettings, saveSettings } = await import('./storage');
  return { data, set, loadSettings, saveSettings };
}

describe('Arc feature parity defaults', () => {
  it('uses the same enabled feature defaults in new Chrome and Arc workspaces', () => {
    expect(DEFAULT_SETTINGS).toMatchObject(ENABLED_FEATURE_DEFAULTS);
  });

  it('upgrades existing Arc settings while preserving prompts, model, credentials and library setup', async () => {
    const { data, loadSettings } = await setup('arc');
    const settings = await loadSettings();
    expect(settings).toMatchObject({ ...ENABLED_FEATURE_DEFAULTS, arcFeatureDefaultsVersion: 1, systemPromptTemplate: 'My custom prompt', chatSuggestions: ['Custom one', 'Custom two', 'Custom three'] });
    expect(settings.aiRoles.chat.model).toBe('custom/model');
    expect(settings.providers.openrouter.apiKey).toBe('existing-key');
    expect(settings.savedNotes.searchInChat).toBe(false);
    expect(settings.savedNotes.enabledEmbeddingProfileIds).toEqual([]);
    expect(data['learnr.globalSettings']).toMatchObject({ keyboardShortcutsEnabled: true, slashCommandsEnabled: true });
    expect(data['learnr.workspace.default.settings']).toMatchObject({ providers: { openrouter: { apiKey: '' } } });
  });

  it('enables saved-note search only when a library is already selected', async () => {
    const { loadSettings } = await setup('arc', true);
    expect((await loadSettings()).savedNotes).toMatchObject({ searchInChat: true, enabledEmbeddingProfileIds: ['my-library'], embeddingProfileId: '' });
  });

  it('does not turn features back on after the user subsequently disables them', async () => {
    const { data, loadSettings, saveSettings, set } = await setup('arc');
    const settings = await loadSettings();
    settings.chatSuggestionsEnabled = false;
    settings.showChatReplyStats = false;
    settings.microphoneDictationEnabled = false;
    await saveSettings(settings);
    (data['learnr.globalSettings'] as Record<string, unknown>).slashCommandsEnabled = false;
    set.mockClear();
    expect(await loadSettings()).toMatchObject({ chatSuggestionsEnabled: false, showChatReplyStats: false, microphoneDictationEnabled: false });
    expect(data['learnr.globalSettings']).toMatchObject({ slashCommandsEnabled: false });
    expect(set).not.toHaveBeenCalled();
  });

  it('leaves existing Chrome preferences unchanged', async () => {
    const { loadSettings, set } = await setup('chromium');
    expect(await loadSettings()).toMatchObject({ chatSuggestionsEnabled: false, showChatReplyStats: false, microphoneDictationEnabled: false });
    expect(set).not.toHaveBeenCalled();
  });

  it('upgrades each Arc workspace separately', async () => {
    const { data, loadSettings } = await setup('arc');
    await loadSettings();
    const second = structuredClone(DEFAULT_SETTINGS);
    second.showChatReplyStats = false;
    data['learnr.workspace.second.settings'] = second;
    expect(await loadSettings('second')).toMatchObject({ showChatReplyStats: true, arcFeatureDefaultsVersion: 1 });
  });
});
