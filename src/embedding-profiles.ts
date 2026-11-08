import { DEFAULT_SETTINGS } from './defaults';
import { copyNoteIndex, deleteWorkspaceNoteIndex, getNoteIndexStatus } from './note-library';
import { loadSettings, saveSettings } from './storage';
import type { AppSettings, EmbeddingIndexProfile, GlobalSettings } from './types';
import { copyNoteLibraryHandle, disconnectNoteLibrary, getNoteLibraryHandle } from './vault';
import { EMBEDDING_PROFILES_VERSION, loadGlobalSettings, saveGlobalSettings } from './workspaces';

function copyId(profileId: string, workspaceId: string): string {
  let hash = 2166136261;
  for (const character of `${profileId}\0${workspaceId}`) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${profileId}-workspace-${(hash >>> 0).toString(16)}`;
}

async function removeProfileData(profileId: string): Promise<void> {
  await Promise.allSettled([deleteWorkspaceNoteIndex(profileId), disconnectNoteLibrary(profileId)]);
}

/** Migrates reusable global profiles into independently workspace-owned libraries. */
export async function migrateEmbeddingProfiles(): Promise<GlobalSettings> {
  let global = await loadGlobalSettings();
  if (global.embeddingProfilesVersion >= EMBEDDING_PROFILES_VERSION && global.embeddingProfiles.every((profile) => profile.workspaceId)) return global;

  const workspaceSettings = new Map<string, AppSettings>();
  for (const workspace of global.workspaces) workspaceSettings.set(workspace.id, await loadSettings(workspace.id));

  global = await loadGlobalSettings();
  const profiles = [...global.embeddingProfiles];
  for (const workspace of global.workspaces) {
    const settings = workspaceSettings.get(workspace.id)!;
    if (settings.savedNotes.embeddingProfileId || settings.savedNotes.enabledEmbeddingProfileIds.length) continue;
    const [handle, status] = await Promise.all([getNoteLibraryHandle(workspace.id), getNoteIndexStatus(workspace.id)]);
    if (!handle && status.state !== 'ready') continue;
    const now = Date.now();
    profiles.push({ id: workspace.id, workspaceId: workspace.id, name: `${workspace.name} notes`, folderName: handle?.name, model: status.model || settings.savedNotes.embeddingModel || DEFAULT_SETTINGS.savedNotes.embeddingModel, dimensions: status.dimensions, autoUpdate: false, createdAt: now, updatedAt: now });
    settings.savedNotes.embeddingProfileId = workspace.id;
  }

  const migrated: EmbeddingIndexProfile[] = [];
  const retainedIds = new Set<string>();
  for (const profile of profiles) {
    const owners = global.workspaces.filter((workspace) => {
      const saved = workspaceSettings.get(workspace.id)!.savedNotes;
      return saved.embeddingProfileId === profile.id || saved.enabledEmbeddingProfileIds.includes(profile.id) || profile.workspaceId === workspace.id;
    });
    if (!owners.length) { await removeProfileData(profile.id); continue; }

    for (let index = 0; index < owners.length; index += 1) {
      const workspace = owners[index];
      const targetId = index === 0 ? profile.id : copyId(profile.id, workspace.id);
      if (index > 0) {
        await copyNoteIndex(profile.id, targetId);
        await copyNoteLibraryHandle(profile.id, targetId);
      }
      if (!retainedIds.has(targetId)) {
        migrated.push({ ...profile, id: targetId, workspaceId: workspace.id, updatedAt: Date.now() });
        retainedIds.add(targetId);
      }
      const settings = workspaceSettings.get(workspace.id)!;
      const wasEnabled = settings.savedNotes.embeddingProfileId === profile.id || settings.savedNotes.enabledEmbeddingProfileIds.includes(profile.id);
      settings.savedNotes.enabledEmbeddingProfileIds = wasEnabled
        ? [...new Set([...settings.savedNotes.enabledEmbeddingProfileIds.filter((id) => id !== profile.id), targetId])]
        : settings.savedNotes.enabledEmbeddingProfileIds.filter((id) => id !== profile.id);
      settings.savedNotes.embeddingProfileId = '';
      if (wasEnabled) settings.savedNotes.embeddingModel = profile.model;
    }
  }

  for (const [workspaceId, settings] of workspaceSettings) await saveSettings(settings, workspaceId);
  global = { ...await loadGlobalSettings(), embeddingProfiles: migrated, embeddingProfilesVersion: EMBEDDING_PROFILES_VERSION };
  await saveGlobalSettings(global);
  return global;
}
