declare const __LEARNR_BROWSER_TARGET__: string;

export type LearnrBrowserTarget = 'chromium' | 'arc';

export const BROWSER_TARGET: LearnrBrowserTarget = typeof __LEARNR_BROWSER_TARGET__ !== 'undefined' && __LEARNR_BROWSER_TARGET__ === 'arc' ? 'arc' : 'chromium';
export const IS_ARC_BUILD = BROWSER_TARGET === 'arc';
export const BROWSER_NAME = IS_ARC_BUILD ? 'Arc' : 'Chrome';
export const EXTENSION_SHORTCUTS_URL = IS_ARC_BUILD ? 'arc://extensions/shortcuts' : 'chrome://extensions/shortcuts';
