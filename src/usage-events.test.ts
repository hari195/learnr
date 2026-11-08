import { describe, expect, it } from 'vitest';
import { aggregateUsageEvents, usageBuckets, usageModelColor, usageModelKey, usageWindowStart } from './usage-events';
import type { UsageEvent } from './types';

const event = (createdAt: number, operation: UsageEvent['operation'] = 'chat'): UsageEvent => ({
  id: crypto.randomUUID(), provider: 'openai', model: 'gpt-5.6-terra', operation, createdAt,
  inputTokens: 10, cachedInputTokens: 2, cacheWriteTokens: 1, outputTokens: 5, totalTokens: 15, costUsd: .01, requestCount: 1, tokensReported: true, costReported: true,
});

describe('model-wise usage', () => {
  it('groups identities and applies independent local windows', () => {
    const now = new Date(2026, 7, 15, 12);
    const result = aggregateUsageEvents([event(now.getTime()), event(now.getTime() - 8 * 86_400_000, 'pdf')], '7d', now);
    expect(usageModelKey('openai', 'gpt-5.6-terra')).toBe('openai:gpt-5.6-terra');
    expect(result.calls).toBe(1);
    expect(result.operations.chat).toEqual({ calls: 1, requests: 1, tokens: 15, costUsd: .01 });
    expect(usageWindowStart('month', now)).toBe(new Date(2026, 7, 1).getTime());
  });

  it('creates stable model colors and time buckets for charts', () => {
    expect(usageModelColor('openai/gpt-5')).toBe(usageModelColor('openai/gpt-5'));
    const now = new Date(2026, 7, 15, 12, 30);
    expect(usageBuckets('today', now)).toHaveLength(13);
    expect(usageBuckets('7d', now).at(-1)?.label).toContain('15');
  });
});
