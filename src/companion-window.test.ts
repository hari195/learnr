import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReadingTab, openSplitReader } from './companion-window';

const readerUrl = 'chrome-extension://learnr/sidepanel.html?mode=arc-split&window=10';
const page = (id: number, extra = {}) => ({ id, windowId: 10, index: id, active: false, url: `https://example.com/${id}`, ...extra });
const reader = { id: 90, windowId: 10, index: 2, active: true, url: readerUrl };
let api: ReturnType<typeof mockBrowser>;
function mockBrowser() {
  return {
    runtime: { getURL: (path: string) => `chrome-extension://learnr/${path}` },
    windows: { getLastFocused: vi.fn().mockResolvedValue({ id: 10 }) },
    tabs: {
      query: vi.fn().mockResolvedValue([page(11), page(12), reader]),
      create: vi.fn().mockResolvedValue(reader),
      update: vi.fn().mockResolvedValue(reader),
    },
    scripting: { executeScript: vi.fn().mockImplementation(async ({ target }: { target: { tabId: number } }) => [{ result: target.tabId === 11 }]) },
    storage: { session: { get: vi.fn().mockResolvedValue({ 'learnr.arc-split.source.10': 11 }), set: vi.fn().mockResolvedValue(undefined) } },
  };
}
beforeEach(() => { api = mockBrowser(); vi.stubGlobal('chrome', api); });
afterEach(() => vi.unstubAllGlobals());

describe('Arc split reader source', () => {
  it('selects the visible left page while the right Learnr pane has focus', async () => {
    expect((await getReadingTab(10))?.id).toBe(11);
    expect(api.tabs.query).toHaveBeenCalledWith({ windowId: 10 });
    expect(api.storage.session.set).toHaveBeenCalledWith({ 'learnr.arc-split.source.10': 11 });
  });

  it('detects replacement of the left pane even when it is not active', async () => {
    api.scripting.executeScript.mockImplementation(async ({ target }) => [{ result: target.tabId === 12 }]);
    expect((await getReadingTab(10))?.id).toBe(12);
  });

  it('returns the new URL after left-pane navigation while Learnr retains focus', async () => {
    api.tabs.query.mockResolvedValue([page(11, { url: 'https://example.com/new-article' }), reader]);
    expect((await getReadingTab(10))?.url).toBe('https://example.com/new-article');
  });

  it('uses exposed split membership without injecting visibility probes', async () => {
    api.tabs.query.mockResolvedValue([page(11, { splitViewId: 7 }), page(12, { splitViewId: -1 }), { ...reader, splitViewId: 7 }]);
    expect((await getReadingTab(10))?.id).toBe(11);
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('keeps established visible source when several panes are visible', async () => {
    api.scripting.executeScript.mockResolvedValue([{ result: true }]);
    expect((await getReadingTab(10))?.id).toBe(11);
  });

  it('does not invent a source for an ambiguous split with no previous selection', async () => {
    api.storage.session.get.mockResolvedValue({});
    api.scripting.executeScript.mockResolvedValue([{ result: true }]);
    expect(await getReadingTab(10)).toBeNull();
  });

  it('handles protected pages and refused script execution without selecting Learnr', async () => {
    api.tabs.query.mockResolvedValue([page(11, { url: 'arc://settings' }), reader]);
    expect((await getReadingTab(10))?.url).toBe('arc://settings');
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    api.tabs.query.mockResolvedValue([page(11), reader]);
    api.scripting.executeScript.mockRejectedValue(new Error('Cannot inject'));
    expect((await getReadingTab(10))?.id).toBe(11);
  });

  it('scopes the source to the reader window rather than another focused window', async () => {
    await getReadingTab(10);
    expect(api.windows.getLastFocused).not.toHaveBeenCalled();
    api.tabs.query.mockResolvedValue([]);
    expect(await getReadingTab(20)).toBeNull();
    expect(api.storage.session.get).toHaveBeenLastCalledWith('learnr.arc-split.source.20');
  });
});

describe('Arc reader tab lifecycle', () => {
  it('opens adjacent to the source tab and deduplicates simultaneous clicks', async () => {
    api.tabs.query.mockResolvedValue([page(11)]);
    await Promise.all([openSplitReader(page(11) as chrome.tabs.Tab), openSplitReader(page(11) as chrome.tabs.Tab)]);
    expect(api.tabs.create).toHaveBeenCalledTimes(1);
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 10, url: readerUrl, index: 12, active: true });
  });

  it('reuses an existing reader after worker restart', async () => {
    await openSplitReader(page(11) as chrome.tabs.Tab);
    expect(api.tabs.update).toHaveBeenCalledWith(90, { active: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });
});
