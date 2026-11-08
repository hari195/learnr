import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const dirArgument = process.argv.find((argument) => argument.startsWith('--dir='));
const targetArgument = process.argv.find((argument) => argument.startsWith('--target='));
const outDir = dirArgument?.slice('--dir='.length) || 'dist';
const target = targetArgument?.slice('--target='.length) || 'chromium';
if (!['chromium', 'arc'].includes(target)) throw new Error(`Unknown browser build target ${JSON.stringify(target)}.`);

const outputPath = (...parts) => resolve(outDir, ...parts);
const contentPath = outputPath('content.js');
const content = await readFile(contentPath, 'utf8').catch((error) => {
  throw new Error(`Missing injected content bundle at ${contentPath}: ${error.message}`);
});

const moduleStatement = /^\s*(?:import(?:\s|["'])|export\s)/m;
if (moduleStatement.test(content)) {
  throw new Error('dist/content.js contains an ES-module import/export and cannot be injected by chrome.scripting.executeScript.');
}

if (/\bprocess\.env\.NODE_ENV\b/.test(content) || /(^|[^\w."'])process\.(?:env|versions|version|platform|arch)\b/m.test(content)) {
  throw new Error('dist/content.js contains an unsafe unresolved Node process reference.');
}

if (!content.includes('LEARNR_TOGGLE_PANEL') || !content.includes('LEARNR_EXTRACT_PAGE')) {
  throw new Error('dist/content.js is missing the injected-panel message handlers.');
}

if (/\bchrome\.(?:tabs|windows|commands|sidePanel|tabGroups|action|scripting|tabCapture|offscreen)\b|\bchrome\.runtime\.openOptionsPage\b/.test(content)) {
  throw new Error(`${outDir}/content.js directly calls a privileged extension API that is unavailable in a page content-script context.`);
}

const [sidePanelPage, settingsPage, historyPage, notePage, microphonePage, offscreenPage, manifest, sourceManifest, packageJson, packageLock, buildInfo, brandSvg] = await Promise.all([
  readFile(outputPath('sidepanel.html'), 'utf8'),
  readFile(outputPath('settings.html'), 'utf8'),
  readFile(outputPath('history.html'), 'utf8'),
  readFile(outputPath('note.html'), 'utf8'),
  readFile(outputPath('microphone.html'), 'utf8'),
  readFile(outputPath('offscreen.html'), 'utf8'),
  readFile(outputPath('manifest.json'), 'utf8').then((value) => JSON.parse(value)),
  readFile(resolve('public/manifest.json'), 'utf8').then((value) => JSON.parse(value)),
  readFile(resolve('package.json'), 'utf8').then((value) => JSON.parse(value)),
  readFile(resolve('package-lock.json'), 'utf8').then((value) => JSON.parse(value)),
  readFile(outputPath('build-info.json'), 'utf8').then((value) => JSON.parse(value)),
  readFile(outputPath('learnr-icon.svg'), 'utf8'),
]);
for (const [name, page] of Object.entries({ sidepanel: sidePanelPage, settings: settingsPage, history: historyPage, note: notePage, microphone: microphonePage })) {
  if (!page.includes('learnr-icon.svg')) throw new Error(`dist/${name}.html does not declare the shared learnr favicon.`);
}
if (!brandSvg.includes('M6 12 3.269 3.125')) throw new Error('dist/learnr-icon.svg does not contain the approved learnr mark.');
if (!settingsPage.includes('settings.js')) throw new Error('dist/settings.html does not load the settings entry bundle.');
if (!historyPage.includes('history.js')) throw new Error('dist/history.html does not load the history entry bundle.');
if (!notePage.includes('note.js')) throw new Error('dist/note.html does not load the saved-note entry bundle.');
if (!microphonePage.includes('microphone.js')) throw new Error('dist/microphone.html does not load the microphone-permission entry bundle.');
if (!offscreenPage.includes('offscreen.js')) throw new Error('dist/offscreen.html does not load the tab-audio recorder bundle.');
if (manifest.options_ui?.page !== 'settings.html' || manifest.options_ui?.open_in_tab !== true) {
  throw new Error('dist/manifest.json does not declare the full-page settings tab.');
}
if (!manifest.host_permissions?.includes('http://*/*') || !manifest.host_permissions?.includes('https://*/*')) {
  throw new Error('dist/manifest.json cannot follow active HTTP(S) tabs without page host permissions.');
}
if (manifest.host_permissions?.some((permission) => permission.includes('api.openai.com'))) {
  throw new Error('dist/manifest.json still declares direct OpenAI API access; learnr must route AI operations through OpenRouter.');
}
if (target === 'chromium' && (!manifest.permissions?.includes('tabGroups') || !manifest.permissions?.includes('sidePanel') || manifest.side_panel?.default_path !== 'sidepanel.html')) {
  throw new Error(`${outDir}/manifest.json is missing Chromium side-panel or tab-group capabilities.`);
}
if (target === 'arc' && (manifest.permissions?.includes('tabGroups') || manifest.permissions?.includes('sidePanel') || manifest.side_panel)) {
  throw new Error(`${outDir}/manifest.json must not request unsupported Arc side-panel or tab-group capabilities.`);
}
if (!manifest.permissions?.includes('offscreen') || !manifest.permissions?.includes('tabCapture')) {
  throw new Error('dist/manifest.json cannot perform explicit user-triggered tab-audio capture.');
}
if (manifest.commands?._execute_action?.suggested_key?.default !== 'Ctrl+Shift+L'
  || manifest.commands?._execute_action?.suggested_key?.mac !== 'Command+Shift+L'
  || manifest.commands?.['create-draft']?.suggested_key?.default !== 'Ctrl+Shift+D'
  || manifest.commands?.['create-draft']?.suggested_key?.mac !== 'Command+Shift+D'
  || manifest.commands?.['open-connected-tab']?.suggested_key?.default !== 'Ctrl+Shift+K'
  || manifest.commands?.['open-connected-tab']?.suggested_key?.mac !== 'Command+Shift+K'
  || manifest.commands?.['save-draft']) {
  throw new Error('dist/manifest.json must declare the expected launch, draft, and connected-tab shortcuts.');
}
for (const size of ['16', '32', '48', '128']) {
  const filename = `icon-${size}.png`;
  if (manifest.icons?.[size] !== filename || manifest.action?.default_icon?.[size] !== filename) throw new Error(`dist/manifest.json does not use ${filename} for the extension and toolbar icon.`);
  await readFile(outputPath(filename));
}
if (buildInfo.appVersion !== manifest.version || buildInfo.target !== target || !/^\d{14}$/.test(buildInfo.buildId)) {
  throw new Error('dist/build-info.json does not contain matching app and UTC build versions.');
}
if (manifest.version !== sourceManifest.version || manifest.version !== packageJson.version || manifest.version !== packageLock.version || manifest.version !== packageLock.packages?.['']?.version) {
  throw new Error('The built manifest, source manifest, package.json, and package-lock.json app versions do not match.');
}
const jsFiles = (await readdir(outputPath(), { recursive: true })).filter((name) => name.endsWith('.js'));
const compiledJavaScript = (await Promise.all(jsFiles.map((name) => readFile(outputPath(name), 'utf8')))).join('\n');
if (compiledJavaScript.includes('https://api.openai.com') || compiledJavaScript.includes('OpenAIAdapter')) {
  throw new Error('The production build contains a direct OpenAI runtime path.');
}
if (!compiledJavaScript.includes('OpenRouter connection') || !compiledJavaScript.includes('Embedding model')) {
  throw new Error('The production build is missing the single OpenRouter connection or independent embedding-model selector.');
}
if (!compiledJavaScript.includes('learnr-chat-highlights') || !compiledJavaScript.includes('learnr-source-highlights') || !compiledJavaScript.includes('Source Highlights') || !compiledJavaScript.includes('Conversation Highlights')) {
  throw new Error('The production build is missing persistent source/chat highlighting or deterministic grouped note quotes.');
}
if (!compiledJavaScript.includes('LEARNR_IMAGE_ASSET_PUT') || !compiledJavaScript.includes('Images') || !compiledJavaScript.includes('Pasted image ')) {
  throw new Error('The production build is missing persistent image highlights or Obsidian image embeds.');
}
const expectedShortcutsUrl = target === 'arc' ? 'arc://extensions/shortcuts' : 'chrome://extensions/shortcuts';
if (!compiledJavaScript.includes('LEARNR_COMMAND_TAKE') || !compiledJavaScript.includes('LEARNR_FOCUS_COMPOSER') || !compiledJavaScript.includes('LEARNR_CLOSE_PANEL') || !compiledJavaScript.includes('LEARNR_TAB_MESSAGE') || !compiledJavaScript.includes(expectedShortcutsUrl)) {
  throw new Error('The production build is missing keyboard-command routing, composer focus, or shortcut settings.');
}
if (!compiledJavaScript.includes('Web search used') || !compiledJavaScript.includes('Open Editor') || !compiledJavaScript.includes('Reset current usage')) {
  throw new Error('The production build is missing search-use feedback, the Editor action, or usage reset controls.');
}
if (!compiledJavaScript.includes('Semantic search') || !compiledJavaScript.includes('Microphone dictation') || !compiledJavaScript.includes('Notes folder (default)') || !compiledJavaScript.includes('Slash commands')) {
  throw new Error('The production build is missing unified search, dictation, draft subfolders, or slash-command help.');
}
if (!compiledJavaScript.includes('getUserMedia') || !compiledJavaScript.includes('LEARNR_MIC_PERMISSION_GRANTED') || compiledJavaScript.includes('LEARNR_DICTATION_START_OFFSCREEN')) {
  throw new Error('The production build must request microphone permission in a visible learnr tab and capture audio in the panel.');
}
if (!compiledJavaScript.includes('Conversation sources') || !compiledJavaScript.includes('Link current tab group') || !compiledJavaScript.includes('effective budget')) {
  throw new Error('The production build is missing multi-page conversation linking, group synchronization, or context-limit feedback.');
}
if (!compiledJavaScript.includes('Image-analysis stage') || !compiledJavaScript.includes('PDF extraction stage') || !compiledJavaScript.includes('PDF processing stopped') || !compiledJavaScript.includes('Restart')) {
  throw new Error('The production build is missing media stages, dedicated PDF configuration, or PDF retry feedback.');
}
if (compiledJavaScript.includes('mistral-ocr') || compiledJavaScript.includes('cloudflare-ai') || compiledJavaScript.includes('PDF parser')) {
  throw new Error('The production build still exposes the retired dedicated PDF parser controls.');
}
if (!compiledJavaScript.includes('Activate source tab when selecting a conversation') || !compiledJavaScript.includes('LEARNR_HISTORY_SELECTED') || !compiledJavaScript.includes('This month')) {
  throw new Error('The production build is missing panel-first history selection, optional source-tab activation, or model-wise usage windows.');
}
if (!compiledJavaScript.includes('New workspace') || !compiledJavaScript.includes('Manage workspaces') || !compiledJavaScript.includes('All workspaces') || !compiledJavaScript.includes('workspace:')) {
  throw new Error('The production build is missing named workspaces, cross-workspace views, or workspace note metadata.');
}
if (target === 'chromium' && (!compiledJavaScript.includes('openPanelOnActionClick') || !compiledJavaScript.includes('learnr could not open its native panel'))) {
  throw new Error('The Chromium build is missing its native side-panel behavior.');
}
if (!compiledJavaScript.includes('learnr-extension-root')) {
  throw new Error('The production build is missing injected-panel support.');
}
if (target === 'arc' && !compiledJavaScript.includes('AutoGroup is unavailable in the Arc build')) {
  throw new Error('The Arc build is missing its explicit tab-group compatibility guard.');
}
if (target === 'arc' && /chrome\.(?:sidePanel|tabGroups)|chrome\.tabs\.(?:group|ungroup)|chrome:\/\/newtab/.test(compiledJavaScript)) {
  throw new Error('The Arc build still contains a native side-panel, tab-group, or Chrome-only new-tab runtime path.');
}
if (!compiledJavaScript.includes('learnr cannot read this protected') || !compiledJavaScript.includes('LEARNR_ACTIVE_TAB_CHANGED') || !compiledJavaScript.includes('Page extraction is unavailable')) {
  throw new Error('The production build is missing protected-page recovery and connection feedback.');
}
if (!compiledJavaScript.includes(buildInfo.buildId) || !content.includes(buildInfo.buildId)) {
  throw new Error('The production entries do not share the generated build version.');
}

console.log(`Verified ${target} build ${buildInfo.buildId}, standalone injected bundle, settings, and history pages: ${outDir}/content.js (${content.length.toLocaleString()} bytes)`);
