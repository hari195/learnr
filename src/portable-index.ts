import type { EmbeddingIndexProfile } from './types';
import { exportNoteIndex, importNoteIndex, type PortableNoteIndexData } from './note-library';

const FORMAT = 'learnr-index';
const VERSION = 1;
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

interface PortablePayload {
  format: typeof FORMAT;
  version: typeof VERSION;
  exportedAt: number;
  profile: Omit<EmbeddingIndexProfile, 'id' | 'workspaceId' | 'autoUpdate'>;
  index: PortableNoteIndexData;
}

interface PortableEnvelope { payload: PortablePayload; checksum: string }

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function compress(bytes: Uint8Array): Promise<Blob> {
  const buffer = Uint8Array.from(bytes).buffer;
  if (typeof CompressionStream === 'undefined') return new Blob([buffer], { type: 'application/json' });
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

async function decompress(bytes: Uint8Array): Promise<string> {
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzipped) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress Learnr index backups.');
  const stream = new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function createPortableIndex(profile: EmbeddingIndexProfile): Promise<Blob> {
  const index = await exportNoteIndex(profile.id);
  const { id: _id, workspaceId: _workspaceId, autoUpdate: _autoUpdate, ...portableProfile } = profile;
  const payload: PortablePayload = { format: FORMAT, version: VERSION, exportedAt: Date.now(), profile: portableProfile, index };
  const payloadJson = JSON.stringify(payload);
  const envelope: PortableEnvelope = { payload, checksum: await sha256(payloadJson) };
  return compress(new TextEncoder().encode(JSON.stringify(envelope)));
}

export async function readPortableIndex(file: File): Promise<{ profile: Omit<EmbeddingIndexProfile, 'id' | 'workspaceId' | 'autoUpdate'>; index: PortableNoteIndexData }> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('This Learnr index backup is larger than 512 MB.');
  let envelope: PortableEnvelope;
  try { envelope = JSON.parse(await decompress(new Uint8Array(await file.arrayBuffer()))) as PortableEnvelope; }
  catch { throw new Error('This file is not a readable Learnr index backup.'); }
  if (envelope?.payload?.format !== FORMAT || envelope.payload.version !== VERSION) throw new Error('This Learnr index backup uses an unsupported format version.');
  if (await sha256(JSON.stringify(envelope.payload)) !== envelope.checksum) throw new Error('The Learnr index backup checksum does not match. The file may be damaged.');
  const profile = envelope.payload.profile;
  if (!profile || typeof profile.name !== 'string' || typeof profile.model !== 'string') throw new Error('The backup profile metadata is malformed.');
  return { profile, index: envelope.payload.index };
}

export async function restorePortableIndex(profileId: string, index: PortableNoteIndexData) {
  return importNoteIndex(profileId, index);
}
