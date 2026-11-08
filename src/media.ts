import type { VideoHighlight, VideoTranscriptContext } from './types';

const VIDEO_ID = /^[\w-]{6,20}$/;

export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'https://example.invalid/' : location.href);
    const host = url.hostname.replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
      else id = /^\/(?:embed|shorts|live)\/([^/?]+)/.exec(url.pathname)?.[1] ?? '';
    }
    return VIDEO_ID.test(id) ? id : null;
  } catch { return null; }
}

export function canonicalYoutubeUrl(videoId: string, seconds?: number): string {
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', videoId);
  if (Number.isFinite(seconds) && (seconds ?? 0) > 0) url.searchParams.set('t', `${Math.floor(seconds!)}s`);
  return url.href;
}

export type InstagramMediaRoute = 'reel' | 'post';

export function instagramMediaReference(value: string): { shortcode: string; route: InstagramMediaRoute } | null {
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'https://example.invalid/' : location.href);
    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'instagram.com') return null;
    const match = /^\/(reel|p)\/([^/?#]+)/.exec(url.pathname);
    const shortcode = match?.[2] ?? '';
    if (!/^[\w-]{3,64}$/.test(shortcode)) return null;
    return { shortcode, route: match?.[1] === 'reel' ? 'reel' : 'post' };
  } catch { return null; }
}

export function instagramReelShortcode(value: string): string | null {
  const media = instagramMediaReference(value);
  return media?.route === 'reel' ? media.shortcode : null;
}

export function canonicalInstagramMediaUrl(shortcode: string, route: InstagramMediaRoute): string {
  return `https://www.instagram.com/${route === 'reel' ? 'reel' : 'p'}/${encodeURIComponent(shortcode)}/`;
}

export function canonicalInstagramReelUrl(shortcode: string): string {
  return canonicalInstagramMediaUrl(shortcode, 'reel');
}

export function appendVideosSection(markdown: string, videos: VideoHighlight[]): string {
  if (!videos.length) return markdown;
  const unique = new Map<string, VideoHighlight>();
  for (const item of [...videos].sort((a, b) => a.createdAt - b.createdAt)) if (!unique.has(item.videoId)) unique.set(item.videoId, item);
  const links = [...unique.values()].map((item) => `- [${item.title.replace(/[\[\]]/g, '')}](${canonicalYoutubeUrl(item.videoId, item.currentTimeSeconds)})`).join('\n');
  return `${markdown.trimEnd()}\n\n## Videos\n\n${links}\n`;
}

export function formatVideosForPrompt(videos: VideoHighlight[], contexts: VideoTranscriptContext[]): string {
  if (!videos.length && !contexts.length) return '(No highlighted, transcribed, or analyzed videos.)';
  const analyzed = new Map(contexts.map((item) => [item.videoId, item]));
  const highlighted = new Set(videos.map((item) => item.videoId));
  const entries = videos.map((item) => {
    const context = analyzed.get(item.videoId);
    return { title: item.title, url: canonicalYoutubeUrl(item.videoId, item.currentTimeSeconds), transcript: context?.transcript, platform: 'youtube' };
  });
  for (const context of contexts) if (!highlighted.has(context.videoId)) entries.push({ title: context.title, url: context.url, transcript: context.transcript, platform: context.platform ?? 'youtube' });
  return entries.map((item, index) => [`${index + 1}. ${item.title} (${item.platform})`, item.url, item.transcript ? `Transcript/analysis:\n${item.transcript}` : 'No paid video analysis or transcription has been run.'].join('\n')).join('\n\n');
}

export type MediaCommand = { type: 'video' | 'image'; question: string } | null;

export function parseMediaCommand(value: string): MediaCommand {
  const match = /^\/(video|image)(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? { type: match[1].toLowerCase() === 'image' ? 'image' : 'video', question: match[2]?.trim() ?? '' } : null;
}
