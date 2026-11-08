import type { TokenWarningPeriod } from './types';
import { getActiveWorkspaceId, LEGACY_WORKSPACE_ID } from './workspaces';

export const TOKEN_USAGE_WINDOW_KEY = 'learnr.tokenUsageWindow';
const usageKey = (workspaceId: string) => workspaceId === LEGACY_WORKSPACE_ID ? TOKEN_USAGE_WINDOW_KEY : `${TOKEN_USAGE_WINDOW_KEY}.${workspaceId}`;

export interface TokenUsageWindow {
  period: TokenWarningPeriod;
  startedAt: number;
  endsAt: number;
  tokens: number;
}

export function periodBounds(period: TokenWarningPeriod, date = new Date()): { startedAt: number; endsAt: number } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === 'month') start.setDate(1);
  const end = new Date(start);
  if (period === 'day') end.setDate(end.getDate() + 1);
  if (period === 'week') end.setDate(end.getDate() + 7);
  if (period === 'month') end.setMonth(end.getMonth() + 1);
  return { startedAt: start.getTime(), endsAt: end.getTime() };
}

export function normalizeTokenUsageWindow(value: Partial<TokenUsageWindow> | undefined, period: TokenWarningPeriod, now = new Date()): TokenUsageWindow {
  const bounds = periodBounds(period, now);
  if (!value || value.period !== period || value.startedAt !== bounds.startedAt || now.getTime() >= Number(value.endsAt)) return { period, ...bounds, tokens: 0 };
  return { period, startedAt: Number(value.startedAt), endsAt: Number(value.endsAt), tokens: Math.max(0, Number(value.tokens) || 0) };
}

export async function loadTokenUsageWindow(period: TokenWarningPeriod, workspaceId?: string): Promise<TokenUsageWindow> {
  const key = usageKey(workspaceId ?? await getActiveWorkspaceId());
  const result = await chrome.storage.local.get(key);
  return normalizeTokenUsageWindow(result[key] as Partial<TokenUsageWindow> | undefined, period);
}

let updateQueue: Promise<TokenUsageWindow> | null = null;
export function addGlobalTokens(period: TokenWarningPeriod, tokens: number, requestedWorkspaceId?: string): Promise<TokenUsageWindow> {
  updateQueue = (updateQueue ?? Promise.resolve({ period, ...periodBounds(period), tokens: 0 })).then(async () => {
    const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
    const current = await loadTokenUsageWindow(period, workspaceId);
    const next = { ...current, tokens: current.tokens + Math.max(0, tokens) };
    await chrome.storage.local.set({ [usageKey(workspaceId)]: next });
    return next;
  });
  return updateQueue;
}

export async function resetTokenUsageWindow(period: TokenWarningPeriod, requestedWorkspaceId?: string): Promise<TokenUsageWindow> {
  const workspaceId = requestedWorkspaceId ?? await getActiveWorkspaceId();
  const next = { period, ...periodBounds(period), tokens: 0 };
  await chrome.storage.local.set({ [usageKey(workspaceId)]: next });
  return next;
}

export function observeTokenUsageWindow(callback: (value: TokenUsageWindow) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    void getActiveWorkspaceId().then((id) => { const change = changes[usageKey(id)]; if (change?.newValue) callback(change.newValue as TokenUsageWindow); });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
