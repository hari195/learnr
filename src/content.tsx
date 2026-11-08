import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { extractPageContext } from './extract';
import { isDuplicateSourceHighlight } from './highlights';
import { resolveSourceHighlights, selectionCanBeHighlighted, serializeSourceSelection } from './source-highlights';
import { detectPageTheme, observePageTheme } from './theme';
import type { GlobalSettings, ImageHighlight, SourceHighlight, VideoHighlight } from './types';
import { canonicalYoutubeUrl, youtubeVideoId } from './media';
import { loadGlobalSettings, observeGlobalSettings } from './workspaces';
import { highlightColorForTheme, sourceHighlightCss } from './highlight-appearance';
import styles from './styles.css?inline';

const HOST_ID = 'learnr-extension-root';
const SOURCE_ACTION_HOST_ID = 'learnr-source-highlight-action-root';
const SOURCE_HIGHLIGHT_NAME = 'learnr-source-highlights';
let reactRoot: Root | null = null;
let visible = false;
let rootElement: HTMLDivElement | null = null;
let sourceMode: { enabled: boolean; historyId: string; pageFingerprint: string; highlights: SourceHighlight[]; imageHighlights: ImageHighlight[]; videoHighlights: VideoHighlight[] } = { enabled: false, historyId: '', pageFingerprint: '', highlights: [], imageHighlights: [], videoHighlights: [] };
let sourceCandidate: Range | null = null;
let mediaCandidate: HTMLImageElement | HTMLIFrameElement | HTMLVideoElement | null = null;
let sourceActionHost: HTMLDivElement | null = null;
let sourceMutationTimer: number | undefined;
let lastResolvedSignature = '';
let sourceHighlightStyle: HTMLStyleElement | null = null;
let highlightSettings: GlobalSettings | null = null;
let pageTheme = detectPageTheme();
let mediaPlayback: {
  jobId: string;
  video: HTMLVideoElement;
  snapshot: { currentTime: number; paused: boolean; muted: boolean; volume: number; playbackRate: number; loop: boolean };
  timer?: number;
  ended: () => void;
  lastAdState: boolean;
} | null = null;

function primaryMediaElement(): HTMLVideoElement | null {
  const youtube = document.querySelector<HTMLVideoElement>('video.html5-main-video');
  if (youtube) return youtube;
  return [...document.querySelectorAll<HTMLVideoElement>('video')]
    .filter((element) => element.readyState > 0 && element.getBoundingClientRect().width > 0)
    .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] ?? null;
}

type InstagramVisual = { url: string; name: string; kind: 'image' | 'video-poster' };

function visibleArea(element: Element): number {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return 0;
  const style = getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 ? 0 : rect.width * rect.height;
}

function instagramPostRoot(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('article'));
  return candidates.sort((left, right) => {
    const area = (root: HTMLElement) => Math.max(0, ...Array.from(root.querySelectorAll('img,video')).map(visibleArea));
    return area(right) - area(left);
  })[0] ?? document.querySelector<HTMLElement>('main');
}

function currentInstagramVisual(root: HTMLElement): InstagramVisual | null {
  const media = Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img,video'))
    .map((element) => ({ element, area: visibleArea(element) }))
    .filter((item) => item.area > 30_000)
    .sort((left, right) => right.area - left.area)[0]?.element;
  if (media instanceof HTMLVideoElement) {
    const poster = media.poster;
    return poster ? { url: poster, name: 'Instagram video cover', kind: 'video-poster' } : null;
  }
  if (media instanceof HTMLImageElement) {
    const url = media.currentSrc || media.src;
    return url ? { url, name: (media.alt || `Instagram slide`).slice(0, 120), kind: 'image' } : null;
  }
  return null;
}

function instagramCarouselButton(root: HTMLElement, direction: 'next' | 'previous'): HTMLElement | null {
  const visual = root.querySelector('img,video')?.getBoundingClientRect();
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('button,[role="button"]')).filter((element) => {
    if (!visibleArea(element)) return false;
    const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent, element.querySelector('[aria-label]')?.getAttribute('aria-label'), element.querySelector('title')?.textContent]
      .filter(Boolean).join(' ').toLowerCase();
    if (direction === 'next' ? /\bnext\b/.test(label) : /\b(previous|prev)\b/.test(label)) return true;
    if (!visual) return false;
    const rect = element.getBoundingClientRect();
    const verticallyAligned = rect.top < visual.bottom && rect.bottom > visual.top;
    return verticallyAligned && (direction === 'next' ? rect.left > visual.left + visual.width * .65 : rect.right < visual.right - visual.width * .65);
  });
  return candidates.sort((left, right) => visibleArea(right) - visibleArea(left))[0] ?? null;
}

