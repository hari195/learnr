import { describe, expect, it } from 'vitest';
import { classifyTabAccess, isAccessibleTabUrl, isProtectedWebUrl, shouldActivateAccessibleTab, tabConnectionSignature } from './tab-access';

describe('browser tab access', () => {
  it('allows ordinary web pages and supported PDF files', () => {
    expect(isAccessibleTabUrl('https://example.com/article')).toBe(true);
    expect(isAccessibleTabUrl('http://localhost:3000')).toBe(true);
    expect(isAccessibleTabUrl('file:///Users/me/paper.pdf')).toBe(true);
    expect(isAccessibleTabUrl('file:///Users/me/note.txt')).toBe(false);
  });

  it('classifies browser surfaces and the Chrome Web Store as protected', () => {
    for (const url of ['chrome://extensions', 'chrome://settings', 'about:blank', 'chrome-extension://abc/settings.html', 'https://chromewebstore.google.com/detail/example']) {
      expect(classifyTabAccess({ id: 7, url, title: 'Browser page' }).status).toBe('protected');
    }
    expect(isProtectedWebUrl('https://chrome.google.com/webstore/detail/example')).toBe(true);
  });

  it('uses tab identity and URL to detect same-tab navigation', () => {
    expect(tabConnectionSignature({ tabId: 7, url: 'chrome://settings' })).not.toBe(tabConnectionSignature({ tabId: 7, url: 'https://example.com' }));
    const protectedPage = classifyTabAccess({ id: 7, url: 'chrome://settings', title: 'Settings' });
    const webPage = classifyTabAccess({ id: 7, url: 'https://example.com', title: 'Example' });
    expect(shouldActivateAccessibleTab(protectedPage, webPage)).toBe(true);
    expect(shouldActivateAccessibleTab({ ...webPage, status: 'connected' }, webPage)).toBe(false);
    expect(shouldActivateAccessibleTab({ ...webPage, status: 'loading' }, webPage)).toBe(false);
    expect(shouldActivateAccessibleTab({ ...webPage, status: 'connected' }, webPage, true)).toBe(true);
  });
});
