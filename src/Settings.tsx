import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Markdown } from './Markdown';
import learnrDocs from './docs/learnr-guide.md?raw';
import { DEFAULT_MODELS } from './defaults';
import { APP_VERSION, BROWSER_TARGET, BUILD_VERSION } from './build-info';
import { getProvider } from './providers';
import {
  DEFAULT_NOTE_PROMPT_TEMPLATE,
  DEFAULT_PDF_PROMPT_TEMPLATE,
  DEFAULT_IMAGE_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_VIDEO_PROMPT_TEMPLATE,
  IMAGE_PROMPT_PLACEHOLDERS,
  NOTE_PROMPT_PLACEHOLDERS,
  PDF_PROMPT_PLACEHOLDERS,
  SYSTEM_PROMPT_PLACEHOLDERS,
  VIDEO_PROMPT_PLACEHOLDERS,
  validateImagePromptTemplate,
  validateNotePromptTemplate,
  validatePdfPromptTemplate,
  validateSystemPromptTemplate,
  validateVideoPromptTemplate,
} from './prompt';
import { loadSettings, saveSettings } from './storage';
import { openHistoryPage } from './history';
import { EMPTY_LIFETIME_STATS, formatTimeSaved, loadLifetimeStats } from './stats';
import type { AiRoleAssignment, AppSettings, EmbeddingIndexProfile, LifetimeStats, OpenRouterModelMetadata, ProviderId, ThemeMode, TokenWarningPeriod, UsageEvent, UsageWindow } from './types';
import { formatCost, formatTokenCount } from './usage';
import { chooseImageFolder, chooseNoteLibrary, chooseVault, disconnectNoteLibrary, getExplicitImageHandle, getVaultHandle, pickNoteLibrary, setNoteLibraryHandle, useNotesFolderForImages } from './vault';
import { CREATE_DRAFT_COMMAND, displayShortcut, LAUNCH_COMMAND, OPEN_CONNECTED_TAB_COMMAND } from './commands';
import { getExtensionCommands, openOptionsPage, openShortcutManager } from './browser-bridge';
import { loadTokenUsageWindow, resetTokenUsageWindow, type TokenUsageWindow } from './token-warnings';
import { DEFAULT_SETTINGS } from './defaults';
import { clearNoteIndex, deleteWorkspaceNoteIndex, getNoteIndexStatus, refreshNoteIndex } from './note-library';
import { createPortableIndex, readPortableIndex, restorePortableIndex } from './portable-index';
import { applyGlobalSettingsExport, createGlobalSettingsExport, createWorkspaceSettingsExport, importedWorkspaceSettings, MAX_SETTINGS_FILE_BYTES, parseSettingsExport, settingsExportFilename, settingsImportSummary, uniqueImportedWorkspaceName, type ParsedSettingsExport } from './portable-settings';
import { migrateEmbeddingProfiles } from './embedding-profiles';
import { aggregateUsageEvents, allTimeUsageBuckets, loadUsageEvents, recordUsageEvent, usageBuckets, usageModelColor, usageWindowStart } from './usage-events';
import { SLASH_COMMANDS } from './command-catalog';
import { createWorkspace, createWorkspaceWithSettings, DEFAULT_ACCENT_COLOR, DEFAULT_DARK_BACKGROUND_COLOR, DEFAULT_DARK_HIGHLIGHT_COLOR, DEFAULT_LIGHT_BACKGROUND_COLOR, DEFAULT_LIGHT_HIGHLIGHT_COLOR, deleteWorkspace, loadGlobalSettings, observeGlobalSettings, renameWorkspace, saveGlobalSettings, SETTINGS_CARD_CATALOG, setActiveWorkspace, setWorkspaceColor } from './workspaces';
import { classifyAutoGroupTabs, type AutoGroupClassificationProgress, type AutoGroupUnclassifiedTab } from './autogroup';
import type { AutoGroupApplyResult, AutoGroupAssignment, AutoGroupExistingGroup, AutoGroupTabSummary, DuplicateRemovalResult, DuplicateTabSet, GlobalSettings } from './types';
import { BROWSER_NAME } from './build-target';

const openTabPath = 'M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5';
const historyPath = 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2';
const keyboardPath = 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h10';
const USAGE_WINDOWS: Array<[UsageWindow, string]> = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['all', 'All time']];
type AutoGroupPhase = 'idle' | 'scanning' | 'classifying' | 'applying' | 'undoing';

function Icon({ path, size = 20 }: { path: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function SearchableModelSelect({ value, options, onChange, disabled, placeholder = 'Search models…' }: { value: string; options: string[]; onChange(value: string): void; disabled?: boolean; placeholder?: string }) {
  const id = useId(); const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const values = [...new Set(value && !options.includes(value) ? [value, ...options] : options)];
  const filtered = values.filter((model) => model.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choose = (model: string) => { onChange(model); setQuery(''); setOpen(false); setActive(0); };
  return <div className={`model-combobox${open ? ' open' : ''}`}>
    <input role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} disabled={disabled} value={open ? query : value} placeholder={placeholder} onFocus={() => { setOpen(true); setQuery(''); }} onChange={(event) => { setOpen(true); setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(filtered.length - 1, index + 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
      else if (event.key === 'Enter' && open && filtered[active]) { event.preventDefault(); choose(filtered[active]); }
      else if (event.key === 'Escape') { setOpen(false); setQuery(''); event.currentTarget.blur(); }
    }} onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 120)} />
    {open && <div className="model-combobox-list" id={`${id}-list`} role="listbox">{filtered.map((model, index) => <button type="button" role="option" aria-selected={model === value} className={index === active ? 'active' : ''} key={model} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(model)}>{model}</button>)}{!filtered.length && <span>No matching models</span>}</div>}
    {!!value && !!options.length && !options.includes(value) && <small className="model-unavailable">Saved model is not in the current OpenRouter catalog.</small>}
  </div>;
}

function compactTokens(value: number): string { return value >= 1_000_000 ? `${value / 1_000_000}M` : value >= 1_000 ? `${value / 1_000}K` : String(value); }
function modelPrice(value?: string): string | null { const amount = Number(value); return Number.isFinite(amount) && amount !== 0 ? `$${(amount * 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} / 1M` : null; }
function ModelDetails({ model, catalog }: { model: string; catalog?: OpenRouterModelMetadata[] }) {
  const metadata = catalog?.find((item) => item.id === model);
  if (!metadata) return <p className="model-metadata">Model context and pricing unavailable.</p>;
  const tier = metadata.pricing[0]; const fees = [tier?.request && Number(tier.request) !== 0 ? `$${tier.request} / request` : '', tier?.image && Number(tier.image) !== 0 ? `$${tier.image} / image` : '', tier?.webSearch && Number(tier.webSearch) !== 0 ? `$${tier.webSearch} / web search` : '', tier?.inputCacheRead && Number(tier.inputCacheRead) !== 0 ? `${modelPrice(tier.inputCacheRead)} cache read` : '', tier?.inputCacheWrite && Number(tier.inputCacheWrite) !== 0 ? `${modelPrice(tier.inputCacheWrite)} cache write` : ''].filter(Boolean);
  return <div className="model-metadata"><span>{metadata.contextLength ? `${compactTokens(metadata.contextLength)} context` : 'Context unavailable'}</span><span>{metadata.maxCompletionTokens ? `${compactTokens(metadata.maxCompletionTokens)} maximum output` : 'Maximum output unavailable'}</span><span>{modelPrice(tier?.prompt) ? `${modelPrice(tier?.prompt)} input tokens` : 'Input price unavailable'}</span><span>{modelPrice(tier?.completion) ? `${modelPrice(tier?.completion)} output tokens` : 'Output price unavailable'}</span>{fees.map((fee) => <span key={fee}>{fee}</span>)}{metadata.pricing.slice(1).map((price, index) => <span key={index}>From {compactTokens(price.minContext ?? 0)} context: {modelPrice(price.prompt) ?? 'input unavailable'} input · {modelPrice(price.completion) ?? 'output unavailable'} output</span>)}</div>;
}

function UsageDashboard({ events, window }: { events: UsageEvent[]; window: UsageWindow }) {
  const visibleEvents = events.filter((event) => event.createdAt >= usageWindowStart(window));
  const buckets = window === 'all' ? allTimeUsageBuckets(visibleEvents) : usageBuckets(window);
  const models = [...new Set(visibleEvents.map((event) => event.model))].sort();
  const aggregate = aggregateUsageEvents(visibleEvents, 'all');
  const cards = [
    { key: 'cost' as const, title: 'Spend', total: aggregate.costReported ? formatCost(aggregate.costUsd) : '—', value: (event: UsageEvent) => event.costReported ? event.costUsd : 0, format: formatCost },
    { key: 'requests' as const, title: 'Requests', total: formatTokenCount(aggregate.requestCount), value: (event: UsageEvent) => event.requestCount, format: formatTokenCount },
    { key: 'tokens' as const, title: 'Total tokens', total: aggregate.tokensReported ? formatTokenCount(aggregate.totalTokens) : '—', value: (event: UsageEvent) => event.tokensReported ? event.totalTokens : 0, format: formatTokenCount },
  ];
  return <div className="usage-card-grid">{cards.map((card) => {
    const bucketValues = buckets.map((bucket) => ({ bucket, models: models.map((model) => ({ model, value: visibleEvents.filter((event) => event.model === model && event.createdAt >= bucket.start && event.createdAt < bucket.end).reduce((sum, event) => sum + card.value(event), 0) })) }));
    const max = Math.max(0, ...bucketValues.map((item) => item.models.reduce((sum, model) => sum + model.value, 0)));
    return <section className="usage-card" key={card.key} aria-label={`${card.title}: ${card.total}`}><h3>{card.title}</h3><strong>{card.total}</strong>
      <div className="usage-bars" aria-hidden="true">{bucketValues.map(({ bucket, models: values }) => <div className="usage-bar-column" key={bucket.key} title={bucket.label}><div className="usage-bar-stack">{values.map((item) => <span key={item.model} style={{ height: max ? `${item.value / max * 100}%` : '0%', background: usageModelColor(item.model) }} />)}</div></div>)}</div>
      <div className="usage-legend">{models.map((model) => { const total = visibleEvents.filter((event) => event.model === model).reduce((sum, event) => sum + card.value(event), 0); return <div key={model}><i style={{ background: usageModelColor(model) }} /><span title={model}>{model}</span><b>{card.format(total)}</b></div>; })}{!models.length && <p>No usage recorded for this range.</p>}</div>
    </section>;
  })}</div>;
}

function JourneyStats({ stats }: { stats: LifetimeStats }) {
  return <section className="settings-section stats-section dashboard-only"><div className="stats-heading"><div><h2>Your learnr journey</h2><p>A little record of everything you have turned into understanding.</p></div><span>✦</span></div><div className="stats-grid"><div><span className="stats-icon">◆</span><strong>{stats.notesSaved.toLocaleString()}</strong><small>notes saved</small></div><div><span className="stats-icon">¶</span><strong>{stats.noteWords.toLocaleString()}</strong><small>words written</small></div><div><span className="stats-icon">◎</span><strong>{formatTokenCount(stats.totalTokens)}</strong><small>total AI tokens (input + output)</small></div><div><span className="stats-icon">$</span><strong>{formatCost(stats.totalCostUsd)}</strong><small>total OpenRouter cost</small></div><div className="time-saved-stat"><span className="stats-icon">⌁</span><strong>{formatTimeSaved(stats.timeSavedMinutes)}</strong><small>estimated writing time saved</small></div></div><p className="fine-print">Time saved is estimated from saved-note length at a 40-word-per-minute drafting pace. Token and cost totals use values reported by OpenRouter. Stats stay on this browser.</p></section>;
}

const SETTINGS_CARD_LABELS: Record<string, string> = {
  journey: 'Your learnr journey', workspaces: 'Workspaces', openrouter: 'OpenRouter connection', autogroup: 'AutoGroup', shortcuts: 'Keyboard shortcuts', 'slash-commands': 'Slash commands', usage: 'Usage',
  'workspace-summary': 'Workspace summary', appearance: 'Appearance', 'saved-notes': 'Saved-note library', 'usage-display': 'Usage display and warnings', chat: 'Chat stage', draft: 'Draft-note stage', pdf: 'PDF extraction stage', image: 'Image-analysis stage', video: 'Video-analysis stage',
  'workspace-portability': 'Workspace settings portability', 'app-personalization': 'Appearance and card order', 'settings-portability': 'Global settings portability', 'factory-reset': 'Factory reset', about: 'About',
};

export interface SettingsProps {
  settings: AppSettings;
  setSettings(value: AppSettings): void;
  error: string;
  setError(value: string): void;
  onBack?: () => void;
  fullPage?: boolean;
  onWorkspaceSwitch?(id: string): void | Promise<void>;
  embedded?: boolean;
  onDirtyChange?(dirty: boolean): void;
}

