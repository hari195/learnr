import type { ChatAttachment, ChatMessage } from './types';

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_BYTES = 512 * 1024;
export const MAX_SESSION_ATTACHMENT_CHARS = 7_000_000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'text', 'json', 'csv', 'html', 'htm']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'application/json', 'text/csv', 'text/html']);

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export async function attachmentFromFile(file: File): Promise<ChatAttachment> {
  const id = crypto.randomUUID();
  if (IMAGE_TYPES.has(file.type) || IMAGE_EXTENSIONS.has(extension(file.name))) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is larger than the 5 MB image limit.`);
    const inferredType = file.type || (extension(file.name) === 'jpg' ? 'image/jpeg' : `image/${extension(file.name)}`);
    return { id, kind: 'image', name: file.name, mimeType: inferredType, imageUrl: await readDataUrl(file), source: 'local' };
  }
  if (TEXT_TYPES.has(file.type) || TEXT_EXTENSIONS.has(extension(file.name))) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`${file.name} is larger than the 512 KB text-file limit.`);
    return { id, kind: 'text', name: file.name, mimeType: file.type || 'text/plain', text: await file.text(), source: 'local' };
  }
  throw new Error(`${file.name} is not supported. Attach PNG, JPEG, WebP, GIF, Markdown, text, JSON, CSV, or HTML files.`);
}

export async function attachmentsFromFiles(files: Iterable<File>): Promise<ChatAttachment[]> {
  return Promise.all(Array.from(files).map(attachmentFromFile));
}

function resolveWebImage(value: string, pageUrl: string): string | null {
  const source = value.trim();
  if (!source) return null;
  if (source.startsWith('data:image/')) return source;
  try {
    const url = new URL(source, pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function webImageFromTransfer(data: Pick<DataTransfer, 'getData'>, pageUrl: string): ChatAttachment | null {
  const html = data.getData('text/html');
  if (html) {
    const image = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
    const imageUrl = resolveWebImage(image?.getAttribute('src') ?? '', pageUrl);
    if (imageUrl) return { id: crypto.randomUUID(), kind: 'image', name: (image?.getAttribute('alt')?.trim() || 'Web image').slice(0, 120), mimeType: 'image/*', imageUrl, source: 'web' };
  }
  const uri = data.getData('text/uri-list').split('\n').find((line) => line && !line.startsWith('#'))
    ?? data.getData('text/plain');
  const imageUrl = resolveWebImage(uri, pageUrl);
  if (!imageUrl || (!imageUrl.startsWith('data:image/') && !/\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(imageUrl))) return null;
  return { id: crypto.randomUUID(), kind: 'image', name: 'Web image', mimeType: 'image/*', imageUrl, source: 'web' };
}

export async function attachmentsFromDrop(data: DataTransfer, pageUrl: string): Promise<ChatAttachment[]> {
  if (data.files.length) return attachmentsFromFiles(data.files);
  const webImage = webImageFromTransfer(data, pageUrl);
  if (!webImage) throw new Error('Drop an image from the webpage or a supported local file.');
  return [webImage];
}

export function attachmentPayloadChars(messages: ChatMessage[], pending: ChatAttachment[] = []): number {
  return [...messages.flatMap((message) => message.attachments ?? []), ...pending]
    .reduce((total, attachment) => total + (attachment.kind === 'image' ? attachment.imageUrl.length : attachment.text.length), 0);
}

export function validateAttachmentCapacity(messages: ChatMessage[], pending: ChatAttachment[]): void {
  if (pending.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error(`Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} items to one message.`);
  if (attachmentPayloadChars(messages, pending) > MAX_SESSION_ATTACHMENT_CHARS) {
    throw new Error('These attachments are too large for this browser session. Remove an attachment or start a new conversation.');
  }
}

export function messageTextWithAttachments(message: ChatMessage): string {
  const files = (message.attachments ?? []).filter((attachment): attachment is Extract<ChatAttachment, { kind: 'text' }> => attachment.kind === 'text');
  if (!files.length) return message.content;
  return [message.content, ...files.map((file) => `\n\n--- Attached file: ${file.name} ---\n${file.text}\n--- End ${file.name} ---`)].join('').trim();
}