async function waitForInstagramVisual(root: HTMLElement, previousUrl: string): Promise<InstagramVisual | null> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    const visual = currentInstagramVisual(root);
    if (visual?.url && visual.url !== previousUrl) return visual;
  }
  return currentInstagramVisual(root);
}

async function moveInstagramCarousel(root: HTMLElement, direction: 'next' | 'previous'): Promise<InstagramVisual | null> {
  const before = currentInstagramVisual(root);
  const button = instagramCarouselButton(root, direction);
  if (!before || !button) return null;
  button.click();
  const after = await waitForInstagramVisual(root, before.url);
  return after?.url !== before.url ? after : null;
}

async function collectInstagramVisuals(): Promise<{ ok: boolean; items?: InstagramVisual[]; error?: string }> {
  const root = instagramPostRoot();
  if (!root) return { ok: false, error: 'The Instagram post is not visible.' };
  const original = currentInstagramVisual(root);
  if (!original) return { ok: false, error: 'No analyzable image is visible in this Instagram post.' };

  // Start at the first slide, then walk forward. The original slide is restored afterward.
  for (let count = 0; count < 19; count += 1) if (!await moveInstagramCarousel(root, 'previous')) break;
  const items: InstagramVisual[] = [];
  let current = currentInstagramVisual(root);
  if (current) items.push(current);
  for (let count = 0; count < 19; count += 1) {
    const next = await moveInstagramCarousel(root, 'next');
    if (!next || items.some((item) => item.url === next.url)) break;
    items.push(next);
  }
  for (let count = 0; count < 19 && currentInstagramVisual(root)?.url !== original.url; count += 1) {
    if (!await moveInstagramCarousel(root, 'previous')) break;
  }
  return { ok: true, items };
}

function youtubeAdPlaying(): boolean {
  return Boolean(document.querySelector('.html5-video-player.ad-showing, ytd-player.ad-showing'));
}

function restoreMediaPlayback(jobId: string): void {
  const playback = mediaPlayback;
  if (!playback || playback.jobId !== jobId) return;
  if (playback.timer) window.clearInterval(playback.timer);
  playback.video.removeEventListener('ended', playback.ended);
  const { video, snapshot } = playback;
  video.loop = snapshot.loop;
  video.playbackRate = snapshot.playbackRate;
  video.muted = snapshot.muted;
  video.volume = snapshot.volume;
  try { video.currentTime = snapshot.currentTime; } catch { /* The page may have replaced the media. */ }
  if (snapshot.paused) video.pause(); else void video.play().catch(() => undefined);
  mediaPlayback = null;
}

async function beginMediaPlayback(jobId: string, startSeconds: number): Promise<{ ok: boolean; error?: string }> {
  const video = primaryMediaElement();
  if (!video) return { ok: false, error: 'No playable video was found on this page.' };
  if (mediaPlayback && mediaPlayback.jobId !== jobId) return { ok: false, error: 'Another media transcription is already active.' };
  if (!mediaPlayback) {
    const ended = () => void chrome.runtime.sendMessage({ target: 'learnr-background', type: 'LEARNR_MEDIA_PLAYBACK_DONE', jobId, currentSeconds: video.duration }).catch(() => undefined);
    mediaPlayback = {
      jobId,
      video,
      snapshot: { currentTime: video.currentTime, paused: video.paused, muted: video.muted, volume: video.volume, playbackRate: video.playbackRate, loop: video.loop },
      ended,
      lastAdState: youtubeAdPlaying(),
    };
    video.addEventListener('ended', ended, { once: true });
  }
  try {
    video.loop = false;
    video.playbackRate = 1;
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
    video.currentTime = Math.max(0, Math.min(startSeconds, Number.isFinite(video.duration) ? video.duration : startSeconds));
    await video.play();
    mediaPlayback.timer = window.setInterval(() => {
      if (!mediaPlayback || mediaPlayback.jobId !== jobId) return;
      const adPlaying = youtubeAdPlaying();
      if (adPlaying !== mediaPlayback.lastAdState) mediaPlayback.lastAdState = adPlaying;
      void chrome.runtime.sendMessage({
        target: 'learnr-background', type: 'LEARNR_MEDIA_PLAYBACK_PROGRESS', jobId,
        currentSeconds: video.currentTime, durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined, adPlaying,
      }).catch(() => undefined);
    }, 500);
    return { ok: true };
  } catch (error) {
    restoreMediaPlayback(jobId);
    return { ok: false, error: error instanceof Error ? error.message : 'The video could not be played.' };
  }
}

