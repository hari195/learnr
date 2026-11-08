import { attachSpawnedTab, attachTabToConversation, clearAllSessions, deleteSessionsForHistory, deleteWorkspaceStorage, handleConnectedTabClosed, loadConversationSession, updateConnectedTabMetadata } from './storage';
import { clearHistoryRecords, clearImageAssets, clearMediaCaches, clearUsageEvents, deleteHistoryRecord, deleteImageAssetRecord, deleteImageAssetsForHistory, deleteMediaCachesForWorkspace, deleteUsageEventsForWorkspace, getAllHistoryRecords, getHistoryRecord, getImageAsset, putHistoryRecord, putImageAsset, putPdfAsset, putUsageEvent } from './history-db';
import { addLifetimeStats } from './stats';
import { deleteWorkspaceHandles, deleteWorkspaceVaultHandles } from './vault';
import { deleteWorkspaceNoteIndex } from './note-library';
import { IMAGE_MIME_TYPES, MAX_HIGHLIGHT_IMAGE_BYTES } from './image-assets';
import type { ImageHighlight } from './types';
import { consumePendingCommand, isLearnrCommandName, OPEN_CONNECTED_TAB_COMMAND, queuePendingCommand } from './commands';
import { classifyTabAccess, isAccessibleTabUrl, isPdfUrl } from './tab-access';
import { migrateUsageAccounting } from './usage-migration';
import { loadGlobalSettings } from './workspaces';
import { AUTOGROUP_UNDO_KEY, AUTOGROUP_UNDO_REASON_KEY, autoGroupColor, autoGroupTabFingerprint, normalizeAutoGroupLabel, sanitizeAutoGroupUrl } from './autogroup';
import { EXTENSION_SHORTCUTS_URL, IS_ARC_BUILD } from './build-target';
import type { AutoGroupApplyResult, AutoGroupAssignment, AutoGroupExistingGroup, AutoGroupTabSummary, AutoGroupUndoSnapshot, DuplicateRemovalResult, DuplicateTabSet, DuplicateTabSummary } from './types';
import { findExactDuplicateTabs } from './duplicate-tabs';
import { getReadingTab, isLearnrTab, openSplitReader } from './companion-window';

void migrateUsageAccounting().catch(() => undefined);

let commandTakeChain: Promise<unknown> = Promise.resolve();
let autoGroupMutationDepth = 0;
let autoGroupIgnoreMovesUntil = 0;
type ConversationOperation = { conversationId: string; instanceId: string; operationId: string; kind: 'chat' | 'draft' | 'pdf' | 'image' | 'video' | 'transcription'; startedAt: number };
const conversationOperations = new Map<string, ConversationOperation>();
const connectedInstances = new Map<string, chrome.runtime.Port>();
const pendingTabAttachments = new Map<number, Promise<unknown>>();
type ActiveMediaCapture = { jobId: string; tabId: number; url: string; startSeconds: number; adPlaying: boolean; stopping?: boolean; ownerInstanceId?: string; timeout?: ReturnType<typeof setTimeout> };
let activeMediaCapture: ActiveMediaCapture | null = null;

async function ensureOffscreenRecorder(): Promise<void> {
  if (typeof chrome.runtime.getContexts !== 'function' || typeof chrome.offscreen?.createDocument !== 'function') {
    throw new Error('This Arc version does not expose Chromium offscreen documents, which tab-audio transcription requires. Update Arc and try again.');
  }
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [offscreenUrl] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.USER_MEDIA], justification: 'Record user-requested tab audio for video transcription.' });
}

async function broadcastMedia(message: Record<string, unknown>): Promise<void> {
  await chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function restoreCapturedTab(capture: ActiveMediaCapture): Promise<void> {
  if (capture.timeout) clearTimeout(capture.timeout);
  await chrome.tabs.sendMessage(capture.tabId, { type: 'LEARNR_MEDIA_RESTORE', jobId: capture.jobId }).catch(() => undefined);
}

async function stopMediaCapture(reason: string, cancelled = true): Promise<void> {
  const capture = activeMediaCapture;
  if (!capture) return;
  if (capture.stopping) return;
  capture.stopping = true;
  const stopped = await chrome.runtime.sendMessage({ target: 'learnr-offscreen', type: 'LEARNR_OFFSCREEN_STOP', jobId: capture.jobId, cancelled }).catch(() => null);
  await restoreCapturedTab(capture);
  if (reason) await broadcastMedia({ type: 'LEARNR_MEDIA_TRANSCRIPTION_NOTICE', jobId: capture.jobId, reason, cancelled });
  if (!stopped?.ok) {
    activeMediaCapture = null;
    await broadcastMedia({ type: 'LEARNR_MEDIA_TRANSCRIPTION_FAILED', jobId: capture.jobId, error: reason || 'Audio capture could not be finalized.' });
  }
}

async function startMediaCapture(message: { jobId: string; tabId: number; startSeconds?: number; startIndex?: number; expectedUrl?: string; ownerInstanceId?: string }): Promise<{ ok: boolean; durationSeconds?: number; error?: string }> {
  if (activeMediaCapture) return { ok: false, error: 'Another tab-audio transcription is already running.' };
  if (typeof chrome.tabCapture?.getMediaStreamId !== 'function') return { ok: false, error: 'This Arc version does not expose Chromium tab capture. Update Arc or use image/video analysis without audio transcription.' };
  const tab = await chrome.tabs.get(message.tabId);
  if (!tab.id || !tab.url || (message.expectedUrl && tab.url !== message.expectedUrl)) return { ok: false, error: 'The source tab changed before transcription could begin.' };
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(tab.id, { active: true });
  await ensureContentScript(tab.id);
  const prepared = await chrome.tabs.sendMessage(tab.id, { type: 'LEARNR_MEDIA_PREPARE', jobId: message.jobId }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  if (!prepared?.ok) return { ok: false, error: prepared?.error ?? 'The source video is not ready.' };
  await ensureOffscreenRecorder();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const capture: ActiveMediaCapture = { jobId: message.jobId, tabId: tab.id, url: tab.url, startSeconds: Math.max(0, Number(message.startSeconds ?? 0)), adPlaying: false, ownerInstanceId: message.ownerInstanceId };
  activeMediaCapture = capture;
  const duration = Number(prepared.durationSeconds);
  const timeoutMs = Number.isFinite(duration) ? Math.min(12 * 60 * 60 * 1000, Math.max(120_000, (duration - capture.startSeconds) * 1_500 + 120_000)) : 2 * 60 * 60 * 1000;
  capture.timeout = setTimeout(() => void stopMediaCapture('Transcription stopped after reaching its safety timeout.', true), timeoutMs);
  const started = await chrome.runtime.sendMessage({ target: 'learnr-offscreen', type: 'LEARNR_OFFSCREEN_START', jobId: capture.jobId, streamId, startSeconds: capture.startSeconds, startIndex: message.startIndex ?? 0 });
  if (!started?.ok) {
    activeMediaCapture = null;
    if (capture.timeout) clearTimeout(capture.timeout);
    return { ok: false, error: started?.error ?? 'Tab audio capture could not start.' };
  }
  return { ok: true, durationSeconds: Number.isFinite(duration) ? duration : undefined };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'learnr-conversation-instance') return;
  let instanceId = '';
  port.onMessage.addListener((message) => { if (message?.type === 'REGISTER_INSTANCE') { instanceId = String(message.instanceId ?? ''); if (instanceId) connectedInstances.set(instanceId, port); } });
  port.onDisconnect.addListener(() => {
    if (instanceId) connectedInstances.delete(instanceId);
    if (instanceId && activeMediaCapture?.ownerInstanceId === instanceId) void stopMediaCapture('Transcription stopped because its learnr view closed.', true);
    for (const [conversationId, operation] of conversationOperations) {
      if (operation.instanceId !== instanceId) continue;
      conversationOperations.delete(conversationId);
      void chrome.runtime.sendMessage({ type: 'LEARNR_CONVERSATION_INTERRUPTED', conversationId, kind: operation.kind, operationId: operation.operationId }).catch(() => undefined);
    }
  });
});
function takePendingCommand(tabId: number) {
  const next = commandTakeChain.then(() => consumePendingCommand(tabId));
  commandTakeChain = next.catch(() => undefined);
  return next;
}

