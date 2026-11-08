import { describe, expect, it } from 'vitest';
import { nextAppVersion } from './version.mjs';

describe('production version transitions', () => {
  it('promotes every 0.x build to 1.0.0', () => {
    expect(nextAppVersion('0.1.59')).toBe('1.0.0');
    expect(nextAppVersion('0.99.999')).toBe('1.0.0');
  });

  it('pins every valid production build to 1.0.0', () => {
    expect(nextAppVersion('1.0.0')).toBe('1.0.0');
    expect(nextAppVersion('1.4.9')).toBe('1.0.0');
  });

  it('rejects invalid versions', () => {
    expect(() => nextAppVersion('1.0')).toThrow(/invalid app version/);
  });
});
