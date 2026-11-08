import type { ActiveTabConnection } from './types';

export function isPdfUrl(value = ''): boolean {
  try { return new URL(value).pathname.toLowerCase().endsWith('.pdf'); } catch { return false; }
}

export function isProtectedWebUrl(value = ''): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'chromewebstore.google.com'
      || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));
  } catch { return false; }
}

export function isAccessibleTabUrl(value = ''): boolean {
  if (isProtectedWebUrl(value)) return false;
  return value.startsWith('http://') || value.startsWith('https://') || (value.startsWith('file://') && isPdfUrl(value));
}

export function classifyTabAccess(tab: Pick<chrome.tabs.Tab, 'id' | 'url' | 'title'>): ActiveTabConnection {
  const url = tab.url ?? '';
  const title = tab.title || url || 'Protected browser page';
  if (tab.id != null && isAccessibleTabUrl(url)) return { tabId: tab.id, url, title, status: 'loading' };
  return {
    tabId: tab.id ?? -1,
    url,
    title,
    status: 'protected',
    detail: isProtectedWebUrl(url)
      ? 'Browsers do not allow extensions to read the Chrome Web Store.'
      : 'The browser does not allow extensions to read this protected page.',
  };
}

export function tabConnectionSignature(connection: Pick<ActiveTabConnection, 'tabId' | 'url'>): string {
  return `${connection.tabId}:${connection.url}`;
}

export function shouldActivateAccessibleTab(current: ActiveTabConnection | null, observed: ActiveTabConnection, force = false): boolean {
  if (observed.status === 'protected') return false;
  if (force || !current) return true;
  if (tabConnectionSignature(current) !== tabConnectionSignature(observed)) return true;
  return current.status === 'protected';
}
