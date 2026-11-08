import type { ChatHistoryRecord, StoredImageAsset, StoredPdfAsset, UsageEvent, VideoTranscriptContext } from './types';
import { normalizeUsage } from './usage';
import { draftLinkReferences, normalizeDrafts } from './drafts';

const DATABASE = 'learnr-history';
const STORE = 'chats';
const ASSET_STORE = 'assets';
const VIDEO_STORE = 'video-cache';
const PDF_ASSET_STORE = 'pdf-assets';
const USAGE_STORE = 'usage-events';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 6);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        const assets = database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
        assets.createIndex('historyId', 'historyId');
      }
      if (database.objectStoreNames.contains('pdf-cache')) database.deleteObjectStore('pdf-cache');
      if (!database.objectStoreNames.contains(VIDEO_STORE)) database.createObjectStore(VIDEO_STORE, { keyPath: 'videoId' });
      if (!database.objectStoreNames.contains(PDF_ASSET_STORE)) database.createObjectStore(PDF_ASSET_STORE, { keyPath: 'id' });
      else request.transaction?.objectStore(PDF_ASSET_STORE).clear();
      if (!database.objectStoreNames.contains(USAGE_STORE)) {
        const usage = database.createObjectStore(USAGE_STORE, { keyPath: 'id' });
        usage.createIndex('createdAt', 'createdAt');
        usage.createIndex('providerModel', ['provider', 'model']);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open chat history.'));
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not access chat history.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not update chat history.'));
  });
}

function normalizeRecord(record: ChatHistoryRecord): ChatHistoryRecord {
  const pages = (record.pages?.length ? record.pages : [{ id: `legacy-${record.id}`, context: record.context, linkOrigin: 'primary' as const, linkedAt: record.lastInteractedAt, lastActiveAt: record.lastInteractedAt }])
    .map((page) => ({ ...page, tabId: undefined, groupId: undefined, linkOrigin: page.linkOrigin === 'group' ? 'manual' as const : page.linkOrigin }));
  const artifacts = record.artifacts ?? [];
  const drafts = normalizeDrafts(record.drafts, undefined, draftLinkReferences(artifacts));
  return {
    ...record, workspaceId: record.workspaceId ?? 'default', pages, activePageId: record.activePageId || pages[0].id,
    sourceHighlights: record.sourceHighlights ?? [], imageHighlights: record.imageHighlights ?? [],
    videoHighlights: record.videoHighlights ?? [], videoContexts: record.videoContexts ?? [],
    artifacts, usage: normalizeUsage(record.usage),
    drafts, activeDraftId: drafts.some((draft) => draft.id === record.activeDraftId) ? record.activeDraftId : drafts.at(-1)?.id,
  };
}

export async function putHistoryRecord(record: ChatHistoryRecord): Promise<void> {
  await transact('readwrite', (store) => store.put(normalizeRecord(record)));
}

export async function getHistoryRecord(id: string): Promise<ChatHistoryRecord | null> {
  const record = await transact<ChatHistoryRecord | undefined>('readonly', (store) => store.get(id));
  return record ? normalizeRecord(record) : null;
}

export async function getAllHistoryRecords(): Promise<ChatHistoryRecord[]> {
  const records = await transact<ChatHistoryRecord[]>('readonly', (store) => store.getAll());
  return records.map(normalizeRecord);
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}

export async function clearHistoryRecords(): Promise<void> {
  await transact('readwrite', (store) => store.clear());
}

export async function putImageAsset(asset: StoredImageAsset): Promise<void> {
  await transact('readwrite', (store) => store.put(asset), ASSET_STORE);
}

export async function getImageAsset(id: string): Promise<StoredImageAsset | null> {
  return (await transact<StoredImageAsset | undefined>('readonly', (store) => store.get(id), ASSET_STORE)) ?? null;
}

export async function deleteImageAssetRecord(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id), ASSET_STORE);
}

export async function deleteImageAssetsForHistory(historyId: string): Promise<void> {
  const assets = await transact<StoredImageAsset[]>('readonly', (store) => store.getAll(), ASSET_STORE);
  await Promise.all(assets.filter((asset) => asset.historyId === historyId).map((asset) => deleteImageAssetRecord(asset.id)));
}

export async function clearImageAssets(): Promise<void> {
  await transact('readwrite', (store) => store.clear(), ASSET_STORE);
}

export async function putPdfAsset(value: StoredPdfAsset): Promise<void> {
  await transact('readwrite', (store) => store.put(value), PDF_ASSET_STORE);
}

export async function getPdfAsset(id: string): Promise<StoredPdfAsset | null> {
  return (await transact<StoredPdfAsset | undefined>('readonly', (store) => store.get(id), PDF_ASSET_STORE)) ?? null;
}

export async function deletePdfAssetRecord(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id), PDF_ASSET_STORE);
}

export async function putUsageEvent(value: UsageEvent): Promise<void> {
  await transact('readwrite', (store) => store.put(value), USAGE_STORE);
}

export async function getAllUsageEvents(): Promise<UsageEvent[]> {
  return transact<UsageEvent[]>('readonly', (store) => store.getAll(), USAGE_STORE);
}

export async function clearUsageEvents(): Promise<void> {
  await transact('readwrite', (store) => store.clear(), USAGE_STORE);
}

export async function deleteUsageEventsForWorkspace(workspaceId: string): Promise<void> {
  const events = await getAllUsageEvents();
  await Promise.all(events.filter((event) => (event.workspaceId ?? 'default') === workspaceId).map((event) => transact('readwrite', (store) => store.delete(event.id), USAGE_STORE)));
}

type StoredVideoTranscript = VideoTranscriptContext & { workspaceId?: string; canonicalVideoId?: string };

export async function putVideoTranscript(value: VideoTranscriptContext, workspaceId = 'default'): Promise<void> {
  await transact('readwrite', (store) => store.put({ ...value, workspaceId, canonicalVideoId: value.videoId, videoId: `${workspaceId}:${value.videoId}` }), VIDEO_STORE);
}

export async function getVideoTranscript(videoId: string, workspaceId = 'default'): Promise<VideoTranscriptContext | null> {
  const scoped = await transact<StoredVideoTranscript | undefined>('readonly', (store) => store.get(`${workspaceId}:${videoId}`), VIDEO_STORE);
  if (scoped) return { ...scoped, videoId: scoped.canonicalVideoId ?? videoId };
  if (workspaceId !== 'default') return null;
  return (await transact<VideoTranscriptContext | undefined>('readonly', (store) => store.get(videoId), VIDEO_STORE)) ?? null;
}

export async function deleteMediaCachesForWorkspace(workspaceId: string): Promise<void> {
  const videos = await transact<StoredVideoTranscript[]>('readonly', (store) => store.getAll(), VIDEO_STORE);
  await Promise.all(videos.filter((video) => (video.workspaceId ?? 'default') === workspaceId).map((video) => transact('readwrite', (store) => store.delete(video.videoId), VIDEO_STORE)));
}

export async function clearMediaCaches(): Promise<void> {
  await Promise.all([
    transact('readwrite', (store) => store.clear(), PDF_ASSET_STORE),
    transact('readwrite', (store) => store.clear(), VIDEO_STORE),
  ]);
}
