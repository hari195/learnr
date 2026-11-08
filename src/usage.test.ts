import { describe, expect, it } from 'vitest';
import { addUsage, emptyUsage, formatEstimatedCost, formatTokenCount, formatTokensPerSecond, normalizeUsage } from './usage';

describe('usage accounting', () => {
  it('migrates empty usage, accumulates calls, and formats the footer', () => {
    expect(normalizeUsage(undefined)).toEqual(emptyUsage());
    const total = addUsage(
      { ...emptyUsage(), inputTokens: 1_000, totalTokens: 1_000, costUsd: .00001 },
      { ...emptyUsage(), outputTokens: 250, totalTokens: 250, costUsd: .01234 },
    );
    expect(total).toMatchObject({ inputTokens: 1_000, outputTokens: 250, totalTokens: 1_250 });
    expect(formatTokenCount(total.totalTokens)).toBe('1,250');
    expect(formatEstimatedCost(.00001)).toBe('<$0.0001');
    expect(formatEstimatedCost(total.costUsd)).toBe('$0.0123');
  });

  it('formats output throughput without estimating missing values', () => {
    expect(formatTokensPerSecond(120, 2_000)).toBe('60');
    expect(formatTokensPerSecond(5, 2_000)).toBe('2.5');
    expect(formatTokensPerSecond(undefined, 2_000)).toBeNull();
    expect(formatTokensPerSecond(100, undefined)).toBeNull();
  });
});
