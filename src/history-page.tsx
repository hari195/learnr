import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark } from './BrandMark';
import { clearHistory, deleteHistory, formatHistoryDate, formatHistoryTime, listHistory, selectHistoryChatInPanel } from './history';
import { loadSettings, observeSettings } from './storage';
import { resolveTheme } from './theme';
import type { AppSettings, ChatHistorySummary, GlobalSettings } from './types';
import './styles.css';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { loadGlobalSettings, observeGlobalSettings } from './workspaces';
import { globalAppearanceStyle } from './app-appearance';
import { Settings } from './Settings';
import { SettingsOverlay } from './SettingsOverlay';

function displayHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function HistoryPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [records, setRecords] = useState<ChatHistorySummary[]>([]);
  const [error, setError] = useState('');
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  async function refreshRecords(all = allWorkspaces) {
    const [nextRecords, global] = await Promise.all([listHistory(all ? 'all' : 'active'), loadGlobalSettings()]);
    const names = new Map(global.workspaces.map((workspace) => [workspace.id, workspace.name]));
    setRecords(nextRecords.map((record) => ({ ...record, workspaceName: names.get(record.workspaceId ?? 'default') ?? 'Default' })));
  }

  useEffect(() => {
    void Promise.all([loadSettings(), refreshRecords(false), loadGlobalSettings()]).then(([nextSettings, , global]) => { setSettings(nextSettings); setGlobalSettings(global); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load chat history.'));
    const stopSettings = observeSettings(setSettings); const stopGlobal = observeGlobalSettings(setGlobalSettings);
    return () => { stopSettings(); stopGlobal(); };
  }, []);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const activeTheme = resolveTheme(settings?.themeMode ?? 'system', undefined, systemDark);

  async function removeRecord(id: string, title: string) {
    if (!window.confirm(`Delete the saved chat for “${title || 'Untitled page'}”?`)) return;
    try { await deleteHistory(id); setRecords((current) => current.filter((record) => record.id !== id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this chat.'); }
  }

  async function removeAll() {
    if (!records.length || !window.confirm(`Clear all ${records.length} saved chats? This cannot be undone.`)) return;
    try { await clearHistory(); setRecords([]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not clear chat history.'); }
  }

  return <div className="app history-page-shell" data-theme={activeTheme} style={globalAppearanceStyle(globalSettings, activeTheme)}>
    <header className="topbar"><div className="topbar-primary"><div className="brand"><BrandMark /><span>learnr</span></div><WorkspaceSwitcher onSwitch={async () => { setSettings(await loadSettings()); await refreshRecords(); }} onError={setError} /><button className="secondary" onClick={() => setSettingsOpen(true)}>Settings</button></div></header>
    <main className="history-view">
      <div className="history-page-heading"><div className="section-heading"><span className="eyebrow">History</span><h1>Return to an idea.</h1><p>Your conversations stay available after the original webpage closes.</p><label className="history-scope"><input type="checkbox" checked={allWorkspaces} onChange={(event) => { const all = event.target.checked; setAllWorkspaces(all); void refreshRecords(all); }} /> All workspaces</label></div>{records.length > 0 && !allWorkspaces && <button className="secondary clear-history" onClick={() => void removeAll()}>Clear workspace history</button>}</div>
      {error && <div className="notice error">{error}</div>}
      {records.length ? <div className="history-list">{records.map((record) => <div key={record.id} className="history-card">
        <button className="history-card-open" onClick={() => void selectHistoryChatInPanel(record.id, record.workspaceId).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open this conversation.'))}>
          <span className="history-card-main"><strong>{record.title || 'Untitled page'}{(record.pageCount ?? 1) > 1 && <em>+{(record.pageCount ?? 1) - 1} pages</em>}</strong><small>{record.url}</small></span>
          <span className="history-card-meta"><span>{allWorkspaces ? `${record.workspaceName} · ` : ''}{displayHost(record.url)}</span><time title={formatHistoryTime(record.lastInteractedAt)} dateTime={new Date(record.lastInteractedAt).toISOString()}>{formatHistoryDate(record.lastInteractedAt)}</time></span>
          <span className="history-card-arrow">↗</span>
        </button>
        <button className="history-delete" title="Delete chat" aria-label={`Delete chat for ${record.title || 'Untitled page'}`} onClick={() => void removeRecord(record.id, record.title)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" /></svg></button>
      </div>)}</div> : !error && <div className="history-empty"><span>○</span><h2>No chats yet</h2><p>Start a conversation on a webpage and it will appear here after your first interaction.</p></div>}
    </main>
    {settings && <SettingsOverlay open={settingsOpen} standalone dirty={settingsDirty} onClose={() => setSettingsOpen(false)}><Settings embedded settings={settings} setSettings={setSettings} error={error} setError={setError} onDirtyChange={setSettingsDirty} onWorkspaceSwitch={async () => { setSettings(await loadSettings()); await refreshRecords(); }} /></SettingsOverlay>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><HistoryPage /></React.StrictMode>);