async function notifyAutoGroupUndoChanged(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'LEARNR_AUTOGROUP_UNDO_CHANGED' }).catch(() => undefined);
}

async function clearAutoGroupUndo(reason: string): Promise<void> {
  await chrome.storage.session.remove(AUTOGROUP_UNDO_KEY);
  await chrome.storage.session.set({ [AUTOGROUP_UNDO_REASON_KEY]: reason });
  await notifyAutoGroupUndoChanged();
}

async function loadAutoGroupUndo(): Promise<AutoGroupUndoSnapshot | null> {
  const stored = await chrome.storage.session.get(AUTOGROUP_UNDO_KEY);
  const snapshot = stored[AUTOGROUP_UNDO_KEY] as AutoGroupUndoSnapshot | undefined;
  return snapshot?.affected?.length ? snapshot : null;
}

async function validateAutoGroupUndo(): Promise<{ available: boolean; reason: string; snapshot?: AutoGroupUndoSnapshot }> {
  if (IS_ARC_BUILD) return { available: false, reason: 'AutoGroup is unavailable in the Arc build because Arc does not implement Chromium tab groups.' };
  const snapshot = await loadAutoGroupUndo();
  if (!snapshot) {
    const stored = await chrome.storage.session.get(AUTOGROUP_UNDO_REASON_KEY);
    return { available: false, reason: String(stored[AUTOGROUP_UNDO_REASON_KEY] || 'No AutoGroup changes are available to undo.') };
  }
  const tabs = await Promise.all(snapshot.affected.map((item) => chrome.tabs.get(item.tabId).catch(() => null)));
  const valid = snapshot.affected.every((item, index) => tabs[index]?.windowId === item.windowId && tabs[index]?.groupId === item.destinationGroupId);
  if (!valid) {
    await clearAutoGroupUndo('Undo is unavailable because an affected tab was closed, moved, or regrouped.');
    return { available: false, reason: 'Undo is unavailable because an affected tab was closed, moved, or regrouped.' };
  }
  return { available: true, reason: 'Return the tabs changed by the last AutoGroup run to an ungrouped state.', snapshot };
}

async function invalidateAutoGroupUndoForTab(tabId: number): Promise<void> {
  if (autoGroupMutationDepth || Date.now() < autoGroupIgnoreMovesUntil) return;
  const snapshot = await loadAutoGroupUndo();
  if (snapshot?.affected.some((item) => item.tabId === tabId)) await clearAutoGroupUndo('Undo is unavailable because an affected tab was closed, moved, or regrouped.');
}

async function scanAutoGroupTabs(): Promise<{ tabs: AutoGroupTabSummary[]; groups: AutoGroupExistingGroup[]; skippedPinned: number; skippedGrouped: number }> {
  if (IS_ARC_BUILD) throw new Error('AutoGroup is unavailable in the Arc build because Arc does not implement Chromium tab groups.');
  const allTabs = await chrome.tabs.query({});
  const groupIds = [...new Set(allTabs.flatMap((tab) => typeof tab.groupId === 'number' && tab.groupId >= 0 ? [tab.groupId] : []))];
  const rawGroups = await Promise.all(groupIds.map((id) => chrome.tabGroups.get(id).catch(() => null)));
  const groups = rawGroups.flatMap((group): AutoGroupExistingGroup[] => group && group.title?.trim() && group.title.trim().toLocaleLowerCase() !== 'sync'
    ? [{ id: group.id, windowId: group.windowId, title: group.title.trim() }]
    : []);
  const eligible = allTabs.filter((tab) => tab.id != null && !tab.pinned && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
  const tabs = eligible.map((tab): AutoGroupTabSummary => {
    const sanitized = sanitizeAutoGroupUrl(tab.url ?? '');
    return { id: tab.id!, windowId: tab.windowId, index: tab.index, title: tab.title?.trim() || sanitized.hostname || 'Untitled tab', url: sanitized.url, hostname: sanitized.hostname, fingerprint: autoGroupTabFingerprint(tab) };
  });
  return { tabs, groups, skippedPinned: allTabs.filter((tab) => tab.pinned).length, skippedGrouped: allTabs.filter((tab) => !tab.pinned && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE).length };
}

async function scanDuplicateTabs(): Promise<DuplicateTabSet[]> {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const groupIds = [...new Set(tabs.flatMap((tab) => typeof tab.groupId === 'number' && tab.groupId >= 0 ? [tab.groupId] : []))];
  const groups = IS_ARC_BUILD ? new Map<number, string>() : new Map((await Promise.all(groupIds.map((id) => chrome.tabGroups.get(id).catch(() => null)))).flatMap((group) => group ? [[group.id, group.title?.trim() || 'Untitled group'] as const] : []));
  const summaries = tabs.flatMap((tab): DuplicateTabSummary[] => tab.id != null && tab.url ? [{ id: tab.id, windowId: tab.windowId, index: tab.index, title: tab.title?.trim() || tab.url, url: tab.url, groupId: tab.groupId, groupTitle: groups.get(tab.groupId), pinned: tab.pinned, active: tab.active, lastAccessed: tab.lastAccessed }] : []);
  return findExactDuplicateTabs(summaries);
}

async function removeDuplicateTabs(requests: Array<{ url: string; keeperId: number; removeIds: number[] }>): Promise<DuplicateRemovalResult> {
  let closed = 0; let skipped = 0;
  for (const request of requests) {
    const keeper = await chrome.tabs.get(request.keeperId).catch(() => null);
    if (!keeper || keeper.url !== request.url) { skipped += request.removeIds.length; continue; }
    const candidates = await Promise.all(request.removeIds.map((id) => chrome.tabs.get(id).catch(() => null)));
    const valid = request.removeIds.filter((id, index) => id !== request.keeperId && candidates[index]?.url === request.url);
    skipped += request.removeIds.length - valid.length;
    if (valid.length) { await chrome.tabs.remove(valid); closed += valid.length; }
  }
  return { closed, skipped };
}

function groupAutoGroupTabs(options: chrome.tabs.GroupOptions): Promise<number> {
  return new Promise((resolve, reject) => chrome.tabs.group(options, (groupId) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(groupId);
  }));
}

