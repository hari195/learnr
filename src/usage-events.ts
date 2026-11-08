import { getAllUsageEvents } from './history-db';
import type { ProviderId, ProviderUsage, UsageEvent, UsageOperation, UsageWindow } from './types';
import { emptyUsage, normalizeUsage } from './usage';
import { getActiveWorkspaceId } from './workspaces';

export function usageModelKey(provider: ProviderId, model: string): string {
  return `${provider}:${model}`;
}

export function usageWindowStart(window: UsageWindow, now = new Date()): number {
  if (window === 'all') return 0;
  if (window === '7d') return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (window === '30d') return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (window === 'month') start.setDate(1);
  return start.getTime();
}

export interface UsageAggregate extends ProviderUsage {
  calls: number;
  operations: Partial<Record<UsageOperation, { calls: number; requests: number; tokens: number; costUsd: number }>>;
}

export function aggregateUsageEvents(events: UsageEvent[], window: UsageWindow, now = new Date()): UsageAggregate {
  const start = usageWindowStart(window, now);
  const aggregate: UsageAggregate = { ...emptyUsage(), calls: 0, operations: {} };
  for (const event of events) {
    if (event.createdAt < start) continue;
    const usage = normalizeUsage(event);
    aggregate.calls += 1;
    aggregate.inputTokens += usage.inputTokens;
    aggregate.cachedInputTokens += usage.cachedInputTokens;
    aggregate.cacheWriteTokens += usage.cacheWriteTokens;
    aggregate.outputTokens += usage.outputTokens;
    aggregate.totalTokens += usage.totalTokens;
    aggregate.costUsd += usage.costUsd;
    aggregate.requestCount += usage.requestCount;
    aggregate.tokensReported ||= usage.tokensReported;
    aggregate.costReported ||= usage.costReported;
    const operation = aggregate.operations[event.operation] ?? { calls: 0, requests: 0, tokens: 0, costUsd: 0 };
    operation.calls += 1; operation.requests += usage.requestCount; operation.tokens += usage.totalTokens; operation.costUsd += usage.costUsd;
    aggregate.operations[event.operation] = operation;
  }
  return aggregate;
}

export async function recordUsageEvent(args: { provider: ProviderId; model: string; operation: UsageOperation; usage: ProviderUsage; conversationId?: string; workspaceId?: string; embeddingProfileId?: string; embeddingProfileIds?: string[] }): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'LEARNR_USAGE_EVENT_ADD', event: { id: crypto.randomUUID(), createdAt: Date.now(), workspaceId: await getActiveWorkspaceId(), ...args, ...normalizeUsage(args.usage) } }) as { ok?: boolean; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'Could not record model usage.');
}

export async function loadUsageEvents(scope: 'active' | 'all' = 'active'): Promise<UsageEvent[]> {
  const events = await getAllUsageEvents();
  if (scope === 'all') return events;
  const workspaceId = await getActiveWorkspaceId();
  return events.filter((event) => (event.workspaceId ?? 'default') === workspaceId);
}

export function usageModelColor(model: string): string {
  let hash = 0;
  for (const character of model) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 72% 58%)`;
}

export interface UsageBucket { key: string; label: string; start: number; end: number }

export function usageBuckets(window: UsageWindow, now = new Date()): UsageBucket[] {
  const end = now.getTime();
  if (window === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return Array.from({ length: now.getHours() + 1 }, (_, hour) => ({ key: `${start.getTime() + hour * 3_600_000}`, label: `${String(hour).padStart(2, '0')}:00`, start: start.getTime() + hour * 3_600_000, end: Math.min(end + 1, start.getTime() + (hour + 1) * 3_600_000) }));
  }
  if (window === 'all') {
    return [];
  }
  const startMs = usageWindowStart(window, now);
  const cursor = new Date(startMs); cursor.setHours(0, 0, 0, 0);
  const buckets: UsageBucket[] = [];
  while (cursor.getTime() <= end) {
    const start = cursor.getTime(); cursor.setDate(cursor.getDate() + 1);
    buckets.push({ key: String(start), label: new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), start, end: Math.min(end + 1, cursor.getTime()) });
  }
  return buckets;
}

export function allTimeUsageBuckets(events: UsageEvent[]): UsageBucket[] {
  if (!events.length) return [];
  const first = new Date(Math.min(...events.map((event) => event.createdAt))); first.setDate(1); first.setHours(0, 0, 0, 0);
  const now = new Date(); const buckets: UsageBucket[] = [];
  while (first.getTime() <= now.getTime()) {
    const start = first.getTime(); first.setMonth(first.getMonth() + 1);
    buckets.push({ key: String(start), label: new Date(start).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), start, end: first.getTime() });
  }
  return buckets;
}
