import { DEFAULT_SETTINGS } from './defaults';
import { normalizeSettings } from './storage';
import type { AppSettings, GlobalSettings, ThemeMode, UsageWindow, WorkspaceDefinition } from './types';
import { DEFAULT_DARK_HIGHLIGHT_COLOR, DEFAULT_LIGHT_HIGHLIGHT_COLOR, normalizeGlobal, normalizeWorkspaceColor, SETTINGS_CARD_CATALOG } from './workspaces';

export const SETTINGS_EXPORT_FORMAT = 'learnr-settings' as const;
export const SETTINGS_EXPORT_VERSION = 1 as const;
export const MAX_SETTINGS_FILE_BYTES = 1_000_000;
const portableAppVersion = () => typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '1.0.0';

type GlobalPortableSettings = Pick<GlobalSettings,
  'keyboardShortcutsEnabled' | 'slashCommandsEnabled' | 'closedConnectedTabBehavior' | 'accentColor' |
  'lightBackgroundColor' | 'darkBackgroundColor' | 'lightHighlightColor' | 'darkHighlightColor' | 'settingsCardOrder' | 'autoGroupModel'
> & { openRouterSelectedModel: string };

type WorkspacePortableSettings = Omit<AppSettings, 'providers' | 'defaultProvider' | 'savedNotes' | 'guardrails' | 'arcFeatureDefaultsVersion'> & {
  savedNotes: Omit<AppSettings['savedNotes'], 'embeddingProfileId' | 'enabledEmbeddingProfileIds'>;
};

export interface GlobalSettingsExportV1 {
  format: typeof SETTINGS_EXPORT_FORMAT;
  version: typeof SETTINGS_EXPORT_VERSION;
  scope: 'global';
  appVersion: string;
  exportedAt: string;
  data: GlobalPortableSettings;
}

export interface WorkspaceSettingsExportV1 {
  format: typeof SETTINGS_EXPORT_FORMAT;
  version: typeof SETTINGS_EXPORT_VERSION;
  scope: 'workspace';
  appVersion: string;
  exportedAt: string;
  workspace: { name: string; color: string };
  data: WorkspacePortableSettings;
}

export type ParsedSettingsExport = GlobalSettingsExportV1 | WorkspaceSettingsExportV1;

const BOOLEAN_WORKSPACE_KEYS = [
  'zettelkastenFilenames', 'autoFollowActiveTab', 'activateSourceTabOnConversationSelect', 'chatSuggestionsEnabled',
  'allowNoteInDraftContext', 'microphoneDictationEnabled', 'videoAnalysisEnabled', 'imageAnalysisEnabled',
  'webSearchEnabled', 'webFetchEnabled', 'pdfExtractionEnabled', 'keepSavedDraftsInEditor', 'showChatReplyStats', 'showDraftStats', 'usageWarningsEnabled',
] as const;
const PROMPT_KEYS = ['systemPromptTemplate', 'notePromptTemplate', 'pdfPromptTemplate', 'imagePromptTemplate', 'videoPromptTemplate'] as const;
const ROLE_KEYS = ['chat', 'drafting', 'pdf', 'image', 'video', 'transcription'] as const;
const USAGE_WINDOWS = new Set<UsageWindow>(['today', '7d', '30d', 'month', 'all']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 200_000): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must contain text.`);
  if (value.length > max) throw new Error(`${label} is too large.`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} is outside the supported range.`);
  return Number(value);
}

function validateColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${label} must be a six-digit hex color.`);
  return value.toLocaleLowerCase();
}

function validateCardOrder(value: unknown): GlobalSettings['settingsCardOrder'] {
  const source = record(value, 'Settings card order');
  const result = {} as GlobalSettings['settingsCardOrder'];
  for (const scope of ['dashboard', 'workspace', 'app'] as const) {
    const order = source[scope];
    if (!Array.isArray(order) || order.some((item) => typeof item !== 'string')) throw new Error(`${scope} card order is invalid.`);
    if (order.some((item) => !SETTINGS_CARD_CATALOG[scope].includes(item as never))) throw new Error(`${scope} card order contains an unknown card.`);
    result[scope] = [...new Set(order)] as string[];
  }
  return result;
}

export function portableGlobalSettings(global: GlobalSettings): GlobalPortableSettings {
  return {
    keyboardShortcutsEnabled: global.keyboardShortcutsEnabled,
    slashCommandsEnabled: global.slashCommandsEnabled,
    closedConnectedTabBehavior: global.closedConnectedTabBehavior,
    accentColor: global.accentColor,
    lightBackgroundColor: global.lightBackgroundColor,
    darkBackgroundColor: global.darkBackgroundColor,
    lightHighlightColor: global.lightHighlightColor,
    darkHighlightColor: global.darkHighlightColor,
    settingsCardOrder: structuredClone(global.settingsCardOrder),
    autoGroupModel: global.autoGroupModel,
    openRouterSelectedModel: global.openRouter.selectedModel,
  };
}

export function portableWorkspaceSettings(settings: AppSettings): WorkspacePortableSettings {
  const { providers: _providers, defaultProvider: _defaultProvider, savedNotes, guardrails: _guardrails, arcFeatureDefaultsVersion: _arcFeatureDefaultsVersion, ...portable } = structuredClone(settings);
  const { embeddingProfileId: _embeddingProfileId, enabledEmbeddingProfileIds: _enabledEmbeddingProfileIds, ...portableSavedNotes } = savedNotes;
  return { ...portable, savedNotes: portableSavedNotes };
}

export function createGlobalSettingsExport(global: GlobalSettings, now = new Date()): GlobalSettingsExportV1 {
  return { format: SETTINGS_EXPORT_FORMAT, version: SETTINGS_EXPORT_VERSION, scope: 'global', appVersion: portableAppVersion(), exportedAt: now.toISOString(), data: portableGlobalSettings(global) };
}

export function createWorkspaceSettingsExport(workspace: WorkspaceDefinition, settings: AppSettings, now = new Date()): WorkspaceSettingsExportV1 {
  return { format: SETTINGS_EXPORT_FORMAT, version: SETTINGS_EXPORT_VERSION, scope: 'workspace', appVersion: portableAppVersion(), exportedAt: now.toISOString(), workspace: { name: workspace.name, color: workspace.color }, data: portableWorkspaceSettings(settings) };
}

function validateGlobalData(value: unknown): GlobalPortableSettings {
  const data = record(value, 'Global settings');
  const closed = String(data.closedConnectedTabBehavior);
  if (!['keep', 'remove', 'ask'].includes(closed)) throw new Error('Connected-tab behavior is invalid.');
  return {
    keyboardShortcutsEnabled: requiredBoolean(data.keyboardShortcutsEnabled, 'Keyboard shortcuts'),
    slashCommandsEnabled: requiredBoolean(data.slashCommandsEnabled, 'Slash commands'),
    closedConnectedTabBehavior: closed as GlobalSettings['closedConnectedTabBehavior'],
    accentColor: validateColor(data.accentColor, 'Accent color'),
    lightBackgroundColor: validateColor(data.lightBackgroundColor, 'Light background color'),
    darkBackgroundColor: validateColor(data.darkBackgroundColor, 'Dark background color'),
    lightHighlightColor: data.lightHighlightColor === undefined ? DEFAULT_LIGHT_HIGHLIGHT_COLOR : validateColor(data.lightHighlightColor, 'Light highlight color'),
    darkHighlightColor: data.darkHighlightColor === undefined ? DEFAULT_DARK_HIGHLIGHT_COLOR : validateColor(data.darkHighlightColor, 'Dark highlight color'),
    settingsCardOrder: validateCardOrder(data.settingsCardOrder),
    autoGroupModel: requiredString(data.autoGroupModel, 'AutoGroup model', 300),
    openRouterSelectedModel: requiredString(data.openRouterSelectedModel, 'OpenRouter model', 300),
  };
}

function validateWorkspaceData(value: unknown): WorkspacePortableSettings {
  const data = record(value, 'Workspace settings');
  for (const key of BOOLEAN_WORKSPACE_KEYS) {
    if ((key === 'pdfExtractionEnabled' || key === 'keepSavedDraftsInEditor') && data[key] === undefined) continue;
    requiredBoolean(data[key], key);
  }
  for (const key of PROMPT_KEYS) requiredString(data[key], key);
  if (!['website', 'system', 'light', 'dark'].includes(String(data.themeMode))) throw new Error('Theme mode is invalid.');
  if (!['countdown', 'manual'].includes(String(data.pdfExtractionMode))) throw new Error('PDF extraction mode is invalid.');
  const roles = record(data.aiRoles, 'AI roles');
  const normalizedRoles = {} as AppSettings['aiRoles'];
  for (const role of ROLE_KEYS) {
    const assignment = record(roles[role], `${role} role`);
    if (typeof assignment.model !== 'string' || assignment.model.length > 300 || (role !== 'video' && !assignment.model.trim())) throw new Error(`${role} model is invalid.`);
    normalizedRoles[role] = { provider: 'openrouter', model: assignment.model };
  }
  if (!Array.isArray(data.chatSuggestions) || data.chatSuggestions.length !== 3) throw new Error('Chat suggestions must contain exactly three items.');
  const suggestions = data.chatSuggestions.map((item, index) => requiredString(item, `Suggestion ${index + 1}`, 160)) as [string, string, string];
  const savedNotes = record(data.savedNotes, 'Saved-note settings');
  const warnings = record(data.tokenWarnings, 'Token warnings');
  if (!['day', 'week', 'month'].includes(String(warnings.globalPeriod))) throw new Error('Token-warning period is invalid.');
  const windows = record(data.usageWindowByModel, 'Usage windows');
  for (const [model, window] of Object.entries(windows)) if (!model || !USAGE_WINDOWS.has(window as UsageWindow)) throw new Error('A model usage window is invalid.');
  const budget = integer(data.sourceContextBudgetTokens, 'Connected-source token budget', 32_000, 2_048_000);
  if (budget % 32_000 !== 0) throw new Error('Connected-source token budget must be a multiple of 32,000.');
  return {
    aiRoles: normalizedRoles,
    themeMode: data.themeMode as ThemeMode,
    systemPromptTemplate: data.systemPromptTemplate as string,
    notePromptTemplate: data.notePromptTemplate as string,
    pdfPromptTemplate: data.pdfPromptTemplate as string,
    imagePromptTemplate: data.imagePromptTemplate as string,
    videoPromptTemplate: data.videoPromptTemplate as string,
    zettelkastenFilenames: data.zettelkastenFilenames as boolean,
    autoFollowActiveTab: data.autoFollowActiveTab as boolean,
    activateSourceTabOnConversationSelect: data.activateSourceTabOnConversationSelect as boolean,
    chatSuggestions: suggestions,
    chatSuggestionsEnabled: data.chatSuggestionsEnabled as boolean,
    allowNoteInDraftContext: data.allowNoteInDraftContext as boolean,
    microphoneDictationEnabled: data.microphoneDictationEnabled as boolean,
    videoAnalysisEnabled: data.videoAnalysisEnabled as boolean,
    imageAnalysisEnabled: data.imageAnalysisEnabled as boolean,
    webSearchEnabled: data.webSearchEnabled as boolean,
    webFetchEnabled: data.webFetchEnabled as boolean,
    pdfExtractionEnabled: data.pdfExtractionEnabled === undefined ? true : data.pdfExtractionEnabled as boolean,
    pdfExtractionMode: data.pdfExtractionMode as AppSettings['pdfExtractionMode'],
    keepSavedDraftsInEditor: data.keepSavedDraftsInEditor === undefined ? true : data.keepSavedDraftsInEditor as boolean,
    sourceContextBudgetTokens: budget,
    savedNotes: { embeddingProvider: 'openrouter', embeddingModel: requiredString(savedNotes.embeddingModel, 'Embedding model', 300), searchInChat: requiredBoolean(savedNotes.searchInChat, 'Saved-note search') },
    showChatReplyStats: data.showChatReplyStats as boolean,
    showDraftStats: data.showDraftStats as boolean,
    usageWarningsEnabled: data.usageWarningsEnabled as boolean,
    tokenWarnings: { conversationTokens: integer(warnings.conversationTokens, 'Conversation warning', 0, Number.MAX_SAFE_INTEGER), globalTokens: integer(warnings.globalTokens, 'Global warning', 0, Number.MAX_SAFE_INTEGER), globalPeriod: warnings.globalPeriod as AppSettings['tokenWarnings']['globalPeriod'] },
    usageWindowByModel: Object.fromEntries(Object.entries(windows)) as Record<string, UsageWindow>,
  };
}

export function parseSettingsExport(text: string): ParsedSettingsExport {
  if (new Blob([text]).size > MAX_SETTINGS_FILE_BYTES) throw new Error('Settings files can be at most 1 MB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This is not valid JSON.'); }
  const envelope = record(value, 'Settings file');
  if (envelope.format !== SETTINGS_EXPORT_FORMAT) throw new Error('This is not a Learnr settings file.');
  if (envelope.version !== SETTINGS_EXPORT_VERSION) throw new Error(Number(envelope.version) > SETTINGS_EXPORT_VERSION ? 'This settings file was created by a newer Learnr version.' : 'This settings file uses an unsupported schema version.');
  if (typeof envelope.appVersion !== 'string' || typeof envelope.exportedAt !== 'string' || !Number.isFinite(Date.parse(envelope.exportedAt))) throw new Error('Settings file metadata is invalid.');
  if (envelope.scope === 'global') return { format: SETTINGS_EXPORT_FORMAT, version: SETTINGS_EXPORT_VERSION, scope: 'global', appVersion: envelope.appVersion, exportedAt: envelope.exportedAt, data: validateGlobalData(envelope.data) };
  if (envelope.scope !== 'workspace') throw new Error('Settings file scope must be global or workspace.');
  const workspace = record(envelope.workspace, 'Workspace identity');
  return { format: SETTINGS_EXPORT_FORMAT, version: SETTINGS_EXPORT_VERSION, scope: 'workspace', appVersion: envelope.appVersion, exportedAt: envelope.exportedAt, workspace: { name: requiredString(workspace.name, 'Workspace name', 60), color: validateColor(workspace.color, 'Workspace color') }, data: validateWorkspaceData(envelope.data) };
}

export function applyGlobalSettingsExport(current: GlobalSettings, imported: GlobalSettingsExportV1): GlobalSettings {
  const data = validateGlobalData(imported.data);
  return normalizeGlobal({ ...current, ...data, openRouter: { ...current.openRouter, selectedModel: data.openRouterSelectedModel } });
}

export function importedWorkspaceSettings(imported: WorkspaceSettingsExportV1, sharedOpenRouter: GlobalSettings['openRouter']): AppSettings {
  const data = validateWorkspaceData(imported.data);
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...data, defaultProvider: 'openrouter', providers: { openai: { ...DEFAULT_SETTINGS.providers.openai }, openrouter: sharedOpenRouter }, savedNotes: { ...data.savedNotes, enabledEmbeddingProfileIds: [], embeddingProfileId: '', searchInChat: false } });
}

export function uniqueImportedWorkspaceName(name: string, workspaces: WorkspaceDefinition[]): string {
  const taken = new Set(workspaces.map((workspace) => workspace.name.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  let suffix = 2; while (taken.has(`${name} (${suffix})`.toLocaleLowerCase())) suffix += 1;
  return `${name} (${suffix})`;
}

export function settingsExportFilename(scope: 'global' | 'workspace', workspaceName?: string): string {
  if (scope === 'global') return 'learnr-global-settings.json';
  const slug = (workspaceName ?? 'workspace').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workspace';
  return `learnr-workspace-${slug}-settings.json`;
}

export function settingsImportSummary(imported: ParsedSettingsExport): string[] {
  if (imported.scope === 'global') return ['Appearance and backgrounds', 'Settings card order', 'Keyboard and slash-command preferences', 'Connected-tab behavior', 'AutoGroup and preferred model choices'];
  return ['Models and system prompts', 'Chat, media, and PDF behavior', 'Context budgets and usage warnings', 'Appearance and note preferences', 'A new workspace with no folder or embedding-library connection'];
}
