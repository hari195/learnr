import { DEFAULT_SETTINGS, ENABLED_FEATURE_DEFAULTS } from './defaults';
import { IS_ARC_BUILD } from './build-target';
import { CHAT_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE, DEFAULT_NOTE_PROMPT_TEMPLATE, EXPLICIT_MATERIAL_DEFAULT_NOTE_PROMPT_TEMPLATE, LEGACY_NOTE_FRONTMATTER_INSTRUCTION, MULTI_PAGE_DEFAULT_NOTE_PROMPT_TEMPLATE, NOTE_FRONTMATTER_INSTRUCTION, PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE, SINGLE_PAGE_DEFAULT_SYSTEM_PROMPT_TEMPLATE, SOURCE_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE } from './prompt';
import type { AppSettings, ChatSession, ConversationPage, PageContext, ProviderId } from './types';
import { normalizeGuardrails } from './guardrails';
import { normalizeUsage } from './usage';
import { draftLinkReferences, normalizeDrafts } from './drafts';
import { getActiveWorkspaceId, LEGACY_SETTINGS_KEY, LEGACY_WORKSPACE_ID, loadGlobalSettings, saveGlobalSettings, workspaceSettingsKey } from './workspaces';

export const SETTINGS_KEY = LEGACY_SETTINGS_KEY;
const sessionKey = (tabId: number) => `learnr.session.${tabId}`;
export const conversationKey = (historyId: string) => `learnr.conversation.${historyId}`;
export const tabConversationKey = (tabId: number, workspaceId = LEGACY_WORKSPACE_ID) => `learnr.tab-conversation.${workspaceId}.${tabId}`;

function legacyPage(session: ChatSession, context?: PageContext): ConversationPage[] {
  if (session.pages?.length) return session.pages;
  if (!context) return [];
  return [{ id: crypto.randomUUID(), tabId: session.tabId, context, linkOrigin: 'primary', linkedAt: Date.now(), lastActiveAt: Date.now() }];
}

export function normalizeSession(session: ChatSession, context?: PageContext): ChatSession {
  const pages = legacyPage(session, context).map((page) => ({ ...page, contextIncluded: page.contextIncluded !== false }));
  const artifacts = session.artifacts ?? [];
  const drafts = normalizeDrafts(session.drafts, session.draft, draftLinkReferences(artifacts));
  const { draft: _legacyDraft, ...rest } = session;
  return {
    ...rest,
    workspaceId: session.workspaceId ?? LEGACY_WORKSPACE_ID,
    historyId: session.historyId || crypto.randomUUID(),
    sourceHighlights: session.sourceHighlights ?? [], imageHighlights: session.imageHighlights ?? [],
    videoHighlights: session.videoHighlights ?? [], videoContexts: session.videoContexts ?? [], usage: normalizeUsage(session.usage),
    artifacts,
    pages,
    activePageId: session.activePageId || pages.find((page) => page.tabId === session.tabId)?.id || pages[0]?.id || '',
    drafts,
    activeDraftId: drafts.some((draft) => draft.id === session.activeDraftId) ? session.activeDraftId : drafts.at(-1)?.id,
  };
}

