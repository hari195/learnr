import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark } from './BrandMark';
import { Markdown } from './Markdown';
import { loadSettings } from './storage';
import { resolveTheme } from './theme';
import { readSavedNote } from './vault';
import { readIndexedNote } from './note-library';
import type { GlobalSettings } from './types';
import { loadGlobalSettings } from './workspaces';
import { globalAppearanceStyle } from './app-appearance';
import './styles.css';

function NotePage() {
  const filename = new URLSearchParams(location.search).get('file') ?? 'Saved note.md';
  const indexedId = new URLSearchParams(location.search).get('indexed');
  const [displayFilename, setDisplayFilename] = useState(filename);
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  useEffect(() => {
    const notePromise = indexedId ? readIndexedNote(indexedId).then((note) => { if (!note) throw new Error('This indexed note is no longer available.'); setDisplayFilename(note.filename); return note.markdown; }) : readSavedNote(filename);
    void Promise.all([notePromise, loadSettings(), loadGlobalSettings()]).then(([content, settings, global]) => { setMarkdown(content); setGlobalSettings(global); setTheme(resolveTheme(settings.themeMode, undefined, matchMedia('(prefers-color-scheme: dark)').matches)); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open this saved note.'));
  }, [filename, indexedId]);
  return <div className="app note-page-shell" data-theme={theme} style={globalAppearanceStyle(globalSettings, theme)}><header className="topbar"><div className="topbar-primary"><div className="brand"><BrandMark /><span>learnr</span></div><strong className="note-page-filename">{displayFilename}</strong></div></header><main className="note-page-content">{error ? <div className="notice error">{error}</div> : markdown ? <Markdown>{markdown}</Markdown> : <div className="loading"><p>Opening note…</p></div>}</main></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><NotePage /></React.StrictMode>);
