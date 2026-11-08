import type { CSSProperties } from 'react';
import type { GlobalSettings } from './types';
import { DEFAULT_ACCENT_COLOR, DEFAULT_DARK_BACKGROUND_COLOR, DEFAULT_DARK_HIGHLIGHT_COLOR, DEFAULT_LIGHT_BACKGROUND_COLOR, DEFAULT_LIGHT_HIGHLIGHT_COLOR } from './workspaces';

export function globalAppearanceStyle(global: GlobalSettings | null | undefined, theme: 'light' | 'dark'): CSSProperties {
  const accent = global?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const background = theme === 'dark' ? global?.darkBackgroundColor ?? DEFAULT_DARK_BACKGROUND_COLOR : global?.lightBackgroundColor ?? DEFAULT_LIGHT_BACKGROUND_COLOR;
  const highlight = theme === 'dark' ? global?.darkHighlightColor ?? DEFAULT_DARK_HIGHLIGHT_COLOR : global?.lightHighlightColor ?? DEFAULT_LIGHT_HIGHLIGHT_COLOR;
  return {
    '--accent': accent,
    '--accent-hover': `color-mix(in srgb, ${accent} 86%, ${theme === 'dark' ? 'white' : 'black'})`,
    '--accent-soft': `color-mix(in srgb, ${accent} ${theme === 'dark' ? '18%' : '10%'}, var(--surface))`,
    '--bg': background,
    '--highlight': 'transparent',
    '--highlight-strong': highlight,
  } as CSSProperties;
}
