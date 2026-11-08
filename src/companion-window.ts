import { isAccessibleTabUrl } from './tab-access';

const sourceKey = (windowId: number) => `learnr.arc-split.source.${windowId}`;
const readerUrl = (windowId: number) => chrome.runtime.getURL(`sidepanel.html?mode=arc-split&window=${windowId}`);

export function isLearnrTab(tab: Pick<chrome.tabs.Tab, 'url'>): boolean {
  return Boolean(tab.url?.startsWith(chrome.runtime.getURL('')));
}

function isSplitReader(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.url?.startsWith(chrome.runtime.getURL('sidepanel.html?mode=arc-split&')));
}

async function rememberSource(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (tab.id != null) await chrome.storage.session.set({ [sourceKey(tab.windowId)]: tab.id });
  return tab;
}

// Arc doesn't consistently expose native split membership. When the reader has
// focus, probe visibility of the other pages in its window instead of assuming
// that tabs.active identifies the left-hand pane. No page contents are read.
export async function getReadingTab(requestedWindowId?: number): Promise<chrome.tabs.Tab | null> {
  const windowId = requestedWindowId ?? (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null))?.id;
  if (windowId == null) return null;
  const tabs = await chrome.tabs.query({ windowId });
  const readers = tabs.filter(isSplitReader);
  const candidates = tabs.filter((tab) => !isLearnrTab(tab));
  const stored = await chrome.storage.session.get(sourceKey(windowId));
  const previous = candidates.find((tab) => tab.id === stored[sourceKey(windowId)]);

  if (readers.length) {
    const reader = readers.find((tab) => tab.active) ?? readers[0];
    const splitId = reader.splitViewId;
    if (typeof splitId === 'number' && splitId >= 0) {
      const siblings = candidates.filter((tab) => tab.splitViewId === splitId);
      if (siblings.length === 1) return rememberSource(siblings[0]);
    }
    const visible = (await Promise.all(candidates.filter((tab) => tab.id != null && isAccessibleTabUrl(tab.url)).map(async (tab) => {
      try {
        const result = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => document.visibilityState === 'visible' });
        return result[0]?.result === true ? tab : null;
      } catch { return null; }
    }))).filter((tab): tab is chrome.tabs.Tab => Boolean(tab));
    if (visible.length === 1) return rememberSource(visible[0]);
    // More than two panes are ambiguous; keep the established source rather
    // than choosing an unrelated tab by index or recency.
    if (previous && visible.some((tab) => tab.id === previous.id)) return previous;
    if (visible.length > 1) return null;
  }
  const active = candidates.find((tab) => tab.active);
  if (active) return rememberSource(active);
  return previous ?? null;
}

const openings = new Map<number, Promise<chrome.tabs.Tab>>();

export function openSplitReader(source: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  const pending = openings.get(source.windowId);
  if (pending) return pending;
  const opening = openOrFocus(source).finally(() => openings.delete(source.windowId));
  openings.set(source.windowId, opening);
  return opening;
}

async function openOrFocus(source: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  if (!isLearnrTab(source)) await rememberSource(source);
  const tabs = await chrome.tabs.query({ windowId: source.windowId });
  const existing = tabs.find(isSplitReader);
  if (existing?.id != null) {
    const focused = await chrome.tabs.update(existing.id, { active: true });
    return focused ?? existing;
  }
  return chrome.tabs.create({ windowId: source.windowId, url: readerUrl(source.windowId), index: source.index + 1, active: true });
}
