import { clearUsageEvents, getAllHistoryRecords, putHistoryRecord } from './history-db';
import { emptyUsage } from './usage';
import { GLOBAL_SETTINGS_KEY, loadGlobalSettings, saveGlobalSettings, USAGE_ACCOUNTING_VERSION } from './workspaces';

export async function migrateUsageAccounting(): Promise<boolean> {
  const stored = await chrome.storage.local.get(GLOBAL_SETTINGS_KEY);
  if (!stored[GLOBAL_SETTINGS_KEY]) return false;
  const global = await loadGlobalSettings();
  if (global.usageAccountingVersion >= USAGE_ACCOUNTING_VERSION) return false;

  const local = await chrome.storage.local.get(null);
  const updates: Record<string, unknown> = {};
  const removals: string[] = [];
  for (const [key, value] of Object.entries(local)) {
    if (key === 'learnr.tokenUsageWindow' || key.startsWith('learnr.tokenUsageWindow.')) removals.push(key);
    if (key === 'learnr.lifetimeStats' || key.startsWith('learnr.lifetimeStats.')) {
      const stats = value as Record<string, unknown>;
      updates[key] = { ...stats, totalTokens: 0, totalCostUsd: 0 };
    }
  }
  const histories = await getAllHistoryRecords();
  const sessions = await chrome.storage.session.get(null);
  const sessionUpdates = Object.fromEntries(Object.entries(sessions).map(([key, value]) => {
    if (!value || typeof value !== 'object' || !('usage' in value)) return [key, value];
    return [key, { ...(value as Record<string, unknown>), usage: emptyUsage() }];
  }));
  await Promise.all([
    clearUsageEvents(),
    ...histories.map((record) => putHistoryRecord({ ...record, usage: emptyUsage() })),
    chrome.storage.local.set(updates),
    removals.length ? chrome.storage.local.remove(removals) : Promise.resolve(),
    chrome.storage.session.set(sessionUpdates),
  ]);
  await saveGlobalSettings({ ...global, usageAccountingVersion: USAGE_ACCOUNTING_VERSION });
  return true;
}