export function normalizeSettings(saved?: Partial<AppSettings>): AppSettings {
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  const { defaultFolder: _legacyDefaultFolder, ...savedSettings } = saved as Partial<AppSettings> & { defaultFolder?: string };
  const legacyProvider = saved.defaultProvider ?? DEFAULT_SETTINGS.defaultProvider;
  const legacyAssignment = saved.aiRoles?.chat ?? { provider: legacyProvider, model: saved.providers?.[legacyProvider]?.selectedModel ?? DEFAULT_SETTINGS.aiRoles.chat.model };
  const migrateModel = (assignment: { provider: ProviderId; model: string } | undefined, fallback = DEFAULT_SETTINGS.aiRoles.chat.model) => {
    if (!assignment?.model) return fallback;
    return assignment.provider === 'openrouter' || assignment.model.includes('/') ? assignment.model : `openai/${assignment.model}`;
  };
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    providers: {
      // Keep the legacy slot only so old history/settings shapes remain readable.
      // Direct OpenAI credentials are deliberately discarded during migration.
      openai: { ...DEFAULT_SETTINGS.providers.openai },
      openrouter: { ...DEFAULT_SETTINGS.providers.openrouter, ...saved.providers?.openrouter },
    },
    chatSuggestions: Array.isArray(saved.chatSuggestions) && saved.chatSuggestions.length === 3
      ? saved.chatSuggestions.map((value, index) => String(value || DEFAULT_SETTINGS.chatSuggestions[index])) as [string, string, string]
      : [...DEFAULT_SETTINGS.chatSuggestions],
    tokenWarnings: { ...DEFAULT_SETTINGS.tokenWarnings, ...saved.tokenWarnings },
    savedNotes: { ...DEFAULT_SETTINGS.savedNotes, ...saved.savedNotes },
    aiRoles: {
      chat: { provider: 'openrouter', model: migrateModel(legacyAssignment) },
      drafting: { provider: 'openrouter', model: migrateModel(saved.aiRoles?.drafting ?? legacyAssignment) },
      pdf: { provider: 'openrouter', model: migrateModel(saved.aiRoles?.pdf ?? legacyAssignment) },
      image: { provider: 'openrouter', model: migrateModel(saved.aiRoles?.image ?? legacyAssignment) },
      video: { provider: 'openrouter', model: migrateModel(saved.aiRoles?.video, DEFAULT_SETTINGS.aiRoles.video.model) },
      transcription: { provider: 'openrouter', model: migrateModel(saved.aiRoles?.transcription, DEFAULT_SETTINGS.aiRoles.transcription.model) },
    },
    guardrails: normalizeGuardrails(saved.guardrails),
    pdfExtractionEnabled: saved.pdfExtractionEnabled !== false,
    pdfExtractionMode: saved.pdfExtractionMode === 'manual' ? 'manual' : 'countdown',
    keepSavedDraftsInEditor: saved.keepSavedDraftsInEditor !== false,
    sourceContextBudgetTokens: Math.min(2_048_000, Math.max(32_000, Math.round((Number(saved.sourceContextBudgetTokens) || 32_000) / 32_000) * 32_000)),
  };
  settings.savedNotes.embeddingProvider = 'openrouter';
  settings.savedNotes.embeddingModel ||= DEFAULT_SETTINGS.savedNotes.embeddingModel;
  settings.savedNotes.enabledEmbeddingProfileIds = Array.isArray(saved.savedNotes?.enabledEmbeddingProfileIds)
    ? [...new Set(saved.savedNotes.enabledEmbeddingProfileIds.filter((id): id is string => typeof id === 'string' && Boolean(id)))]
    : saved.savedNotes?.embeddingProfileId ? [saved.savedNotes.embeddingProfileId] : [];
  for (const role of ['chat', 'drafting', 'pdf', 'image'] as const) {
    const assignment = settings.aiRoles[role];
    assignment.provider = 'openrouter';
  }
  settings.aiRoles.video.provider = 'openrouter';
  settings.aiRoles.transcription.provider = 'openrouter';
  settings.defaultProvider = 'openrouter';
  if (settings.systemPromptTemplate === SINGLE_PAGE_DEFAULT_SYSTEM_PROMPT_TEMPLATE) settings.systemPromptTemplate = DEFAULT_SETTINGS.systemPromptTemplate;
  if ([PREVIOUS_DEFAULT_NOTE_PROMPT_TEMPLATE, CHAT_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE, SOURCE_HIGHLIGHT_DEFAULT_NOTE_PROMPT_TEMPLATE, MULTI_PAGE_DEFAULT_NOTE_PROMPT_TEMPLATE, EXPLICIT_MATERIAL_DEFAULT_NOTE_PROMPT_TEMPLATE].includes(settings.notePromptTemplate)) settings.notePromptTemplate = DEFAULT_NOTE_PROMPT_TEMPLATE;
  else if (settings.notePromptTemplate.includes(LEGACY_NOTE_FRONTMATTER_INSTRUCTION)) settings.notePromptTemplate = settings.notePromptTemplate.replace(LEGACY_NOTE_FRONTMATTER_INSTRUCTION, `${NOTE_FRONTMATTER_INSTRUCTION}\n---`).replace('model: {{model}}\nThen write', 'model: {{model}}\n---\nThen write');
  return settings;
}

