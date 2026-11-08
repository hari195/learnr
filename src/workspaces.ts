import { DEFAULT_SETTINGS } from './defaults';
import { IS_ARC_BUILD } from './build-target';
import type { AppSettings, EmbeddingIndexProfile, GlobalSettings, ProviderSettings, WorkspaceDefinition } from './types';

export const LEGACY_WORKSPACE_ID = 'default';
export const GLOBAL_SETTINGS_KEY = 'learnr.globalSettings';
const ARC_GLOBAL_FEATURES_KEY = 'learnr.arc.globalFeatureDefaultsVersion';
export const LEGACY_SETTINGS_KEY = 'learnr.settings';
export const workspaceSettingsKey = (id: string) => `learnr.workspace.${id}.settings`;
export const WORKSPACE_COLORS = ['#1687ff', '#8b5cf6', '#e0528d', '#e07828', '#c19a16', '#26966f', '#168caa', '#65758b'] as const;
export const USAGE_ACCOUNTING_VERSION = 2;
export const DEFAULT_AUTOGROUP_MODEL = 'openai/gpt-5-mini';
export const EMBEDDING_PROFILES_VERSION = 2;
export const DEFAULT_ACCENT_COLOR = '#1687ff';
export const DEFAULT_LIGHT_BACKGROUND_COLOR = '#f4f6f8';
export const DEFAULT_DARK_BACKGROUND_COLOR = '#07090c';
export const DEFAULT_LIGHT_HIGHLIGHT_COLOR = '#d59b00';
export const DEFAULT_DARK_HIGHLIGHT_COLOR = '#ffd45e';
export const SETTINGS_CARD_CATALOG = {
  dashboard: ['journey', 'workspaces', 'openrouter', 'autogroup', 'shortcuts', 'slash-commands', 'usage'],
  workspace: ['workspace-summary', 'workspace-portability', 'appearance', 'saved-notes', 'usage-display', 'chat', 'draft', 'pdf', 'image', 'video'],
  app: ['app-personalization', 'settings-portability', 'factory-reset', 'about'],
} as const;

function normalizeCardOrder(value: unknown, defaults: readonly string[]): string[] {
  const requested = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && defaults.includes(item)) : [];
  return [...new Set([...requested, ...defaults])];
}

function fallbackWorkspaceColor(id: string): string {
  if (id === LEGACY_WORKSPACE_ID) return WORKSPACE_COLORS[0];
  let hash = 0;
  for (const character of id) hash = Math.imul(hash, 31) + character.charCodeAt(0) | 0;
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
}

export function normalizeWorkspaceColor(value: unknown, id = LEGACY_WORKSPACE_ID): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallbackWorkspaceColor(id);
}

function defaultOpenRouter(): ProviderSettings {
  return structuredClone(DEFAULT_SETTINGS.providers.openrouter);
}

