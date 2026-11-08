import { describe, expect, it } from 'vitest';
import { attachmentPayloadChars, messageTextWithAttachments, validateAttachmentCapacity, webImageFromTransfer } from './attachments';
import type { ChatAttachment, ChatMessage } from './types';

const textAttachment: Extract<ChatAttachment, { kind: 'text' }> = { id: 'text', kind: 'text', name: 'old-note.md', mimeType: 'text/markdown', text: '# Previous note', source: 'local' };
const imageAttachment: Extract<ChatAttachment, { kind: 'image' }> = { id: 'image', kind: 'image', name: 'diagram.png', mimeType: 'image/png', imageUrl: 'https://example.com/diagram.png', source: 'web' };

describe('chat attachments', () => {
  it('extracts a webpage image URL from drag data', () => {
    const data = { getData: (type: string) => type === 'text/uri-list' ? '/images/chart.png' : '' };
    const attachment = webImageFromTransfer(data, 'https://example.com/article');
    expect(attachment?.kind).toBe('image');
    expect(attachment?.kind === 'image' ? attachment.imageUrl : '').toBe('https://example.com/images/chart.png');
  });

  it('adds local text files as labeled prompt context', () => {
    const message: ChatMessage = { id: '1', role: 'user', content: 'Compare this', createdAt: 1, attachments: [textAttachment] };
    expect(messageTextWithAttachments(message)).toContain('--- Attached file: old-note.md ---\n# Previous note');
  });

  it('counts persisted payloads and rejects too many attachments', () => {
    const message: ChatMessage = { id: '1', role: 'user', content: 'Look', createdAt: 1, attachments: [imageAttachment] };
    expect(attachmentPayloadChars([message], [textAttachment])).toBe(imageAttachment.imageUrl.length + textAttachment.text.length);
    expect(() => validateAttachmentCapacity([], Array(5).fill(textAttachment))).toThrow('up to 4');
  });
});