export async function loadSettings(workspaceId?: string): Promise<AppSettings> {
  const global = await loadGlobalSettings();
  const id = workspaceId ?? global.activeWorkspaceId;
  const keys = [workspaceSettingsKey(id), SETTINGS_KEY];
  const result = await chrome.storage.local.get(keys);
  const saved = result[workspaceSettingsKey(id)] ?? (id === LEGACY_WORKSPACE_ID ? result[SETTINGS_KEY] : undefined);
  const workspace = saved as Partial<AppSettings> | undefined;
  // The shared OpenRouter catalog is intentionally stripped from workspace
  // settings on save. Merge it back before normalization so a workspace's
  // selected role model is not mistaken for an unavailable legacy model.
  const normalized = normalizeSettings({
    ...workspace,
    providers: {
      openai: workspace?.providers?.openai ?? DEFAULT_SETTINGS.providers.openai,
      openrouter: { ...workspace?.providers?.openrouter, ...global.openRouter, providerId: 'openrouter' },
    },
  });
  const upgradeArcFeatures = IS_ARC_BUILD && (normalized.arcFeatureDefaultsVersion ?? 0) < 1;
  if (upgradeArcFeatures) {
    Object.assign(normalized, ENABLED_FEATURE_DEFAULTS);
    normalized.arcFeatureDefaultsVersion = 1;
    // Do not invent a library or request folder access on the user's behalf.
    if (normalized.savedNotes.enabledEmbeddingProfileIds.length) normalized.savedNotes.searchInChat = true;
  }
  // Existing indexes were keyed by workspace. Reusing that key as the first
  // global profile preserves vectors and directory handles without copying.
  if (!normalized.savedNotes.embeddingProfileId && !normalized.savedNotes.enabledEmbeddingProfileIds.length && normalized.savedNotes.searchInChat) {
    const profileId = id;
    normalized.savedNotes.embeddingProfileId = profileId;
    const now = Date.now();
    const profiles = global.embeddingProfiles.some((profile) => profile.id === profileId)
      ? global.embeddingProfiles
      : [...global.embeddingProfiles, { id: profileId, workspaceId: id, name: `${global.workspaces.find((item) => item.id === id)?.name ?? 'Workspace'} notes`, model: normalized.savedNotes.embeddingModel, autoUpdate: false, createdAt: now, updatedAt: now }];
    const persisted = structuredClone(normalized);
    persisted.providers.openrouter = { ...persisted.providers.openrouter, apiKey: '', connectionStatus: 'untested', availableModels: [], modelCatalog: [], modelsUpdatedAt: undefined };
    await Promise.all([chrome.storage.local.set({ [workspaceSettingsKey(id)]: persisted }), saveGlobalSettings({ ...global, embeddingProfiles: profiles })]);
  }
  if (upgradeArcFeatures) {
    const persisted = structuredClone(normalized);
    persisted.providers.openrouter = { ...persisted.providers.openrouter, apiKey: '', connectionStatus: 'untested', availableModels: [], modelCatalog: [], modelsUpdatedAt: undefined };
    await chrome.storage.local.set({ [workspaceSettingsKey(id)]: persisted });
  }
  return normalized;
}

export async function saveSettings(settings: AppSettings, workspaceId?: string): Promise<void> {
  const global = await loadGlobalSettings();
  const id = workspaceId ?? global.activeWorkspaceId;
  const openRouter = { ...settings.providers.openrouter, providerId: 'openrouter' as const };
  const workspaceSettings = structuredClone(settings);
  workspaceSettings.providers.openrouter = { ...workspaceSettings.providers.openrouter, apiKey: '', connectionStatus: 'untested', availableModels: [], modelCatalog: [], modelsUpdatedAt: undefined };
  await Promise.all([
    chrome.storage.local.set({ [workspaceSettingsKey(id)]: workspaceSettings }),
    saveGlobalSettings({ ...global, openRouter }),
  ]);
}

