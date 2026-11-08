export const CREATE_DRAFT_COMMAND = 'create-draft';
export const LAUNCH_COMMAND = '_execute_action';
export const OPEN_CONNECTED_TAB_COMMAND = 'open-connected-tab';

export type LearnrCommandName = typeof CREATE_DRAFT_COMMAND;

export interface PendingLearnrCommand {
  id: string;
  name: LearnrCommandName;
  tabId: number;
  createdAt: number;
}

export const PENDING_COMMAND_TTL_MS = 15_000;
const pendingCommandKey = (tabId: number) => `learnr.pending-command.${tabId}`;

export function isLearnrCommandName(value: string): value is LearnrCommandName {
  return value === CREATE_DRAFT_COMMAND;
}

export function isPendingCommandCurrent(command: PendingLearnrCommand, tabId: number, now = Date.now()): boolean {
  return command.tabId === tabId && now >= command.createdAt && now - command.createdAt <= PENDING_COMMAND_TTL_MS;
}

export async function queuePendingCommand(name: LearnrCommandName, tabId: number): Promise<PendingLearnrCommand> {
  const command = { id: crypto.randomUUID(), name, tabId, createdAt: Date.now() };
  await chrome.storage.session.set({ [pendingCommandKey(tabId)]: command });
  return command;
}

export async function consumePendingCommand(tabId: number): Promise<PendingLearnrCommand | null> {
  const key = pendingCommandKey(tabId);
  const result = await chrome.storage.session.get(key);
  const command = result[key] as PendingLearnrCommand | undefined;
  if (!command) return null;
  await chrome.storage.session.remove(key);
  return isPendingCommandCurrent(command, tabId) ? command : null;
}

export async function acknowledgePendingCommand(command: PendingLearnrCommand): Promise<void> {
  const key = pendingCommandKey(command.tabId);
  const result = await chrome.storage.session.get(key);
  if ((result[key] as PendingLearnrCommand | undefined)?.id === command.id) await chrome.storage.session.remove(key);
}

export function displayShortcut(shortcut?: string): string {
  return shortcut?.trim() || 'Unassigned';
}
