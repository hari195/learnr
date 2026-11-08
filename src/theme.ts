import type { PageTheme, ThemeMode } from './types';

export interface RgbColor { r: number; g: number; b: number; a: number }

export function parseCssColor(value: string): RgbColor | null {
  const match = value.trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
}

function linearChannel(value: number): number {
  const channel = Math.max(0, Math.min(255, value)) / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: RgbColor): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function classifyTheme(color: RgbColor): PageTheme {
  return relativeLuminance(color) < 0.32 ? 'dark' : 'light';
}

export function resolveTheme(mode: ThemeMode, pageTheme: PageTheme | undefined, systemDark: boolean): PageTheme {
  if (mode === 'dark' || mode === 'light') return mode;
  if (mode === 'website' && pageTheme) return pageTheme;
  return systemDark ? 'dark' : 'light';
}

function declaredColorScheme(): PageTheme | null {
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    const scheme = getComputedStyle(element).colorScheme.toLowerCase();
    if (scheme === 'dark') return 'dark';
    if (scheme === 'light') return 'light';
  }
  return null;
}

function visibleBackground(): RgbColor | null {
  const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const candidates: Array<Element | null> = [center, document.body, document.documentElement];
  for (const candidate of candidates) {
    let element = candidate;
    while (element) {
      const color = parseCssColor(getComputedStyle(element).backgroundColor);
      if (color && color.a >= 0.65) return color;
      element = element.parentElement;
    }
  }
  return null;
}

export function detectPageTheme(): PageTheme {
  const declared = declaredColorScheme();
  if (declared) return declared;
  const background = visibleBackground();
  if (background) return classifyTheme(background);
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function observePageTheme(onChange: (theme: PageTheme) => void): () => void {
  let current = detectPageTheme();
  let timer: number | undefined;
  const update = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const next = detectPageTheme();
      if (next !== current) { current = next; onChange(next); }
    }, 120);
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  return () => { observer.disconnect(); media.removeEventListener('change', update); window.clearTimeout(timer); };
}
