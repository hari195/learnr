import { describe, expect, it } from 'vitest';
import { highlightColorForTheme, sourceHighlightCss } from './highlight-appearance';
import { defaultGlobalSettings } from './workspaces';

describe('highlight appearance', () => {
  it('uses independent colors for light and dark pages', () => {
    const global = { ...defaultGlobalSettings(), lightHighlightColor: '#aabbcc', darkHighlightColor: '#ddeeff' };
    expect(highlightColorForTheme(global, 'light')).toBe('#aabbcc');
    expect(highlightColorForTheme(global, 'dark')).toBe('#ddeeff');
  });

  it('renders text highlights without an opaque fill', () => {
    const css = sourceHighlightCss('learnr-test', '#fedcba');
    expect(css).toContain('background-color:transparent');
    expect(css).toContain('text-decoration-line:underline overline');
    expect(css).toContain('outline:3px solid #fedcba');
    expect(css).not.toContain('background:#fedcba');
  });
});
