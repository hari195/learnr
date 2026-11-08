import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateBrowserTab, getActiveBrowserTab, getBrowserTab, getExtensionCommands, getOpenBrowserTabCount, listBrowserTabs, openBrowserUrl, openExtensionTab, openOptionsPage, openShortcutManager, sendTabMessage } from './browser-bridge';

afterEach(() => vi.unstubAllGlobals());

describe('browser API bridge', () => {
  it('routes tab operations through the background context', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { title: 'Page' } })
      .mockResolvedValueOnce({ ok: true, tab: { id: 4, title: 'Page', url: 'https://example.com', windowId: 2 } })
      .mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    expect(await sendTabMessage(4, { type: 'PING' })).toEqual({ title: 'Page' });
    expect(await getBrowserTab(4)).toMatchObject({ id: 4, title: 'Page' });
    await openExtensionTab('history.html');
    await openShortcutManager();
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'LEARNR_TAB_MESSAGE', tabId: 4, payload: { type: 'PING' } });
    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: 'LEARNR_OPEN_EXTENSION_TAB', path: 'history.html' });
    expect(sendMessage).toHaveBeenNthCalledWith(4, { type: 'LEARNR_OPEN_SHORTCUTS' });
  });

  it('surfaces background bridge errors', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'Blocked page' }) } });
    await expect(sendTabMessage(4, { type: 'PING' })).rejects.toThrow('Blocked page');
  });

  it('keeps privileged tab, command, and options operations behind runtime messages', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, tab: { id: 7, url: 'https://example.com' } })
      .mockResolvedValueOnce({ ok: true, tabs: [{ id: 7 }, { id: 8 }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, count: 2 })
      .mockResolvedValueOnce({ ok: true, commands: [{ name: '_execute_action', shortcut: '⌘⇧L' }] })
      .mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    expect((await getActiveBrowserTab())?.id).toBe(7);
    expect(await listBrowserTabs()).toHaveLength(2);
    await activateBrowserTab(8);
    expect(await getOpenBrowserTabCount()).toBe(2);
    expect(await getExtensionCommands()).toHaveLength(1);
    await openOptionsPage();
    await openBrowserUrl('https://example.com/article');

    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'LEARNR_ACTIVE_TAB_GET' });
    expect(sendMessage).toHaveBeenNthCalledWith(3, { type: 'LEARNR_TAB_ACTIVATE', tabId: 8 });
    expect(sendMessage).toHaveBeenNthCalledWith(6, { type: 'LEARNR_OPEN_OPTIONS' });
    expect(sendMessage).toHaveBeenNthCalledWith(7, { type: 'LEARNR_OPEN_BROWSER_TAB', url: 'https://example.com/article' });
  });
});
