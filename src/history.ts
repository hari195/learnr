import type { ChatHistoryRecord, ChatHistorySummary } from './types';
import { openExtensionTab } from './browser-bridge';
import { IS_ARC_BUILD } from './build-target';
import { getActiveWorkspaceId, setActiveWorkspace } from './workspaces';

type HistorySuccess = { ok: true; record?: ChatHistoryRecord | null; records?: ChatHistorySummary[] };
type HistoryResponse = HistorySuccess | { ok: false; error: string };

async function request<T>(message: object, select: (response: HistorySuccess) => T): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as HistoryResponse;
  if (!response?.ok) throw new Error(response?.error || 'Could not access chat history.');
  return select(response);
}

export function sortHistory<T extends ChatHistorySummary>(records: T[]): T[] {
  return [...records].sort((a, b) => b.lastInteractedAt - a.lastInteractedAt);
}

export function filterRecentHistory<T extends ChatHistorySummary>(records: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return sortHistory(records);
  return sortHistory(records.filter((record) => [record.title, record.url, ...(record.pageUrls ?? [])]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))));
}

export function formatHistoryTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return formatHistoryDate(timestamp);
}

export function formatHistoryDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

export async function saveHistory(record: ChatHistoryRecord): Promise<void> {
  const workspaceId = record.workspaceId ?? await getActiveWorkspaceId();
  await request({ type: 'LEARNR_HISTORY_PUT', record: { ...record, workspaceId } }, () => undefined);
}

export async function loadHistory(id: string): Promise<ChatHistoryRecord | null> {
  return request({ type: 'LEARNR_HISTORY_GET', id }, (response) => response.record ?? null);
}

export async function listHistory(scope: 'active' | 'all' = 'active'): Promise<ChatHistorySummary[]> {
  return request({ type: 'LEARNR_HISTORY_LIST', workspaceId: scope === 'active' ? await getActiveWorkspaceId() : undefined }, (response) => sortHistory(response.records ?? []));
}

export async function listFullHistory(scope: 'active' | 'all' = 'active'): Promise<ChatHistoryRecord[]> {
  return request({ type: 'LEARNR_HISTORY_ALL', workspaceId: scope === 'active' ? await getActiveWorkspaceId() : undefined }, (response) => ((response as HistorySuccess & { fullRecords?: ChatHistoryRecord[] }).fullRecords ?? []));
}

export async function openHistoryChat(id: string): Promise<void> {
  await openExtensionTab(`sidepanel.html?history=${encodeURIComponent(id)}`);
}

export async function openStandaloneConversation(id: string): Promise<void> {
  await openExtensionTab(`sidepanel.html?mode=standalone&conversation=${encodeURIComponent(id)}`);
}

export async function selectHistoryChatInPanel(id: string, workspaceId?: string): Promise<void> {
  if (workspaceId) await setActiveWorkspace(workspaceId);
  if (IS_ARC_BUILD) {
    await openStandaloneConversation(id);
    return;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (chrome.sidePanel?.open && active?.windowId != null) await chrome.sidePanel.open({ windowId: active.windowId });
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_HISTORY_SELECT', id }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not show this conversation in learnr.');
}

export async function openHistoryPage(): Promise<void> {
  await openExtensionTab('history.html');
}

export async function deleteHistory(id: string): Promise<void> {
  await request({ type: 'LEARNR_HISTORY_DELETE', id }, () => undefined);
}

export async function clearHistory(): Promise<void> {
  await request({ type: 'LEARNR_HISTORY_CLEAR', workspaceId: await getActiveWorkspaceId() }, () => undefined);
}

export function latestHistoryForUrl(records: ChatHistorySummary[], url: string): ChatHistorySummary | null {
  const comparableUrl = (value: string) => {
    try { const parsed = new URL(value); parsed.hash = ''; return parsed.href; } catch { return value; }
  };
  const target = comparableUrl(url);
  return sortHistory(records.filter((record) => (record.pageUrls?.length ? record.pageUrls : [record.url]).some((url) => comparableUrl(url) === target)))[0] ?? null;
}
