declare const __LEARNR_BUILD_ID__: string;

import { BROWSER_TARGET } from './build-target';

export const APP_VERSION = chrome.runtime.getManifest().version;
export const BUILD_VERSION = typeof __LEARNR_BUILD_ID__ === 'string' ? __LEARNR_BUILD_ID__ : 'development';
export { BROWSER_TARGET };
