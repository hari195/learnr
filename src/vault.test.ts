import { afterEach, describe, expect, it, vi } from 'vitest';
import { directoryPickerId, formatZettelkastenTimestamp, markdownFilename, openSavedFile, pickNoteLibrary, sanitizeFilename, zettelkastenFilename } from './vault';

afterEach(() => vi.unstubAllGlobals());

describe('vault path safety', () => {
  it('sanitizes filenames and adds no extension', () => {
    expect(sanitizeFilename('  A: useful / page?.md ')).toBe('A- useful - page-');
  });

  it('creates a local-time editable Zettelkasten filename when drafting', () => {
    const date = new Date(2026, 5, 18, 23, 28, 32);
    expect(formatZettelkastenTimestamp(date)).toBe('20260618232832');
    expect(zettelkastenFilename('AI: Dark / Output.md', date)).toBe('20260618232832 AI- Dark - Output');
  });

  it('keeps timestamped filenames within the filename limit', () => {
    expect(zettelkastenFilename('A'.repeat(300), new Date(2026, 1, 21, 18, 5, 6))).toHaveLength(160);
    expect(sanitizeFilename('19990101000000 User edited title')).toBe('19990101000000 User edited title');
    expect(markdownFilename('19990101000000 User edited title')).toBe('19990101000000 User edited title.md');
  });

  it('supports untimestamped draft names', () => {
    expect(sanitizeFilename('AI: Dark / Output.md')).toBe('AI- Dark - Output');
  });

  it('opens the note-library picker immediately without a storage dependency', async () => {
    const handle = { name: 'Notes' } as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn().mockResolvedValue(handle);
    vi.stubGlobal('window', { showDirectoryPicker });
    await expect(pickNoteLibrary('profile-1')).resolves.toBe(handle);
    expect(showDirectoryPicker).toHaveBeenCalledWith({ id: directoryPickerId('library', 'profile-1'), mode: 'read' });
  });

  it('keeps every directory-picker ID stable and within Chrome’s 32-character limit', () => {
    const uuid = '32637cda-2838-41f1-9ae9-2fe613f84afb';
    for (const kind of ['vault', 'images', 'library'] as const) {
      expect(directoryPickerId(kind, uuid)).toBe(directoryPickerId(kind, uuid));
      expect(directoryPickerId(kind, uuid).length).toBeLessThanOrEqual(32);
    }
    expect(directoryPickerId('library', uuid)).not.toBe(directoryPickerId('library', 'another-profile'));
  });

  it('opens a saved note in the learnr file viewer', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await openSavedFile('A note.md');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'LEARNR_OPEN_EXTENSION_TAB', path: 'note.html?file=A%20note.md' });
  });

  it('keeps an immediate subfolder in the saved-note viewer path', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await openSavedFile('Research/A note.md');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'LEARNR_OPEN_EXTENSION_TAB', path: 'note.html?file=Research%2FA%20note.md' });
  });

});