export function validateWorkspaceName(value: string, existing: WorkspaceDefinition[] = [], excludingId?: string): string {
  const name = value.trim();
  if (!name) throw new Error('Workspace name cannot be empty.');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('Workspace name contains unsupported control characters.');
  if (name.length > 60) throw new Error('Workspace names can contain at most 60 characters.');
  if (existing.some((item) => item.id !== excludingId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A workspace with that name already exists.');
  return name;
}

export function defaultGlobalSettings(now = Date.now(), openRouter = defaultOpenRouter()): GlobalSettings {
  return { activeWorkspaceId: LEGACY_WORKSPACE_ID, workspaces: [{ id: LEGACY_WORKSPACE_ID, name: 'Default', color: WORKSPACE_COLORS[0], createdAt: now, updatedAt: now }], openRouter, keyboardShortcutsEnabled: true, slashCommandsEnabled: true, closedConnectedTabBehavior: 'keep', accentColor: DEFAULT_ACCENT_COLOR, lightBackgroundColor: DEFAULT_LIGHT_BACKGROUND_COLOR, darkBackgroundColor: DEFAULT_DARK_BACKGROUND_COLOR, lightHighlightColor: DEFAULT_LIGHT_HIGHLIGHT_COLOR, darkHighlightColor: DEFAULT_DARK_HIGHLIGHT_COLOR, settingsCardOrder: { dashboard: [...SETTINGS_CARD_CATALOG.dashboard], workspace: [...SETTINGS_CARD_CATALOG.workspace], app: [...SETTINGS_CARD_CATALOG.app] }, autoGroupModel: DEFAULT_AUTOGROUP_MODEL, embeddingProfiles: [], embeddingProfilesVersion: EMBEDDING_PROFILES_VERSION, usageAccountingVersion: USAGE_ACCOUNTING_VERSION };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeGlobal(value: Partial<GlobalSettings> | undefined): GlobalSettings {
  const fallback = defaultGlobalSettings();
  const seenIds = new Set<string>();
  const workspaces = (Array.isArray(value?.workspaces) ? value.workspaces : []).flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || !candidate.id.trim() || seenIds.has(candidate.id)) return [];
    seenIds.add(candidate.id);
    const createdAt = Number(candidate.createdAt);
    const updatedAt = Number(candidate.updatedAt);
    return [{
      id: candidate.id,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : 'Workspace',
      color: normalizeWorkspaceColor(candidate.color, candidate.id),
      createdAt: Number.isFinite(createdAt) ? createdAt : fallback.workspaces[0].createdAt,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : fallback.workspaces[0].updatedAt,
    }];
  });
  if (!workspaces.length) workspaces.push(...fallback.workspaces);
  const activeWorkspaceId = workspaces.some((item) => item.id === value?.activeWorkspaceId) ? value!.activeWorkspaceId! : workspaces[0].id;
  const openRouter = isRecord(value?.openRouter) ? value.openRouter : {};
  const embeddingProfiles = (Array.isArray(value?.embeddingProfiles) ? value.embeddingProfiles : []).flatMap((candidate): EmbeddingIndexProfile[] => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !candidate.id || !candidate.name.trim()) return [];
    return [{ id: candidate.id, workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : '', name: candidate.name.trim().slice(0, 80), folderName: typeof candidate.folderName === 'string' ? candidate.folderName : undefined, model: typeof candidate.model === 'string' && candidate.model ? candidate.model : DEFAULT_SETTINGS.savedNotes.embeddingModel, dimensions: Number(candidate.dimensions) > 0 ? Number(candidate.dimensions) : undefined, autoUpdate: candidate.autoUpdate === true, imported: candidate.imported === true, createdAt: Number(candidate.createdAt) || Date.now(), updatedAt: Number(candidate.updatedAt) || Date.now() }];
  });
  const color = (candidate: unknown, fallbackColor: string) => typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : fallbackColor;
  const order: Record<string, unknown> = isRecord(value?.settingsCardOrder) ? value.settingsCardOrder : {};
  const closedConnectedTabBehavior = ['keep', 'remove', 'ask'].includes(String(value?.closedConnectedTabBehavior)) ? value!.closedConnectedTabBehavior! : 'keep';
  return { activeWorkspaceId, workspaces, openRouter: { ...fallback.openRouter, ...openRouter, providerId: 'openrouter' }, keyboardShortcutsEnabled: value?.keyboardShortcutsEnabled ?? true, slashCommandsEnabled: value?.slashCommandsEnabled ?? true, closedConnectedTabBehavior, accentColor: color(value?.accentColor, DEFAULT_ACCENT_COLOR), lightBackgroundColor: color(value?.lightBackgroundColor, DEFAULT_LIGHT_BACKGROUND_COLOR), darkBackgroundColor: color(value?.darkBackgroundColor, DEFAULT_DARK_BACKGROUND_COLOR), lightHighlightColor: color(value?.lightHighlightColor, DEFAULT_LIGHT_HIGHLIGHT_COLOR), darkHighlightColor: color(value?.darkHighlightColor, DEFAULT_DARK_HIGHLIGHT_COLOR), settingsCardOrder: { dashboard: normalizeCardOrder(order.dashboard, SETTINGS_CARD_CATALOG.dashboard), workspace: normalizeCardOrder(order.workspace, SETTINGS_CARD_CATALOG.workspace), app: normalizeCardOrder(order.app, SETTINGS_CARD_CATALOG.app) }, autoGroupModel: typeof value?.autoGroupModel === 'string' && value.autoGroupModel.trim() ? value.autoGroupModel : DEFAULT_AUTOGROUP_MODEL, embeddingProfiles, embeddingProfilesVersion: Number(value?.embeddingProfilesVersion) || EMBEDDING_PROFILES_VERSION, usageAccountingVersion: Number.isFinite(value?.usageAccountingVersion) ? Number(value?.usageAccountingVersion) : 0 };
}

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  if (!chrome.storage.local?.get) return defaultGlobalSettings();
  const stored = await chrome.storage.local.get([GLOBAL_SETTINGS_KEY, LEGACY_SETTINGS_KEY, ARC_GLOBAL_FEATURES_KEY]);
  if (stored[GLOBAL_SETTINGS_KEY]) {
    const global = normalizeGlobal(stored[GLOBAL_SETTINGS_KEY] as Partial<GlobalSettings>);
    if (IS_ARC_BUILD && (Number(stored[ARC_GLOBAL_FEATURES_KEY]) || 0) < 1) {
      global.keyboardShortcutsEnabled = true;
      global.slashCommandsEnabled = true;
      await chrome.storage.local.set({ [GLOBAL_SETTINGS_KEY]: global, [ARC_GLOBAL_FEATURES_KEY]: 1 });
    }
    return global;
  }
  const legacy = stored[LEGACY_SETTINGS_KEY] as Partial<AppSettings> | undefined;
  const global = defaultGlobalSettings(Date.now(), { ...defaultOpenRouter(), ...legacy?.providers?.openrouter, providerId: 'openrouter' });
  await chrome.storage.local.set({ [GLOBAL_SETTINGS_KEY]: global, ...(IS_ARC_BUILD ? { [ARC_GLOBAL_FEATURES_KEY]: 1 } : {}) });
  return global;
}

