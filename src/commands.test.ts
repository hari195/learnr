import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgePendingCommand, consumePendingCommand, CREATE_DRAFT_COMMAND, displayShortcut, isPendingCommandCurrent, PENDING_COMMAND_TTL_MS, queuePendingCommand } from './commands';

afterEach(() => vi.unstubAllGlobals());

function mockSessionStorage() {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('chrome', { storage: { session: {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  } } });
  return values;
}

describe('keyboard command handoff', () => {
  it('queues and consumes a tab-scoped command exactly once', async () => {
    mockSessionStorage();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const queued = await queuePendingCommand(CREATE_DRAFT_COMMAND, 7);
    expect(queued).toMatchObject({ name: CREATE_DRAFT_COMMAND, tabId: 7, createdAt: 1_000 });
    expect(await consumePendingCommand(7)).toEqual(queued);
    expect(await consumePendingCommand(7)).toBeNull();
  });

  it('rejects expired and wrong-tab commands', () => {
    const command = { id: 'one', name: CREATE_DRAFT_COMMAND, tabId: 4, createdAt: 1_000 } as const;
    expect(isPendingCommandCurrent(command, 4, 1_000 + PENDING_COMMAND_TTL_MS)).toBe(true);
    expect(isPendingCommandCurrent(command, 4, 1_001 + PENDING_COMMAND_TTL_MS)).toBe(false);
    expect(isPendingCommandCurrent(command, 5, 1_001)).toBe(false);
  });

  it('acknowledges only the matching command and formats unassigned shortcuts', async () => {
    const values = mockSessionStorage();
    const queued = await queuePendingCommand(CREATE_DRAFT_COMMAND, 9);
    await acknowledgePendingCommand({ ...queued, id: 'different' });
    expect(Object.keys(values)).toHaveLength(1);
    await acknowledgePendingCommand(queued);
    expect(Object.keys(values)).toHaveLength(0);
    expect(displayShortcut('Command+Shift+D')).toBe('Command+Shift+D');
    expect(displayShortcut('')).toBe('Unassigned');
  });
});