function sourceHighlightRegistry() {
  return (CSS as typeof CSS & { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } }).highlights;
}

function ensureSourceStyles() {
  sourceHighlightStyle = sourceHighlightStyle ?? document.getElementById('learnr-source-highlight-styles') as HTMLStyleElement | null;
  if (!sourceHighlightStyle) {
    sourceHighlightStyle = document.createElement('style');
    sourceHighlightStyle.id = 'learnr-source-highlight-styles';
    document.documentElement.appendChild(sourceHighlightStyle);
  }
  sourceHighlightStyle.textContent = sourceHighlightCss(SOURCE_HIGHLIGHT_NAME, highlightColorForTheme(highlightSettings, pageTheme));
}

function ensureSourceAction() {
  if (sourceActionHost) return sourceActionHost;
  const host = document.createElement('div');
  host.id = SOURCE_ACTION_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{display:block}.menu{display:flex;flex-direction:column;min-width:105px;border:1px solid rgba(116,82,0,.35);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 7px 20px rgba(20,24,20,.24)}button{appearance:none;padding:8px 11px;border:0;border-bottom:1px solid #eadfbd;background:#fff;color:#251b00;text-align:left;font:700 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:last-child{border-bottom:0}button:first-child{background:#ffe16b}button:hover{filter:brightness(.96)}';
  const menu = document.createElement('div'); menu.className = 'menu';
  const highlight = document.createElement('button'); highlight.type = 'button'; highlight.dataset.action = 'highlight'; highlight.textContent = 'Highlight';
  const ask = document.createElement('button'); ask.type = 'button'; ask.dataset.action = 'ask'; ask.textContent = 'Ask learnr';
  for (const button of [highlight, ask]) button.addEventListener('pointerdown', (event) => event.preventDefault());
  highlight.addEventListener('click', () => void (mediaCandidate ? addMediaHighlight() : addSourceHighlight()));
  ask.addEventListener('click', () => void askCandidate());
  menu.append(highlight, ask); shadow.append(style, menu);
  document.documentElement.appendChild(host);
  sourceActionHost = host;
  return host;
}

function hideSourceAction() {
  sourceCandidate = null;
  mediaCandidate = null;
  if (sourceActionHost) sourceActionHost.style.display = 'none';
}

function reportResolved(ids: string[]) {
  const signature = [...ids].sort().join(',');
  if (signature === lastResolvedSignature) return;
  lastResolvedSignature = signature;
  void chrome.runtime.sendMessage({
    type: 'LEARNR_SOURCE_HIGHLIGHTS_RESOLVED',
    historyId: sourceMode.historyId,
    pageFingerprint: sourceMode.pageFingerprint,
    resolvedIds: ids,
  }).catch(() => undefined);
}

function paintSourceHighlights() {
  const registry = sourceHighlightRegistry();
  const HighlightConstructor = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightConstructor || !sourceMode.enabled || !document.body) {
    registry?.delete(SOURCE_HIGHLIGHT_NAME);
    reportResolved([]);
    return;
  }
  const resolved = resolveSourceHighlights(sourceMode.highlights, sourceMode.pageFingerprint);
  if (resolved.ranges.length) registry.set(SOURCE_HIGHLIGHT_NAME, new HighlightConstructor(...resolved.ranges));
  else registry.delete(SOURCE_HIGHLIGHT_NAME);
  reportResolved(resolved.resolvedIds);
  document.querySelectorAll('.learnr-image-highlighted,.learnr-video-highlighted').forEach((element) => element.classList.remove('learnr-image-highlighted', 'learnr-video-highlighted'));
  for (const highlight of sourceMode.imageHighlights) {
    if (highlight.pageFingerprint !== sourceMode.pageFingerprint || !highlight.sourceAnchor?.src) continue;
    const matches = Array.from(document.images).filter((image) => image.currentSrc === highlight.sourceAnchor!.src || image.src === highlight.sourceAnchor!.src);
    matches[highlight.sourceAnchor.index ?? 0]?.classList.add('learnr-image-highlighted');
  }
  for (const highlight of sourceMode.videoHighlights) {
    if (highlight.pageFingerprint !== sourceMode.pageFingerprint) continue;
    mediaElements().find((element) => youtubeVideoId(mediaUrl(element)) === highlight.videoId)?.classList.add('learnr-video-highlighted');
  }
}