function ungroupAutoGroupTabs(tabIds: number[]): Promise<void> {
  if (!tabIds.length) return Promise.resolve();
  return new Promise((resolve, reject) => chrome.tabs.ungroup(tabIds as [number, ...number[]], () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}

async function applyAutoGroupAssignments(assignments: AutoGroupAssignment[]): Promise<AutoGroupApplyResult> {
  if (IS_ARC_BUILD) throw new Error('AutoGroup is unavailable in the Arc build because Arc does not implement Chromium tab groups.');
  const unique = [...new Map(assignments.map((assignment) => [assignment.tab.id, assignment])).values()];
  const existingDestinations = [...new Map(unique.flatMap((assignment) => assignment.destination.kind === 'existing' ? [[assignment.destination.groupId, assignment.destination] as const] : [])).values()];
  const existingGroups = await Promise.all(existingDestinations.map((destination) => chrome.tabGroups.get(destination.groupId).catch(() => null)));
  const staleGroup = existingDestinations.find((destination, index) => {
    const group = existingGroups[index];
    const assignment = unique.find((item) => item.destination.kind === 'existing' && item.destination.groupId === destination.groupId);
    return !group || !assignment || group.windowId !== assignment.tab.windowId || group.title?.trim() !== destination.title || group.title.trim().toLocaleLowerCase() === 'sync';
  });
  if (staleGroup) throw new Error('An existing destination group changed. Refresh the AutoGroup preview and try again.');

  const currentTabs = await Promise.all(unique.map((assignment) => chrome.tabs.get(assignment.tab.id).catch(() => null)));
  const valid = unique.filter((assignment, index) => {
    const tab = currentTabs[index];
    return Boolean(tab && !tab.pinned && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && tab.windowId === assignment.tab.windowId && autoGroupTabFingerprint(tab) === assignment.tab.fingerprint);
  }).sort((left, right) => left.tab.windowId - right.tab.windowId || left.tab.index - right.tab.index);
  const buckets = new Map<string, AutoGroupAssignment[]>();
  for (const assignment of valid) {
    const key = assignment.destination.kind === 'existing'
      ? `existing:${assignment.destination.groupId}`
      : `new:${assignment.tab.windowId}:${normalizeAutoGroupLabel(assignment.destination.category)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), assignment]);
  }

  const changed: Array<{ tabId: number; windowId: number; destinationGroupId: number }> = [];
  const createdGroupIds: number[] = [];
  autoGroupMutationDepth += 1;
  try {
    for (const bucket of buckets.values()) {
      const first = bucket[0];
      const tabIds = bucket.map((item) => item.tab.id) as [number, ...number[]];
      if (first.destination.kind === 'existing') {
        const groupId = await groupAutoGroupTabs({ groupId: first.destination.groupId, tabIds });
        changed.push(...bucket.map((item) => ({ tabId: item.tab.id, windowId: item.tab.windowId, destinationGroupId: groupId })));
      } else {
        const category = normalizeAutoGroupLabel(first.destination.category);
        const groupId = await groupAutoGroupTabs({ tabIds, createProperties: { windowId: first.tab.windowId } });
        await chrome.tabGroups.update(groupId, { title: category, color: autoGroupColor(category), collapsed: true });
        createdGroupIds.push(groupId);
        changed.push(...bucket.map((item) => ({ tabId: item.tab.id, windowId: item.tab.windowId, destinationGroupId: groupId })));
      }
    }
    if (changed.length) {
      const snapshot: AutoGroupUndoSnapshot = { createdAt: Date.now(), affected: changed, createdGroupIds };
      await chrome.storage.session.set({ [AUTOGROUP_UNDO_KEY]: snapshot });
      await chrome.storage.session.remove(AUTOGROUP_UNDO_REASON_KEY);
      autoGroupIgnoreMovesUntil = Date.now() + 1_000;
    } else {
      await clearAutoGroupUndo('No eligible tabs remained when the preview was applied.');
    }
  } catch (error) {
    if (changed.length) await ungroupAutoGroupTabs(changed.map((item) => item.tabId)).catch(() => undefined);
    await clearAutoGroupUndo('The last AutoGroup attempt was rolled back after an error.');
    throw error;
  } finally { autoGroupMutationDepth -= 1; }
  await notifyAutoGroupUndoChanged();
  return { applied: changed.length, skipped: unique.length - valid.length, existingGroupsUsed: new Set(changed.filter((item) => !createdGroupIds.includes(item.destinationGroupId)).map((item) => item.destinationGroupId)).size, newGroupsCreated: createdGroupIds.length };
}

async function undoAutoGroup(): Promise<number> {
  if (IS_ARC_BUILD) throw new Error('AutoGroup is unavailable in the Arc build because Arc does not implement Chromium tab groups.');
  const status = await validateAutoGroupUndo();
  if (!status.available || !status.snapshot) throw new Error(status.reason);
  autoGroupMutationDepth += 1;
  try {
    await ungroupAutoGroupTabs(status.snapshot.affected.map((item) => item.tabId));
    autoGroupIgnoreMovesUntil = Date.now() + 1_000;
    await clearAutoGroupUndo('The last AutoGroup run has already been undone.');
  } finally { autoGroupMutationDepth -= 1; }
  return status.snapshot.affected.length;
}

function normalizeImageMime(value: string, source: string): ImageHighlight['mimeType'] | null {
  const mime = value.toLowerCase().split(';')[0].trim().replace('image/jpg', 'image/jpeg');
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return mime as ImageHighlight['mimeType'];
  const extension = (() => { try { return new URL(source).pathname.split('.').pop()?.toLowerCase(); } catch { return undefined; } })();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return null;
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function materializeImage(message: { assetId?: string; historyId?: string; imageUrl: string; mimeType?: string; temporary?: boolean }) {
  const response = await fetch(message.imageUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`The webpage image could not be downloaded (${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_HIGHLIGHT_IMAGE_BYTES) throw new Error('The image is larger than the 5 MB image limit.');
  const sourceBlob = await response.blob();
  if (sourceBlob.size > MAX_HIGHLIGHT_IMAGE_BYTES) throw new Error('The image is larger than the 5 MB image limit.');
  if (sourceBlob.type && sourceBlob.type !== 'application/octet-stream' && !sourceBlob.type.startsWith('image/')) throw new Error('The dropped address did not return an image.');
  const mimeType = normalizeImageMime(sourceBlob.type || message.mimeType || '', message.imageUrl);
  if (!mimeType) throw new Error('Only PNG, JPEG, WebP, and GIF images can be highlighted.');
  const blob = sourceBlob.type === mimeType ? sourceBlob : new Blob([sourceBlob], { type: mimeType });
  if (!message.temporary) {
    if (!message.assetId || !message.historyId) throw new Error('The image asset destination is missing.');
    await putImageAsset({ id: message.assetId, historyId: message.historyId, mimeType, blob, createdAt: Date.now() });
  }
  return { mimeType, byteSize: blob.size, ...(message.temporary ? { dataUrl: await blobDataUrl(blob) } : {}) };
}

async function ensureContentScript(tabId: number): Promise<void> {
  // The injected UI reads conversations and observes session changes directly.
  // Session storage is trusted-context-only by default. Complete this before
  // injecting or notifying an existing content script so React cannot race it.
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'LEARNR_PING' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function clearActionFeedback(tabId: number): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: 'Open learnr' }),
  ]);
}

