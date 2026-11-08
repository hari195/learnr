import { useEffect, useRef, useState } from 'react';
import type { GlobalSettings } from './types';
import { createWorkspace, loadGlobalSettings, observeGlobalSettings, setActiveWorkspace } from './workspaces';
import { getOpenBrowserTabCount, openOptionsPage } from './browser-bridge';

export function WorkspaceSwitcher({ disabled = false, onSwitch, onError }: { disabled?: boolean; onSwitch?(id: string): void | Promise<void>; onError?(message: string): void }) {
  const [global, setGlobal] = useState<GlobalSettings | null>(null);
  const [dictationLocked, setDictationLocked] = useState(false); const [open, setOpen] = useState(false); const [activeIndex, setActiveIndex] = useState(0);
  const [openTabCount, setOpenTabCount] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { void loadGlobalSettings().then(setGlobal); return observeGlobalSettings(setGlobal); }, []);
  useEffect(() => {
    void chrome.storage.session?.get('learnr.dictationWorkspaceLock').then((value) => setDictationLocked(Boolean(value['learnr.dictationWorkspaceLock'])));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes['learnr.dictationWorkspaceLock']) setDictationLocked(Boolean(changes['learnr.dictationWorkspaceLock'].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  useEffect(() => {
    const refresh = () => { void getOpenBrowserTabCount().then(setOpenTabCount).catch(() => setOpenTabCount(null)); };
    const listener = (message: { type?: string }) => { if (message.type === 'LEARNR_TAB_TOPOLOGY_CHANGED') refresh(); };
    refresh();
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  if (!global) return null;
  const active = global.workspaces.find((item) => item.id === global.activeWorkspaceId) ?? global.workspaces[0];
  async function select(value: string) {
    try {
      const id = value; await setActiveWorkspace(value); setOpen(false);
      await onSwitch?.(id);
      trigger.current?.focus();
    } catch (cause) { onError?.(cause instanceof Error ? cause.message : 'Could not switch workspaces.'); }
  }
  async function create() { const requested = window.prompt('Name this workspace'); if (requested == null) return; try { const workspace = await createWorkspace(requested); setOpen(false); await onSwitch?.(workspace.id); } catch (cause) { onError?.(cause instanceof Error ? cause.message : 'Could not create the workspace.'); } }
  return <div className="workspace-switcher" ref={root}><button ref={trigger} type="button" className="workspace-switcher-trigger" disabled={disabled || dictationLocked} title={dictationLocked ? 'Finish or cancel dictation before switching workspaces' : 'Switch workspace'} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen((value) => !value); setActiveIndex(Math.max(0, global.workspaces.findIndex((item) => item.id === active.id))); }} onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); return; } if (!open && ['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(true); return; } if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(global.workspaces.length - 1, index + 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); } else if (event.key === 'Enter' && global.workspaces[activeIndex]) { event.preventDefault(); void select(global.workspaces[activeIndex].id); } }}><span className="workspace-color-dot" style={{ backgroundColor: active.color }} aria-hidden="true" /><span>{active.name}</span><span className={`workspace-chevron${open ? ' open' : ''}`} aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 5.5 4.5 4.5 4.5-4.5" /></svg></span></button>{openTabCount !== null && <span className="open-tab-count" role="status" aria-label={`${openTabCount} open browser tabs`} title={`${openTabCount} open browser tabs`}>{openTabCount}</span>}{open && <div className="workspace-popover" role="listbox" aria-label="Workspaces">{global.workspaces.map((workspace, index) => <button type="button" role="option" aria-selected={workspace.id === active.id} className={index === activeIndex ? 'keyboard-active' : ''} key={workspace.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => void select(workspace.id)}><i style={{ backgroundColor: workspace.color }} /><span>{workspace.name}</span>{workspace.id === active.id && <b>Active</b>}</button>)}<div className="workspace-popover-actions"><button type="button" onClick={() => void create()}>＋ New workspace</button><button type="button" onClick={() => void openOptionsPage().catch((cause) => onError?.(cause instanceof Error ? cause.message : 'Could not open settings.'))}>Manage workspaces</button></div></div>}</div>;
}