export function Settings({ settings: activeSettings, setSettings, error, setError, fullPage = false, embedded = false, onWorkspaceSwitch, onDirtyChange }: SettingsProps) {
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [settingsTab, setSettingsTab] = useState<string>('dashboard');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('default');
  const [settings, setEditedSettings] = useState(activeSettings);
  const [keys, setKeys] = useState<Record<ProviderId, string>>({ openai: '', openrouter: '' });
  const [models, setModels] = useState<Record<ProviderId, string[]>>({
    openai: settings.providers.openai.availableModels.length ? settings.providers.openai.availableModels : [...DEFAULT_MODELS.openai],
    openrouter: settings.providers.openrouter.availableModels.length ? settings.providers.openrouter.availableModels : [...DEFAULT_MODELS.openrouter],
  });
  const [promptDraft, setPromptDraft] = useState(settings.systemPromptTemplate);
  const [notePromptDraft, setNotePromptDraft] = useState(settings.notePromptTemplate);
  const [pdfPromptDraft, setPdfPromptDraft] = useState(settings.pdfPromptTemplate);
  const [imagePromptDraft, setImagePromptDraft] = useState(settings.imagePromptTemplate);
  const [videoPromptDraft, setVideoPromptDraft] = useState(settings.videoPromptTemplate);
  const [suggestionDrafts, setSuggestionDrafts] = useState<[string, string, string]>([...settings.chatSuggestions]);
  const [globalUsage, setGlobalUsage] = useState<TokenUsageWindow | null>(null);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [videoModels, setVideoModels] = useState<string[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [imageModels, setImageModels] = useState<Record<ProviderId, string[]>>({ openai: [], openrouter: [] });
  const [loadingVideoModels, setLoadingVideoModels] = useState(false);
  const [transcriptionModels, setTranscriptionModels] = useState<string[]>([]);
  const [loadingTranscriptionModels, setLoadingTranscriptionModels] = useState(false);
  const refreshedProviders = useRef(new Set<ProviderId>());
  const [vaultName, setVaultName] = useState('');
  const [imageFolderName, setImageFolderName] = useState('');
  const [usesNotesFolderForImages, setUsesNotesFolderForImages] = useState(true);
  const [lifetimeStats, setLifetimeStats] = useState<LifetimeStats>(EMPTY_LIFETIME_STATS);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [loadingShortcuts, setLoadingShortcuts] = useState(true);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [newLibraryModel, setNewLibraryModel] = useState(settings.savedNotes.embeddingModel);
  const importIndexRef = useRef<HTMLInputElement | null>(null);
  const settingsImportRef = useRef<HTMLInputElement | null>(null);
  const settingsImportScopeRef = useRef<'global' | 'workspace'>('global');
  const settingsImportTriggerRef = useRef<HTMLElement | null>(null);
  const [settingsImportPreview, setSettingsImportPreview] = useState<ParsedSettingsExport | null>(null);
  const [settingsImportBusy, setSettingsImportBusy] = useState(false);
  const settingsImportBusyRef = useRef(false);
  const profileAutoRefreshStarted = useRef(new Set<string>());
  const [resettingApp, setResettingApp] = useState(false);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [usageScope, setUsageScope] = useState('all');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('month');
  const [usageOperation, setUsageOperation] = useState<'all' | 'embeddings'>('all');
  const [profileStatuses, setProfileStatuses] = useState<Record<string, import('./types').NoteIndexStatus>>({});
  const [profileOperation, setProfileOperation] = useState<{ id: string; completed: number; total: number; startedAt: number } | null>(null);
  const [profileOperationClock, setProfileOperationClock] = useState(Date.now());
  const profileOperationController = useRef<AbortController | null>(null);
  const [autoGroupPhase, setAutoGroupPhase] = useState<AutoGroupPhase>('idle');
  const [autoGroupProgress, setAutoGroupProgress] = useState<AutoGroupClassificationProgress | null>(null);
  const [autoGroupElapsed, setAutoGroupElapsed] = useState(0);
  const autoGroupStartedAt = useRef(0);
  const [autoGroupPreview, setAutoGroupPreview] = useState<{ assignments: AutoGroupAssignment[]; unclassified: AutoGroupUnclassifiedTab[]; groups: AutoGroupExistingGroup[]; skippedPinned: number; skippedGrouped: number } | null>(null);
  const [autoGroupQuery, setAutoGroupQuery] = useState('');
  const [autoGroupNotice, setAutoGroupNotice] = useState('');
  const [autoGroupUndo, setAutoGroupUndo] = useState({ available: false, reason: 'No AutoGroup changes are available to undo.' });
  const [duplicateSets, setDuplicateSets] = useState<DuplicateTabSet[] | null>(null);
  const [duplicateQuery, setDuplicateQuery] = useState('');
  const [duplicateRemoving, setDuplicateRemoving] = useState(false);
  const [duplicateSelection, setDuplicateSelection] = useState<Record<number, boolean>>({});
  const autoGroupController = useRef<AbortController | null>(null);
  const active = 'openrouter' as const;
  const provider = settings.providers[active];
  const workspaceProfiles = globalSettings?.embeddingProfiles.filter((profile) => profile.workspaceId === selectedWorkspaceId) ?? [];
  const enabledProfiles = workspaceProfiles.filter((profile) => settings.savedNotes.enabledEmbeddingProfileIds.includes(profile.id));
  const enabledModel = enabledProfiles[0]?.model;
  const enabledReady = enabledProfiles.some((profile) => profileStatuses[profile.id]?.state === 'ready');

  useEffect(() => {
    if (autoGroupPhase !== 'scanning' && autoGroupPhase !== 'classifying') return;
    const tick = () => setAutoGroupElapsed(Math.max(0, Date.now() - autoGroupStartedAt.current));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [autoGroupPhase]);

  useEffect(() => { void migrateEmbeddingProfiles().then((global) => { setGlobalSettings(global); setSelectedWorkspaceId(global.activeWorkspaceId); }); return observeGlobalSettings(setGlobalSettings); }, []);
  useEffect(() => {
    if (settingsTab === 'dashboard' || settingsTab === 'docs' || settingsTab === 'app') return;
    setSelectedWorkspaceId(settingsTab);
    void loadSettings(settingsTab).then(setEditedSettings).catch((cause) => setError(errorMessage(cause)));
  }, [settingsTab]);

  useEffect(() => { void Promise.all([getVaultHandle(selectedWorkspaceId), getExplicitImageHandle(selectedWorkspaceId)]).then(([notes, images]) => {
    setVaultName(notes?.name ?? ''); setImageFolderName(images?.name ?? notes?.name ?? ''); setUsesNotesFolderForImages(!images);
  }); }, [selectedWorkspaceId]);
  useEffect(() => { setNewLibraryName(`${globalSettings?.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.name ?? 'Workspace'} notes`); setNewLibraryModel(settings.savedNotes.embeddingModel); }, [selectedWorkspaceId]);
  useEffect(() => { if (!profileOperation) return; const timer = window.setInterval(() => setProfileOperationClock(Date.now()), 1_000); return () => window.clearInterval(timer); }, [profileOperation?.id]);
  useEffect(() => {
    const ids = usageScope === 'all' ? (globalSettings?.workspaces.map((workspace) => workspace.id) ?? []) : [usageScope];
    void Promise.all(ids.map((id) => loadLifetimeStats(id))).then((values) => setLifetimeStats(values.reduce((total, value) => ({ notesSaved: total.notesSaved + value.notesSaved, noteWords: total.noteWords + value.noteWords, totalTokens: total.totalTokens + value.totalTokens, totalCostUsd: total.totalCostUsd + value.totalCostUsd, timeSavedMinutes: total.timeSavedMinutes + value.timeSavedMinutes }), { ...EMPTY_LIFETIME_STATS }))).catch(() => undefined);
  }, [usageScope, globalSettings?.workspaces]);

  useEffect(() => {
    const refresh = () => {
      setLoadingShortcuts(true);
      void getExtensionCommands().then((commands) => {
        setShortcuts(Object.fromEntries(commands.map((command) => [command.name ?? '', command.shortcut ?? ''])));
      }).catch((cause) => setError(errorMessage(cause))).finally(() => setLoadingShortcuts(false));
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [setError]);

  useEffect(() => {
    setPromptDraft(settings.systemPromptTemplate);
  }, [settings.systemPromptTemplate]);

  useEffect(() => {
    setNotePromptDraft(settings.notePromptTemplate);
  }, [settings.notePromptTemplate]);
  useEffect(() => setImagePromptDraft(settings.imagePromptTemplate), [settings.imagePromptTemplate]);
  useEffect(() => setVideoPromptDraft(settings.videoPromptTemplate), [settings.videoPromptTemplate]);
  useEffect(() => setPdfPromptDraft(settings.pdfPromptTemplate), [settings.pdfPromptTemplate]);
  useEffect(() => setSuggestionDrafts([...settings.chatSuggestions]), [settings.chatSuggestions]);
  useEffect(() => {
    onDirtyChange?.(
      promptDraft !== settings.systemPromptTemplate
      || notePromptDraft !== settings.notePromptTemplate
      || pdfPromptDraft !== settings.pdfPromptTemplate
      || imagePromptDraft !== settings.imagePromptTemplate
      || videoPromptDraft !== settings.videoPromptTemplate
      || suggestionDrafts.some((value, index) => value !== settings.chatSuggestions[index])
    );
  }, [promptDraft, notePromptDraft, pdfPromptDraft, imagePromptDraft, videoPromptDraft, suggestionDrafts, settings, onDirtyChange]);
  useEffect(() => {
    void loadTokenUsageWindow(settings.tokenWarnings.globalPeriod, selectedWorkspaceId).then(setGlobalUsage);
  }, [settings.tokenWarnings.globalPeriod, selectedWorkspaceId]);

  useEffect(() => {
    setModels({ openai: [], openrouter: settings.providers.openrouter.availableModels.length ? settings.providers.openrouter.availableModels : [...DEFAULT_MODELS.openrouter] });
  }, [settings.providers.openrouter.availableModels]);

  useEffect(() => {
    const apiKey = settings.providers.openrouter.apiKey;
    if (!apiKey) { setVideoModels([]); return; }
    setLoadingVideoModels(true);
    void getProvider('openrouter').listVideoModels?.(apiKey).then((available) => {
      const next = available ?? [];
      setVideoModels(next);
      if (next.length && !next.includes(settings.aiRoles.video.model)) {
        void update({ ...settings, aiRoles: { ...settings.aiRoles, video: { provider: 'openrouter', model: next[0] } } });
      }
    }).catch((cause) => setError(`Could not load video models: ${errorMessage(cause)}`)).finally(() => setLoadingVideoModels(false));
  }, [settings.providers.openrouter.apiKey]);

  useEffect(() => {
    const refresh = () => void loadUsageEvents('all').then(setUsageEvents).catch((cause) => setError(errorMessage(cause)));
    const listener = (message: { type?: string }) => { if (message.type === 'LEARNR_USAGE_EVENT_ADDED') refresh(); };
    refresh(); chrome.runtime.onMessage.addListener(listener); return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    const profiles = globalSettings?.embeddingProfiles ?? [];
    void Promise.all(profiles.map(async (profile) => [profile.id, await getNoteIndexStatus(profile.id)] as const)).then((entries) => setProfileStatuses(Object.fromEntries(entries))).catch(() => undefined);
  }, [globalSettings?.embeddingProfiles]);
  useEffect(() => {
    if (settingsTab !== selectedWorkspaceId || !globalSettings?.openRouter.apiKey) return;
    for (const profile of workspaceProfiles) {
      const status = profileStatuses[profile.id];
      if (!profile.autoUpdate || profileAutoRefreshStarted.current.has(profile.id) || (status?.lastRefreshedAt && Date.now() - status.lastRefreshedAt <= 6 * 60 * 60 * 1_000)) continue;
      profileAutoRefreshStarted.current.add(profile.id);
      void (async () => {
        const result = await refreshNoteIndex({ provider: 'openrouter', apiKey: globalSettings.openRouter.apiKey, model: profile.model, profileId: profile.id, requestPermission: false });
        setProfileStatuses((current) => ({ ...current, [profile.id]: result.status }));
        if (result.usage.requestCount) await recordUsageEvent({ provider: 'openrouter', model: profile.model, operation: 'embedding', usage: result.usage, workspaceId: profile.workspaceId, embeddingProfileId: profile.id });
      })().catch(() => undefined);
    }
  }, [settingsTab, selectedWorkspaceId, globalSettings?.embeddingProfiles, globalSettings?.openRouter.apiKey, profileStatuses]);

  useEffect(() => {
    const listener = (message: { type?: string }) => { if (message.type === 'LEARNR_AUTOGROUP_UNDO_CHANGED') void refreshAutoGroupUndo(); };
    void refreshAutoGroupUndo();
    chrome.runtime.onMessage.addListener(listener);
    return () => { chrome.runtime.onMessage.removeListener(listener); autoGroupController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!autoGroupPreview) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && autoGroupPhase !== 'applying') { setAutoGroupPreview(null); setAutoGroupQuery(''); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [autoGroupPreview, autoGroupPhase]);

  useEffect(() => {
    if (!settingsImportPreview) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !settingsImportBusyRef.current) setSettingsImportPreview(null); };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); settingsImportTriggerRef.current?.focus(); };
  }, [settingsImportPreview]);
  useEffect(() => { settingsImportBusyRef.current = settingsImportBusy; }, [settingsImportBusy]);

  useEffect(() => {
    for (const providerId of ['openrouter'] as ProviderId[]) {
      const apiKey = settings.providers[providerId].apiKey;
      if (!apiKey) continue;
      void getProvider(providerId).listImageModels?.(apiKey).then((available) => {
        const next = available ?? []; setImageModels((current) => ({ ...current, [providerId]: next }));
        const assignment = settings.aiRoles.image;
        if (assignment.provider === providerId && next.length && !next.includes(assignment.model)) void update({ ...settings, aiRoles: { ...settings.aiRoles, image: { provider: providerId, model: next[0] } } });
      }).catch(() => undefined);
    }
  }, [settings.providers.openrouter.apiKey]);

  useEffect(() => {
    const apiKey = settings.providers.openrouter.apiKey; if (!apiKey) { setEmbeddingModels([]); return; }
    void getProvider('openrouter').listEmbeddingModels?.(apiKey).then((available) => setEmbeddingModels(available ?? [])).catch((cause) => setError(`Could not load embedding models: ${errorMessage(cause)}`));
  }, [settings.providers.openrouter.apiKey]);

  useEffect(() => {
    const apiKey = settings.providers.openrouter.apiKey;
    if (!apiKey) { setTranscriptionModels([]); return; }
    setLoadingTranscriptionModels(true);
    void getProvider('openrouter').listTranscriptionModels?.(apiKey).then((available) => {
      const next = available ?? []; setTranscriptionModels(next);
      if (next.length && !next.includes(settings.aiRoles.transcription.model)) {
        const preferred = next.includes('openai/gpt-4o-mini-transcribe') ? 'openai/gpt-4o-mini-transcribe' : next.find((model) => model.startsWith('openai/')) ?? next[0];
        void update({ ...settings, aiRoles: { ...settings.aiRoles, transcription: { provider: 'openrouter', model: preferred } } });
      }
    }).catch((cause) => setError(`Could not load transcription models: ${errorMessage(cause)}`)).finally(() => setLoadingTranscriptionModels(false));
  }, [settings.providers.openrouter.apiKey]);

  useEffect(() => {
    if (!provider.apiKey || refreshedProviders.current.has(active)) return;
    refreshedProviders.current.add(active);
    void refreshModels(active, provider.apiKey, false).catch((cause) => setError(errorMessage(cause)));
  }, [active, provider.apiKey]);

  async function update(next: AppSettings) { setEditedSettings(next); await saveSettings(next, selectedWorkspaceId); if (selectedWorkspaceId === globalSettings?.activeWorkspaceId) setSettings(next); }
  function patchProvider(providerId: ProviderId, patch: Partial<AppSettings['providers'][ProviderId]>): AppSettings {
    return { ...settings, providers: { ...settings.providers, [providerId]: { ...settings.providers[providerId], ...patch } } };
  }
  function rolesWithAvailable(providerId: ProviderId, available: string[]) {
    return { ...settings.aiRoles, ...Object.fromEntries((['chat', 'drafting', 'pdf'] as const).map((role) => { const assignment = settings.aiRoles[role]; if (assignment.provider !== providerId || available.includes(assignment.model)) return [role, assignment]; return [role, { ...assignment, model: available[0] }]; })) } as AppSettings['aiRoles'];
  }
  function patchRole(role: keyof AppSettings['aiRoles'], patch: Partial<AiRoleAssignment>) {
    const current = settings.aiRoles[role]; const providerId = 'openrouter' as const;
    const available = role === 'image' ? (imageModels[providerId].length ? imageModels[providerId] : models[providerId]) : role === 'video' ? videoModels : role === 'transcription' ? transcriptionModels : models[providerId];
    const model = patch.model ?? (providerId === current.provider && available.includes(current.model) ? current.model : available[0]);
    void update({ ...settings, aiRoles: { ...settings.aiRoles, [role]: { provider: providerId, model } }, ...(role === 'chat' ? { defaultProvider: providerId } : {}) });
  }
  async function refreshModels(providerId: ProviderId, apiKey: string, markConnected: boolean) {
    setLoadingModels(true);
    try {
      const adapter = getProvider(providerId);
      const catalog = await adapter.listModelCatalog?.(apiKey);
      const available = catalog?.map((model) => model.id) ?? await adapter.listModels(apiKey);
      if (!available.length) throw new Error('No models are available to this OpenRouter API key.');
      const current = settings.providers[providerId];
      const selectedModel = available.includes(current.selectedModel) ? current.selectedModel : available[0];
      setModels((value) => ({ ...value, [providerId]: available }));
      await update({ ...patchProvider(providerId, {
        availableModels: available,
        ...(catalog ? { modelCatalog: catalog } : {}),
        modelsUpdatedAt: Date.now(),
        selectedModel,
        ...(markConnected ? { connectionStatus: 'connected' as const } : {}),
      }), aiRoles: rolesWithAvailable(providerId, available) });
      return available;
    } finally { setLoadingModels(false); }
  }

  async function testConnection() {
    const apiKey = keys[active] || provider.apiKey;
    if (!apiKey) { setError('Paste an API key first.'); return; }
    setTesting(true); setError('');
    try {
      const adapter = getProvider(active);
      await adapter.validateKey(apiKey);
      const catalog = await adapter.listModelCatalog?.(apiKey);
      const available = catalog?.map((model) => model.id) ?? await adapter.listModels(apiKey);
      if (!available.length) throw new Error('No models are available to this OpenRouter API key.');
      const selectedModel = available.includes(provider.selectedModel) ? provider.selectedModel : available[0];
      setModels((current) => ({ ...current, [active]: available }));
      await update({ ...patchProvider(active, { apiKey, connectionStatus: 'connected', availableModels: available, ...(catalog ? { modelCatalog: catalog } : {}), modelsUpdatedAt: Date.now(), selectedModel }), aiRoles: rolesWithAvailable(active, available) });
      refreshedProviders.current.add(active);
      setKeys((current) => ({ ...current, [active]: '' }));
    } catch (cause) {
      await update(patchProvider(active, { connectionStatus: 'failed' }));
      setError(errorMessage(cause));
    } finally { setTesting(false); }
  }

  async function savePrompt() {
    try {
      validateSystemPromptTemplate(promptDraft);
      setError('');
      await update({ ...settings, systemPromptTemplate: promptDraft });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function resetPrompt() {
    setPromptDraft(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
    setError('');
    await update({ ...settings, systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE });
  }

  async function saveNotePrompt() {
    try {
      validateNotePromptTemplate(notePromptDraft);
      setError('');
      await update({ ...settings, notePromptTemplate: notePromptDraft });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function resetNotePrompt() {
    setNotePromptDraft(DEFAULT_NOTE_PROMPT_TEMPLATE);
    setError('');
    await update({ ...settings, notePromptTemplate: DEFAULT_NOTE_PROMPT_TEMPLATE });
  }

  async function savePdfPrompt() {
    try { validatePdfPromptTemplate(pdfPromptDraft); setError(''); await update({ ...settings, pdfPromptTemplate: pdfPromptDraft }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function resetPdfPrompt() {
    setPdfPromptDraft(DEFAULT_PDF_PROMPT_TEMPLATE); setError(''); await update({ ...settings, pdfPromptTemplate: DEFAULT_PDF_PROMPT_TEMPLATE });
  }

  async function saveImagePrompt() {
    try { validateImagePromptTemplate(imagePromptDraft); setError(''); await update({ ...settings, imagePromptTemplate: imagePromptDraft }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function resetImagePrompt() {
    setImagePromptDraft(DEFAULT_IMAGE_PROMPT_TEMPLATE); setError(''); await update({ ...settings, imagePromptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE });
  }

  async function saveVideoPrompt() {
    try { validateVideoPromptTemplate(videoPromptDraft); setError(''); await update({ ...settings, videoPromptTemplate: videoPromptDraft }); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function resetVideoPrompt() {
    setVideoPromptDraft(DEFAULT_VIDEO_PROMPT_TEMPLATE); setError(''); await update({ ...settings, videoPromptTemplate: DEFAULT_VIDEO_PROMPT_TEMPLATE });
  }

  async function saveSuggestions() {
    const next = suggestionDrafts.map((value) => value.trim()) as [string, string, string];
    if (next.some((value) => !value)) { setError('All three chat suggestions must contain text.'); return; }
    if (next.some((value) => value.length > 160)) { setError('Chat suggestions can be at most 160 characters each.'); return; }
    setError(''); await update({ ...settings, chatSuggestions: next });
  }

  async function resetSuggestions() {
    const next = [...DEFAULT_SETTINGS.chatSuggestions] as [string, string, string];
    setSuggestionDrafts(next); setError(''); await update({ ...settings, chatSuggestions: next });
  }

  async function changeWarningPeriod(period: TokenWarningPeriod) {
    await update({ ...settings, tokenWarnings: { ...settings.tokenWarnings, globalPeriod: period } });
    setGlobalUsage(await resetTokenUsageWindow(period, selectedWorkspaceId));
  }

  async function resetUsage() {
    setGlobalUsage(await resetTokenUsageWindow(settings.tokenWarnings.globalPeriod, selectedWorkspaceId));
    setError('');
  }

  async function resetWarningThresholds() {
    await update({ ...settings, tokenWarnings: { ...DEFAULT_SETTINGS.tokenWarnings } });
    setError('');
  }

  async function factoryReset() {
    if (!window.confirm('Factory reset learnr? This permanently deletes all local settings, prompts, API keys, workspaces, chat history, usage, saved folder connections, and indexes.')) return;
    setResettingApp(true); setError('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LEARNR_FACTORY_RESET' }) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error || 'Could not reset learnr.');
      window.location.reload();
    } catch (cause) {
      setResettingApp(false); setError(errorMessage(cause));
    }
  }

  async function refreshAutoGroupUndo() {
    const response = await chrome.runtime.sendMessage({ type: 'LEARNR_AUTOGROUP_UNDO_STATUS' }).catch(() => null) as { ok?: boolean; available?: boolean; reason?: string } | null;
    setAutoGroupUndo({ available: Boolean(response?.ok && response.available), reason: response?.reason || 'No AutoGroup changes are available to undo.' });
  }

  async function saveAutoGroupModel(model: string) {
    if (!globalSettings) return;
    setError('');
    await saveGlobalSettings({ ...globalSettings, autoGroupModel: model });
  }

  async function startAutoGroup() {
    if (!globalSettings?.openRouter.apiKey) { setError('Connect OpenRouter before using AutoGroup.'); return; }
    if (!globalSettings.autoGroupModel) { setError('Choose an AutoGroup model first.'); return; }
    autoGroupController.current?.abort();
    const controller = new AbortController(); autoGroupController.current = controller;
    autoGroupStartedAt.current = Date.now(); setAutoGroupElapsed(0);
    setAutoGroupPhase('scanning'); setAutoGroupProgress(null); setAutoGroupPreview(null); setAutoGroupNotice(''); setError('');
    try {
      const scan = await chrome.runtime.sendMessage({ type: 'LEARNR_AUTOGROUP_SCAN' }) as { ok?: boolean; error?: string; tabs?: AutoGroupTabSummary[]; groups?: AutoGroupExistingGroup[]; skippedPinned?: number; skippedGrouped?: number };
      if (!scan?.ok) throw new Error(scan?.error || 'Could not scan browser tabs.');
      const tabs = scan.tabs ?? []; const groups = scan.groups ?? [];
      if (!tabs.length) {
        setAutoGroupNotice('There are no ungrouped, unpinned tabs to organize.');
        return;
      }
      setAutoGroupPhase('classifying');
      const workspaceId = globalSettings.activeWorkspaceId;
      const result = await classifyAutoGroupTabs({
        apiKey: globalSettings.openRouter.apiKey,
        model: globalSettings.autoGroupModel,
        tabs,
        groups,
        signal: controller.signal,
        onProgress: setAutoGroupProgress,
        onBatch: async (_completed, _total, usage) => {
          await recordUsageEvent({ provider: 'openrouter', model: globalSettings.autoGroupModel, operation: 'autogroup', usage, workspaceId });
        },
      });
      setAutoGroupPreview({ ...result, groups, skippedPinned: scan.skippedPinned ?? 0, skippedGrouped: scan.skippedGrouped ?? 0 });
      setAutoGroupQuery('');
    } catch (cause) {
      if (controller.signal.aborted) setAutoGroupNotice('AutoGroup classification was cancelled. No tabs were changed.');
      else setError(errorMessage(cause));
    } finally {
      if (autoGroupController.current === controller) autoGroupController.current = null;
      setAutoGroupPhase('idle');
    }
  }

  function cancelAutoGroup() {
    autoGroupController.current?.abort();
  }

  async function retryUnclassifiedAutoGroup() {
    if (!autoGroupPreview?.unclassified.length || !globalSettings?.openRouter.apiKey) return;
    autoGroupController.current?.abort();
    const controller = new AbortController(); autoGroupController.current = controller;
    autoGroupStartedAt.current = Date.now(); setAutoGroupElapsed(0); setAutoGroupPhase('classifying'); setError(''); setAutoGroupNotice('');
    const retryTabs = autoGroupPreview.unclassified.map((item) => item.tab);
    try {
      const result = await classifyAutoGroupTabs({
        apiKey: globalSettings.openRouter.apiKey, model: globalSettings.autoGroupModel, tabs: retryTabs, groups: autoGroupPreview.groups,
        signal: controller.signal, onProgress: setAutoGroupProgress,
        onBatch: async (_completed, _total, usage) => recordUsageEvent({ provider: 'openrouter', model: globalSettings.autoGroupModel, operation: 'autogroup', usage, workspaceId: globalSettings.activeWorkspaceId }),
      });
      setAutoGroupPreview((current) => current ? { ...current, assignments: [...current.assignments, ...result.assignments], unclassified: result.unclassified } : current);
    } catch (cause) {
      if (controller.signal.aborted) setAutoGroupNotice('AutoGroup retry was cancelled. No tabs were changed.');
      else setError(errorMessage(cause));
    } finally {
      if (autoGroupController.current === controller) autoGroupController.current = null;
      setAutoGroupPhase('idle');
    }
  }

  async function applyAutoGroup() {
    if (!autoGroupPreview || !autoGroupPreview.assignments.length) return;
    setAutoGroupPhase('applying'); setError(''); setAutoGroupNotice('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LEARNR_AUTOGROUP_APPLY', assignments: autoGroupPreview.assignments }) as { ok?: boolean; error?: string; refreshRequired?: boolean; result?: AutoGroupApplyResult };
      if (!response?.ok || !response.result) throw new Error(response?.error || 'Could not apply AutoGroup.');
      const result = response.result;
      setAutoGroupPreview(null); setAutoGroupQuery('');
      setAutoGroupNotice(`Grouped ${result.applied} tab${result.applied === 1 ? '' : 's'} across ${result.existingGroupsUsed} existing and ${result.newGroupsCreated} new group${result.newGroupsCreated === 1 ? '' : 's'}.${result.skipped ? ` Skipped ${result.skipped} changed tab${result.skipped === 1 ? '' : 's'}.` : ''}`);
      await refreshAutoGroupUndo();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setAutoGroupPhase('idle'); }
  }

  async function undoLastAutoGroup() {
    setAutoGroupPhase('undoing'); setError(''); setAutoGroupNotice('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LEARNR_AUTOGROUP_UNDO' }) as { ok?: boolean; count?: number; error?: string };
      if (!response?.ok) throw new Error(response?.error || 'Could not undo AutoGroup.');
      setAutoGroupNotice(`Returned ${response.count ?? 0} tab${response.count === 1 ? '' : 's'} to an ungrouped state.`);
      await refreshAutoGroupUndo();
    } catch (cause) { setError(errorMessage(cause)); await refreshAutoGroupUndo(); }
    finally { setAutoGroupPhase('idle'); }
  }

  async function findDuplicates() {
    setError(''); setAutoGroupNotice('Scanning tabs for exact URL matches…');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LEARNR_DUPLICATES_SCAN' }) as { ok?: boolean; sets?: DuplicateTabSet[]; error?: string };
      if (!response.ok) throw new Error(response.error || 'Could not scan duplicate tabs.');
      const sets = response.sets ?? []; const selected: Record<number, boolean> = {};
      for (const set of sets) for (const tab of set.tabs) selected[tab.id] = tab.id !== set.keeperId;
      setDuplicateSelection(selected); setDuplicateSets(sets); setDuplicateQuery(''); setAutoGroupNotice(sets.length ? '' : 'No exact duplicate URLs were found.');
    } catch (cause) { setError(errorMessage(cause)); setAutoGroupNotice(''); }
  }

  async function removeDuplicates() {
    if (!duplicateSets) return;
    const requests = duplicateSets.map((set) => ({ url: set.url, keeperId: set.keeperId, removeIds: set.tabs.filter((tab) => tab.id !== set.keeperId && duplicateSelection[tab.id]).map((tab) => tab.id) })).filter((request) => request.removeIds.length);
    setDuplicateRemoving(true); setError('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LEARNR_DUPLICATES_REMOVE', requests }) as { ok?: boolean; result?: DuplicateRemovalResult; error?: string };
      if (!response.ok || !response.result) throw new Error(response.error || 'Could not close duplicate tabs.');
      setDuplicateSets(null); setAutoGroupNotice(`Closed ${response.result.closed} duplicate tab${response.result.closed === 1 ? '' : 's'}${response.result.skipped ? `; skipped ${response.result.skipped} changed tab${response.result.skipped === 1 ? '' : 's'}` : ''}. Use ${BROWSER_NAME}’s recently closed tabs to recover them.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setDuplicateRemoving(false); }
  }

  async function persistProfiles(profiles: EmbeddingIndexProfile[]) {
    if (!globalSettings) return;
    const next = { ...globalSettings, embeddingProfiles: profiles };
    setGlobalSettings(next); await saveGlobalSettings(next);
  }

  async function saveGlobalPatch(patch: Partial<GlobalSettings>) {
    if (!globalSettings) return;
    const next = { ...globalSettings, ...patch };
    setGlobalSettings(next); await saveGlobalSettings(next);
  }

  function exportGlobalPreferences() {
    if (!globalSettings) return;
    downloadJson(createGlobalSettingsExport(globalSettings), settingsExportFilename('global'));
  }

  function exportWorkspacePreferences() {
    if (!selectedWorkspace) return;
    downloadJson(createWorkspaceSettingsExport(selectedWorkspace, settings), settingsExportFilename('workspace', selectedWorkspace.name));
  }

  function chooseSettingsImport(scope: 'global' | 'workspace') {
    settingsImportScopeRef.current = scope; settingsImportTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; settingsImportRef.current?.click();
  }

  async function readSettingsImport(file: File) {
    if (!file.name.toLocaleLowerCase().endsWith('.json') && file.type !== 'application/json') throw new Error('Choose a JSON settings file.');
    if (file.size > MAX_SETTINGS_FILE_BYTES) throw new Error('Settings files can be at most 1 MB.');
    const imported = parseSettingsExport(await file.text());
    if (imported.scope !== settingsImportScopeRef.current) throw new Error(`Choose a ${settingsImportScopeRef.current} settings export here.`);
    setSettingsImportPreview(imported); setError('');
  }

  async function applySettingsImport() {
    if (!settingsImportPreview || !globalSettings) return;
    setSettingsImportBusy(true); setError('');
    try {
      if (settingsImportPreview.scope === 'global') {
        const next = applyGlobalSettingsExport(globalSettings, settingsImportPreview);
        await saveGlobalSettings(next); setGlobalSettings(next);
      } else {
        const name = uniqueImportedWorkspaceName(settingsImportPreview.workspace.name, globalSettings.workspaces);
        const importedSettings = importedWorkspaceSettings(settingsImportPreview, globalSettings.openRouter);
        const workspace = await createWorkspaceWithSettings(name, settingsImportPreview.workspace.color, importedSettings);
        setSettingsTab(workspace.id); setSelectedWorkspaceId(workspace.id); setEditedSettings(importedSettings);
      }
      setSettingsImportPreview(null);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSettingsImportBusy(false); }
  }

  async function moveSettingsCard(scope: 'dashboard' | 'workspace' | 'app', id: string, direction: -1 | 1) {
    if (!globalSettings) return;
    const current = [...globalSettings.settingsCardOrder[scope]];
    const index = current.indexOf(id); const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    await saveGlobalPatch({ settingsCardOrder: { ...globalSettings.settingsCardOrder, [scope]: current } });
  }

  async function createWorkspaceLibrary() {
    if (!globalSettings) return;
    const name = newLibraryName.trim().slice(0, 80);
    if (!name) { setError('Name the embedding library before choosing a folder.'); return; }
    if (!newLibraryModel) { setError('Choose an embedding model before choosing a folder.'); return; }
    const id = crypto.randomUUID();
    try {
      // Keep the picker as the first asynchronous action so Chrome retains the click's user activation.
      const handle = await pickNoteLibrary(id);
      const taken = new Set(workspaceProfiles.map((profile) => profile.name.toLocaleLowerCase()));
      let uniqueName = name; let suffix = 2;
      while (taken.has(uniqueName.toLocaleLowerCase())) uniqueName = `${name} (${suffix++})`;
      const now = Date.now();
      const profile: EmbeddingIndexProfile = { id, workspaceId: selectedWorkspaceId, name: uniqueName, folderName: handle.name, model: newLibraryModel, autoUpdate: false, createdAt: now, updatedAt: now };
      await setNoteLibraryHandle(id, handle);
      await persistProfiles([...globalSettings.embeddingProfiles, profile]);
      setProfileStatuses((current) => ({ ...current, [id]: { state: 'empty', noteCount: 0, chunkCount: 0, skippedCount: 0 } }));
      setNewLibraryName(`${selectedWorkspace?.name ?? 'Workspace'} notes`);
      setError('');
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(errorMessage(cause)); }
  }

  async function toggleLibrary(profile: EmbeddingIndexProfile, enabled: boolean) {
    const ids = settings.savedNotes.enabledEmbeddingProfileIds;
    if (enabled && enabledModel && enabledModel !== profile.model) { setError(`Enabled libraries use ${enabledModel}. Rebuild “${profile.name}” with that model before enabling it.`); return; }
    const nextIds = enabled ? [...new Set([...ids, profile.id])] : ids.filter((id) => id !== profile.id);
    await update({ ...settings, savedNotes: { ...settings.savedNotes, embeddingModel: enabled ? profile.model : settings.savedNotes.embeddingModel, enabledEmbeddingProfileIds: nextIds, embeddingProfileId: '', searchInChat: nextIds.length ? settings.savedNotes.searchInChat : false } });
  }

  async function toggleSavedNoteSearch(enabled: boolean) {
    if (!enabled) { await update({ ...settings, savedNotes: { ...settings.savedNotes, searchInChat: false } }); return; }
    if (enabledReady) { await update({ ...settings, savedNotes: { ...settings.savedNotes, searchInChat: true } }); return; }
    const ready = workspaceProfiles.filter((profile) => { const status = profileStatuses[profile.id]; return status?.state === 'ready' && status.model === profile.model; });
    if (!ready.length) { setError('Build at least one embedding library before enabling saved-note search in Chat.'); return; }
    const model = ready[0].model;
    const compatibleIds = ready.filter((profile) => profile.model === model).map((profile) => profile.id);
    await update({ ...settings, savedNotes: { ...settings.savedNotes, embeddingModel: model, enabledEmbeddingProfileIds: compatibleIds, embeddingProfileId: '', searchInChat: true } });
    setError('');
  }

  async function changeProfileModel(profile: EmbeddingIndexProfile, model: string) {
    if (!globalSettings || model === profile.model) return;
    const status = profileStatuses[profile.id];
    if (status?.noteCount && !window.confirm('Changing the model requires rebuilding this library. Continue?')) return;
    if (settings.savedNotes.enabledEmbeddingProfileIds.includes(profile.id)) await toggleLibrary(profile, false);
    await persistProfiles(globalSettings.embeddingProfiles.map((item) => item.id === profile.id ? { ...item, model, dimensions: undefined, updatedAt: Date.now() } : item));
  }

  async function exportProfile(profile: EmbeddingIndexProfile) {
    if (!window.confirm('This backup contains your complete note text and derived vectors. Export it anyway?')) return;
    const blob = await createPortableIndex(profile); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${profile.name.replace(/[^a-z0-9._-]+/gi, '-') || 'learnr-index'}.learnr-index.gz`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function importProfile(file: File) {
    const portable = await readPortableIndex(file);
    const taken = new Set(globalSettings?.embeddingProfiles.map((profile) => profile.name.toLocaleLowerCase()) ?? []);
    let name = portable.profile.name; let suffix = 2;
    while (taken.has(name.toLocaleLowerCase())) name = `${portable.profile.name} (${suffix++})`;
    const profile: EmbeddingIndexProfile = { ...portable.profile, id: crypto.randomUUID(), workspaceId: selectedWorkspaceId, name, folderName: undefined, imported: true, autoUpdate: false, createdAt: Date.now(), updatedAt: Date.now() };
    await restorePortableIndex(profile.id, portable.index); await persistProfiles([...(globalSettings?.embeddingProfiles ?? []), profile]);
    setProfileStatuses((current) => ({ ...current, [profile.id]: portable.index.status }));
  }

  async function deleteEmbeddingProfile(profile: EmbeddingIndexProfile) {
    if (!globalSettings) return;
    if (!window.confirm(`Delete “${profile.name}” and its local vectors?`)) return;
    await Promise.all([deleteWorkspaceNoteIndex(profile.id), disconnectNoteLibrary(profile.id)]);
    if (settings.savedNotes.enabledEmbeddingProfileIds.includes(profile.id)) await update({ ...settings, savedNotes: { ...settings.savedNotes, enabledEmbeddingProfileIds: settings.savedNotes.enabledEmbeddingProfileIds.filter((id) => id !== profile.id), searchInChat: settings.savedNotes.enabledEmbeddingProfileIds.length > 1 ? settings.savedNotes.searchInChat : false } });
    await persistProfiles(globalSettings.embeddingProfiles.filter((item) => item.id !== profile.id));
  }

  async function clearEmbeddingIndex(profile: EmbeddingIndexProfile) {
    if (!window.confirm(`Clear every local vector in “${profile.name}”? The folder and model will remain configured so you can build it again.`)) return;
    await clearNoteIndex(profile.id);
    const enabledIds = settings.savedNotes.enabledEmbeddingProfileIds.filter((id) => id !== profile.id);
    if (enabledIds.length !== settings.savedNotes.enabledEmbeddingProfileIds.length) await update({ ...settings, savedNotes: { ...settings.savedNotes, enabledEmbeddingProfileIds: enabledIds, searchInChat: enabledIds.length ? settings.savedNotes.searchInChat : false } });
    setProfileStatuses((current) => ({ ...current, [profile.id]: { state: 'empty', noteCount: 0, chunkCount: 0, skippedCount: 0 } }));
    setError('');
  }

  async function chooseProfileFolder(profile: EmbeddingIndexProfile) {
    if (!globalSettings) return;
    const handle = await chooseNoteLibrary(profile.id);
    const next = { ...profile, folderName: handle.name, imported: false, updatedAt: Date.now() };
    await persistProfiles(globalSettings.embeddingProfiles.some((item) => item.id === next.id) ? globalSettings.embeddingProfiles.map((item) => item.id === next.id ? next : item) : [...globalSettings.embeddingProfiles, next]);
  }

  async function runProfileOperation(profile: EmbeddingIndexProfile, force: boolean) {
    if (!globalSettings?.openRouter.apiKey) throw new Error('Connect OpenRouter before building an embedding profile.');
    if (!profile.folderName) throw new Error('Link a source folder before building or refreshing this profile.');
    const controller = new AbortController(); profileOperationController.current = controller;
    setProfileOperation({ id: profile.id, completed: 0, total: 0, startedAt: Date.now() }); setError('');
    try {
      const result = await refreshNoteIndex({ provider: 'openrouter', apiKey: globalSettings.openRouter.apiKey, model: profile.model, profileId: profile.id, force, requestPermission: true, signal: controller.signal, onProgress: (completed, total) => setProfileOperation((current) => current?.id === profile.id ? { ...current, completed, total } : current) });
      setProfileStatuses((current) => ({ ...current, [profile.id]: result.status }));
      await persistProfiles(globalSettings.embeddingProfiles.map((item) => item.id === profile.id ? { ...item, dimensions: result.status.dimensions, updatedAt: Date.now() } : item));
      if (result.usage.requestCount) await recordUsageEvent({ provider: 'openrouter', model: profile.model, operation: 'embedding', usage: result.usage, workspaceId: profile.workspaceId, embeddingProfileId: profile.id });
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) throw cause; }
    finally { profileOperationController.current = null; setProfileOperation(null); }
  }

  const maskedKey = provider.apiKey ? `Saved · ••••${provider.apiKey.slice(-4)}` : 'No key saved';
  const selectedWorkspace = globalSettings?.workspaces.find((item) => item.id === selectedWorkspaceId);
  const workspaceScope = { 'data-workspace': selectedWorkspace?.name ?? 'Workspace' };
  const orderVariables = Object.fromEntries((['dashboard', 'workspace', 'app'] as const).flatMap((scope) => (globalSettings?.settingsCardOrder[scope] ?? SETTINGS_CARD_CATALOG[scope]).map((id, index) => [`--settings-order-${id}`, index])));
  const workspaceStyle = { '--workspace-color': selectedWorkspace?.color ?? '#1687ff', ...orderVariables } as CSSProperties;
  const scopedUsageEvents = usageEvents.filter((event) => (usageScope === 'all' || (event.workspaceId ?? 'default') === usageScope) && (usageOperation === 'all' || event.operation === 'embedding' || event.operation === 'saved-note-tool'));
  const autoGroupModels = globalSettings?.openRouter.availableModels.length ? globalSettings.openRouter.availableModels : models.openrouter;
  const autoGroupBusy = autoGroupPhase !== 'idle';
  const normalizedAutoGroupQuery = autoGroupQuery.trim().toLocaleLowerCase();
  const visibleAutoGroupAssignments = (autoGroupPreview?.assignments ?? []).filter((assignment) => {
    if (!normalizedAutoGroupQuery) return true;
    const destination = assignment.destination.kind === 'existing' ? assignment.destination.title : assignment.destination.category;
    return [assignment.tab.title, assignment.tab.hostname, assignment.tab.url, destination].some((value) => value.toLocaleLowerCase().includes(normalizedAutoGroupQuery));
  });
  const autoGroupSectionMap = new Map<string, { key: string; destination: string; kind: 'existing' | 'new'; windowId: number; assignments: AutoGroupAssignment[] }>();
  for (const assignment of visibleAutoGroupAssignments) {
    const destination = assignment.destination.kind === 'existing' ? assignment.destination.title : assignment.destination.category;
    const key = `${assignment.tab.windowId}:${assignment.destination.kind}:${assignment.destination.kind === 'existing' ? assignment.destination.groupId : destination}`;
    const section = autoGroupSectionMap.get(key) ?? { key, destination, kind: assignment.destination.kind, windowId: assignment.tab.windowId, assignments: [] };
    section.assignments.push(assignment); autoGroupSectionMap.set(key, section);
  }
  const autoGroupPreviewSections = [...autoGroupSectionMap.values()];
  const visibleDuplicateSets = (duplicateSets ?? []).filter((set) => !duplicateQuery.trim() || [set.url, ...set.tabs.map((tab) => `${tab.title} ${tab.groupTitle ?? ''}`)].some((value) => value.toLocaleLowerCase().includes(duplicateQuery.trim().toLocaleLowerCase())));
  const duplicateCloseCount = (duplicateSets ?? []).reduce((total, set) => total + set.tabs.filter((tab) => tab.id !== set.keeperId && duplicateSelection[tab.id]).length, 0);

  const tabKind = settingsTab === 'dashboard' ? 'dashboard' : settingsTab === 'docs' ? 'docs' : settingsTab === 'app' ? 'app' : 'workspace';
  return <main className={`settings-view tab-${tabKind}${fullPage ? ' full-page-settings' : ''}`} data-settings-tab={settingsTab} style={workspaceStyle}>
    <div className="section-heading settings-heading"><div><span className="eyebrow">Settings</span><h1>Make learnr yours.</h1></div>
      <div className="settings-heading-actions">
        <button className="icon-button open-settings-tab" title="Open chat history" aria-label="Open chat history" onClick={() => void openHistoryPage().catch((cause) => setError(errorMessage(cause)))}><Icon path={historyPath} size={19} /></button>
        {!fullPage && !embedded && <button className="icon-button open-settings-tab" title="Open full settings in a new tab" aria-label="Open full settings in a new tab" onClick={() => void openOptionsPage().catch((cause) => setError(errorMessage(cause)))}><Icon path={openTabPath} size={19} /></button>}
      </div>
    </div>
    <nav className="settings-tabs" aria-label="Settings sections"><button className={settingsTab === 'dashboard' ? 'active' : ''} onClick={() => setSettingsTab('dashboard')}>Dashboard</button>{globalSettings?.workspaces.map((workspace) => <button key={workspace.id} className={settingsTab === workspace.id ? 'active' : ''} style={{ '--tab-color': workspace.color } as CSSProperties} onClick={() => setSettingsTab(workspace.id)}><i />{workspace.name}</button>)}<button className={settingsTab === 'docs' ? 'active' : ''} onClick={() => setSettingsTab('docs')}>Docs</button><button className={settingsTab === 'app' ? 'active' : ''} onClick={() => setSettingsTab('app')}>App</button></nav>
    <input ref={settingsImportRef} hidden type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readSettingsImport(file).catch((cause) => setError(errorMessage(cause))); event.currentTarget.value = ''; }} />
    <section className="settings-section docs-only docs-card"><Markdown>{learnrDocs}</Markdown></section>
    <JourneyStats stats={lifetimeStats} />
    {tabKind === 'workspace' && selectedWorkspace && <section {...workspaceScope} className="settings-section workspace-scoped workspace-tab-summary"><div className="workspace-summary-title"><h2>{selectedWorkspace.name}</h2><p className="settings-copy">Editing this workspace does not change the workspace used by chat.</p></div><div className="workspace-summary-actions"><button className="primary" disabled={selectedWorkspace.id === globalSettings?.activeWorkspaceId} onClick={() => void setActiveWorkspace(selectedWorkspace.id).then(() => onWorkspaceSwitch?.(selectedWorkspace.id)).catch((cause) => setError(errorMessage(cause)))}>{selectedWorkspace.id === globalSettings?.activeWorkspaceId ? 'Active workspace' : 'Activate workspace'}</button><label className="workspace-color-setting"><span>Color</span><input type="color" value={selectedWorkspace.color} onChange={(event) => void setWorkspaceColor(selectedWorkspace.id, event.target.value).catch((cause) => setError(errorMessage(cause)))} /></label></div></section>}
    <section className="settings-section workspace-settings-section dashboard-only">
      <div className="settings-section-title"><div><h2>Workspaces</h2><p className="settings-copy">Prompts, models, tools, folders, history, indexes, usage, and appearance are independent. Your OpenRouter connection is shared.</p></div><span className="stats-icon">◫</span></div>
      {globalSettings && <div className="workspace-manage-list">{globalSettings.workspaces.map((workspace) => <div key={workspace.id}><i style={{ background: workspace.color }} /><strong>{workspace.name}</strong>{workspace.id === globalSettings.activeWorkspaceId && <small>Active</small>}<button className="ghost" onClick={() => setSettingsTab(workspace.id)}>Edit</button><button className="secondary" disabled={workspace.id === globalSettings.activeWorkspaceId} onClick={() => void setActiveWorkspace(workspace.id).then(() => onWorkspaceSwitch?.(workspace.id)).catch((cause) => setError(errorMessage(cause)))}>Activate</button></div>)}</div>}
      {globalSettings && <div className="settings-button-row wrap"><button className="secondary" onClick={() => { const name = window.prompt('Name this workspace'); if (name == null) return; void createWorkspace(name, false).then((workspace) => setSettingsTab(workspace.id)).catch((cause) => setError(errorMessage(cause))); }}>New workspace</button><button className="secondary" onClick={() => chooseSettingsImport('workspace')}>Import workspace settings</button><button className="secondary" onClick={() => { const activeWorkspace = globalSettings.workspaces.find((item) => item.id === globalSettings.activeWorkspaceId); if (!activeWorkspace) return; const name = window.prompt('Rename workspace', activeWorkspace.name); if (name == null) return; void renameWorkspace(activeWorkspace.id, name).catch((cause) => setError(errorMessage(cause))); }}>Rename</button><button className="danger" disabled={globalSettings.workspaces.length <= 1} onClick={() => { const activeWorkspace = globalSettings.workspaces.find((item) => item.id === globalSettings.activeWorkspaceId); if (!activeWorkspace || !window.confirm(`Delete “${activeWorkspace.name}” and its local chats, settings, indexes, and statistics? Saved note files will not be deleted.`)) return; void deleteWorkspace(activeWorkspace.id).then(async (next) => { await onWorkspaceSwitch?.(next.activeWorkspaceId); }).catch((cause) => setError(errorMessage(cause))); }}>Delete workspace</button></div>}
      <p className="fine-print">Workspace definitions stay local to this browser profile. Arc Spaces are not exposed to extensions, so choose the workspace manually before starting work.</p>
    </section>
    <section className="settings-section dashboard-only openrouter-card">
      <h2>OpenRouter connection</h2>
      <p className="settings-copy">One OpenRouter API key powers every learnr operation. Provider keys configured through OpenRouter BYOK are used automatically by OpenRouter routing.</p>
      <label>OpenRouter API key<div className="key-field"><input type="password" autoComplete="off" value={keys.openrouter} placeholder={maskedKey} onChange={(event) => setKeys({ ...keys, openrouter: event.target.value })} />{provider.apiKey && <button title="Delete saved key" onClick={() => void update(patchProvider('openrouter', { apiKey: '', connectionStatus: 'untested' }))}>Delete</button>}</div></label>
      <div className={`connection ${provider.connectionStatus}`}><span />{provider.connectionStatus === 'connected' ? 'Connection verified' : provider.connectionStatus === 'failed' ? 'Connection failed' : 'Connection not tested'}</div>
      <button className="secondary full" disabled={testing} onClick={() => void testConnection()}>{testing ? 'Testing…' : provider.apiKey ? 'Test or replace key' : 'Test connection & save'}</button>
      {loadingModels && <p className="fine-print">Refreshing available models…</p>}
      <p className="fine-print">The OpenRouter key stays in this browser’s local extension storage. learnr never stores or receives the upstream provider keys configured in your OpenRouter account.</p>
    </section>
    <section className="settings-section dashboard-only autogroup-card">
      <div className="settings-section-title"><div><h2>AutoGroup</h2><p className="settings-copy">Organize every ungrouped, unpinned browser tab into fine-grained topics.</p></div><span className="stats-icon">▦</span></div>
      <label>OpenRouter model<SearchableModelSelect value={globalSettings?.autoGroupModel ?? 'openai/gpt-5-mini'} options={autoGroupModels} disabled={BROWSER_TARGET === 'arc' || autoGroupBusy || !autoGroupModels.length} onChange={(model) => void saveAutoGroupModel(model).catch((cause) => setError(errorMessage(cause)))} placeholder={loadingModels ? 'Loading models…' : 'Connect OpenRouter first'} /></label>
      <ModelDetails model={globalSettings?.autoGroupModel ?? 'openai/gpt-5-mini'} catalog={globalSettings?.openRouter.modelCatalog} />
      <p className="fine-print">AutoGroup sends only tab titles and URL origins/paths. Credentials, queries, fragments, and webpage contents are never sent. Existing named groups may receive suitable tabs; <strong>SYNC</strong> is always reserved.</p>
      {autoGroupPhase === 'scanning' && <div className="autogroup-progress" role="status"><strong>Scanning browser windows and tabs…</strong><small>{Math.floor(autoGroupElapsed / 1000)}s elapsed</small><span className="autogroup-progress-track indeterminate"><i /></span></div>}
      {autoGroupPhase === 'classifying' && autoGroupProgress && <div className="autogroup-progress" role="status"><strong>{autoGroupProgress.phase === 'retrying' ? 'Retrying a smaller batch' : 'Waiting for AutoGroup model'} · batch {autoGroupProgress.batch} of {autoGroupProgress.totalBatches}</strong><small>{autoGroupProgress.completedTabs} of {autoGroupProgress.totalTabs} tabs completed · {Math.floor(autoGroupElapsed / 1000)}s elapsed</small><span className="autogroup-progress-track"><i style={{ width: `${autoGroupProgress.totalTabs ? autoGroupProgress.completedTabs / autoGroupProgress.totalTabs * 100 : 0}%` }} /></span></div>}
      {autoGroupNotice && <div className="notice success autogroup-notice">{autoGroupNotice}</div>}
      <div className="settings-button-row wrap">
        <button className="primary" disabled={BROWSER_TARGET === 'arc' || autoGroupBusy || !globalSettings?.openRouter.apiKey || !globalSettings?.autoGroupModel} onClick={() => void startAutoGroup()}>{autoGroupPhase === 'scanning' ? 'Scanning…' : autoGroupPhase === 'classifying' ? 'Classifying…' : 'AutoGroup tabs'}</button>
        <button className="secondary" disabled={autoGroupBusy} onClick={() => void findDuplicates()}>Find duplicate tabs</button>
        {(autoGroupPhase === 'scanning' || autoGroupPhase === 'classifying') && <button className="secondary" onClick={cancelAutoGroup}>Cancel</button>}
        <button className="secondary" disabled={autoGroupBusy || !autoGroupUndo.available} title={autoGroupUndo.reason} onClick={() => void undoLastAutoGroup()}>{autoGroupPhase === 'undoing' ? 'Undoing…' : 'Undo last AutoGroup'}</button>
      </div>
      {!globalSettings?.openRouter.apiKey && <p className="fine-print">Connect OpenRouter above to enable AutoGroup.</p>}
      {BROWSER_TARGET === 'arc' && <p className="fine-print">AutoGroup is unavailable in the Arc build because Arc does not implement Chromium tab groups. Duplicate-tab detection remains available.</p>}
      {!autoGroupUndo.available && <p className="fine-print">{autoGroupUndo.reason}</p>}
    </section>
    <section {...workspaceScope} className="settings-section workspace-scoped workspace-portability-card">
      <h2>Workspace settings portability</h2>
      <p className="settings-copy">Export this workspace’s models, prompts, toggles, budgets, and display preferences. Importing always creates a new inactive workspace.</p>
      <div className="settings-button-row wrap"><button className="secondary" onClick={exportWorkspacePreferences}>Export workspace settings</button><button className="secondary" onClick={() => chooseSettingsImport('workspace')}>Import as new workspace</button></div>
      <p className="fine-print">API keys, chats, usage, drafts, folder permissions, note files, and embedding indexes are never included. Exported prompts may contain personal information.</p>
    </section>
    <section {...workspaceScope} className="settings-section workspace-scoped appearance-card">
      <h2>Appearance</h2>
      <div className="theme-options">{([
        ['website', 'Website'], ['system', 'System'], ['light', 'Light'], ['dark', 'Dark'],
      ] as Array<[ThemeMode, string]>).map(([mode, label]) => <button className={settings.themeMode === mode ? 'active' : ''} key={mode} onClick={() => void update({ ...settings, themeMode: mode })}>{label}</button>)}</div>
      <p className="fine-print">Website mode follows the active page and falls back to your system appearance.</p>
      <label className="toggle-row"><span><strong>Follow the active browser tab</strong><small>When learnr is open, restore the latest chat for each page you switch to—or start a fresh chat when none exists.</small></span><input type="checkbox" checked={settings.autoFollowActiveTab} onChange={(event) => void update({ ...settings, autoFollowActiveTab: event.target.checked })} /></label>
      <label className="toggle-row"><span><strong>Activate source tab when selecting a conversation</strong><small>Off by default. History and recent-chat selections otherwise change only the learnr panel.</small></span><input type="checkbox" checked={settings.activateSourceTabOnConversationSelect} onChange={(event) => void update({ ...settings, activateSourceTabOnConversationSelect: event.target.checked })} /></label>
    </section>
    <section className={`settings-section shortcuts-section dashboard-only${globalSettings?.keyboardShortcutsEnabled === false ? ' feature-disabled' : ''}`}>
      <div className="settings-section-title"><div><h2>Keyboard shortcuts</h2><p className="settings-copy">Launch learnr or create a draft without leaving the keyboard.</p></div><label className="feature-toggle" title="Toggle keyboard shortcuts"><input aria-label="Keyboard shortcuts" type="checkbox" checked={globalSettings?.keyboardShortcutsEnabled ?? true} onChange={(event) => globalSettings && void saveGlobalSettings({ ...globalSettings, keyboardShortcutsEnabled: event.target.checked })} /></label></div>
      <dl className="shortcut-list">
        <div><dt>Open learnr</dt><dd>{loadingShortcuts ? 'Loading…' : displayShortcut(shortcuts[LAUNCH_COMMAND])}</dd></div>
        <div><dt>Create draft</dt><dd>{loadingShortcuts ? 'Loading…' : displayShortcut(shortcuts[CREATE_DRAFT_COMMAND])}</dd></div>
        <div><dt>New connected tab</dt><dd>{loadingShortcuts ? 'Loading…' : displayShortcut(shortcuts[OPEN_CONNECTED_TAB_COMMAND])}</dd></div>
        <div><dt>Select suggestion 1</dt><dd>⌃1</dd></div>
        <div><dt>Select suggestion 2</dt><dd>⌃2</dd></div>
        <div><dt>Select suggestion 3</dt><dd>⌃3</dd></div>
        <div><dt>Create note from chat</dt><dd>⌘↵</dd></div>
      </dl>
      <button className="secondary full" onClick={() => void openShortcutManager().catch((cause) => setError(`Could not open ${BROWSER_NAME} extension shortcuts: ${errorMessage(cause)}`))}>Change shortcuts</button>
      <p className="fine-print">{BROWSER_NAME} manages the global extension shortcuts. The Control-number suggestion shortcuts and Command-Return work locally while learnr is focused and are not remapped by the browser.</p>
    </section>
    <section className={`settings-section slash-command-section dashboard-only${globalSettings?.slashCommandsEnabled === false ? ' feature-disabled' : ''}`}>
      <div className="settings-section-title"><div><h2>Slash commands</h2><p className="settings-copy">Type these commands in the composer. Microphone dictation remains available from the mic button.</p></div><label className="feature-toggle" title="Toggle slash commands"><input aria-label="Slash commands" type="checkbox" checked={globalSettings?.slashCommandsEnabled ?? true} onChange={(event) => globalSettings && void saveGlobalSettings({ ...globalSettings, slashCommandsEnabled: event.target.checked })} /></label></div>
      <div className="slash-command-list">{SLASH_COMMANDS.map((command) => <article key={command.command}><div><code>{command.command}</code><span>{command.providerCall ? 'Uses AI' : 'Local action'}</span></div><p>{command.summary}</p><small>{command.requirement}</small></article>)}</div>
    </section>
    <section {...workspaceScope} className="settings-section workspace-scoped saved-notes-card">
      <div className="settings-section-title"><div><h2>Saved-note library</h2><p className="settings-copy">Keep note storage, image downloads, and the private semantic index in one place.</p></div><span className="stats-icon">▤</span></div>
      {vaultName && <div className="folder-path"><span>Note save folder</span><strong title={vaultName}>{vaultName}</strong></div>}
      <button className="secondary full" onClick={() => void chooseVault(selectedWorkspaceId).then((handle) => { setVaultName(handle.name); if (usesNotesFolderForImages) setImageFolderName(handle.name); }).catch((cause) => setError(errorMessage(cause)))}>{vaultName ? 'Change note save folder' : 'Set note save folder'}</button>
      <div className="image-folder-setting">
        <h3>Image download folder</h3>
        {imageFolderName && <div className="folder-path"><span>{usesNotesFolderForImages ? 'Using note save folder' : 'Selected image folder'}</span><strong title={imageFolderName}>{imageFolderName}</strong></div>}
        <button className="secondary full" onClick={() => void chooseImageFolder(selectedWorkspaceId).then((handle) => { setImageFolderName(handle.name); setUsesNotesFolderForImages(false); }).catch((cause) => setError(errorMessage(cause)))}>{usesNotesFolderForImages ? 'Set separate image folder' : 'Change image folder'}</button>
        {!usesNotesFolderForImages && <button className="ghost full" onClick={() => void useNotesFolderForImages(selectedWorkspaceId).then(() => { setImageFolderName(vaultName); setUsesNotesFolderForImages(true); }).catch((cause) => setError(errorMessage(cause)))}>Use note save folder</button>}
        <p className="fine-print">For basename-only Obsidian embeds to resolve, choose a folder inside the same Obsidian vault as your notes.</p>
      </div>
      <label className="toggle-row"><span><strong>Add Zettelkasten timestamp to filenames</strong><small>Prefix new drafts with the local creation time.</small></span><input type="checkbox" checked={settings.zettelkastenFilenames} onChange={(event) => void update({ ...settings, zettelkastenFilenames: event.target.checked })} /></label>
      <div className="tool-divider" />
      <h3>Semantic search</h3>
      <p className="settings-copy">Libraries belong only to this workspace. Choosing a folder is passive; Learnr contacts OpenRouter only after you explicitly build or refresh.</p>
      <div className="embedding-profile-list workspace-library-list">{workspaceProfiles.map((profile) => {
        const status = profileStatuses[profile.id] ?? { state: 'empty', noteCount: 0, chunkCount: 0, skippedCount: 0 };
        const enabled = settings.savedNotes.enabledEmbeddingProfileIds.includes(profile.id);
        const incompatible = Boolean(!enabled && enabledModel && enabledModel !== profile.model);
        const builtForSelectedModel = status.state === 'ready' && status.model === profile.model;
        const profileUsage = aggregateUsageEvents(usageEvents.filter((event) => event.embeddingProfileId === profile.id || event.embeddingProfileIds?.includes(profile.id)), 'all');
        const busy = profileOperation?.id === profile.id;
        return <article key={profile.id}><div className="embedding-profile-heading"><div><strong>{profile.name}</strong><small>{profile.folderName ?? 'Source folder not linked'} · {profile.model}</small></div><span className={`profile-status ${status.state}`}>{status.state}</span></div>
          <label className="toggle-row compact"><span><strong>Use for semantic search</strong><small>{!builtForSelectedModel ? 'Build or rebuild this library with its selected model first.' : incompatible ? `Enabled libraries use ${enabledModel}.` : 'Search this index alongside the other enabled libraries.'}</small></span><input type="checkbox" checked={enabled} disabled={!builtForSelectedModel || incompatible || Boolean(profileOperation)} onChange={(event) => void toggleLibrary(profile, event.target.checked)} /></label>
          <div className="embedding-profile-metrics"><span>{status.noteCount} notes</span><span>{status.chunkCount} chunks</span>{(profile.dimensions ?? status.dimensions) && <span>{profile.dimensions ?? status.dimensions} dimensions</span>}<span>{profileUsage.requestCount} requests</span><span>{profileUsage.tokensReported ? `${formatTokenCount(profileUsage.totalTokens)} tokens` : 'tokens unavailable'}</span><span>{profileUsage.costReported ? `${formatCost(profileUsage.costUsd)} cost` : 'cost unavailable'}</span></div>
          {status.lastRefreshedAt && <p className="fine-print">Refreshed {new Date(status.lastRefreshedAt).toLocaleString()} · {status.skippedCount} skipped</p>}
          {busy && <div className="index-status indexing" role="status"><strong>{profileOperation.total ? `Embedding ${profileOperation.completed} of ${profileOperation.total} changed chunks` : 'Scanning notes for changes…'}</strong><small>{Math.floor((profileOperationClock - profileOperation.startedAt) / 1000)}s elapsed</small></div>}
          <label>Embedding model<SearchableModelSelect value={profile.model} options={embeddingModels} disabled={Boolean(profileOperation) || !embeddingModels.length} onChange={(model) => void changeProfileModel(profile, model)} placeholder={settings.providers.openrouter.apiKey ? 'Loading embedding models…' : 'Connect OpenRouter first'} /></label><ModelDetails model={profile.model} catalog={settings.providers.openrouter.modelCatalog} />
          <label className="toggle-row compact"><span><strong>Auto-update</strong><small>Refresh after note saves and when stale for six hours.</small></span><input type="checkbox" disabled={!profile.folderName || Boolean(profileOperation)} checked={profile.autoUpdate} onChange={(event) => void persistProfiles((globalSettings?.embeddingProfiles ?? []).map((item) => item.id === profile.id ? { ...item, autoUpdate: event.target.checked, updatedAt: Date.now() } : item))} /></label>
          <div className="settings-button-row wrap"><button className="secondary" disabled={Boolean(profileOperation)} onClick={() => void chooseProfileFolder(profile).catch((cause) => setError(errorMessage(cause)))}>{profile.folderName ? 'Relink folder' : 'Link folder'}</button>{status.state === 'empty' && <button className="primary" disabled={Boolean(profileOperation) || !profile.folderName} onClick={() => void runProfileOperation(profile, false).catch((cause) => setError(errorMessage(cause)))}>Build index</button>}<button className="secondary" disabled={Boolean(profileOperation) || !profile.folderName || status.state === 'empty'} onClick={() => void runProfileOperation(profile, false).catch((cause) => setError(errorMessage(cause)))}>Refresh changes</button><button className="secondary" disabled={Boolean(profileOperation) || !profile.folderName} onClick={() => { if (window.confirm(`Re-embed every note in “${profile.name}”?`)) void runProfileOperation(profile, true).catch((cause) => setError(errorMessage(cause))); }}>Rebuild all</button>{busy && <button className="danger" onClick={() => profileOperationController.current?.abort()}>Cancel</button>}<button className="secondary" disabled={Boolean(profileOperation)} onClick={() => { const name = window.prompt('Rename embedding library', profile.name); if (name?.trim()) void persistProfiles((globalSettings?.embeddingProfiles ?? []).map((item) => item.id === profile.id ? { ...item, name: name.trim().slice(0, 80), updatedAt: Date.now() } : item)); }}>Rename</button><button className="secondary" disabled={Boolean(profileOperation) || status.state === 'empty'} onClick={() => void exportProfile(profile).catch((cause) => setError(errorMessage(cause)))}>Export index</button><button className="danger" disabled={Boolean(profileOperation) || status.state === 'empty'} onClick={() => void clearEmbeddingIndex(profile).catch((cause) => setError(errorMessage(cause)))}>Clear index</button><button className="danger" disabled={Boolean(profileOperation)} onClick={() => void deleteEmbeddingProfile(profile).catch((cause) => setError(errorMessage(cause)))}>Delete library</button></div>
        </article>;
      })}{!workspaceProfiles.length && <p className="empty-state">No embedding libraries in this workspace yet.</p>}</div>
      <div className="new-library-card"><h4>New embedding library</h4><label>Library name<input value={newLibraryName} maxLength={80} onChange={(event) => setNewLibraryName(event.target.value)} /></label><label>Embedding model<SearchableModelSelect value={newLibraryModel} options={embeddingModels} disabled={!embeddingModels.length || Boolean(profileOperation)} onChange={setNewLibraryModel} placeholder={settings.providers.openrouter.apiKey ? 'Loading embedding models…' : 'Connect OpenRouter first'} /></label><ModelDetails model={newLibraryModel} catalog={settings.providers.openrouter.modelCatalog} /><button className="primary full" disabled={!newLibraryName.trim() || !newLibraryModel || Boolean(profileOperation)} onClick={() => void createWorkspaceLibrary()}>Choose source folder</button><p className="fine-print">Selecting the folder creates an unbuilt library. Use its explicit Build index button when you are ready.</p></div>
      <input ref={importIndexRef} hidden type="file" accept=".gz,.learnr-index.gz,application/gzip,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProfile(file).catch((cause) => setError(errorMessage(cause))); event.currentTarget.value = ''; }} />
      <button className="secondary full" disabled={Boolean(profileOperation)} onClick={() => importIndexRef.current?.click()}>Import .learnr-index.gz</button>
      <p className="fine-print"><strong>Refresh changes</strong> embeds only new or modified notes, reuses unchanged vectors, and removes deleted notes. External filesystem changes require Refresh unless Auto-update runs after a Learnr save or when stale.</p>
      <p className="fine-print">Full Markdown and vectors stay in this browser. Note text is sent only for embedding and when a note-search tool returns a relevant excerpt. Hidden folders are skipped.</p>
    </section>
    <section className="settings-section dashboard-only usage-dashboard-section"><div className="settings-section-title"><div><h2>Usage</h2><p className="settings-copy">Exact usage reported by OpenRouter for requests made by learnr.</p></div><div className="usage-filters"><select aria-label="Usage operation" value={usageOperation} onChange={(event) => setUsageOperation(event.target.value as 'all' | 'embeddings')}><option value="all">All operations</option><option value="embeddings">Embeddings</option></select><select aria-label="Usage workspace" value={usageScope} onChange={(event) => setUsageScope(event.target.value)}><option value="all">All workspaces</option>{globalSettings?.workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select><select aria-label="Usage range" value={usageWindow} onChange={(event) => setUsageWindow(event.target.value as UsageWindow)}>{USAGE_WINDOWS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></div><UsageDashboard events={scopedUsageEvents} window={usageWindow} /></section>
    <section {...workspaceScope} className="settings-section workspace-scoped usage-display-card">
      <h2>Usage display and warnings</h2>
      <p className="settings-copy">Choose where exact reported usage is shown and when this workspace should warn about token volume.</p>
      <label className="toggle-row"><span><strong>Show stats below chat replies</strong><small>Display model, total tokens, cost, and output tokens per second for replies and PDF extraction.</small></span><input type="checkbox" checked={settings.showChatReplyStats} onChange={(event) => void update({ ...settings, showChatReplyStats: event.target.checked })} /></label>
      <label className="toggle-row"><span><strong>Show stats in draft editor</strong><small>Display model, total tokens, cost, and output tokens per second for generated notes.</small></span><input type="checkbox" checked={settings.showDraftStats} onChange={(event) => void update({ ...settings, showDraftStats: event.target.checked })} /></label>
      <div className="tool-divider" />
      <label className="toggle-row"><span><strong>Token usage warnings</strong><small>Show warning thresholds without blocking requests.</small></span><input type="checkbox" checked={settings.usageWarningsEnabled} onChange={(event) => void update({ ...settings, usageWarningsEnabled: event.target.checked })} /></label>
      {settings.usageWarningsEnabled && <>
        <label>Conversation warning threshold<input type="number" min="0" step="1000" value={settings.tokenWarnings.conversationTokens} onChange={(event) => void update({ ...settings, tokenWarnings: { ...settings.tokenWarnings, conversationTokens: Math.max(0, Number(event.target.value) || 0) } })} /></label>
        <label>Global warning threshold<input type="number" min="0" step="1000" value={settings.tokenWarnings.globalTokens} onChange={(event) => void update({ ...settings, tokenWarnings: { ...settings.tokenWarnings, globalTokens: Math.max(0, Number(event.target.value) || 0) } })} /></label>
        <label>Global reset period<select value={settings.tokenWarnings.globalPeriod} onChange={(event) => void changeWarningPeriod(event.target.value as TokenWarningPeriod)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
        <div className="usage-progress"><strong>{formatTokenCount(globalUsage?.tokens ?? 0)} tokens this {settings.tokenWarnings.globalPeriod}</strong>{globalUsage && <small>Resets {new Date(globalUsage.endsAt).toLocaleString()}</small>}</div>
        <div className="settings-button-row"><button className="secondary" onClick={() => void resetWarningThresholds()}>Reset thresholds</button><button className="secondary" onClick={() => void resetUsage()}>Reset current usage</button></div>
        <p className="fine-print">Set either threshold to 0 to disable it. Resetting current usage starts the counter again for the active period. Warnings never block requests.</p>
      </>}
    </section>
    <section {...workspaceScope} className="settings-section workspace-scoped chat-stage-card">
      <h2>Chat stage</h2>
      <label>OpenRouter model<SearchableModelSelect value={settings.aiRoles.chat.model} options={models.openrouter} onChange={(model) => patchRole('chat', { model })} /></label>
      <ModelDetails model={settings.aiRoles.chat.model} catalog={settings.providers.openrouter.modelCatalog} />
      <label>Maximum connected-source context (tokens)<input type="number" list="source-context-budget-options" min="32000" max="2048000" step="32000" value={settings.sourceContextBudgetTokens} onChange={(event) => { const value = Math.min(2_048_000, Math.max(32_000, Math.round((Number(event.target.value) || 32_000) / 32_000) * 32_000)); void update({ ...settings, sourceContextBudgetTokens: value }); }} /><datalist id="source-context-budget-options">{[32_000,64_000,128_000,256_000,512_000,1_024_000,2_048_000].map((value) => <option value={value} key={value}>{value.toLocaleString()} tokens</option>)}</datalist></label>
      <p className="fine-print">Learnr may use less when this model has a smaller context window. Pre-request counts are projected tokens; completed usage remains exact.</p>
      <p className="settings-copy">This template becomes the complete chat instruction sent with each page.</p>
      <textarea className="prompt-editor" value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} spellCheck={false} />
      <p className="fine-print">Available placeholders: {SYSTEM_PROMPT_PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ')}</p>
      <div className="settings-button-row"><button className="secondary" onClick={() => void resetPrompt()}>Reset to default</button><button className="primary" onClick={() => void savePrompt()}>Save prompt</button></div>
      <div className="stage-capabilities">
        <h3>Chat capabilities</h3>
        <label className="toggle-row"><span><strong>Web search</strong><small>Let the selected model search when a chat question needs current information. Search is never enabled for draft generation.</small></span><input type="checkbox" checked={settings.webSearchEnabled} onChange={(event) => void update({ ...settings, webSearchEnabled: event.target.checked })} /></label>
        <label className="toggle-row"><span><strong>Web fetch</strong><small>Let Chat read a known URL, supplied link, search result, webpage, or PDF in greater depth. Off by default.</small></span><input type="checkbox" checked={settings.webFetchEnabled} onChange={(event) => void update({ ...settings, webFetchEnabled: event.target.checked })} /></label>
        <p className="fine-print">Search discovers sources; fetch reads a specific source. When both are enabled the model may search and then fetch a useful result.</p>
        <label className="toggle-row"><span><strong>Search saved notes in chat</strong><small>Offer private note-search tools across every enabled library. If necessary, enabling this also enables compatible ready libraries.</small></span><input type="checkbox" checked={settings.savedNotes.searchInChat} onChange={(event) => void toggleSavedNoteSearch(event.target.checked).catch((cause) => setError(errorMessage(cause)))} /></label>
        {!enabledReady && <p className="fine-print">Build at least one workspace embedding library. Learnr will enable compatible ready libraries when you turn this on.</p>}
        <label className="toggle-row"><span><strong>Allow the Draft model to read /note content</strong><small>Off by default. Your /note text is always appended unchanged to My Notes; enable this only when the AI synthesis should also use it as context.</small></span><input type="checkbox" checked={settings.allowNoteInDraftContext} onChange={(event) => void update({ ...settings, allowNoteInDraftContext: event.target.checked })} /></label>
        <div className={`feature-panel${settings.microphoneDictationEnabled ? '' : ' feature-disabled'}`}>
          <div className="settings-section-title"><div><h3>Microphone dictation</h3><p className="settings-copy">Record up to 60 seconds and insert the transcript at the composer cursor without sending it.</p></div><label className="feature-toggle" title="Toggle microphone dictation"><input aria-label="Microphone dictation" type="checkbox" checked={settings.microphoneDictationEnabled} onChange={(event) => void update({ ...settings, microphoneDictationEnabled: event.target.checked })} /></label></div>
          {!settings.providers.openrouter.apiKey ? <p className="fine-print">Save your OpenRouter key on the Dashboard to enable dictation.</p> : <><label>Transcription model<SearchableModelSelect value={settings.aiRoles.transcription.model} options={transcriptionModels} disabled={loadingTranscriptionModels || !transcriptionModels.length} onChange={(model) => patchRole('transcription', { model })} placeholder={loadingTranscriptionModels ? 'Loading transcription models…' : 'No transcription models found'} /></label><ModelDetails model={settings.aiRoles.transcription.model} catalog={settings.providers.openrouter.modelCatalog} /><button className="secondary full" disabled={loadingTranscriptionModels} onClick={() => { setLoadingTranscriptionModels(true); void getProvider('openrouter').listTranscriptionModels?.(settings.providers.openrouter.apiKey).then((available) => setTranscriptionModels(available ?? [])).catch((cause) => setError(errorMessage(cause))).finally(() => setLoadingTranscriptionModels(false)); }}>{loadingTranscriptionModels ? 'Refreshing…' : 'Refresh transcription models'}</button><p className="fine-print">Audio is sent to OpenRouter only after recording stops and is not retained in learnr history.</p></>}
        </div>
        <div className={`feature-panel${settings.chatSuggestionsEnabled ? '' : ' feature-disabled'}`}>
          <div className="settings-section-title"><div><h3>Chat suggestions</h3><p className="settings-copy">Customize the three prompts shown at the start of a new conversation.</p></div><label className="feature-toggle" title="Toggle chat suggestions"><input aria-label="Chat suggestions" type="checkbox" checked={settings.chatSuggestionsEnabled} onChange={(event) => void update({ ...settings, chatSuggestionsEnabled: event.target.checked })} /></label></div>
          {suggestionDrafts.map((value, index) => <label key={index}>Suggestion {index + 1}<input value={value} maxLength={160} onChange={(event) => setSuggestionDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as [string, string, string])} /></label>)}
          <div className="settings-button-row"><button className="secondary" onClick={() => void resetSuggestions()}>Reset to default</button><button className="primary" onClick={() => void saveSuggestions()}>Save suggestions</button></div>
        </div>
      </div>
    </section>
    <section {...workspaceScope} className="settings-section workspace-scoped draft-stage-card">
      <h2>Draft-note stage</h2>
      <label>OpenRouter model<SearchableModelSelect value={settings.aiRoles.drafting.model} options={models.openrouter} onChange={(model) => patchRole('drafting', { model })} /></label>
      <ModelDetails model={settings.aiRoles.drafting.model} catalog={settings.providers.openrouter.modelCatalog} />
      <p className="settings-copy">This template becomes the complete instruction used to generate an editable Markdown note.</p>
      <textarea className="prompt-editor" value={notePromptDraft} onChange={(event) => setNotePromptDraft(event.target.value)} spellCheck={false} />
      <p className="fine-print">Available placeholders: {NOTE_PROMPT_PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ')}</p>
      <div className="settings-button-row"><button className="secondary" onClick={() => void resetNotePrompt()}>Reset to default</button><button className="primary" onClick={() => void saveNotePrompt()}>Save prompt</button></div>
      <label className="toggle-row"><span><strong>Keep saved drafts in Editor</strong><small>Return to the latest draft for this conversation after visiting Chat. Use the plus button when you want a new atomic note.</small></span><input type="checkbox" checked={settings.keepSavedDraftsInEditor} onChange={(event) => void update({ ...settings, keepSavedDraftsInEditor: event.target.checked })} /></label>
    </section>
    <section {...workspaceScope} className={`settings-section workspace-scoped pdf-stage-card${settings.pdfExtractionEnabled ? '' : ' feature-disabled'}`}>
      <div className="settings-section-title"><div><h2>PDF extraction stage</h2></div><label className="feature-toggle" title="Toggle PDF extraction"><input aria-label="PDF extraction" type="checkbox" checked={settings.pdfExtractionEnabled} onChange={(event) => void update({ ...settings, pdfExtractionEnabled: event.target.checked })} /></label></div>
      <label>When a PDF opens<select value={settings.pdfExtractionMode} onChange={(event) => void update({ ...settings, pdfExtractionMode: event.target.value as AppSettings['pdfExtractionMode'] })}><option value="countdown">Auto-start after 5 seconds</option><option value="manual">Wait for Start</option></select></label>
      <p className="fine-print">Every detected PDF can still be started immediately or skipped. Active extraction can be stopped and restarted from the beginning.</p>
      <label>OpenRouter model<SearchableModelSelect value={settings.aiRoles.pdf.model} options={models.openrouter} onChange={(model) => patchRole('pdf', { model })} /></label>
      <ModelDetails model={settings.aiRoles.pdf.model} catalog={settings.providers.openrouter.modelCatalog} />
      <p className="settings-copy">Used to turn a PDF into Markdown before chat.</p>
      <textarea className="prompt-editor" value={pdfPromptDraft} onChange={(event) => setPdfPromptDraft(event.target.value)} spellCheck={false} />
      <p className="fine-print">Available placeholders: {PDF_PROMPT_PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ')}</p>
      <div className="settings-button-row"><button className="secondary" onClick={() => void resetPdfPrompt()}>Reset to default</button><button className="primary" onClick={() => void savePdfPrompt()}>Save prompt</button></div>
    </section>
    <section {...workspaceScope} className={`settings-section workspace-scoped image-stage-card${settings.imageAnalysisEnabled ? '' : ' feature-disabled'}`}>
      <div className="settings-section-title"><div><h2>Image-analysis stage</h2></div><label className="feature-toggle" title="Toggle image analysis"><input aria-label="Image analysis" type="checkbox" checked={settings.imageAnalysisEnabled} onChange={(event) => void update({ ...settings, imageAnalysisEnabled: event.target.checked })} /></label></div>
      <label>OpenRouter model<SearchableModelSelect value={settings.aiRoles.image.model} options={imageModels.openrouter.length ? imageModels.openrouter : models.openrouter} onChange={(model) => patchRole('image', { model })} /></label>
      <ModelDetails model={settings.aiRoles.image.model} catalog={settings.providers.openrouter.modelCatalog} />
      <p className="settings-copy">Used by explicit <code>/image</code> requests with the Image role.</p>
      <textarea className="prompt-editor" value={imagePromptDraft} onChange={(event) => setImagePromptDraft(event.target.value)} spellCheck={false} />
      <p className="fine-print">Available placeholders: {IMAGE_PROMPT_PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ')}</p>
      <div className="settings-button-row"><button className="secondary" onClick={() => void resetImagePrompt()}>Reset to default</button><button className="primary" onClick={() => void saveImagePrompt()}>Save prompt</button></div>
    </section>
    <section {...workspaceScope} className={`settings-section workspace-scoped video-stage-card${settings.videoAnalysisEnabled ? '' : ' feature-disabled'}`}>
      <div className="settings-section-title"><div><h2>Video-analysis stage</h2></div><label className="feature-toggle" title="Toggle video analysis"><input aria-label="Video analysis" type="checkbox" checked={settings.videoAnalysisEnabled} onChange={(event) => void update({ ...settings, videoAnalysisEnabled: event.target.checked })} /></label></div>
      <label>OpenRouter model<SearchableModelSelect value={settings.aiRoles.video.model} options={videoModels} onChange={(model) => patchRole('video', { model })} placeholder={loadingVideoModels ? 'Loading video models…' : 'No compatible video models found'} /></label>
      <ModelDetails model={settings.aiRoles.video.model} catalog={settings.providers.openrouter.modelCatalog} />
      <p className="settings-copy">Used by explicit <code>/video</code> requests with the Video role.</p>
      <textarea className="prompt-editor" value={videoPromptDraft} onChange={(event) => setVideoPromptDraft(event.target.value)} spellCheck={false} />
      <p className="fine-print">Available placeholders: {VIDEO_PROMPT_PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ')}</p>
      <div className="settings-button-row"><button className="secondary" onClick={() => void resetVideoPrompt()}>Reset to default</button><button className="primary" onClick={() => void saveVideoPrompt()}>Save prompt</button></div>
      <div className="stage-capabilities">
        <h3>Reel and YouTube audio transcription</h3>
        <p className="settings-copy">The explicit Transcribe action replays the connected video and captures spoken audio in real time. Page captions are not used as the generated transcript.</p>
        {!settings.providers.openrouter.apiKey ? <p className="fine-print">Save your OpenRouter key on the Dashboard to enable media transcription.</p> : <>
          <label>Speech-to-text model<SearchableModelSelect value={settings.aiRoles.transcription.model} options={transcriptionModels} disabled={loadingTranscriptionModels || !transcriptionModels.length} onChange={(model) => patchRole('transcription', { model })} placeholder={loadingTranscriptionModels ? 'Loading transcription models…' : 'No transcription models found'} /></label>
          <ModelDetails model={settings.aiRoles.transcription.model} catalog={settings.providers.openrouter.modelCatalog} />
          <button className="secondary full" disabled={loadingTranscriptionModels} onClick={() => { setLoadingTranscriptionModels(true); void getProvider('openrouter').listTranscriptionModels?.(settings.providers.openrouter.apiKey).then((available) => setTranscriptionModels(available ?? [])).catch((cause) => setError(errorMessage(cause))).finally(() => setLoadingTranscriptionModels(false)); }}>{loadingTranscriptionModels ? 'Refreshing…' : 'Refresh transcription models'}</button>
          <p className="fine-print">Raw audio is kept only in memory. Completed timestamped transcript segments and exact reported usage are stored with the conversation.</p>
        </>}
      </div>
    </section>
    <section className="settings-section app-only app-personalization-card">
      <h2>Appearance and card order</h2>
      <p className="settings-copy">These colors and layouts apply globally across every Learnr workspace and page.</p>
      <div className="global-color-grid">
        <label><span>Accent color</span><div><input type="color" value={globalSettings?.accentColor ?? DEFAULT_ACCENT_COLOR} onChange={(event) => void saveGlobalPatch({ accentColor: event.target.value })} /><code>{globalSettings?.accentColor ?? DEFAULT_ACCENT_COLOR}</code></div></label>
        <label><span>Light background</span><div><input type="color" value={globalSettings?.lightBackgroundColor ?? DEFAULT_LIGHT_BACKGROUND_COLOR} onChange={(event) => void saveGlobalPatch({ lightBackgroundColor: event.target.value })} /><code>{globalSettings?.lightBackgroundColor ?? DEFAULT_LIGHT_BACKGROUND_COLOR}</code></div></label>
        <label><span>Dark background</span><div><input type="color" value={globalSettings?.darkBackgroundColor ?? DEFAULT_DARK_BACKGROUND_COLOR} onChange={(event) => void saveGlobalPatch({ darkBackgroundColor: event.target.value })} /><code>{globalSettings?.darkBackgroundColor ?? DEFAULT_DARK_BACKGROUND_COLOR}</code></div></label>
        <label><span>Light-mode highlight</span><div><input type="color" value={globalSettings?.lightHighlightColor ?? DEFAULT_LIGHT_HIGHLIGHT_COLOR} onChange={(event) => void saveGlobalPatch({ lightHighlightColor: event.target.value })} /><code>{globalSettings?.lightHighlightColor ?? DEFAULT_LIGHT_HIGHLIGHT_COLOR}</code></div></label>
        <label><span>Dark-mode highlight</span><div><input type="color" value={globalSettings?.darkHighlightColor ?? DEFAULT_DARK_HIGHLIGHT_COLOR} onChange={(event) => void saveGlobalPatch({ darkHighlightColor: event.target.value })} /><code>{globalSettings?.darkHighlightColor ?? DEFAULT_DARK_HIGHLIGHT_COLOR}</code></div></label>
      </div>
      <button className="secondary" onClick={() => void saveGlobalPatch({ accentColor: DEFAULT_ACCENT_COLOR, lightBackgroundColor: DEFAULT_LIGHT_BACKGROUND_COLOR, darkBackgroundColor: DEFAULT_DARK_BACKGROUND_COLOR, lightHighlightColor: DEFAULT_LIGHT_HIGHLIGHT_COLOR, darkHighlightColor: DEFAULT_DARK_HIGHLIGHT_COLOR })}>Reset colors</button>
      <label>When a connected browser tab closes<select value={globalSettings?.closedConnectedTabBehavior ?? 'keep'} onChange={(event) => void saveGlobalPatch({ closedConnectedTabBehavior: event.target.value as GlobalSettings['closedConnectedTabBehavior'] })}><option value="keep">Keep snapshot</option><option value="remove">Remove source</option><option value="ask">Ask next time Learnr is visible</option></select></label>
      <p className="fine-print">Keep snapshot preserves extracted content in the research tree. Ask queues a choice in the Conversation sources overlay.</p>
      <div className="tool-divider" />
      <h3>Settings card order</h3>
      <p className="fine-print">Use the arrow buttons to arrange the cards separately for each Settings tab type.</p>
      <div className="settings-order-groups">{(['dashboard', 'workspace', 'app'] as const).map((scope) => <div key={scope}><div className="settings-order-heading"><strong>{scope === 'app' ? 'App' : scope[0].toUpperCase() + scope.slice(1)}</strong><button className="ghost" onClick={() => globalSettings && void saveGlobalPatch({ settingsCardOrder: { ...globalSettings.settingsCardOrder, [scope]: [...SETTINGS_CARD_CATALOG[scope]] } })}>Reset</button></div><ol>{(globalSettings?.settingsCardOrder[scope] ?? SETTINGS_CARD_CATALOG[scope]).map((id, index, cards) => <li key={id}><span>{SETTINGS_CARD_LABELS[id] ?? id}</span><div><button className="icon-button" aria-label={`Move ${SETTINGS_CARD_LABELS[id] ?? id} up`} disabled={index === 0} onClick={() => void moveSettingsCard(scope, id, -1)}>↑</button><button className="icon-button" aria-label={`Move ${SETTINGS_CARD_LABELS[id] ?? id} down`} disabled={index === cards.length - 1} onClick={() => void moveSettingsCard(scope, id, 1)}>↓</button></div></li>)}</ol></div>)}</div>
    </section>
    <section className="settings-section app-only settings-portability-card">
      <h2>Global settings portability</h2>
      <p className="settings-copy">Move Learnr’s global appearance, card order, shortcuts, slash commands, tab behavior, and AutoGroup preferences between browser profiles.</p>
      <div className="settings-button-row wrap"><button className="secondary" onClick={exportGlobalPreferences}>Export global settings</button><button className="secondary" onClick={() => chooseSettingsImport('global')}>Import global settings</button></div>
      <p className="fine-print">Workspaces, API keys, histories, usage, folder permissions, model catalogs, embedding profiles, and indexes remain untouched.</p>
    </section>
    <section className="settings-section danger-zone app-only">
      <h2>Factory reset</h2>
      <p className="settings-copy">Delete all data stored locally by learnr and return every setting to its original default.</p>
      <button className="danger full" disabled={resettingApp} onClick={() => void factoryReset()}>{resettingApp ? 'Resetting learnr…' : 'Clear all local data'}</button>
      <p className="fine-print">This includes prompts, model choices, API keys, workspaces, chats, usage, folder connections, and saved-note indexes. Files already written to your folders are not deleted.</p>
    </section>
    <section className="settings-section about-section app-only">
      <h2>About</h2>
      <dl><div><dt>App version</dt><dd>{APP_VERSION}</dd></div><div><dt>Build version</dt><dd>{BUILD_VERSION}</dd></div><div><dt>Browser target</dt><dd>{BROWSER_TARGET === 'arc' ? 'Arc' : 'Chromium'}</dd></div></dl>
    </section>
    {settingsImportPreview && <div className="settings-import-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !settingsImportBusy) setSettingsImportPreview(null); }}>
      <section className="settings-import-modal" role="dialog" aria-modal="true" aria-labelledby="settings-import-title"><header><div><span className="eyebrow">Settings import</span><h2 id="settings-import-title">{settingsImportPreview.scope === 'global' ? 'Apply global preferences?' : `Create “${uniqueImportedWorkspaceName(settingsImportPreview.workspace.name, globalSettings?.workspaces ?? [])}”?`}</h2><p>{settingsImportPreview.scope === 'global' ? 'Only portable global preferences will change.' : 'The imported workspace will be created without becoming active.'}</p></div><button aria-label="Close settings import preview" disabled={settingsImportBusy} onClick={() => setSettingsImportPreview(null)}>×</button></header>
        <ul>{settingsImportSummary(settingsImportPreview).map((item) => <li key={item}>{item}</li>)}</ul>
        <div className="settings-import-safety"><strong>Always preserved</strong><span>API keys, folders, embedding data, chats, drafts, usage, and browser-local permissions.</span></div>
        <footer><small>Exported by Learnr {settingsImportPreview.appVersion} on {new Date(settingsImportPreview.exportedAt).toLocaleString()}.</small><div><button className="secondary" disabled={settingsImportBusy} onClick={() => setSettingsImportPreview(null)}>Cancel</button><button autoFocus className="primary" disabled={settingsImportBusy} onClick={() => void applySettingsImport()}>{settingsImportBusy ? 'Applying…' : settingsImportPreview.scope === 'global' ? 'Apply global settings' : 'Create workspace'}</button></div></footer>
      </section>
    </div>}
    {duplicateSets && <div className="autogroup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !duplicateRemoving) setDuplicateSets(null); }}>
      <section className="autogroup-modal duplicate-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-preview-title"><header><div><span className="eyebrow">Duplicate-tab review</span><h2 id="duplicate-preview-title">{duplicateSets.length} exact URL match{duplicateSets.length === 1 ? '' : 'es'}</h2><p>Nothing closes until you confirm. Keeper priority favors pinned, active, grouped, and recently accessed tabs.</p></div><button aria-label="Close duplicate review" disabled={duplicateRemoving} onClick={() => setDuplicateSets(null)}>×</button></header>
        <input autoFocus type="search" value={duplicateQuery} onChange={(event) => setDuplicateQuery(event.target.value)} placeholder="Search URLs, titles, or groups…" />
        <div className="autogroup-preview-list">{visibleDuplicateSets.map((set) => <article key={set.url}><div className="autogroup-category-heading"><div><strong title={set.url}>{set.url}</strong><small>{set.tabs.length} matching tabs</small></div></div>{set.tabs.map((tab) => <div className="duplicate-tab-row" key={tab.id}><label className="duplicate-keeper"><input type="radio" name={`keeper-${set.url}`} checked={set.keeperId === tab.id} onChange={() => { setDuplicateSets((current) => current?.map((item) => item.url === set.url ? { ...item, keeperId: tab.id } : item) ?? null); setDuplicateSelection((current) => ({ ...current, [tab.id]: false, [set.keeperId]: true })); }} /><span>Keep</span></label><label className="duplicate-remove"><input type="checkbox" disabled={set.keeperId === tab.id} checked={set.keeperId !== tab.id && Boolean(duplicateSelection[tab.id])} onChange={(event) => setDuplicateSelection((current) => ({ ...current, [tab.id]: event.target.checked }))} /><span>Close</span></label><div><strong>{tab.title}</strong><small>Window {tab.windowId}{tab.groupTitle ? ` · ${tab.groupTitle}` : ''}{tab.pinned ? ' · Pinned' : ''}{tab.active ? ' · Active' : ''}{tab.lastAccessed ? ` · ${new Date(tab.lastAccessed).toLocaleString()}` : ''}</small></div></div>)}</article>)}</div>
        <footer><span>Tabs are revalidated against the complete URL immediately before removal.</span><div><button className="secondary" disabled={duplicateRemoving} onClick={() => setDuplicateSets(null)}>Cancel</button><button className="danger" disabled={duplicateRemoving || !duplicateCloseCount} onClick={() => void removeDuplicates()}>{duplicateRemoving ? 'Closing…' : `Close ${duplicateCloseCount} duplicate tab${duplicateCloseCount === 1 ? '' : 's'}`}</button></div></footer>
      </section>
    </div>}
    {autoGroupPreview && <div className="autogroup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && autoGroupPhase !== 'applying') { setAutoGroupPreview(null); setAutoGroupQuery(''); } }}>
      <section className="autogroup-modal" role="dialog" aria-modal="true" aria-labelledby="autogroup-preview-title">
        <header><div><span className="eyebrow">AutoGroup preview</span><h2 id="autogroup-preview-title">Review {autoGroupPreview.assignments.length} tab assignments</h2><p>{autoGroupPreview.skippedGrouped} grouped and {autoGroupPreview.skippedPinned} pinned tabs were left untouched.{autoGroupPreview.unclassified.length ? ` ${autoGroupPreview.unclassified.length} tabs could not be classified.` : ''}</p></div><button aria-label="Close AutoGroup preview" disabled={autoGroupPhase === 'applying'} onClick={() => { setAutoGroupPreview(null); setAutoGroupQuery(''); }}>×</button></header>
        <input autoFocus type="search" value={autoGroupQuery} onChange={(event) => setAutoGroupQuery(event.target.value)} placeholder="Search titles, domains, or categories…" aria-label="Search AutoGroup preview" />
        <div className="autogroup-preview-list">
          {autoGroupPreviewSections.map((section) => <article key={section.key}><div className="autogroup-category-heading"><div><strong>{section.destination}</strong><small>Window {section.windowId} · {section.assignments.length} tab{section.assignments.length === 1 ? '' : 's'}</small></div><span className={section.kind}>{section.kind === 'existing' ? 'Existing group' : 'New group'}</span></div>
            {section.assignments.map((assignment) => <div className="autogroup-preview-tab" key={assignment.tab.id}><span>{assignment.tab.hostname.slice(0, 1).toLocaleUpperCase()}</span><div><strong title={assignment.tab.title}>{assignment.tab.title}</strong><small title={assignment.tab.url}>{assignment.tab.hostname} · {assignment.tab.url}</small>{assignment.originalDestination && <small className="autogroup-reconciled">Broadened from {assignment.originalDestination.kind === 'existing' ? assignment.originalDestination.title : assignment.originalDestination.category}</small>}</div></div>)}
          </article>)}
          {!!autoGroupPreview.unclassified.length && <article className="autogroup-unclassified"><div className="autogroup-category-heading"><div><strong>Unclassified</strong><small>These tabs will remain untouched.</small></div><span>{autoGroupPreview.unclassified.length}</span></div>{autoGroupPreview.unclassified.map(({ tab, reason, detail }) => <div className="autogroup-preview-tab" key={tab.id}><span>!</span><div><strong title={tab.title}>{tab.title}</strong><small title={detail}>{tab.hostname} · {reason.replace('-', ' ')}</small></div></div>)}</article>}
          {!autoGroupPreviewSections.length && <p className="autogroup-empty">No assignments match that search.</p>}
        </div>
        <footer><span>Tabs are revalidated before grouping. Changed and unclassified tabs stay untouched.</span><div>{!!autoGroupPreview.unclassified.length && <button className="secondary" disabled={autoGroupBusy} onClick={() => void retryUnclassifiedAutoGroup()}>{autoGroupPhase === 'classifying' ? 'Retrying…' : 'Retry unclassified'}</button>}<button className="secondary" disabled={autoGroupPhase === 'applying'} onClick={() => { setAutoGroupPreview(null); setAutoGroupQuery(''); }}>Cancel</button><button className="primary" disabled={autoGroupPhase === 'applying' || !autoGroupPreview.assignments.length} onClick={() => void applyAutoGroup()}>{autoGroupPhase === 'applying' ? 'Applying…' : 'Apply groups'}</button></div></footer>
      </section>
    </div>}
    {error && <div className="notice error settings-error-notice" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" title="Dismiss error" onClick={() => setError('')}>×</button></div>}
  </main>;
}
