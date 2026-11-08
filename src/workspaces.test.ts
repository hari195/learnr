import { describe, expect, it } from 'vitest';
import { defaultGlobalSettings, LEGACY_WORKSPACE_ID, normalizeGlobal, normalizeWorkspaceColor, validateWorkspaceName } from './workspaces';

describe('workspaces', () => {
  it('creates a stable Default migration workspace', () => {
    const settings = defaultGlobalSettings(42);
    expect(settings.activeWorkspaceId).toBe(LEGACY_WORKSPACE_ID);
    expect(settings.workspaces).toEqual([{ id: LEGACY_WORKSPACE_ID, name: 'Default', color: '#1687ff', createdAt: 42, updatedAt: 42 }]);
    expect(settings.keyboardShortcutsEnabled).toBe(true);
    expect(settings.slashCommandsEnabled).toBe(true);
    expect(settings.closedConnectedTabBehavior).toBe('keep');
    expect(settings.accentColor).toBe('#1687ff');
    expect(settings.lightBackgroundColor).toBe('#f4f6f8');
    expect(settings.darkBackgroundColor).toBe('#07090c');
    expect(settings.settingsCardOrder.dashboard[0]).toBe('journey');
    expect(settings.autoGroupModel).toBe('openai/gpt-5-mini');
    expect(settings.usageAccountingVersion).toBe(2);
  });

  it('normalizes names and rejects empty, duplicate, or control-character names', () => {
    const existing = [{ id: 'one', name: 'Research', color: '#1687ff', createdAt: 1, updatedAt: 1 }];
    expect(validateWorkspaceName('  Personal  ', existing)).toBe('Personal');
    expect(() => validateWorkspaceName('research', existing)).toThrow(/already exists/i);
    expect(() => validateWorkspaceName('   ', existing)).toThrow(/empty/i);
    expect(() => validateWorkspaceName('Bad\nName', existing)).toThrow(/control/i);
  });

  it('recovers from malformed, missing, and duplicate workspace records', () => {
    const normalized = normalizeGlobal({
      activeWorkspaceId: 'missing',
      workspaces: [
        null,
        { id: '', name: 'Missing ID' },
        { id: 'valid', name: '', createdAt: 'bad', updatedAt: 4 },
        { id: 'valid', name: 'Duplicate', createdAt: 5, updatedAt: 5 },
      ],
      openRouter: null,
    } as unknown as Parameters<typeof normalizeGlobal>[0]);

    expect(normalized.activeWorkspaceId).toBe('valid');
    expect(normalized.workspaces).toHaveLength(1);
    expect(normalized.workspaces[0]).toMatchObject({ id: 'valid', name: 'Workspace', updatedAt: 4 });
    expect(normalized.workspaces[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(Number.isFinite(normalized.workspaces[0].createdAt)).toBe(true);
    expect(normalized.openRouter.providerId).toBe('openrouter');
    expect(normalized.autoGroupModel).toBe('openai/gpt-5-mini');
  });

  it('uses the legacy default when no stored workspace record is usable', () => {
    const normalized = normalizeGlobal({ workspaces: [null] } as unknown as Parameters<typeof normalizeGlobal>[0]);
    expect(normalized.workspaces[0].id).toBe(LEGACY_WORKSPACE_ID);
  });

  it('normalizes valid colors and gives legacy workspaces a stable fallback', () => {
    expect(normalizeWorkspaceColor('#ABCDEF', 'one')).toBe('#abcdef');
    expect(normalizeWorkspaceColor('invalid', 'one')).toBe(normalizeWorkspaceColor(undefined, 'one'));
  });

  it('normalizes global colors and preserves a complete card order', () => {
    const normalized = normalizeGlobal({ accentColor: '#AABBCC', lightBackgroundColor: 'bad', darkBackgroundColor: '#010203', settingsCardOrder: { dashboard: ['usage', 'journey', 'not-a-card'], workspace: ['chat'], app: ['about'] } } as Parameters<typeof normalizeGlobal>[0]);
    expect(normalized.accentColor).toBe('#aabbcc');
    expect(normalized.lightBackgroundColor).toBe('#f4f6f8');
    expect(normalized.darkBackgroundColor).toBe('#010203');
    expect(normalized.settingsCardOrder.dashboard.slice(0, 2)).toEqual(['usage', 'journey']);
    expect(normalized.settingsCardOrder.dashboard).not.toContain('not-a-card');
    expect(normalized.settingsCardOrder.workspace).toContain('saved-notes');
    expect(new Set(normalized.settingsCardOrder.app).size).toBe(normalized.settingsCardOrder.app.length);
  });
});
