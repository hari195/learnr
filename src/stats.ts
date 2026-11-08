import type { LifetimeStats, ProviderUsage } from './types';
import { getActiveWorkspaceId, LEGACY_WORKSPACE_ID } from './workspaces';

export const LIFETIME_STATS_KEY = 'learnr.lifetimeStats';
const statsKey = (workspaceId: string) => workspaceId === LEGACY_WORKSPACE_ID ? LIFETIME_STATS_KEY : `${LIFETIME_STATS_KEY}.${workspaceId}`;
export const EMPTY_LIFETIME_STATS: LifetimeStats = { notesSaved: 0, noteWords: 0, totalTokens: 0, totalCostUsd: 0, timeSavedMinutes: 0 };

export function normalizeLifetimeStats(value?: Partial<LifetimeStats>): LifetimeStats {
  return { ...EMPTY_LIFETIME_STATS, ...value };
}

export function countWords(markdown: string): number {
  return markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
}

export function savedNoteStats(markdown: string): Partial<LifetimeStats> {
  const noteWords = countWords(markdown);
  return { notesSaved: 1, noteWords, timeSavedMinutes: noteWords / 40 };
}

export function usageStats(usage: ProviderUsage): Partial<LifetimeStats> {
  return { totalTokens: usage.totalTokens, totalCostUsd: usage.costUsd };
}

export async function loadLifetimeStats(workspaceId?: string): Promise<LifetimeStats> {
  const key = statsKey(workspaceId ?? await getActiveWorkspaceId());
  const result = await chrome.storage.local.get(key);
  return normalizeLifetimeStats(result[key] as Partial<LifetimeStats> | undefined);
}

let updateQueue: Promise<LifetimeStats> = Promise.resolve(EMPTY_LIFETIME_STATS);
export function addLifetimeStats(delta: Partial<LifetimeStats>, workspaceId?: string): Promise<LifetimeStats> {
  updateQueue = updateQueue.catch(() => EMPTY_LIFETIME_STATS).then(async () => {
    const id = workspaceId ?? await getActiveWorkspaceId();
    const current = await loadLifetimeStats(id);
    const next = {
      notesSaved: current.notesSaved + (delta.notesSaved ?? 0),
      noteWords: current.noteWords + (delta.noteWords ?? 0),
      totalTokens: current.totalTokens + (delta.totalTokens ?? 0),
      totalCostUsd: current.totalCostUsd + (delta.totalCostUsd ?? 0),
      timeSavedMinutes: current.timeSavedMinutes + (delta.timeSavedMinutes ?? 0),
    };
    await chrome.storage.local.set({ [statsKey(id)]: next });
    return next;
  });
  return updateQueue;
}

export async function recordLifetimeStats(delta: Partial<LifetimeStats>, workspaceId?: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_STATS_ADD', delta, workspaceId: workspaceId ?? await getActiveWorkspaceId() }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not update lifetime statistics.');
}

export function observeLifetimeStats(onChange: (stats: LifetimeStats) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;
    void getActiveWorkspaceId().then((id) => { const change = changes[statsKey(id)]; if (change) onChange(normalizeLifetimeStats(change.newValue as Partial<LifetimeStats> | undefined)); });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function formatTimeSaved(minutes: number): string {
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
