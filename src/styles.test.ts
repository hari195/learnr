import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Settings card layout', () => {
  it('does not let ordered cards shrink and clip their contents', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.settings-view\s*>\s*\.settings-section\s*\{[^}]*flex:\s*0\s+0\s+auto/);
  });

  it('keeps the Conversation Sources header clear of its rounded corners', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.sources-overlay-backdrop\s*\{[^}]*padding:\s*max\(12px/);
    expect(css).toMatch(/\.sources-drawer\s*>\s*\.highlights-drawer-heading\s*\{[^}]*padding:\s*18px\s+20px\s+16px/);
    expect(css).toMatch(/\.source-budget-summary\s*\{[^}]*padding:\s*16px/);
  });

  it('keeps model metadata in normal flow below its searchable input', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.model-combobox\s*\{[^}]*display:\s*flow-root/);
    expect(css).toMatch(/\.model-combobox\s*>\s*input\s*\{[^}]*display:\s*block[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.model-metadata\s*\{[^}]*clear:\s*both/);
  });
});
