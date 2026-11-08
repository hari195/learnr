import { describe, expect, it } from 'vitest';
import { classifyTheme, parseCssColor, relativeLuminance, resolveTheme } from './theme';

describe('theme inference', () => {
  it('parses computed rgb and rgba colors', () => {
    expect(parseCssColor('rgb(20, 24, 20)')).toEqual({ r: 20, g: 24, b: 20, a: 1 });
    expect(parseCssColor('rgba(255 255 255 / 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });

  it('classifies dark and light backgrounds by luminance', () => {
    expect(classifyTheme({ r: 20, g: 24, b: 20, a: 1 })).toBe('dark');
    expect(classifyTheme({ r: 247, g: 245, b: 238, a: 1 })).toBe('light');
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1);
  });

  it('applies manual, website, and system precedence', () => {
    expect(resolveTheme('dark', 'light', false)).toBe('dark');
    expect(resolveTheme('website', 'dark', false)).toBe('dark');
    expect(resolveTheme('website', undefined, true)).toBe('dark');
    expect(resolveTheme('system', 'dark', false)).toBe('light');
  });
});
