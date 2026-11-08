import { loadImageAssetDataUrl, obsidianImageEmbed, referencedDraftImages } from './image-assets';
import type { ImageHighlight, NoteDraft } from './types';
import { openExtensionTab } from './browser-bridge';
import { getActiveWorkspaceId, LEGACY_WORKSPACE_ID } from './workspaces';

const DB_NAME = 'learnr-vault';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'vault-root';
const IMAGE_HANDLE_KEY = 'image-root';
const NOTE_LIBRARY_HANDLE_KEY = 'note-library-root';
const scopedHandleKey = (key: string, workspaceId: string) => workspaceId === LEGACY_WORKSPACE_ID ? key : `${workspaceId}:${key}`;

/** Chrome limits directory-picker IDs to 32 characters. Keep them stable without embedding UUIDs. */
export function directoryPickerId(kind: 'vault' | 'images' | 'library', scope: string): string {
  let hash = 0x811c9dc5;
  for (const character of scope) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 0x01000193); }
  return `learnr-${kind}-${(hash >>> 0).toString(36)}`;
}

declare global {
  interface Window {
    showDirectoryPicker(options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  }
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeHandle(handle: FileSystemDirectoryHandle, key = HANDLE_KEY): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(handle, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

async function readHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const database = await db();
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return handle;
}

export async function getVaultHandle(workspaceId?: string): Promise<FileSystemDirectoryHandle | null> {
  return readHandle(scopedHandleKey(HANDLE_KEY, workspaceId ?? await getActiveWorkspaceId()));
}

export async function getExplicitImageHandle(workspaceId?: string): Promise<FileSystemDirectoryHandle | null> {
  return readHandle(scopedHandleKey(IMAGE_HANDLE_KEY, workspaceId ?? await getActiveWorkspaceId()));
}

export async function getImageHandle(workspaceId?: string): Promise<FileSystemDirectoryHandle | null> {
  const id = workspaceId ?? await getActiveWorkspaceId();
  return await getExplicitImageHandle(id) ?? getVaultHandle(id);
}

export async function getNoteLibraryHandle(workspaceId?: string): Promise<FileSystemDirectoryHandle | null> {
  return readHandle(scopedHandleKey(NOTE_LIBRARY_HANDLE_KEY, workspaceId ?? await getActiveWorkspaceId()));
}

export async function chooseVault(requestedWorkspaceId?: string): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error('Vault selection is not supported in this browser surface. Open learnr in a full extension tab.');
  const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
  const handle = await window.showDirectoryPicker({ id: directoryPickerId('vault', workspaceId), mode: 'readwrite' });
  await storeHandle(handle, scopedHandleKey(HANDLE_KEY, workspaceId));
  return handle;
}

export async function chooseImageFolder(requestedWorkspaceId?: string): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error('Image folder selection is not supported in this browser surface. Open learnr in a full extension tab.');
  const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
  const handle = await window.showDirectoryPicker({ id: directoryPickerId('images', workspaceId), mode: 'readwrite' });
  await storeHandle(handle, scopedHandleKey(IMAGE_HANDLE_KEY, workspaceId));
  return handle;
}

export async function chooseNoteLibrary(requestedWorkspaceId?: string): Promise<FileSystemDirectoryHandle> {
  const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
  const handle = await pickNoteLibrary(workspaceId);
  await storeHandle(handle, scopedHandleKey(NOTE_LIBRARY_HANDLE_KEY, workspaceId));
  return handle;
}

export function pickNoteLibrary(profileId: string): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error('Note-library selection is not supported in this browser surface. Open learnr in a full extension tab.');
  return window.showDirectoryPicker({ id: directoryPickerId('library', profileId), mode: 'read' });
}

export async function setNoteLibraryHandle(profileId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await storeHandle(handle, scopedHandleKey(NOTE_LIBRARY_HANDLE_KEY, profileId));
}

export async function copyNoteLibraryHandle(fromProfileId: string, toProfileId: string): Promise<void> {
  const handle = await getNoteLibraryHandle(fromProfileId);
  if (handle) await setNoteLibraryHandle(toProfileId, handle);
}

export async function disconnectNoteLibrary(requestedWorkspaceId?: string): Promise<void> {
  const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(scopedHandleKey(NOTE_LIBRARY_HANDLE_KEY, workspaceId));
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}

export async function useNotesFolderForImages(requestedWorkspaceId?: string): Promise<void> {
  const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(scopedHandleKey(IMAGE_HANDLE_KEY, workspaceId));
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}

export async function deleteWorkspaceHandles(workspaceId: string): Promise<void> {
  const database = await db();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  for (const key of [HANDLE_KEY, IMAGE_HANDLE_KEY, NOTE_LIBRARY_HANDLE_KEY]) store.delete(scopedHandleKey(key, workspaceId));
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  database.close();
}

export async function deleteWorkspaceVaultHandles(workspaceId: string): Promise<void> {
  const database = await db();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  for (const key of [HANDLE_KEY, IMAGE_HANDLE_KEY]) store.delete(scopedHandleKey(key, workspaceId));
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  database.close();
}

export async function ensureVaultPermission(handle: FileSystemDirectoryHandle, request = false): Promise<boolean> {
  const options = { mode: 'readwrite' } as const;
  if (await handle.queryPermission(options) === 'granted') return true;
  return request && await handle.requestPermission(options) === 'granted';
}

export async function ensureNoteLibraryPermission(handle: FileSystemDirectoryHandle, request = false): Promise<boolean> {
  const options = { mode: 'read' } as const;
  if (await handle.queryPermission(options) === 'granted') return true;
  return request && await handle.requestPermission(options) === 'granted';
}

