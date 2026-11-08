import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { PageContext } from './types';
import { detectPageTheme } from './theme';
import { canonicalInstagramMediaUrl, canonicalYoutubeUrl, instagramMediaReference, youtubeVideoId } from './media';

function meta(...names: string[]): string | undefined {
  for (const name of names) {
    const element = document.querySelector<HTMLMetaElement>(
      `meta[name="${name}"], meta[property="${name}"]`,
    );
    if (element?.content.trim()) return element.content.trim();
  }
}

function visibleText(): string {
  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  return (root as HTMLElement).innerText?.replace(/\n{3,}/g, '\n\n').trim() ?? '';
}

export function extractPageContext(): PageContext {
  const selectedText = window.getSelection()?.toString().trim() || undefined;
  const videoId = youtubeVideoId(location.href);
  const instagramReference = instagramMediaReference(location.href);
  const video = document.querySelector<HTMLVideoElement>('video');
  const captions = Array.from(document.querySelectorAll<HTMLElement>('ytd-transcript-segment-renderer .segment-text, [class*="transcript"] [class*="text"]'))
    .map((element) => element.innerText.trim()).filter(Boolean).join('\n');
  const youtube = videoId ? {
    videoId,
    canonicalUrl: canonicalYoutubeUrl(videoId),
    title: meta('og:title') || document.title.replace(/\s*-\s*YouTube\s*$/, '') || 'YouTube video',
    channel: document.querySelector<HTMLElement>('ytd-video-owner-renderer #channel-name')?.innerText.trim() || meta('author'),
    description: meta('og:description', 'description'),
    durationSeconds: Number.isFinite(video?.duration) ? video?.duration : undefined,
    currentTimeSeconds: video?.currentTime,
    captions: captions || undefined,
    captionsAvailable: Boolean(captions),
  } : undefined;
  const instagramRoot = instagramReference ? document.querySelector<HTMLElement>('article') ?? document.querySelector<HTMLElement>('main') : null;
  const instagramImages = instagramRoot ? Array.from(instagramRoot.querySelectorAll<HTMLImageElement>('img')).filter((image) => image.naturalWidth >= 240 || image.getBoundingClientRect().width >= 240) : [];
  const instagramHasNext = Boolean(instagramRoot && Array.from(instagramRoot.querySelectorAll<HTMLElement>('button,[role="button"]')).some((element) => {
    const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.querySelector('[aria-label]')?.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
    return /\bnext\b/.test(label);
  }));
  const instagramCaption = instagramRoot?.innerText?.replace(/\n{3,}/g, '\n\n').trim();
  const instagramMedia = instagramReference ? {
    shortcode: instagramReference.shortcode,
    route: instagramReference.route,
    canonicalUrl: canonicalInstagramMediaUrl(instagramReference.shortcode, instagramReference.route),
    title: meta('og:title') || document.title || (instagramReference.route === 'reel' ? 'Instagram Reel' : 'Instagram post'),
    account: meta('author') || document.querySelector<HTMLAnchorElement>('a[href^="/"][role="link"]')?.textContent?.trim(),
    caption: instagramCaption || meta('og:description', 'description'),
    mediaType: instagramHasNext || instagramImages.length > 1 ? 'carousel' as const : video ? 'video' as const : instagramImages.length ? 'image' as const : 'unknown' as const,
    hasVideo: Boolean(video),
    itemCount: instagramImages.length || undefined,
    durationSeconds: Number.isFinite(video?.duration) ? video?.duration : undefined,
    currentTimeSeconds: video?.currentTime,
  } : undefined;
  const base = {
    title: document.title || meta('og:title') || 'Untitled page',
    url: location.href,
    author: meta('author', 'article:author'),
    publishedDate: meta('article:published_time', 'date', 'datePublished'),
    selectedText,
    pageTheme: detectPageTheme(),
    documentKind: youtube ? 'youtube' as const : instagramMedia ? 'instagram-media' as const : 'html' as const,
    youtube,
    instagramMedia,
  };

  if (youtube) {
    const structured = [
      `# ${youtube.title}`,
      youtube.channel ? `Channel: ${youtube.channel}` : '',
      `URL: ${youtube.canonicalUrl}`,
      youtube.description ? `\n## Description\n\n${youtube.description}` : '',
      youtube.captions ? `\n## Captions available on page\n\n${youtube.captions}` : '\nCaptions are not currently exposed by this YouTube page. Use metadata only unless the user explicitly invokes /video.',
    ].filter(Boolean).join('\n');
    return { ...base, title: youtube.title, cleanedMarkdown: structured, extractionStatus: youtube.captions ? 'readable' : 'visible-text' };
  }

  if (instagramMedia) {
    const structured = [
      `# ${instagramMedia.title}`,
      instagramMedia.account ? `Account: ${instagramMedia.account}` : '',
      `URL: ${instagramMedia.canonicalUrl}`,
      `Media: ${instagramMedia.mediaType}`,
      instagramMedia.caption ? `\n## Caption and visible post text\n\n${instagramMedia.caption}` : '',
      instagramMedia.hasVideo ? '\nThis Instagram post can also be transcribed explicitly from its audio in Learnr.' : '',
    ].filter(Boolean).join('\n');
    return { ...base, title: instagramMedia.title, cleanedMarkdown: structured, extractionStatus: 'visible-text' };
  }

  try {
    const article = new Readability(document.cloneNode(true) as Document).parse();
    if (article?.content && (article.textContent?.trim().length ?? 0) > 200) {
      const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
      turndown.remove(['script', 'style', 'noscript', 'form', 'nav']);
      return {
        ...base,
        title: article.title || base.title,
        author: article.byline || base.author,
        cleanedMarkdown: turndown.turndown(article.content),
        extractionStatus: 'readable',
      };
    }
  } catch {
    // Continue through the progressively more conservative fallbacks.
  }

  if (selectedText) {
    return { ...base, cleanedMarkdown: selectedText, extractionStatus: 'selection' };
  }
  const fallback = visibleText();
  return {
    ...base,
    cleanedMarkdown: fallback,
    extractionStatus: fallback ? 'visible-text' : 'unavailable',
  };
}

export function pageFingerprint(context: PageContext): string {
  return `${context.url.split('#')[0]}::${context.title}`;
}
