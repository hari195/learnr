import type { ImageHighlight } from './types';

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_HIGHLIGHT_IMAGE_BYTES = 5 * 1024 * 1024;

type AssetSuccess = { ok: true; mimeType?: ImageHighlight['mimeType']; byteSize?: number; dataUrl?: string };
type AssetResponse = AssetSuccess | { ok: false; error: string };

function extensionForMime(mimeType: ImageHighlight['mimeType'], originalName = ''): string {
  const original = (() => { try { return new URL(originalName).pathname; } catch { return originalName; } })().split('.').pop()?.toLowerCase();
  if (mimeType === 'image/jpeg' && (original === 'jpg' || original === 'jpeg')) return original;
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
}

function imageTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function pastedImageFilename(mimeType: ImageHighlight['mimeType'], existing: Iterable<string>, date = new Date(), originalName = ''): string {
  const extension = extensionForMime(mimeType, originalName);
  const base = `Pasted image ${imageTimestamp(date)}`;
  const names = new Set(Array.from(existing, (name) => name.toLowerCase()));
  let filename = `${base}.${extension}`;
  let index = 2;
  while (names.has(filename.toLowerCase())) filename = `${base} ${index++}.${extension}`;
  return filename;
}

export function obsidianImageEmbed(filename: string): string {
  return `![[${filename}]]`;
}

export function appendImagesSection(markdown: string, images: ImageHighlight[]): string {
  if (!images.length) return markdown;
  const embeds = [...images].sort((left, right) => left.createdAt - right.createdAt).map((image) => obsidianImageEmbed(image.filename)).join('\n\n');
  return `${markdown.trimEnd()}\n\n## Images\n\n${embeds}\n`;
}

export function insertImageEmbed(markdown: string, filename: string, start = markdown.length, end = start): { markdown: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, markdown.length));
  const safeEnd = Math.max(safeStart, Math.min(end, markdown.length));
  const before = markdown.slice(0, safeStart);
  const after = markdown.slice(safeEnd);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${obsidianImageEmbed(filename)}${suffix}`;
  return { markdown: before + inserted + after, cursor: before.length + inserted.length };
}

export function referencedDraftImages(markdown: string, images: ImageHighlight[]): ImageHighlight[] {
  return images.filter((image) => markdown.includes(obsidianImageEmbed(image.filename)));
}

async function request(message: object): Promise<AssetSuccess> {
  const response = await chrome.runtime.sendMessage(message) as AssetResponse;
  if (!response?.ok) throw new Error(response?.error || 'Could not store the image.');
  return response;
}

export async function storeImageAsset(args: { assetId: string; historyId: string; imageUrl: string; mimeType?: string }): Promise<{ mimeType: ImageHighlight['mimeType']; byteSize: number }> {
  const response = await request({ type: 'LEARNR_IMAGE_ASSET_PUT', ...args });
  if (!response.mimeType || response.byteSize === undefined) throw new Error('The image response was incomplete.');
  return { mimeType: response.mimeType, byteSize: response.byteSize };
}

export async function loadImageAssetDataUrl(assetId: string): Promise<string> {
  const response = await request({ type: 'LEARNR_IMAGE_ASSET_GET', assetId });
  if (!response.dataUrl) throw new Error('The saved image data is unavailable.');
  return response.dataUrl;
}

export async function deleteImageAsset(assetId: string): Promise<void> {
  await request({ type: 'LEARNR_IMAGE_ASSET_DELETE', assetId });
}
