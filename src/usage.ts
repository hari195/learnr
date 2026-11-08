import type { ProviderUsage } from './types';

export function emptyUsage(): ProviderUsage {
  return { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, requestCount: 0, tokensReported: false, costReported: false };
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeUsage(value?: Partial<ProviderUsage>): ProviderUsage {
  const inputTokens = finite(value?.inputTokens);
  const outputTokens = finite(value?.outputTokens);
  return {
    inputTokens,
    cachedInputTokens: Math.min(inputTokens, finite(value?.cachedInputTokens)),
    cacheWriteTokens: Math.min(inputTokens, finite(value?.cacheWriteTokens)),
    outputTokens,
    totalTokens: finite(value?.totalTokens) || inputTokens + outputTokens,
    costUsd: finite(value?.costUsd),
    requestCount: Math.max(0, Math.round(Number(value?.requestCount) || 0)),
    tokensReported: value?.tokensReported ?? Boolean(value && ('totalTokens' in value || 'inputTokens' in value || 'outputTokens' in value)),
    costReported: value?.costReported ?? Boolean(value && 'costUsd' in value),
  };
}

export function addUsage(current: ProviderUsage, addition: ProviderUsage): ProviderUsage {
  const left = normalizeUsage(current);
  const right = normalizeUsage(addition);
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costUsd: left.costUsd + right.costUsd,
    requestCount: left.requestCount + right.requestCount,
    tokensReported: left.tokensReported || right.tokensReported,
    costReported: left.costReported || right.costReported,
  };
}

export function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

export function formatCost(value: number): string {
  if (value > 0 && value < .0001) return '<$0.0001';
  if (value < 1) return `$${Math.max(0, value).toFixed(4)}`;
  return `$${Math.max(0, value).toFixed(2)}`;
}

export function formatTokensPerSecond(outputTokens?: number, durationMs?: number): string | null {
  if (outputTokens === undefined || !Number.isFinite(outputTokens) || !durationMs || durationMs <= 0) return null;
  const speed = Math.max(0, outputTokens) / (durationMs / 1000);
  return speed < 10 ? speed.toFixed(1) : Math.round(speed).toLocaleString('en-US');
}

/** @deprecated Use formatCost; retained while stored UI code migrates. */
export const formatEstimatedCost = formatCost;
