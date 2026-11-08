import { describe, expect, it } from 'vitest';
import { appendVideosSection, canonicalInstagramMediaUrl, canonicalInstagramReelUrl, canonicalYoutubeUrl, formatVideosForPrompt, instagramMediaReference, instagramReelShortcode, parseMediaCommand, youtubeVideoId } from './media';

describe('media helpers', () => {
  it('normalizes YouTube URLs', () => {
    expect(youtubeVideoId('https://youtu.be/abc123XYZ_0')).toBe('abc123XYZ_0');
    expect(youtubeVideoId('https://www.youtube.com/embed/abc123XYZ_0')).toBe('abc123XYZ_0');
    expect(youtubeVideoId('https://example.com/watch?v=abc123XYZ_0')).toBeNull();
    expect(canonicalYoutubeUrl('abc123XYZ_0', 12)).toContain('t=12s');
  });
  it('recognizes only Instagram Reel URLs', () => {
    expect(instagramReelShortcode('https://www.instagram.com/reel/C9abc_12-x/?utm_source=copy')).toBe('C9abc_12-x');
    expect(instagramReelShortcode('https://instagram.com/p/C9abc_12-x/')).toBeNull();
    expect(instagramMediaReference('https://instagram.com/p/C9abc_12-x/?img_index=2')).toEqual({ shortcode: 'C9abc_12-x', route: 'post' });
    expect(instagramMediaReference('https://instagram.com/reel/C9abc_12-x/')).toEqual({ shortcode: 'C9abc_12-x', route: 'reel' });
    expect(instagramReelShortcode('https://example.com/reel/C9abc_12-x/')).toBeNull();
    expect(canonicalInstagramReelUrl('C9abc_12-x')).toBe('https://www.instagram.com/reel/C9abc_12-x/');
    expect(canonicalInstagramMediaUrl('C9abc_12-x', 'post')).toBe('https://www.instagram.com/p/C9abc_12-x/');
  });
  it('parses explicit video commands', () => {
    expect(parseMediaCommand('/video what happens?')).toEqual({ type: 'video', question: 'what happens?' });
    expect(parseMediaCommand('/video')).toEqual({ type: 'video', question: '' });
    expect(parseMediaCommand('/transcribe')).toBeNull();
    expect(parseMediaCommand('/image inspect the diagram')).toEqual({ type: 'image', question: 'inspect the diagram' });
    expect(parseMediaCommand('/image')).toEqual({ type: 'image', question: '' });
  });
  it('appends unique timestamped video links', () => {
    const video = { id: '1', videoId: 'abc123XYZ_0', title: 'A video', url: '', currentTimeSeconds: 9, createdAt: 1, pageFingerprint: 'p' };
    expect(appendVideosSection('# Note', [video, { ...video, id: '2' }])).toContain('## Videos\n\n- [A video](https://www.youtube.com/watch?v=abc123XYZ_0&t=9s)');
  });
  it('includes analyzed videos even when they were not highlighted', () => {
    expect(formatVideosForPrompt([], [{ videoId: 'abc123XYZ_0', title: 'Analyzed', url: 'https://youtu.be/abc123XYZ_0', transcript: 'Full analysis', analyzedAt: 1, model: 'video-model' }])).toContain('Full analysis');
  });
});
