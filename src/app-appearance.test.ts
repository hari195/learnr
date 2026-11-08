import { describe, expect, it } from 'vitest';
import { globalAppearanceStyle } from './app-appearance';
import { defaultGlobalSettings } from './workspaces';

describe('global app appearance', () => {
  it('applies the selected accent and theme-specific background', () => {
    const global = { ...defaultGlobalSettings(), accentColor: '#ff0088', lightBackgroundColor: '#fafafa', darkBackgroundColor: '#020304' };
    expect(globalAppearanceStyle(global, 'light')).toMatchObject({ '--accent': '#ff0088', '--bg': '#fafafa' });
    expect(globalAppearanceStyle(global, 'dark')).toMatchObject({ '--accent': '#ff0088', '--bg': '#020304' });
  });
});
