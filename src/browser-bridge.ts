export async function sendTabMessage<T>(tabId: number, payload: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_TAB_MESSAGE', tabId, payload }) as { ok?: boolean; value?: T; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not communicate with the active webpage.');
  return response.value as T;
}

export async function getBrowserTab(tabId: number): Promise<Pick<chrome.tabs.Tab, 'id' | 'title' | 'url' | 'windowId' | 'active'>> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_GET_TAB', tabId }) as { ok?: boolean; tab?: chrome.tabs.Tab; error?: string };
  if (!response?.ok || !response.tab) throw new Error(response?.error || 'The browser tab is no longer available.');
  return response.tab;
}

export async function getActiveBrowserTab(): Promise<chrome.tabs.Tab | null> {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const readerWindowId = params?.get('mode') === 'arc-split' ? Number(params.get('window')) || undefined : undefined;
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_ACTIVE_TAB_GET', ...(readerWindowId ? { readerWindowId } : {}) }) as { ok?: boolean; tab?: chrome.tabs.Tab; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not read the active browser tab.');
  return response.tab ?? null;
}

export async function listBrowserTabs(): Promise<chrome.tabs.Tab[]> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_TABS_LIST' }) as { ok?: boolean; tabs?: chrome.tabs.Tab[]; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not list browser tabs.');
  return response.tabs ?? [];
}

export async function activateBrowserTab(tabId: number): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_TAB_ACTIVATE', tabId }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not activate the browser tab.');
}

export async function getOpenBrowserTabCount(): Promise<number> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_TAB_COUNT' }) as { ok?: boolean; count?: number; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not count browser tabs.');
  return response.count ?? 0;
}

export async function getExtensionCommands(): Promise<chrome.commands.Command[]> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_COMMANDS_GET' }) as { ok?: boolean; commands?: chrome.commands.Command[]; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not read extension shortcuts.');
  return response.commands ?? [];
}

export async function openOptionsPage(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_OPEN_OPTIONS' }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not open Learnr settings.');
}

export async function openExtensionTab(path: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_OPEN_EXTENSION_TAB', path }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not open the learnr page.');
}

export async function openBrowserUrl(url: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_OPEN_BROWSER_TAB', url }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not open the browser page.');
}

export async function openShortcutManager(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_OPEN_SHORTCUTS' }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not open the browser extension shortcuts page.');
}
