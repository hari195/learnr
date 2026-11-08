import { describe, expect, it } from 'vitest';
import { normalizeTokenUsageWindow, periodBounds } from './token-warnings';

describe('token warning periods', () => {
  const now = new Date(2026, 7, 12, 14, 30);

  it('uses local calendar boundaries', () => {
    expect(new Date(periodBounds('day', now).startedAt).getHours()).toBe(0);
    expect(new Date(periodBounds('week', now).startedAt).getDay()).toBe(1);
    expect(new Date(periodBounds('month', now).startedAt).getDate()).toBe(1);
  });

  it('retains a current window and resets stale or changed periods', () => {
    const bounds = periodBounds('month', now);
    expect(normalizeTokenUsageWindow({ period: 'month', ...bounds, tokens: 42 }, 'month', now).tokens).toBe(42);
    expect(normalizeTokenUsageWindow({ period: 'week', ...periodBounds('week', now), tokens: 42 }, 'month', now).tokens).toBe(0);
  });
});