export function sanitizeFilename(value: string): string {
  const safe = value.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').replace(/^\.+/, '').replace(/\s+/g, ' ').trim();
  return (safe || 'Untitled note').slice(0, 160).replace(/\.md$/i, '');
}

export function formatZettelkastenTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function zettelkastenFilename(title: string, date = new Date()): string {
  return sanitizeFilename(`${formatZettelkastenTimestamp(date)} ${sanitizeFilename(title)}`);
}

export function markdownFilename(value: string): string {
  return `${sanitizeFilename(value)}.md`;
}

export async function listNoteSubfolders(requestPermission = false): Promise<string[]> {
  const root = await getVaultHandle();
  if (!root) return [];
  if (!await ensureVaultPermission(root, requestPermission)) return [];
  const names: string[] = [];
  for await (const [name, handle] of root.entries()) if (handle.kind === 'directory') names.push(name);
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function resolveNoteDirectory(root: FileSystemDirectoryHandle, subfolder: string): Promise<FileSystemDirectoryHandle> {
  if (!subfolder) return root;
  if (subfolder.includes('/') || subfolder.includes('\\') || subfolder === '.' || subfolder === '..') throw new Error('The selected note subfolder is invalid.');
  try { return await root.getDirectoryHandle(subfolder); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('The selected note subfolder no longer exists. Choose another destination.');
    throw error;
  }
}

export async function writeDraft(
  draft: NoteDraft,
  collision: 'error' | 'replace' | 'copy' = 'error',
): Promise<{ filename: string; relativePath: string; vaultName: string; markdown: string; images: ImageHighlight[] }> {
  const root = await getVaultHandle();
  if (!root) throw new Error('Choose a notes folder in Settings first.');
  if (!await ensureVaultPermission(root, true)) throw new Error('Write permission for the notes folder was not granted.');
  const referenced = referencedDraftImages(draft.markdown, draft.images);
  const imageDirectory = await getImageHandle();
  if (referenced.length && !imageDirectory) throw new Error('Choose an image download path in Settings first.');
  if (referenced.length && imageDirectory && !await ensureVaultPermission(imageDirectory, true)) throw new Error('Write permission for the image folder was not granted.');
  const directory = await resolveNoteDirectory(root, draft.targetSubfolder ?? '');
  const base = sanitizeFilename(draft.filename);
  let filename = markdownFilename(draft.filename);
  if (collision !== 'replace') {
    try {
      await directory.getFileHandle(filename);
      if (collision === 'error') throw new Error('FILE_EXISTS');
      let index = 2;
      do {
        filename = `${base} ${index}.md`;
        try { await directory.getFileHandle(filename); index += 1; } catch { break; }
      } while (true);
    } catch (error) {
      if (error instanceof Error && error.message === 'FILE_EXISTS') throw error;
      if (error instanceof DOMException && error.name !== 'NotFoundError') throw error;
    }
  }
  const loaded = await Promise.all(referenced.map(async (image) => ({ image, blob: await fetch(await loadImageAssetDataUrl(image.assetId)).then((response) => response.blob()) })));
  const createdImages: string[] = [];
  let markdown = draft.markdown;
  const resolvedImages = [...draft.images];
  try {
    if (imageDirectory) for (const { image, blob } of loaded) {
      const dot = image.filename.lastIndexOf('.');
      const base = dot > 0 ? image.filename.slice(0, dot) : image.filename;
      const extension = dot > 0 ? image.filename.slice(dot) : '';
      let resolved = image.filename;
      let index = 2;
      while (true) {
        try { await imageDirectory.getFileHandle(resolved); resolved = `${base} ${index++}${extension}`; }
        catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') break; throw error; }
      }
      const handle = await imageDirectory.getFileHandle(resolved, { create: true });
      const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
      createdImages.push(resolved);
      if (resolved !== image.filename) markdown = markdown.split(obsidianImageEmbed(image.filename)).join(obsidianImageEmbed(resolved));
      const target = resolvedImages.findIndex((candidate) => candidate.id === image.id);
      if (target >= 0) resolvedImages[target] = { ...resolvedImages[target], filename: resolved };
    }
    const file = await directory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable(); await writable.write(markdown); await writable.close();
    return { filename, relativePath: draft.targetSubfolder ? `${draft.targetSubfolder}/${filename}` : filename, vaultName: root.name, markdown, images: resolvedImages };
  } catch (error) {
    if (imageDirectory) await Promise.allSettled(createdImages.map((name) => imageDirectory.removeEntry(name)));
    throw error;
  }
}

export async function readSavedNote(relativePath: string): Promise<string> {
  const root = await getVaultHandle();
  if (!root) throw new Error('The notes folder is no longer available.');
  if (!await ensureVaultPermission(root)) throw new Error('Reopen Settings and renew access to the notes folder.');
  const parts = relativePath.split('/').filter(Boolean);
  if (!parts.length || parts.length > 2 || parts.some((part) => part === '.' || part === '..' || part.includes('\\'))) throw new Error('The saved note path is invalid.');
  const directory = parts.length === 2 ? await resolveNoteDirectory(root, parts[0]) : root;
  const handle = await directory.getFileHandle(markdownFilename(parts.at(-1)!));
  return (await handle.getFile()).text();
}

export async function openSavedFile(relativePath: string): Promise<void> {
  await openExtensionTab(`note.html?file=${encodeURIComponent(relativePath.replace(/\.md$/i, '') + '.md')}`);
}