async function showActionError(tabId: number, message: string): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#9b5a51' }),
    chrome.action.setBadgeText({ tabId, text: '!' }),
    chrome.action.setTitle({ tabId, title: message }),
  ]);
}

async function notifyPanel(tabId: number, type: 'LEARNR_COMMAND_AVAILABLE' | 'LEARNR_FOCUS_COMPOSER', injected: boolean): Promise<void> {
  await Promise.allSettled(injected
    ? [chrome.tabs.sendMessage(tabId, { type, tabId })]
    : [chrome.runtime.sendMessage({ type, tabId })]);
}

function enableNativeActionToggle(): Promise<boolean> {
  if (IS_ARC_BUILD) return Promise.resolve(false);
  if (!chrome.sidePanel?.setPanelBehavior) return Promise.resolve(false);
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => true).catch(() => false);
}

const nativeActionToggle = enableNativeActionToggle();

function isLearnrPage(value = ''): boolean {
  return isAccessibleTabUrl(value);
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const pdfDownloads = new Map<string, AbortController>();

async function readPdf(url: string, jobId: string) {
  const controller = new AbortController(); pdfDownloads.set(jobId, controller);
  const startedAt = Date.now();
  const progress = (stage: string, detail: object = {}) => void chrome.runtime.sendMessage({ type: 'LEARNR_PDF_PROGRESS', jobId, progress: { stage, startedAt, ...detail } }).catch(() => undefined);
  progress('downloading', { receivedBytes: 0 });
  const response = await fetch(url, { credentials: 'include', signal: controller.signal });
  if (!response.ok) throw new Error(`The PDF could not be downloaded (${response.status}).`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_PDF_BYTES) throw new Error('This PDF is larger than learnr’s 50 MB limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The PDF download returned no data.');
  const chunks: Uint8Array[] = []; let received = 0;
  try {
    while (true) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => { idleTimer = setTimeout(() => { controller.abort(); reject(new Error('The PDF download stopped receiving data for 30 seconds.')); }, 30_000); });
      const result = await Promise.race([reader.read(), idle]); if (idleTimer) clearTimeout(idleTimer);
      if (result.done) break;
      received += result.value.byteLength;
      if (received > MAX_PDF_BYTES) { controller.abort(); throw new Error('This PDF is larger than learnr’s 50 MB limit.'); }
      chunks.push(result.value); progress('downloading', { receivedBytes: received, totalBytes: declared || undefined });
    }
  } finally { pdfDownloads.delete(jobId); }
  const bytes = new Uint8Array(received); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The selected address did not return a valid PDF.');
  progress('preparing', { receivedBytes: received, totalBytes: declared || received });
  const assetId = jobId;
  const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'document.pdf');
  await putPdfAsset({ id: assetId, url, filename, mimeType: 'application/pdf', byteSize: bytes.byteLength, blob: new Blob([bytes], { type: 'application/pdf' }), createdAt: Date.now() });
  return { assetId, byteSize: bytes.byteLength, filename };
}

async function closeInjectedPanel(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'LEARNR_CLOSE_PANEL' }).catch(() => undefined);
  // Also remove an orphaned host left by an older, invalidated content-script
  // context after an extension reload. Such a context cannot receive messages.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.getElementById('learnr-extension-root')?.remove(),
  }).catch(() => undefined);
}

async function openLearnr(tab: chrome.tabs.Tab, command?: string): Promise<void> {
  if (IS_ARC_BUILD) {
    if (command && tab.id && isLearnrCommandName(command)) await queuePendingCommand(command, tab.id);
    if (tab.id) await closeInjectedPanel(tab.id);
    await openSplitReader(tab);
    if (tab.id) await notifyPanel(tab.id, command ? 'LEARNR_COMMAND_AVAILABLE' : 'LEARNR_FOCUS_COMPOSER', false);
    return;
  }
  if (!tab.id) return;
  if (!isLearnrPage(tab.url)) {
    await showActionError(tab.id, 'learnr works on ordinary webpages and accessible PDF files.');
    return;
  }
  void clearActionFeedback(tab.id);
  // Call sidePanel.open before awaiting storage so the keyboard command's user
  // activation is still live. Awaiting first causes Chrome to reject the call.
  const nativeOpen = !IS_ARC_BUILD
    && typeof chrome.sidePanel?.open === 'function' && tab.windowId !== undefined
    ? chrome.sidePanel.open({ windowId: tab.windowId })
    : null;
  const queued = command && isLearnrCommandName(command) ? queuePendingCommand(command, tab.id) : Promise.resolve();
  await queued;

  if (nativeOpen) {
    try {
      await nativeOpen;
      await closeInjectedPanel(tab.id);
      await notifyPanel(tab.id, command ? 'LEARNR_COMMAND_AVAILABLE' : 'LEARNR_FOCUS_COMPOSER', false);
      return;
    } catch (error) {
      if (await nativeActionToggle) {
        // A working native panel may already be open. Never interpret that as a
        // reason to launch the injected fallback beside it.
        await closeInjectedPanel(tab.id);
        await notifyPanel(tab.id, command ? 'LEARNR_COMMAND_AVAILABLE' : 'LEARNR_FOCUS_COMPOSER', false);
        const detail = error instanceof Error ? error.message : String(error);
        void showActionError(tab.id, `learnr could not open its native panel: ${detail}`);
        return;
      }
    }
  }

  try {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: command ? 'LEARNR_OPEN_PANEL' : 'LEARNR_TOGGLE_PANEL' });
    await notifyPanel(tab.id, command ? 'LEARNR_COMMAND_AVAILABLE' : 'LEARNR_FOCUS_COMPOSER', true);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await showActionError(tab.id, `learnr could not open on this page: ${detail}`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void enableNativeActionToggle();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (IS_ARC_BUILD) { await openLearnr(tab); return; }
  if (!tab.id) return;
  if (!isLearnrPage(tab.url)) {
    await showActionError(tab.id, 'learnr works on ordinary webpages and accessible PDF files.');
    return;
  }
  void clearActionFeedback(tab.id);
  if (await nativeActionToggle) {
    // Chrome itself toggles the native panel for action clicks, including the
    // reserved _execute_action keyboard command.
    await closeInjectedPanel(tab.id);
    await notifyPanel(tab.id, 'LEARNR_FOCUS_COMPOSER', false);
    return;
  }
  await openLearnr(tab);
});