export async function saveGlobalSettings(global: GlobalSettings): Promise<void> {
  if (!chrome.storage.local?.set) return;
  await chrome.storage.local.set({ [GLOBAL_SETTINGS_KEY]: normalizeGlobal(global) });
}

export async function getActiveWorkspaceId(): Promise<string> {
  return (await loadGlobalSettings()).activeWorkspaceId;
}

export async function setActiveWorkspace(id: string): Promise<GlobalSettings> {
  const global = await loadGlobalSettings();
  if (!global.workspaces.some((item) => item.id === id)) throw new Error('That workspace no longer exists.');
  const next = { ...global, activeWorkspaceId: id };
  await saveGlobalSettings(next);
  return next;
}

export async function createWorkspace(name: string, activate = true): Promise<WorkspaceDefinition> {
  const global = await loadGlobalSettings();
  const clean = validateWorkspaceName(name, global.workspaces);
  const now = Date.now();
  const id = crypto.randomUUID();
  const workspace = { id, name: clean, color: WORKSPACE_COLORS[global.workspaces.length % WORKSPACE_COLORS.length], createdAt: now, updatedAt: now };
  const fresh = structuredClone(DEFAULT_SETTINGS);
  fresh.providers.openrouter = { ...fresh.providers.openrouter, apiKey: '', availableModels: [] };
  await chrome.storage.local.set({ [workspaceSettingsKey(workspace.id)]: fresh });
  await saveGlobalSettings({ ...global, workspaces: [...global.workspaces, workspace], activeWorkspaceId: activate ? workspace.id : global.activeWorkspaceId });
  return workspace;
}

export async function createWorkspaceWithSettings(name: string, color: string, settings: AppSettings): Promise<WorkspaceDefinition> {
  const global = await loadGlobalSettings();
  const clean = validateWorkspaceName(name, global.workspaces);
  const now = Date.now();
  const workspace = { id: crypto.randomUUID(), name: clean, color: normalizeWorkspaceColor(color), createdAt: now, updatedAt: now };
  const portable = structuredClone(settings);
  portable.savedNotes.embeddingProfileId = '';
  portable.savedNotes.enabledEmbeddingProfileIds = [];
  portable.savedNotes.searchInChat = false;
  portable.providers.openai = { ...DEFAULT_SETTINGS.providers.openai };
  portable.providers.openrouter = { ...portable.providers.openrouter, apiKey: '', connectionStatus: 'untested', availableModels: [], modelCatalog: [], modelsUpdatedAt: undefined };
  const nextGlobal = normalizeGlobal({ ...global, workspaces: [...global.workspaces, workspace] });
  await chrome.storage.local.set({ [workspaceSettingsKey(workspace.id)]: portable, [GLOBAL_SETTINGS_KEY]: nextGlobal });
  return workspace;
}

export async function renameWorkspace(id: string, name: string): Promise<WorkspaceDefinition> {
  const global = await loadGlobalSettings();
  const clean = validateWorkspaceName(name, global.workspaces, id);
  const current = global.workspaces.find((item) => item.id === id);
  if (!current) throw new Error('That workspace no longer exists.');
  const nextWorkspace = { ...current, name: clean, updatedAt: Date.now() };
  await saveGlobalSettings({ ...global, workspaces: global.workspaces.map((item) => item.id === id ? nextWorkspace : item) });
  return nextWorkspace;
}

export async function setWorkspaceColor(id: string, color: string): Promise<WorkspaceDefinition> {
  const global = await loadGlobalSettings();
  const current = global.workspaces.find((item) => item.id === id);
  if (!current) throw new Error('That workspace no longer exists.');
  const nextWorkspace = { ...current, color: normalizeWorkspaceColor(color, id), updatedAt: Date.now() };
  await saveGlobalSettings({ ...global, workspaces: global.workspaces.map((item) => item.id === id ? nextWorkspace : item) });
  return nextWorkspace;
}

export async function deleteWorkspace(id: string): Promise<GlobalSettings> {
  const global = await loadGlobalSettings();
  if (global.workspaces.length <= 1) throw new Error('The final workspace cannot be deleted.');
  if (!global.workspaces.some((item) => item.id === id)) throw new Error('That workspace no longer exists.');
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_WORKSPACE_DELETE', workspaceId: id }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not delete the workspace data.');
  const workspaces = global.workspaces.filter((item) => item.id !== id);
  const next = { ...global, workspaces, embeddingProfiles: global.embeddingProfiles.filter((profile) => profile.workspaceId !== id), activeWorkspaceId: global.activeWorkspaceId === id ? workspaces[0].id : global.activeWorkspaceId };
  await Promise.all([chrome.storage.local.remove(workspaceSettingsKey(id)), saveGlobalSettings(next)]);
  return next;
}

export function observeGlobalSettings(callback: (settings: GlobalSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[GLOBAL_SETTINGS_KEY]) callback(normalizeGlobal(changes[GLOBAL_SETTINGS_KEY].newValue as Partial<GlobalSettings>));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
