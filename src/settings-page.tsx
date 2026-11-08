import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Settings } from './Settings';
import { BrandMark } from './BrandMark';
import { loadSettings, observeSettings } from './storage';
import { resolveTheme } from './theme';
import type { AppSettings, GlobalSettings } from './types';
import { loadGlobalSettings, observeGlobalSettings } from './workspaces';
import { globalAppearanceStyle } from './app-appearance';
import './styles.css';

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    void Promise.all([loadSettings(), loadGlobalSettings()]).then(([nextSettings, global]) => { setSettings(nextSettings); setGlobalSettings(global); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load settings.'));
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
  const backToReading = async () => {
    const current = await chrome.tabs.getCurrent().catch(() => undefined);
    if (current?.id) { await chrome.tabs.remove(current.id); return; }
    if (history.length > 1) history.back();
  };
  return <div className="app settings-page-shell" data-theme={activeTheme} style={globalAppearanceStyle(globalSettings, activeTheme)}>
    <header className="topbar"><div className="topbar-primary"><button className="back-link settings-header-back" onClick={() => void backToReading()}>← Back to reading</button></div></header>
    {settings
      ? <Settings settings={settings} setSettings={setSettings} error={error} setError={setError} onWorkspaceSwitch={async () => setSettings(await loadSettings())} fullPage />
      : <div className="loading"><BrandMark /><p>Loading settings…</p>{error && <div className="notice error">{error}</div>}</div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><SettingsPage /></React.StrictMode>);