async function createConnectedTab(args: { historyId?: string; parentPageId?: string; parentTabId?: number }): Promise<chrome.tabs.Tab> {
  let parentTabId = args.parentTabId; let historyId = args.historyId; let parentPageId = args.parentPageId;
  if (historyId && (!parentTabId || !parentPageId)) { const session = await loadConversationSession(historyId); const parent = session?.pages.find((page) => page.id === parentPageId) ?? session?.pages.find((page) => page.id === session.activePageId); parentTabId ??= parent?.tabId; parentPageId ??= parent?.id; }
  let parent: chrome.tabs.Tab | undefined; if (parentTabId) parent = await chrome.tabs.get(parentTabId).catch(() => undefined);
  // Omitting the URL lets each browser create its own native new-tab surface.
  // Arc does not accept Chrome's chrome://newtab/ URL from extension contexts.
  const created = await chrome.tabs.create({ active: true, ...(parent ? { windowId: parent.windowId, index: parent.index + 1, openerTabId: parent.id } : {}) });
  if (historyId && parentPageId) await attachTabToConversation(historyId, parentPageId, created, 'manual');
  else if (parentTabId) { const attached = await attachSpawnedTab(parentTabId, created, 'manual'); if (!attached) { await chrome.tabs.remove(created.id!); throw new Error('Open a connected learnr conversation before creating a connected tab.'); } }
  else { await chrome.tabs.remove(created.id!); throw new Error('Open a connected learnr conversation before creating a connected tab.'); }
  return created;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === OPEN_CONNECTED_TAB_COMMAND) { void loadGlobalSettings().then((global) => { if (!global.keyboardShortcutsEnabled) return; const activeTabId = tab?.id; if (!activeTabId) throw new Error('No active browser tab is available.'); return createConnectedTab({ parentTabId: activeTabId }); }).catch(async (error) => { if (!tab?.id) return; await openLearnr(tab); await chrome.runtime.sendMessage({ type: 'LEARNR_CONNECTED_TAB_REQUIRED', tabId: tab.id, detail: error instanceof Error ? error.message : String(error) }).catch(() => undefined); }); return; }
  if (!isLearnrCommandName(command)) return;
  void loadGlobalSettings().then((global) => { if (!global.keyboardShortcutsEnabled) return; return tab?.id ? openLearnr(tab, command) : chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => { if (active) return openLearnr(active, command); }); });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'learnr-background' && message.type === 'LEARNR_OFFSCREEN_READY') {
    const capture = activeMediaCapture;
    if (!capture || capture.jobId !== message.jobId) return;
    void chrome.tabs.sendMessage(capture.tabId, { type: 'LEARNR_MEDIA_PLAY', jobId: capture.jobId, startSeconds: capture.startSeconds }).then((result) => {
      if (!result?.ok) return stopMediaCapture(result?.error ?? 'The source video could not play.', true);
      return broadcastMedia({ type: 'LEARNR_MEDIA_TRANSCRIPTION_STARTED', jobId: capture.jobId, tabId: capture.tabId });
    }).catch((error) => stopMediaCapture(error instanceof Error ? error.message : String(error), true));
    sendResponse({ ok: true }); return;
  }
  if (message?.target === 'learnr-background' && message.type === 'LEARNR_OFFSCREEN_SEGMENT') {
    if (activeMediaCapture?.jobId === message.jobId) void broadcastMedia({ ...message, target: undefined, type: 'LEARNR_MEDIA_TRANSCRIPTION_SEGMENT' });
    sendResponse({ ok: true }); return;
  }
  if (message?.target === 'learnr-background' && message.type === 'LEARNR_OFFSCREEN_DONE') {
    const capture = activeMediaCapture;
    if (capture && capture.jobId === message.jobId) {
      const jobId = capture.jobId;
      activeMediaCapture = null;
      void restoreCapturedTab(capture).then(() => broadcastMedia({ type: 'LEARNR_MEDIA_TRANSCRIPTION_CAPTURE_DONE', jobId, cancelled: Boolean(message.cancelled) }));
    }
    sendResponse({ ok: true }); return;
  }
  if (message?.target === 'learnr-background' && message.type === 'LEARNR_OFFSCREEN_ERROR') {
    const capture = activeMediaCapture;
    if (capture && capture.jobId === message.jobId) {
      const jobId = capture.jobId;
      activeMediaCapture = null;
      void restoreCapturedTab(capture).then(() => broadcastMedia({ type: 'LEARNR_MEDIA_TRANSCRIPTION_FAILED', jobId, error: String(message.error ?? 'Audio recording failed.') }));
    }
    sendResponse({ ok: true }); return;
  }
  if (message?.target === 'learnr-background' && message.type === 'LEARNR_MEDIA_PLAYBACK_PROGRESS') {
    const capture = activeMediaCapture;
    if (!capture || capture.jobId !== message.jobId) return;
    const adPlaying = Boolean(message.adPlaying);
    if (adPlaying !== capture.adPlaying) {
      capture.adPlaying = adPlaying;
      void chrome.runtime.sendMessage({ target: 'learnr-offscreen', type: adPlaying ? 'LEARNR_OFFSCREEN_PAUSE' : 'LEARNR_OFFSCREEN_RESUME', jobId: capture.jobId }).catch(() => undefined);
    }
    void broadcastMedia({ type: 'LEARNR_MEDIA_TRANSCRIPTION_PROGRESS', jobId: capture.jobId, currentSeconds: message.currentSeconds, durationSeconds: message.durationSeconds, adPlaying });
    sendResponse({ ok: true }); return;
  }
  if (message?.target === 'learnr-background' && message.type === 'LEARNR_MEDIA_PLAYBACK_DONE') {
    if (activeMediaCapture?.jobId === message.jobId) void stopMediaCapture('', false);
    sendResponse({ ok: true }); return;
  }
  if (message?.type === 'LEARNR_MEDIA_TRANSCRIPTION_START') {
    void startMediaCapture({ jobId: String(message.jobId), tabId: Number(message.tabId), startSeconds: Number(message.startSeconds ?? 0), startIndex: Number(message.startIndex ?? 0), expectedUrl: String(message.expectedUrl ?? ''), ownerInstanceId: String(message.ownerInstanceId ?? '') }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_MEDIA_TRANSCRIPTION_STOP') {
    if (activeMediaCapture?.jobId !== String(message.jobId)) { sendResponse({ ok: false, error: 'That transcription is no longer active.' }); return; }
    void stopMediaCapture('Transcription stopped. Completed segments will be preserved.', true).then(() => sendResponse({ ok: true })); return true;
  }
  if (message?.type === 'LEARNR_MEDIA_TRANSCRIPTION_BACKPRESSURE') {
    const capture = activeMediaCapture;
    if (!capture || capture.jobId !== String(message.jobId)) { sendResponse({ ok: false }); return; }
    const paused = Boolean(message.paused);
    void Promise.all([
      chrome.tabs.sendMessage(capture.tabId, { type: 'LEARNR_MEDIA_BACKPRESSURE', jobId: capture.jobId, paused }).catch(() => undefined),
      chrome.runtime.sendMessage({ target: 'learnr-offscreen', type: paused ? 'LEARNR_OFFSCREEN_PAUSE' : 'LEARNR_OFFSCREEN_RESUME', jobId: capture.jobId }).catch(() => undefined),
    ]).then(() => sendResponse({ ok: true })); return true;
  }
  if (message?.type === 'LEARNR_OPEN_CONNECTED_TAB') {
    void createConnectedTab({ historyId: String(message.historyId ?? ''), parentPageId: String(message.parentPageId ?? ''), parentTabId: Number(message.parentTabId) || undefined }).then((tab) => sendResponse({ ok: true, tabId: tab.id })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_CONVERSATION_OPERATION_CLAIM') {
    const conversationId = String(message.conversationId ?? ''); const instanceId = String(message.instanceId ?? '');
    const existing = conversationOperations.get(conversationId);
    if (existing && existing.instanceId !== instanceId) { sendResponse({ ok: false, error: `A ${existing.kind} operation is already running for this conversation.` }); return; }
    const operation: ConversationOperation = { conversationId, instanceId, operationId: String(message.operationId ?? crypto.randomUUID()), kind: message.kind, startedAt: Date.now() };
    conversationOperations.set(conversationId, operation); sendResponse({ ok: true, operation }); return;
  }
  if (message?.type === 'LEARNR_CONVERSATION_OPERATION_RELEASE') {
    const conversationId = String(message.conversationId ?? ''); const existing = conversationOperations.get(conversationId);
    if (existing?.instanceId === String(message.instanceId ?? '') && (!message.operationId || existing.operationId === message.operationId)) conversationOperations.delete(conversationId);
    sendResponse({ ok: true }); return;
  }
  if (message?.type === 'LEARNR_CONVERSATION_OPERATION_STATUS') {
    sendResponse({ ok: true, operation: conversationOperations.get(String(message.conversationId ?? '')) ?? null }); return;
  }
  if (message?.type === 'LEARNR_AUTOGROUP_SCAN') {
    void scanAutoGroupTabs().then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_DUPLICATES_SCAN') {
    void scanDuplicateTabs().then((sets) => sendResponse({ ok: true, sets })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_DUPLICATES_REMOVE') {
    void removeDuplicateTabs(Array.isArray(message.requests) ? message.requests : []).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_AUTOGROUP_APPLY') {
    void applyAutoGroupAssignments(Array.isArray(message.assignments) ? message.assignments as AutoGroupAssignment[] : []).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), refreshRequired: String(error).includes('Refresh the AutoGroup preview') }));
    return true;
  }
  if (message?.type === 'LEARNR_AUTOGROUP_UNDO_STATUS') {
    void validateAutoGroupUndo().then((status) => sendResponse({ ok: true, ...status, snapshot: undefined })).catch((error) => sendResponse({ ok: false, available: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_AUTOGROUP_UNDO') {
    void undoAutoGroup().then((count) => sendResponse({ ok: true, count })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_FACTORY_RESET') {
    void chrome.storage.local.get('learnr.globalSettings').then(async (stored) => {
      const global = stored['learnr.globalSettings'] as { workspaces?: Array<{ id?: string }>; embeddingProfiles?: Array<{ id?: string }> } | undefined;
      const workspaceIds = [...new Set(['default', ...(global?.workspaces ?? []).flatMap((workspace) => workspace.id ? [workspace.id] : [])])];
      const profileIds = [...new Set([...workspaceIds, ...(global?.embeddingProfiles ?? []).flatMap((profile) => profile.id ? [profile.id] : [])])];
      await Promise.all([
        clearAllSessions(), clearHistoryRecords(), clearImageAssets(), clearMediaCaches(), clearUsageEvents(),
        ...profileIds.map((profileId) => deleteWorkspaceHandles(profileId)),
        ...profileIds.map((profileId) => deleteWorkspaceNoteIndex(profileId)),
      ]);
      await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]);
    }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_WORKSPACE_DELETE') {
    const workspaceId = String(message.workspaceId);
    void Promise.all([getAllHistoryRecords(), chrome.storage.local.get('learnr.globalSettings')]).then(async ([records, stored]) => {
      const targets = records.filter((record) => (record.workspaceId ?? 'default') === workspaceId);
      const global = stored['learnr.globalSettings'] as { embeddingProfiles?: Array<{ id?: string; workspaceId?: string }> } | undefined;
      const profileIds = (global?.embeddingProfiles ?? []).filter((profile) => profile.workspaceId === workspaceId).flatMap((profile) => profile.id ? [profile.id] : []);
      await Promise.all(targets.map((record) => Promise.all([deleteHistoryRecord(record.id), deleteImageAssetsForHistory(record.id)])));
      const localKeys = workspaceId === 'default' ? ['learnr.lifetimeStats', 'learnr.tokenUsageWindow'] : [`learnr.lifetimeStats.${workspaceId}`, `learnr.tokenUsageWindow.${workspaceId}`];
      await Promise.all([deleteWorkspaceStorage(workspaceId), deleteUsageEventsForWorkspace(workspaceId), deleteWorkspaceVaultHandles(workspaceId), deleteMediaCachesForWorkspace(workspaceId), ...profileIds.map((id) => deleteWorkspaceHandles(id)), ...profileIds.map((id) => deleteWorkspaceNoteIndex(id)), chrome.storage.local.remove(localKeys)]);
    }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_TAB_MESSAGE') {
    void chrome.tabs.sendMessage(Number(message.tabId), message.payload).then((value) => sendResponse({ ok: true, value })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_GET_TAB') {
    void chrome.tabs.get(Number(message.tabId)).then((tab) => sendResponse({ ok: true, tab })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_ACTIVE_TAB_GET') {
    if (IS_ARC_BUILD) {
      void getReadingTab(Number(message.readerWindowId) || sender.tab?.windowId).then((tab) => sendResponse({ ok: true, tab })).catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => sendResponse({ ok: true, tab: tab ?? null })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_TAB_ACTIVATE') {
    const tabId = Number(message.tabId);
    void chrome.tabs.update(tabId, { active: true }).then(async (tab) => {
      if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_TAB_COUNT') {
    void chrome.tabs.query({ windowType: 'normal' }).then((tabs) => sendResponse({ ok: true, count: tabs.length })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_COMMANDS_GET') {
    void chrome.commands.getAll().then((commands) => sendResponse({ ok: true, commands })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_TABS_LIST') {
    void chrome.tabs.query({}).then(async (tabs) => {
      if (IS_ARC_BUILD) { sendResponse({ ok: true, tabs, groups: [] }); return; }
      const groupIds = [...new Set(tabs.map((tab) => tab.groupId).filter((id) => typeof id === 'number' && id >= 0))];
      const groups = await Promise.all(groupIds.map((id) => chrome.tabGroups.get(id).catch(() => null)));
      sendResponse({ ok: true, tabs, groups: groups.filter(Boolean) });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_TAB_GROUP_GET') {
    const tabId = Number(message.tabId);
    void chrome.tabs.get(tabId).then(async (tab) => {
      if (IS_ARC_BUILD) return { tab, group: null, tabs: [] };
      if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return { tab, group: null, tabs: [] };
      return { tab, group: await chrome.tabGroups.get(tab.groupId), tabs: await chrome.tabs.query({ groupId: tab.groupId }) };
    }).then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_OPEN_EXTENSION_TAB') {
    const path = String(message.path ?? '');
    if (!/^(?:sidepanel|history|note|microphone)\.html(?:\?|$)/.test(path)) { sendResponse({ ok: false, error: 'That learnr page is not available.' }); return; }
    void chrome.tabs.create({ url: chrome.runtime.getURL(path), active: true }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_OPEN_BROWSER_TAB') {
    const url = String(message.url ?? '');
    if (!isAccessibleTabUrl(url)) { sendResponse({ ok: false, error: 'That page cannot be opened by Learnr.' }); return; }
    void chrome.tabs.create({ url, active: true }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_OPEN_SHORTCUTS') {
    void chrome.tabs.create({ url: EXTENSION_SHORTCUTS_URL, active: true }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_COMMAND_TAKE') {
    const tabId = Number(message.tabId);
    void takePendingCommand(tabId).then((command) => sendResponse({ ok: true, command })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_IMAGE_ASSET_PUT') {
    void materializeImage(message).then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_IMAGE_MATERIALIZE') {
    void materializeImage({ ...message, temporary: true }).then((value) => sendResponse({ ok: true, ...value })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_IMAGE_ASSET_GET') {
    void getImageAsset(String(message.assetId)).then(async (asset) => asset
      ? sendResponse({ ok: true, dataUrl: await blobDataUrl(asset.blob), mimeType: asset.mimeType, byteSize: asset.blob.size })
      : sendResponse({ ok: false, error: 'The saved image data is unavailable.' }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_IMAGE_ASSET_DELETE') {
    void deleteImageAssetRecord(String(message.assetId)).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_DOCUMENT_INSPECT') {
    const tabId = Number(message.tabId);
    void chrome.tabs.get(tabId).then(async (tab) => {
      const url = tab.url ?? '';
      let pdf = isPdfUrl(url);
      if (!pdf && /^https?:/i.test(url)) {
        // Read the already loaded document first. Fetching it again can stall
        // split-pane context updates on offline, cached, or authenticated pages.
        const documents = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.contentType }).catch(() => []);
        const contentType = documents[0]?.result;
        if (typeof contentType === 'string' && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
          sendResponse({ ok: true, pdf: false, url, title: tab.title });
          return;
        }
        if (contentType === 'application/pdf') pdf = true;
      }
      if (url.startsWith('http')) {
        const response = await fetch(url, { method: 'HEAD', credentials: 'include', signal: AbortSignal.timeout(3000) }).catch(() => null);
        pdf ||= response?.headers.get('content-type')?.toLowerCase().includes('application/pdf') ?? false;
        if (!pdf) {
          const signature = await fetch(url, { headers: { Range: 'bytes=0-4' }, credentials: 'include', signal: AbortSignal.timeout(3000) }).then(async (result) => {
            const reader = result.body?.getReader(); if (!reader) return null;
            const first = await reader.read(); await reader.cancel();
            return first.value?.subarray(0, 5) ?? null;
          }).catch(() => null);
          pdf = Boolean(signature && String.fromCharCode(...signature) === '%PDF-');
        }
      }
      sendResponse({ ok: true, pdf, url, title: tab.title });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_PDF_READ') {
    const jobId = String(message.jobId || crypto.randomUUID());
    void readPdf(String(message.url), jobId).then((value) => sendResponse({ ok: true, jobId, ...value })).catch((error) => sendResponse({ ok: false, jobId, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_PDF_CANCEL') {
    pdfDownloads.get(String(message.jobId))?.abort(); pdfDownloads.delete(String(message.jobId)); sendResponse({ ok: true }); return;
  }
  if ((message?.type === 'LEARNR_SOURCE_HIGHLIGHT_CREATED' || message?.type === 'LEARNR_SOURCE_HIGHLIGHTS_RESOLVED' || message?.type === 'LEARNR_SOURCE_ASK' || message?.type === 'LEARNR_SOURCE_MEDIA_HIGHLIGHT') && sender.tab?.id) {
    void chrome.runtime.sendMessage({ ...message, tabId: sender.tab.id }).catch(() => undefined);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === 'LEARNR_HISTORY_PUT') {
    void putHistoryRecord(message.record).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_HISTORY_GET') {
    void getHistoryRecord(String(message.id)).then((record) => sendResponse({ ok: true, record })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_HISTORY_SELECT') {
    void chrome.storage.session.set({ learnrPendingHistoryId: String(message.id) }).then(async () => {
      await chrome.runtime.sendMessage({ type: 'LEARNR_HISTORY_SELECTED', id: String(message.id) }).catch(() => undefined); sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })); return true;
  }
  if (message?.type === 'LEARNR_HISTORY_SELECTION_TAKE') {
    void chrome.storage.session.get('learnrPendingHistoryId').then(async (value) => { await chrome.storage.session.remove('learnrPendingHistoryId'); sendResponse({ ok: true, id: value.learnrPendingHistoryId }); }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })); return true;
  }
  if (message?.type === 'LEARNR_HISTORY_LIST') {
    void getAllHistoryRecords().then((records) => records.filter((record) => !message.workspaceId || (record.workspaceId ?? 'default') === message.workspaceId)).then((records) => sendResponse({ ok: true, records: records.map(({ id, title, url, lastInteractedAt, provider, model, pages, workspaceId }) => ({ id, title, url, lastInteractedAt, provider, model, workspaceId: workspaceId ?? 'default', pageCount: pages.length, pageUrls: pages.map((page) => page.context.url) })) })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_HISTORY_ALL') {
    void getAllHistoryRecords().then((records) => records.filter((record) => !message.workspaceId || (record.workspaceId ?? 'default') === message.workspaceId)).then((fullRecords) => sendResponse({ ok: true, fullRecords })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_HISTORY_DELETE') {
    const id = String(message.id);
    void Promise.all([deleteHistoryRecord(id), deleteSessionsForHistory(id), deleteImageAssetsForHistory(id)]).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_HISTORY_CLEAR') {
    void getAllHistoryRecords().then(async (records) => {
      const targets = records.filter((record) => !message.workspaceId || (record.workspaceId ?? 'default') === message.workspaceId);
      await Promise.all(targets.map((record) => Promise.all([deleteHistoryRecord(record.id), deleteSessionsForHistory(record.id), deleteImageAssetsForHistory(record.id)])));
      if (!message.workspaceId) await Promise.all([clearAllSessions(), clearImageAssets(), clearMediaCaches()]);
      else await deleteMediaCachesForWorkspace(String(message.workspaceId));
    }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_STATS_ADD') {
    void addLifetimeStats(message.delta ?? {}, message.workspaceId).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_USAGE_EVENT_ADD') {
    void putUsageEvent(message.event).then(() => addLifetimeStats({ totalTokens: Number(message.event?.totalTokens) || 0, totalCostUsd: Number(message.event?.costUsd) || 0 }, message.event?.workspaceId)).then(async () => { await chrome.runtime.sendMessage({ type: 'LEARNR_USAGE_EVENT_ADDED' }).catch(() => undefined); sendResponse({ ok: true }); }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_PAGE_THEME_DETECTED' && sender.tab?.id) {
    void chrome.runtime.sendMessage({ type: 'LEARNR_PAGE_THEME_CHANGED', tabId: sender.tab.id, theme: message.theme }).catch(() => undefined);
    return;
  }
  if (message?.type === 'LEARNR_GET_TAB_ID') {
    if (IS_ARC_BUILD && (!sender.tab || isLearnrTab(sender.tab))) {
      void getReadingTab(Number(message.readerWindowId) || sender.tab?.windowId).then((tab) => sendResponse({ tabId: tab?.id })).catch(() => sendResponse({}));
      return true;
    }
    if (sender.tab?.id) {
      sendResponse({ tabId: sender.tab.id });
    } else {
      void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => sendResponse({ tabId: tab?.id }));
      return true;
    }
    return;
  }
  if (message?.type !== 'LEARNR_ENSURE_CONTENT') return;
  const tabId = message.tabId as number;
  void ensureContentScript(tabId).then(() => sendResponse({ ok: true })).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeMediaCapture?.tabId === tabId) void stopMediaCapture('Transcription stopped because its source tab was closed.', true);
  void invalidateAutoGroupUndoForTab(tabId);
  void chrome.runtime.sendMessage({ type: 'LEARNR_LINKED_TAB_REMOVED', tabId }).catch(() => undefined);
  void loadGlobalSettings().then((global) => handleConnectedTabClosed(tabId, global.closedConnectedTabBehavior)).then(async (sessions) => {
    for (const session of sessions) {
      const record = await getHistoryRecord(session.historyId);
      if (!record) continue;
      const active = session.pages.find((page) => page.id === session.activePageId) ?? session.pages[0];
      await putHistoryRecord({ ...record, ...(active ? { title: active.context.title, url: active.context.url, context: active.context } : {}), pages: session.pages, activePageId: session.activePageId, sourceHighlights: session.sourceHighlights, lastInteractedAt: Date.now() });
      await chrome.runtime.sendMessage({ type: 'LEARNR_CONNECTED_SOURCES_CHANGED', historyId: session.historyId }).catch(() => undefined);
    }
  }).catch(() => undefined);
});

function broadcastActiveTab(tabId: number): void {
  void (pendingTabAttachments.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(() => chrome.tabs.get(tabId)).then(async (tab) => {
    if (IS_ARC_BUILD) {
      const reading = await getReadingTab(tab.windowId);
      if (!reading) return;
      return chrome.runtime.sendMessage({ type: 'LEARNR_ACTIVE_TAB_CHANGED', ...classifyTabAccess(reading) });
    }
    if (!tab.active) return;
    return chrome.runtime.sendMessage({ type: 'LEARNR_ACTIVE_TAB_CHANGED', ...classifyTabAccess(tab) });
  }).catch(() => undefined);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (activeMediaCapture?.tabId === tabId && changeInfo.url && changeInfo.url !== activeMediaCapture.url) void stopMediaCapture('Transcription stopped because the source tab navigated to another page.', true);
  notifyTopologyChanged();
  if (changeInfo.status === 'complete') {
    void chrome.runtime.sendMessage({ type: 'LEARNR_TAB_READY', tabId }).catch(() => undefined);
    void chrome.runtime.sendMessage({ type: 'LEARNR_TAB_NAVIGATED', tabId }).catch(() => undefined);
    void chrome.tabs.get(tabId).then(updateConnectedTabMetadata).then((session) => { if (session) return chrome.runtime.sendMessage({ type: 'LEARNR_CONNECTED_SOURCES_CHANGED', historyId: session.historyId }); }).catch(() => undefined);
  }
  if (changeInfo.url) {
    void chrome.tabs.get(tabId).then(updateConnectedTabMetadata).then((session) => { if (session) return chrome.runtime.sendMessage({ type: 'LEARNR_CONNECTED_SOURCES_CHANGED', historyId: session.historyId }); }).catch(() => undefined);
    void chrome.runtime.sendMessage({ type: 'LEARNR_TAB_NAVIGATED', tabId }).catch(() => undefined);
    void chrome.tabs.sendMessage(tabId, { type: 'LEARNR_TAB_NAVIGATED', tabId }).catch(() => undefined);
  }
  if (changeInfo.url || changeInfo.status === 'complete') broadcastActiveTab(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  broadcastActiveTab(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (IS_ARC_BUILD) {
    void getReadingTab().then((tab) => { if (tab?.id != null) broadcastActiveTab(tab.id); }).catch(() => undefined);
    return;
  }
  void chrome.tabs.query({ active: true, windowId }).then(([tab]) => { if (tab?.id != null) broadcastActiveTab(tab.id); }).catch(() => undefined);
});


function notifyTopologyChanged() {
  void chrome.runtime.sendMessage({ type: 'LEARNR_TAB_TOPOLOGY_CHANGED' }).catch(() => undefined);
  if (!autoGroupMutationDepth) void validateAutoGroupUndo().catch(() => undefined);
}
if (!IS_ARC_BUILD) {
  chrome.tabGroups.onCreated.addListener(notifyTopologyChanged);
  chrome.tabGroups.onUpdated.addListener(notifyTopologyChanged);
  chrome.tabGroups.onRemoved.addListener(notifyTopologyChanged);
}
chrome.tabs.onCreated.addListener((tab) => {
  notifyTopologyChanged();
  if (!tab.id || !tab.openerTabId || tab.pinned || (tab.url && !/^https?:/i.test(tab.url))) return;
  const pending = chrome.windows.get(tab.windowId).then((window) => { if (window.type !== 'normal') return null; return attachSpawnedTab(tab.openerTabId!, tab); }).then((session) => { if (session) return chrome.runtime.sendMessage({ type: 'LEARNR_CONNECTED_SOURCES_CHANGED', historyId: session.historyId, tabId: tab.id }); }).catch(() => undefined).finally(() => pendingTabAttachments.delete(tab.id!)); pendingTabAttachments.set(tab.id, pending);
});
chrome.tabs.onMoved.addListener((tabId) => { notifyTopologyChanged(); void invalidateAutoGroupUndoForTab(tabId); });
chrome.tabs.onAttached.addListener((tabId) => { notifyTopologyChanged(); void invalidateAutoGroupUndoForTab(tabId); });
chrome.tabs.onDetached.addListener((tabId) => { notifyTopologyChanged(); void invalidateAutoGroupUndoForTab(tabId); });