function scheduleSourcePaint() {
  window.clearTimeout(sourceMutationTimer);
  sourceMutationTimer = window.setTimeout(paintSourceHighlights, 180);
}

function updateSourceMode(next: typeof sourceMode) {
  sourceMode = next;
  ensureSourceStyles();
  if (!next.enabled) {
    hideSourceAction();
    sourceHighlightRegistry()?.delete(SOURCE_HIGHLIGHT_NAME);
    reportResolved([]);
    return;
  }
  scheduleSourcePaint();
}

function captureSourceSelection() {
  if (!sourceMode.enabled || !document.body) return hideSourceAction();
  const selection = window.getSelection();
  if (!selectionCanBeHighlighted(selection, document.body)) return hideSourceAction();
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return hideSourceAction();
  sourceCandidate = range.cloneRange();
  mediaCandidate = null;
  const action = ensureSourceAction();
  action.style.left = `${Math.min(window.innerWidth - 120, Math.max(8, rect.left + rect.width / 2 - 54))}px`;
  action.style.top = `${Math.max(8, rect.top - 72)}px`;
  action.style.display = 'block';
}

function mediaUrl(element: HTMLImageElement | HTMLIFrameElement | HTMLVideoElement): string {
  if (element instanceof HTMLImageElement) return element.currentSrc || element.src;
  if (element instanceof HTMLIFrameElement) return element.src;
  return location.href;
}

function mediaElements(): Array<HTMLIFrameElement | HTMLVideoElement> {
  return Array.from(document.querySelectorAll<HTMLIFrameElement | HTMLVideoElement>('iframe[src*="youtube.com/embed/"],iframe[src*="youtube-nocookie.com/embed/"],video')).filter((element) => Boolean(youtubeVideoId(mediaUrl(element))));
}

function showMediaAction(element: HTMLImageElement | HTMLIFrameElement | HTMLVideoElement) {
  if (!sourceMode.enabled || element.closest(`#${HOST_ID},#${SOURCE_ACTION_HOST_ID}`)) return;
  const rect = element.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 60) return;
  sourceCandidate = null; mediaCandidate = element;
  const action = ensureSourceAction();
  action.style.left = `${Math.max(8, Math.min(window.innerWidth - 120, rect.right - 116))}px`;
  action.style.top = `${Math.max(8, rect.top + 8)}px`;
  action.style.display = 'block';
}

function imagesInRange(range: Range): HTMLImageElement[] {
  return Array.from(document.images).filter((image) => { try { return range.intersectsNode(image); } catch { return false; } });
}

function imagePayload(image: HTMLImageElement) {
  const src = image.currentSrc || image.src;
  const matches = Array.from(document.images).filter((candidate) => (candidate.currentSrc || candidate.src) === src);
  return { url: src, name: (image.alt || image.title || 'Web image').slice(0, 120), anchor: { src, alt: image.alt || undefined, index: Math.max(0, matches.indexOf(image)) } };
}

async function askCandidate() {
  if (!sourceMode.enabled) return;
  const range = sourceCandidate?.cloneRange(); const media = mediaCandidate;
  const images = range ? imagesInRange(range).map(imagePayload) : media instanceof HTMLImageElement ? [imagePayload(media)] : [];
  const videoId = media && !(media instanceof HTMLImageElement) ? youtubeVideoId(mediaUrl(media)) : null;
  const currentTimeSeconds = media instanceof HTMLVideoElement ? media.currentTime : undefined;
  await chrome.runtime.sendMessage({
    type: 'LEARNR_SOURCE_ASK', historyId: sourceMode.historyId, pageFingerprint: sourceMode.pageFingerprint,
    text: range?.toString().trim() ?? '', images,
    video: videoId ? { videoId, title: media?.getAttribute('title') || document.title || 'YouTube video', url: canonicalYoutubeUrl(videoId, currentTimeSeconds), currentTimeSeconds } : undefined,
  }).catch(() => undefined);
  hideSourceAction(); window.getSelection()?.removeAllRanges();
}

