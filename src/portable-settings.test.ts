import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { applyGlobalSettingsExport, createGlobalSettingsExport, createWorkspaceSettingsExport, importedWorkspaceSettings, parseSettingsExport, settingsExportFilename, uniqueImportedWorkspaceName } from './portable-settings';
import { defaultGlobalSettings } from './workspaces';

describe('portable settings', () => {
  it('exports only whitelisted global preferences and preserves local resources on apply', () => {
    const global = defaultGlobalSettings();
    global.openRouter.apiKey = 'secret-key';
    global.openRouter.availableModels = ['private/catalog-model'];
    global.embeddingProfiles = [{ id: 'profile', workspaceId: 'default', name: 'Notes', model: 'embed', autoUpdate: true, createdAt: 1, updatedAt: 1 }];
    const exported = createGlobalSettingsExport({ ...global, accentColor: '#abcdef', slashCommandsEnabled: false });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain('embeddingProfiles');
    expect(serialized).not.toContain('private/catalog-model');
    const parsed = parseSettingsExport(serialized);
    expect(parsed.scope).toBe('global');
    const next = applyGlobalSettingsExport(global, parsed as typeof exported);
    expect(next.accentColor).toBe('#abcdef');
    expect(next.slashCommandsEnabled).toBe(false);
    expect(next.openRouter.apiKey).toBe('secret-key');
    expect(next.openRouter.availableModels).toEqual(['private/catalog-model']);
    expect(next.embeddingProfiles).toEqual([expect.objectContaining(global.embeddingProfiles[0])]);
    expect(next.workspaces).toEqual(global.workspaces);
  });

  it('exports workspace preferences without credentials or profile attachments', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.arcFeatureDefaultsVersion = 1;
    settings.providers.openrouter.apiKey = 'workspace-secret';
    settings.providers.openrouter.modelCatalog = [{ id: 'catalog', contextLength: 1, inputModalities: [], outputModalities: [], supportedParameters: [], pricing: [] }];
    settings.savedNotes.embeddingProfileId = 'browser-profile';
    settings.aiRoles.chat.model = 'provider/imported-model';
    settings.pdfExtractionEnabled = false;
    settings.pdfExtractionMode = 'manual';
    const exported = createWorkspaceSettingsExport({ id: 'one', name: 'Research', color: '#8b5cf6', createdAt: 1, updatedAt: 1 }, settings);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('workspace-secret');
    expect(serialized).not.toContain('arcFeatureDefaultsVersion');
    expect(serialized).not.toContain('browser-profile');
    expect(serialized).not.toContain('modelCatalog');
    expect(serialized).not.toContain('guardrails');
    const parsed = parseSettingsExport(serialized);
    expect(parsed.scope).toBe('workspace');
    const imported = importedWorkspaceSettings(parsed as typeof exported, defaultGlobalSettings().openRouter);
    expect(imported.aiRoles.chat.model).toBe('provider/imported-model');
    expect(imported.pdfExtractionMode).toBe('manual');
    expect(imported.pdfExtractionEnabled).toBe(false);
    expect(imported.keepSavedDraftsInEditor).toBe(true);
    expect(imported.savedNotes.embeddingProfileId).toBe('');
    expect(imported.savedNotes.searchInChat).toBe(false);
    expect(imported.providers.openrouter.apiKey).toBe('');
  });

  it('rejects malformed, wrong-scope, future, and invalid-budget files', () => {
    expect(() => parseSettingsExport('{bad')).toThrow(/valid JSON/i);
    expect(() => parseSettingsExport(JSON.stringify({ format: 'other', version: 1 }))).toThrow(/not a Learnr/i);
    expect(() => parseSettingsExport(JSON.stringify({ format: 'learnr-settings', version: 2, scope: 'global', appVersion: '1.0.0', exportedAt: new Date().toISOString(), data: {} }))).toThrow(/newer/i);
    const exported = createWorkspaceSettingsExport({ id: 'one', name: 'Research', color: '#8b5cf6', createdAt: 1, updatedAt: 1 }, DEFAULT_SETTINGS);
    expect(() => parseSettingsExport(JSON.stringify({ ...exported, data: { ...exported.data, sourceContextBudgetTokens: 33_000 } }))).toThrow(/multiple of 32,000/i);
  });

  it('creates deterministic filenames and collision-safe imported names', () => {
    expect(settingsExportFilename('global')).toBe('learnr-global-settings.json');
    expect(settingsExportFilename('workspace', 'My Research!')).toBe('learnr-workspace-my-research-settings.json');
    expect(uniqueImportedWorkspaceName('Research', [{ id: '1', name: 'Research', color: '#1687ff', createdAt: 1, updatedAt: 1 }, { id: '2', name: 'Research (2)', color: '#1687ff', createdAt: 1, updatedAt: 1 }])).toBe('Research (3)');
  });
});
