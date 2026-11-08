import type { GlobalSettings, PageTheme } from './types';
import { DEFAULT_DARK_HIGHLIGHT_COLOR, DEFAULT_LIGHT_HIGHLIGHT_COLOR } from './workspaces';

export function highlightColorForTheme(global: GlobalSettings | null | undefined, theme: PageTheme): string {
  return theme === 'dark'
    ? global?.darkHighlightColor ?? DEFAULT_DARK_HIGHLIGHT_COLOR
    : global?.lightHighlightColor ?? DEFAULT_LIGHT_HIGHLIGHT_COLOR;
}

export function sourceHighlightCss(name: string, color: string): string {
  return `::highlight(${name}){background-color:transparent;color:inherit;text-decoration-line:underline overline;text-decoration-color:${color};text-decoration-style:solid;text-decoration-thickness:1.5px;text-underline-offset:2px;text-shadow:-.35px 0 ${color},.35px 0 ${color},0 -.35px ${color},0 .35px ${color}}.learnr-image-highlighted,.learnr-video-highlighted{outline:3px solid ${color}!important;outline-offset:2px!important}`;
}