async function addMediaHighlight() {
  const media = mediaCandidate; if (!media || !sourceMode.enabled) return;
  if (media instanceof HTMLImageElement) {
    await chrome.runtime.sendMessage({ type: 'LEARNR_SOURCE_MEDIA_HIGHLIGHT', mediaKind: 'image', historyId: sourceMode.historyId, pageFingerprint: sourceMode.pageFingerprint, image: imagePayload(media) }).catch(() => undefined);
  } else {
    const videoId = youtubeVideoId(mediaUrl(media)); if (!videoId) return hideSourceAction();
    const currentTimeSeconds = media instanceof HTMLVideoElement ? media.currentTime : undefined;
    await chrome.runtime.sendMessage({ type: 'LEARNR_SOURCE_MEDIA_HIGHLIGHT', mediaKind: 'video', historyId: sourceMode.historyId, pageFingerprint: sourceMode.pageFingerprint, video: { videoId, title: media.getAttribute('title') || document.title || 'YouTube video', url: canonicalYoutubeUrl(videoId), currentTimeSeconds } }).catch(() => undefined);
  }
  hideSourceAction();
}

async function addSourceHighlight() {
  if (!sourceCandidate || !sourceMode.enabled || !document.body) return;
  const selectedRange = sourceCandidate.cloneRange();
  const selectedImages = imagesInRange(selectedRange).map(imagePayload);
  const highlight = serializeSourceSelection(selectedRange, sourceMode.pageFingerprint);
  if (!highlight) return hideSourceAction();
  if (isDuplicateSourceHighlight(sourceMode.highlights, highlight)) {
    hideSourceAction(); window.getSelection()?.removeAllRanges(); return;
  }
  sourceMode = { ...sourceMode, highlights: [...sourceMode.highlights, highlight] };
  hideSourceAction(); window.getSelection()?.removeAllRanges(); paintSourceHighlights();
  await chrome.runtime.sendMessage({
    type: 'LEARNR_SOURCE_HIGHLIGHT_CREATED',
    historyId: sourceMode.historyId,
    pageFingerprint: sourceMode.pageFingerprint,
    highlight,
  }).catch(() => undefined);
  for (const image of selectedImages) await chrome.runtime.sendMessage({ type: 'LEARNR_SOURCE_MEDIA_HIGHLIGHT', mediaKind: 'image', historyId: sourceMode.historyId, pageFingerprint: sourceMode.pageFingerprint, image }).catch(() => undefined);
}