export function observeSettings(onChange: (settings: AppSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !Object.keys(changes).some((key) => key === SETTINGS_KEY || key === 'learnr.globalSettings' || key.startsWith('learnr.workspace.'))) return;
    if (changes[SETTINGS_KEY] && !chrome.storage.local?.get) { onChange(normalizeSettings(changes[SETTINGS_KEY].newValue as Partial<AppSettings> | undefined)); return; }
    void loadSettings().then(onChange);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function loadSession(tabId: number, context?: PageContext, workspaceId?: string): Promise<ChatSession | null> {
  const id = workspaceId ?? await getActiveWorkspaceId();
  const keys = [tabConversationKey(tabId, id), ...(id === LEGACY_WORKSPACE_ID ? [sessionKey(tabId), `learnr.tab-conversation.${tabId}`] : [])];
  const result = await chrome.storage.session.get(keys);
  const historyId = (result[tabConversationKey(tabId, id)] ?? result[`learnr.tab-conversation.${tabId}`]) as string | undefined;
  if (historyId) {
    const canonical = await chrome.storage.session.get(conversationKey(historyId));
    const session = canonical[conversationKey(historyId)] as ChatSession | undefined;
    if (session && (session.workspaceId ?? LEGACY_WORKSPACE_ID) === id) return normalizeSession({ ...session, tabId, workspaceId: id }, context);
  }
  const legacy = result[sessionKey(tabId)] as ChatSession | undefined;
  return legacy ? normalizeSession(legacy, context) : null;
}

export async function loadConversationSession(historyId: string): Promise<ChatSession | null> {
  const result = await chrome.storage.session.get(conversationKey(historyId));
  const session = result[conversationKey(historyId)] as ChatSession | undefined;
  return session ? normalizeSession(session) : null;
}

export async function saveSession(session: ChatSession): Promise<void> {
  const normalized = normalizeSession({ ...session, workspaceId: session.workspaceId ?? await getActiveWorkspaceId() });
  const current = await chrome.storage.session.get(conversationKey(normalized.historyId));
  const previous = current[conversationKey(normalized.historyId)] as ChatSession | undefined;
  normalized.revision = Math.max(previous?.revision ?? 0, normalized.revision ?? 0) + 1;
  const values: Record<string, unknown> = { [conversationKey(normalized.historyId)]: normalized };
  const retainedMappingKeys = new Set(normalized.pages.flatMap((page) => page.tabId ? [tabConversationKey(page.tabId, normalized.workspaceId)] : []));
  for (const key of retainedMappingKeys) values[key] = normalized.historyId;
  const existing = await chrome.storage.session.get(null);
  const staleMappings = Object.entries(existing).filter(([key, value]) => key.startsWith(`learnr.tab-conversation.${normalized.workspaceId}.`) && value === normalized.historyId && !retainedMappingKeys.has(key)).map(([key]) => key);
  if (staleMappings.length) await chrome.storage.session.remove(staleMappings);
  await chrome.storage.session.set(values);
  await chrome.storage.session.remove(sessionKey(session.tabId));
}

export async function deleteSession(tabId: number, workspaceId?: string): Promise<void> {
  const id = workspaceId ?? await getActiveWorkspaceId();
  await chrome.storage.session.remove([...(id === LEGACY_WORKSPACE_ID ? [sessionKey(tabId), `learnr.tab-conversation.${tabId}`] : []), tabConversationKey(tabId, id)]);
}

export async function detachTabFromConversation(tabId: number): Promise<ChatSession | null> {
  const workspaceId = await getActiveWorkspaceId();
  const mapping = await chrome.storage.session.get(tabConversationKey(tabId, workspaceId));
  const historyId = mapping[tabConversationKey(tabId, workspaceId)] as string | undefined;
  await deleteSession(tabId, workspaceId);
  if (!historyId) return null;
  const result = await chrome.storage.session.get(conversationKey(historyId));
  const stored = result[conversationKey(historyId)] as ChatSession | undefined;
  if (!stored) return null;
  const removed = stored.pages.find((page) => page.tabId === tabId);
  const pages = stored.pages.filter((page) => page.tabId !== tabId);
  const activePageId = pages.some((page) => page.id === stored.activePageId) ? stored.activePageId : pages.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.id ?? '';
  const next = {
    ...stored,
    updatedByInstanceId: undefined,
    revision: (stored.revision ?? 0) + 1,
    pages,
    activePageId,
    sourceHighlights: stored.sourceHighlights.filter((highlight) => !removed || highlight.pageId !== removed.id),
    imageHighlights: (stored.imageHighlights ?? []).filter((highlight) => !removed || highlight.pageId !== removed.id),
    videoHighlights: (stored.videoHighlights ?? []).filter((highlight) => !removed || highlight.pageId !== removed.id),
  };
  if (pages.length) await chrome.storage.session.set({ [conversationKey(historyId)]: next });
  else await chrome.storage.session.remove(conversationKey(historyId));
  return next;
}

export async function detachTabFromAllConversations(tabId: number): Promise<ChatSession[]> {
  const stored = await chrome.storage.session.get(null);
  const suffix = `.${tabId}`;
  const mappings = Object.entries(stored).filter(([key]) => key.startsWith('learnr.tab-conversation.') && key.endsWith(suffix));
  const results: ChatSession[] = [];
  for (const [mappingKey, historyValue] of mappings) {
    const historyId = String(historyValue ?? ''); if (!historyId) continue;
    const session = stored[conversationKey(historyId)] as ChatSession | undefined;
    await chrome.storage.session.remove(mappingKey);
    if (!session) continue;
    const removed = session.pages.find((page) => page.tabId === tabId);
    const pages = session.pages.filter((page) => page.tabId !== tabId);
    const activePageId = pages.some((page) => page.id === session.activePageId) ? session.activePageId : [...pages].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.id ?? '';
    const next = normalizeSession({ ...session, updatedByInstanceId: undefined, revision: (session.revision ?? 0) + 1, pages, activePageId, sourceHighlights: session.sourceHighlights.filter((highlight) => !removed || highlight.pageId !== removed.id), imageHighlights: session.imageHighlights.filter((highlight) => !removed || highlight.pageId !== removed.id), videoHighlights: (session.videoHighlights ?? []).filter((highlight) => !removed || highlight.pageId !== removed.id) });
    if (pages.length) { await chrome.storage.session.set({ [conversationKey(historyId)]: next }); results.push(next); } else await chrome.storage.session.remove(conversationKey(historyId));
  }
  return results;
}

export async function attachSpawnedTab(openerTabId: number, tab: chrome.tabs.Tab, origin: ConversationPage['linkOrigin'] = 'spawned'): Promise<ChatSession | null> {
  if (!tab.id || tab.pinned) return null;
  const stored = await chrome.storage.session.get(null); const suffix = `.${openerTabId}`;
  const mapping = Object.entries(stored).find(([key]) => key.startsWith('learnr.tab-conversation.') && key.endsWith(suffix));
  if (!mapping) return null;
  const historyId = String(mapping[1] ?? ''); const session = stored[conversationKey(historyId)] as ChatSession | undefined; if (!session) return null;
  const parent = session.pages.find((page) => page.tabId === openerTabId); if (!parent) return null;
  return attachTabToConversation(historyId, parent.id, tab, origin);
}

export async function attachTabToConversation(historyId: string, parentPageId: string, tab: chrome.tabs.Tab, origin: ConversationPage['linkOrigin'] = 'spawned'): Promise<ChatSession | null> {
  if (!tab.id || tab.pinned) return null; const result = await chrome.storage.session.get(conversationKey(historyId)); const session = result[conversationKey(historyId)] as ChatSession | undefined; if (!session) return null;
  const parent = session.pages.find((page) => page.id === parentPageId); if (!parent) return null;
  if (session.pages.some((page) => page.tabId === tab.id)) return normalizeSession(session);
  const now = Date.now(); const pending = !tab.url || !/^https?:/i.test(tab.url);
  const page: ConversationPage = { id: crypto.randomUUID(), tabId: tab.id, parentPageId: parent.id, contextIncluded: true, pending, context: { title: tab.title || 'New connected tab', url: tab.url ?? '', cleanedMarkdown: '', extractionStatus: 'unavailable', pageTheme: parent.context.pageTheme }, faviconUrl: tab.favIconUrl, linkOrigin: origin, linkedAt: now, lastActiveAt: now };
  const next = normalizeSession({ ...session, updatedByInstanceId: undefined, pages: [...session.pages, page], activePageId: tab.active ? page.id : session.activePageId, tabId: tab.active ? tab.id : session.tabId }); await saveSession(next); return next;
}

export async function updateConnectedTabMetadata(tab: chrome.tabs.Tab): Promise<ChatSession | null> {
  if (!tab.id) return null; const stored = await chrome.storage.session.get(null); const suffix = `.${tab.id}`;
  const mapping = Object.entries(stored).find(([key]) => key.startsWith('learnr.tab-conversation.') && key.endsWith(suffix)); if (!mapping) return null;
  const historyId = String(mapping[1] ?? ''); const session = stored[conversationKey(historyId)] as ChatSession | undefined; if (!session) return null;
  const pages = session.pages.map((page) => page.tabId === tab.id ? { ...page, pending: !tab.url || !/^https?:/i.test(tab.url), closedAt: undefined, closeDecisionPending: false, faviconUrl: tab.favIconUrl ?? page.faviconUrl, context: { ...page.context, title: tab.title || page.context.title, url: tab.url ?? page.context.url } } : page);
  const next = normalizeSession({ ...session, updatedByInstanceId: undefined, pages }); await saveSession(next); return next;
}

export async function handleConnectedTabClosed(tabId: number, behavior: 'keep' | 'remove' | 'ask'): Promise<ChatSession[]> {
  if (behavior === 'remove') return detachTabFromAllConversations(tabId);
  const stored = await chrome.storage.session.get(null); const suffix = `.${tabId}`; const mappings = Object.entries(stored).filter(([key]) => key.startsWith('learnr.tab-conversation.') && key.endsWith(suffix)); const results: ChatSession[] = [];
  for (const [mappingKey, historyValue] of mappings) {
    const historyId = String(historyValue ?? ''); const session = stored[conversationKey(historyId)] as ChatSession | undefined; await chrome.storage.session.remove(mappingKey); if (!session) continue;
    const pages = session.pages.map((page) => page.tabId === tabId ? { ...page, tabId: undefined, closedAt: Date.now(), closeDecisionPending: behavior === 'ask' } : page);
    const next = normalizeSession({ ...session, updatedByInstanceId: undefined, revision: (session.revision ?? 0) + 1, pages }); await chrome.storage.session.set({ [conversationKey(historyId)]: next }); results.push(next);
  }
  return results;
}

export async function deleteSessionsForHistory(historyId: string): Promise<void> {
  const sessions = await chrome.storage.session.get(null);
  const keys = Object.entries(sessions).filter(([key, value]) =>
    (key.startsWith('learnr.session.') && (value as ChatSession | undefined)?.historyId === historyId)
    || key === conversationKey(historyId)
    || (key.startsWith('learnr.tab-conversation.') && value === historyId)).map(([key]) => key);
  if (keys.length) await chrome.storage.session.remove(keys);
}

export async function clearAllSessions(): Promise<void> {
  const sessions = await chrome.storage.session.get(null);
  const keys = Object.keys(sessions).filter((key) => key.startsWith('learnr.session.') || key.startsWith('learnr.conversation.') || key.startsWith('learnr.tab-conversation.'));
  if (keys.length) await chrome.storage.session.remove(keys);
}

export async function deleteWorkspaceStorage(workspaceId: string): Promise<void> {
  await chrome.storage.local.remove(workspaceSettingsKey(workspaceId));
  const sessions = await chrome.storage.session.get(null);
  const keys = Object.entries(sessions).filter(([key, value]) => key.startsWith(`learnr.tab-conversation.${workspaceId}.`) || (key.startsWith('learnr.conversation.') && (value as ChatSession | undefined)?.workspaceId === workspaceId)).map(([key]) => key);
  if (keys.length) await chrome.storage.session.remove(keys);
}
