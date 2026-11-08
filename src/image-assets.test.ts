import { describe, expect, it } from 'vitest';
import { appendImagesSection, insertImageEmbed, obsidianImageEmbed, pastedImageFilename, referencedDraftImages } from './image-assets';
import type { ImageHighlight } from './types';

const image = (filename: string, createdAt = 1): ImageHighlight => ({
  id: filename, assetId: `asset-${filename}`, filename, mimeType: filename.endsWith('.gif') ? 'image/gif' : 'image/png', byteSize: 12,
  source: 'web', createdAt, pageFingerprint: 'page',
});

describe('note image assets', () => {
  it('creates local-time Pasted image names while preserving formats and avoiding same-second duplicates', () => {
    const date = new Date(2025, 10, 8, 19, 16, 3);
    expect(pastedImageFilename('image/png', [], date)).toBe('Pasted image 20251108191603.png');
    expect(pastedImageFilename('image/jpeg', ['Pasted image 20251108191603.jpg'], date)).toBe('Pasted image 20251108191603 2.jpg');
    expect(pastedImageFilename('image/jpeg', [], date, 'photo.jpeg')).toBe('Pasted image 20251108191603.jpeg');
    expect(pastedImageFilename('image/gif', [], date)).toBe('Pasted image 20251108191603.gif');
  });

  it('appends an ordered Images section using basename-only Obsidian embeds', () => {
    const output = appendImagesSection('# Note\n', [image('later.png', 2), image('first.gif', 1)]);
    expect(output).toBe('# Note\n\n## Images\n\n![[first.gif]]\n\n![[later.png]]\n');
    expect(appendImagesSection('# Note', [])).toBe('# Note');
  });

  it('inserts at a selection or the end with useful spacing', () => {
    expect(insertImageEmbed('Before selected after', 'image.png', 7, 15).markdown).toBe('Before \n\n![[image.png]]\n\n after');
    expect(insertImageEmbed('# Note', 'image.png').markdown).toBe('# Note\n\n![[image.png]]\n');
  });

  it('writes only images whose exact generated embed remains in the draft', () => {
    const images = [image('kept.png'), image('removed.png')];
    expect(referencedDraftImages(`Text\n${obsidianImageEmbed('kept.png')}`, images)).toEqual([images[0]]);
  });
});