function mount() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0 0 0 auto;width:min(440px,92vw);z-index:2147483647;display:none;filter:drop-shadow(-12px 0 32px rgba(20,24,20,.14));';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{color-scheme:light dark}${styles}`;
    const root = document.createElement('div'); root.id = 'root'; root.style.height = '100%'; rootElement = root;
    const handle = document.createElement('div'); handle.className = 'learnr-resize-handle';
    handle.addEventListener('pointerdown', (event) => {
      const startX = event.clientX; const startWidth = host!.getBoundingClientRect().width;
      const move = (moveEvent: PointerEvent) => { host!.style.width = `${Math.max(340, Math.min(window.innerWidth * .92, startWidth + startX - moveEvent.clientX))}px`; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    shadow.append(style, handle, root); document.documentElement.appendChild(host);
  }
  return host;
}

function setVisible(next: boolean) {
  visible = next;
  const host = mount();
  if (visible && !reactRoot && rootElement) {
    reactRoot = createRoot(rootElement);
    reactRoot.render(<React.StrictMode><App injected onClose={() => setVisible(false)} /></React.StrictMode>);
  }
  host.style.display = visible ? 'block' : 'none';
  if (!visible) {
    updateSourceMode({ ...sourceMode, enabled: false });
    reactRoot?.unmount(); reactRoot = null;
  }
  else if (sourceMode.historyId) updateSourceMode({ ...sourceMode, enabled: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LEARNR_PING') { sendResponse({ ok: true }); return; }
  if (message?.type === 'LEARNR_TOGGLE_PANEL') { setVisible(!visible); sendResponse({ ok: true }); return; }
  if (message?.type === 'LEARNR_OPEN_PANEL') { setVisible(true); sendResponse({ ok: true }); return; }
  if (message?.type === 'LEARNR_CLOSE_PANEL') { setVisible(false); sendResponse({ ok: true }); return; }
  if (message?.type === 'LEARNR_FOCUS_COMPOSER' || message?.type === 'LEARNR_COMMAND_AVAILABLE') {
    if (visible) window.dispatchEvent(new CustomEvent(message.type === 'LEARNR_FOCUS_COMPOSER' ? 'learnr:focus-composer' : 'learnr:command-available'));
    sendResponse({ ok: true }); return;
  }
  if (message?.type === 'LEARNR_EXTRACT_PAGE') { sendResponse(extractPageContext()); }
  if (message?.type === 'LEARNR_INSTAGRAM_MEDIA_COLLECT') {
    void collectInstagramVisuals().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'LEARNR_MEDIA_PREPARE') {
    const video = primaryMediaElement();
    if (!video) { sendResponse({ ok: false, error: 'No playable video was found on this page.' }); return; }
    sendResponse({ ok: true, durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined, currentSeconds: video.currentTime, title: document.title });
    return;
  }
  if (message?.type === 'LEARNR_MEDIA_PLAY') {
    void beginMediaPlayback(String(message.jobId), Number(message.startSeconds ?? 0)).then(sendResponse);
    return true;
  }
  if (message?.type === 'LEARNR_MEDIA_RESTORE') {
    restoreMediaPlayback(String(message.jobId));
    sendResponse({ ok: true }); return;
  }
  if (message?.type === 'LEARNR_MEDIA_BACKPRESSURE') {
    if (!mediaPlayback || mediaPlayback.jobId !== String(message.jobId)) { sendResponse({ ok: false }); return; }
    if (message.paused) mediaPlayback.video.pause(); else void mediaPlayback.video.play().catch(() => undefined);
    sendResponse({ ok: true }); return;
  }
  if (message?.type === 'LEARNR_TAB_NAVIGATED') { window.dispatchEvent(new CustomEvent('learnr:navigated', { detail: { tabId: message.tabId } })); }
  if (message?.type === 'LEARNR_SOURCE_HIGHLIGHT_MODE') {
    updateSourceMode({ enabled: Boolean(message.enabled), historyId: String(message.historyId ?? ''), pageFingerprint: String(message.pageFingerprint ?? ''), highlights: (message.highlights ?? []) as SourceHighlight[], imageHighlights: (message.imageHighlights ?? []) as ImageHighlight[], videoHighlights: (message.videoHighlights ?? []) as VideoHighlight[] });
    sendResponse({ ok: true });
  }
  if (message?.type === 'LEARNR_SOURCE_HIGHLIGHTS_SYNC') {
    if (message.historyId === sourceMode.historyId && message.pageFingerprint === sourceMode.pageFingerprint) updateSourceMode({ ...sourceMode, highlights: (message.highlights ?? []) as SourceHighlight[], imageHighlights: (message.imageHighlights ?? []) as ImageHighlight[], videoHighlights: (message.videoHighlights ?? []) as VideoHighlight[] });
    sendResponse({ ok: true });
  }
});

document.addEventListener('mouseup', captureSourceSelection);
document.addEventListener('keyup', (event) => { if (event.key === 'Escape') hideSourceAction(); else captureSourceSelection(); });
document.addEventListener('selectionchange', () => { if (window.getSelection()?.isCollapsed) hideSourceAction(); });
document.addEventListener('pointerover', (event) => {
  const element = event.target instanceof Element ? event.target.closest<HTMLImageElement | HTMLIFrameElement | HTMLVideoElement>('img,iframe,video') : null;
  if (element instanceof HTMLImageElement || element instanceof HTMLIFrameElement || element instanceof HTMLVideoElement) {
    if (element instanceof HTMLImageElement || youtubeVideoId(mediaUrl(element))) showMediaAction(element);
  }
}, true);
document.addEventListener('focusin', (event) => {
  const element = event.target instanceof Element ? event.target.closest<HTMLImageElement | HTMLIFrameElement | HTMLVideoElement>('img,iframe,video') : null;
  if (element instanceof HTMLImageElement || element instanceof HTMLIFrameElement || element instanceof HTMLVideoElement) {
    if (element instanceof HTMLImageElement || youtubeVideoId(mediaUrl(element))) showMediaAction(element);
  }
}, true);
window.addEventListener('resize', hideSourceAction);
window.addEventListener('scroll', hideSourceAction, true);

const sourceMutationObserver = new MutationObserver(() => { if (sourceMode.enabled) scheduleSourcePaint(); });
sourceMutationObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

observePageTheme((theme) => {
  pageTheme = theme;
  ensureSourceStyles();
  window.dispatchEvent(new CustomEvent('learnr:theme-changed', { detail: { theme } }));
  void chrome.runtime.sendMessage({ type: 'LEARNR_PAGE_THEME_DETECTED', theme }).catch(() => undefined);
});

void loadGlobalSettings().then((settings) => { highlightSettings = settings; ensureSourceStyles(); }).catch(() => undefined);
observeGlobalSettings((settings) => { highlightSettings = settings; ensureSourceStyles(); });

mount();
