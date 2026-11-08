# Arc compatibility

The Arc build is produced with `npm run build:arc` in `dist-arc/`. It shares Learnr's application code with the Chromium build, but compiles browser-specific branches and manifest capabilities for Arc.

## Feature audit

| Area | Arc status | Implementation |
| --- | --- | --- |
| Toolbar and launch shortcut | Supported | Opens or focuses one reusable Learnr tab per normal Arc window. Drag it into the right side of a webpage using Arc's native Split View controls. Automatic Arc split creation is not available through a documented extension API. |
| Left-pane awareness | Implemented; requires live Arc validation | Uses split membership if exposed; otherwise probes document visibility in tabs of the reader's own window. Selects the other visible webpage even while Learnr has focus, and rechecks every 1.5 seconds for left-pane replacements. Navigation selects the corresponding conversation. Disabling Follow active tab pins the conversation. |
| Chat, drafts, highlights, attachments, AI tools | Supported | Browser-independent application and OpenRouter paths. |
| Page, image, Instagram, YouTube, and PDF extraction | Supported | Uses standard `tabs`, `scripting`, fetch, and page DOM APIs. Local PDFs still require optional file-URL access. |
| Manual multi-page conversations | Supported | **Add open tabs** uses `tabs.query`; **New connected tab** asks Arc to create its native new-tab surface instead of navigating to `chrome://newtab/`. |
| History | Supported | History selection opens a standalone Learnr conversation tab because Arc has no extension side panel. |
| Workspaces, settings, history, usage | Supported | Uses extension storage and IndexedDB. |
| Notes folders, images, and embedding libraries | Supported | Uses the Chromium File System Access API. Pickers are opened from a full extension tab when needed. |
| Dictation | Supported | Microphone permission is requested from a full extension tab. |
| YouTube/Instagram tab-audio transcription | Supported when Arc exposes Chromium `tabCapture` and offscreen documents | The Arc manifest retains both permissions. Runtime checks return an actionable update message rather than crashing if an Arc release omits either API. |
| Keyboard shortcuts | Supported | The settings action opens `arc://extensions/shortcuts`. |
| Duplicate-tab review | Supported | Uses standard tab query/removal APIs and does not call tab-group methods. |
| AutoGroup | Not available | Arc Spaces and Folders are not exposed through Chromium's `tabGroups` extension API. The Arc build disables the control and omits the permission. |
| Link current tab group | Not available | Arc exposes no equivalent group/Space/Folder API. Use **Add open tabs** or **New connected tab**. |

## Feature defaults and existing installations

Both builds now enable empty-chat suggestions, chat/draft response stats, dictation,
image/video analysis, web search/fetch, PDF extraction, usage warnings, and active-page
following by default. Existing Arc workspaces receive a one-time upgrade on first load;
global keyboard shortcuts and slash commands are also enabled once. Later explicit
opt-outs are preserved. Custom prompts, suggestion text, models, keys, and history are
not replaced. Existing Chrome preferences are not reset.

Saved-note search is enabled during the Arc upgrade only if the workspace already has
a selected library. Folder access, microphone permission, API credentials, and a video
model still require user setup. Enabling a capability does not start recording or make
an AI request. Historical replies without recorded usage cannot acquire missing stats;
provider-unreported costs/tokens are displayed as unavailable, not fabricated.

Native Arc limitations in the audit above remain; feature toggles cannot enable a
missing browser API. The audit is a code/build check, not a claim that every workflow
has been live-tested in Arc.

## Build guarantees

`npm run verify:build:arc` checks that the Arc artifact:

- omits the `sidePanel` and `tabGroups` permissions and the `side_panel` manifest entry;
- contains the injected-panel message handlers;
- contains `arc://extensions/shortcuts`;
- contains no compiled `chrome.sidePanel`, `chrome.tabGroups`, `chrome.tabs.group`, `chrome.tabs.ungroup`, or `chrome://newtab` runtime path;
- retains tab capture, offscreen recording, settings, history, note, PDF, image, and conversation bundles.
- keeps privileged `tabs`, `windows`, `commands`, options-page, side-panel, grouping, scripting, and capture calls out of `content.js`; injected UI operations must cross the runtime-message bridge to the service worker.

The normal `npm run build` and `npm run verify:build` commands continue to validate the native Chromium side-panel build independently.
