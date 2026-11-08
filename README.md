# learnr

Learnr is a private reading companion for Chromium browsers. It turns the page you are reading into a grounded conversation, helps you keep the useful parts, and saves editable atomic Markdown notes to your own folder or Obsidian vault.

> **The workflow:** read a page → ask questions → keep evidence and personal notes → create one or more focused drafts → edit and save.

Learnr has no account, analytics service, sync server, or Learnr backend. Browser data stays local. AI requests go directly from the extension to OpenRouter and the upstream model you select.

## Five-minute setup

1. Run `npm install` and `npm run build`.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/`.
3. Open an ordinary webpage and select the Learnr toolbar icon. The side panel is the default surface.
4. Open Settings, paste an [OpenRouter](https://openrouter.ai/) API key, and select **Test connection & save**.
5. Optional: open a workspace tab in Settings and connect your notes folder, image folder, and embedding libraries.

### Arc build

The Arc build opens Learnr as a reusable tab for the right side of Arc Split View. The webpage belongs on the left. Learnr follows the visible page beside it, returning to the corresponding conversation when that page changes, even while the Learnr pane has keyboard focus. **Follow active tab** can be disabled in Settings to stay on one conversation.

1. Run `npm install` and `npm run build:arc`.
2. Open `arc://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist-arc/`.
3. Open an ordinary HTTP(S) webpage and select the **learnr (Arc)** extension icon. Learnr opens in an adjacent tab; subsequent clicks reuse that tab in the same window.
4. Drag the Learnr tab into the right side of the webpage to create Arc Split View. Split creation uses Arc's own UI because Arc does not expose a documented extension API for it.

With a two-pane split, Learnr identifies the other visible webpage without treating its own pane as a source. It checks navigation/tab events and rechecks every 1.5 seconds while visible to detect left-pane replacements that Arc does not report as tab activations. When several source panes are visible, Learnr retains an established source rather than guessing. Protected browser pages such as `arc://extensions` and the Chrome Web Store cannot be read. After installing or rebuilding, reload the extension and refresh webpages with old content scripts.

The Arc build retains page extraction, chat, drafts, highlights, image/PDF/video analysis, manual multi-page conversations, connected tabs, history, workspaces, OpenRouter tools, dictation, tab-audio transcription, note folders, saved-note indexes, usage reporting, settings portability, and duplicate-tab detection. Folder pickers and microphone permission open in full extension tabs when the embedded panel cannot show a browser prompt. Tab-audio transcription checks Arc's Chromium capture and offscreen-document APIs at runtime and reports an actionable compatibility error if an outdated Arc release does not expose them.

Two Chrome concepts have no Arc extension equivalent:

- **AutoGroup** is disabled because Arc Spaces and Folders are not exposed through Chromium's `tabGroups` API. Arc's own Tidy Tabs remains available from the Arc sidebar.
- **Link current tab group** is omitted. Use **Add open tabs** or **New connected tab** to build the same multi-page Learnr conversation manually.

See [the Arc compatibility audit](docs/arc-compatibility.md) for the complete feature and API matrix.

The Settings button opens an overlay without leaving your conversation. Use its expand action for the full `settings.html` page. **Open in tab** opens the same live conversation in a wide standalone view; it does not create a frozen copy.

## Where things live

| Surface | Best for |
| --- | --- |
| Side panel | Reading beside the current webpage; the normal toolbar and shortcut destination |
| Standalone tab | A wide Chat or Editor view of the same live conversation |
| Settings overlay | Quick changes without losing Chat/Editor state or unsaved prompt text |
| Full Settings page | Managing workspaces, embedding libraries, usage, and app settings |
| History | Returning to conversations stored in this browser profile |

Side panel and standalone views synchronize messages, streaming output, sources, highlights, artifacts, drafts, the active draft, usage, and Chat/Editor view. Learnr prevents two AI operations from running against one conversation at the same time. A standalone Learnr tab never treats itself as a reading source and does not follow browser focus.

## Feature guide

### Understand what you are reading

- Extract readable HTML pages, selections, metadata, and visible text.
- Link several pages or a Chrome tab group to one conversation with a visible source budget.
- Process PDFs with staged download/extraction progress, cancellation, retry, extracted-character totals, elapsed time, and OpenRouter-reported usage.
- Attach images to Chat or explicitly use the independent Image stage with `/image`.
- Read YouTube metadata and available captions locally; explicitly invoke the Video model and prompt with `/video`.
- Analyze Instagram Reel and post images, including automatic ordered traversal of image carousels in batches through the Image stage. Transcribe spoken audio from YouTube videos and Instagram video posts on demand. Learnr replays the source in real time, records 45-second in-memory segments, sends them to the selected OpenRouter speech-to-text model, and caches only the timestamped transcript.
- Preserve source links and citations from OpenRouter Web search and Web fetch.

### Chat and retrieval

- Assign a searchable OpenRouter model, editable prompt, and guardrail to Chat, Draft, PDF, Image, and Video separately.
- Enable Web search for discovery and Web fetch for reading a known URL in depth, independently per workspace.
- Enable local saved-note tools so Chat can search and read bounded passages from the workspace’s enabled embedding libraries.
- Search the current conversation, local indexed-note cache, and previous chats from one overlay.
- Dictate up to 60 seconds into the composer when the workspace microphone feature is enabled.
- Type `/` for a keyboard-navigable command menu. Slash commands, suggestions, dictation, image/video analysis, and shortcuts can each be disabled.

### Turn reading into attributed notes

- Highlight exact source passages and conversation text.
- `/keep` captures editable material; `/note` preserves your Markdown exactly as reader-authored content.
- `/draft` creates a note from the whole page and conversation. `/draft <focus>` creates another atomic note about one aspect.
- Multiple unsaved drafts can coexist in tabs while Chat remains available.
- Drafts separate **Highlights**, **AI Generated**, and **My Notes**. Saving assembles them after valid YAML frontmatter.
- Add multiple deterministic Obsidian wikilinks with the Editor’s searchable Links field or `/link`, choose a filename/folder, retain images and YouTube links, and resolve collisions safely.
- Response statistics show the model, total tokens, charged cost, and reported output tokens per second.

### Workspace embedding libraries

Each workspace manages its own independent embedding libraries from the **Saved-note library** card. A workspace can keep several libraries and search across multiple enabled libraries when they use the same embedding model.

- Enter a name and embedding model, then choose a folder. Folder selection is passive and never starts embedding.
- **Build index** explicitly creates vectors for an unbuilt library.
- **Refresh changes** embeds added or modified Markdown, reuses unchanged vectors, and removes deleted notes.
- **Rebuild all** replaces every vector after confirmation; active work can be cancelled.
- Optional Auto-update refreshes after Learnr saves a note, at startup when stale, and when its workspace Settings opens while stale.
- Export/import a versioned compressed `.learnr-index.gz` backup from the workspace card. Imported libraries are searchable immediately and can be relinked later.

External filesystem changes cannot be watched continuously. Select **Refresh changes** whenever you want newly added or edited notes indexed immediately.

### Organize browser tabs

- **AutoGroup** classifies ungrouped, unpinned tabs across normal windows using a dedicated OpenRouter model. It sends titles and sanitized URL origins/paths—not page content, credentials, queries, or fragments.
- Learnr reuses suitable named groups in the same window, never uses reserved `SYNC`, reconciles singleton topics into broader groups, and falls back to lowercase `misc`.
- Nothing moves before a searchable preview and explicit Apply. New groups are collapsed; a safe session-scoped Undo reverses the last run.
- **Find duplicate tabs** needs no model. It previews exact complete-URL matches, lets you choose keepers/removals, revalidates before closing, and reports skips.

### Usage, customization, and accessibility

- Dashboard cards show model-colored stacked Spend, Requests, and Tokens bars by time range and workspace.
- Tokens, completion tokens, request counts, and charged cost come from OpenRouter response usage. Learnr never estimates them; missing fields show as unavailable.
- Workspaces have independent colors, models, prompts, guardrails, feature toggles, folders, history, usage warnings, and note destinations while sharing the OpenRouter connection.
- App Settings controls the global accent, light/dark backgrounds, and card order.
- Controls support keyboard navigation, visible focus, focus-trapped dialogs, focus restoration, reduced motion, and reduced-transparency fallbacks.

## Slash commands

| Command | Result | Provider call? |
| --- | --- | --- |
| `/keep <text>` | Keep editable author material for a draft | No |
| `/note <text>` | Add exact Markdown to **My Notes** | No |
| `/draft [focus]` | Create a full-context or focused atomic draft | Yes |
| `/search <query>` | Semantically search ready saved-note libraries | Yes, one query embedding per index model |
| `/link [query]` | Search and select multiple indexed notes as Obsidian wikilinks | No |
| `/image [question]` | Analyze attached images with the Image model | Yes |
| `/video [question]` | Analyze the selected YouTube video with the Video model | Yes |

## Keyboard shortcuts

| Shortcut | Default | Behavior |
| --- | --- | --- |
| Open Learnr | `Ctrl+Shift+L` / `Command+Shift+L` | Toggle Chrome's native side panel or open/focus Arc's Learnr tab |
| Create draft | `Ctrl+Shift+D` / `Command+Shift+D` | Open Learnr if needed and create a draft |
| Create draft in composer | `Command+Enter` | Same draft path while the composer is focused |
| Suggestions | `Control+1`–`Control+3` | Insert a configured chat suggestion |

The browser owns global extension shortcut registration. Change bindings at `chrome://extensions/shortcuts` in Chrome or `arc://extensions/shortcuts` in Arc. Disabling Learnr shortcuts suppresses Learnr handlers, but the browser's reserved action shortcut cannot be unregistered at runtime.

## Privacy and data boundaries

| Data | Stored locally | Sent outside the browser |
| --- | --- | --- |
| Settings, API key, sessions, history, usage events | Extension storage and IndexedDB | Only as required below |
| Page/PDF/image/video context and messages | Session/history as needed | To OpenRouter and the selected upstream model for requested AI work |
| Note and image folders | File System Access handles plus files you save | No |
| Indexed notes, chunks, hashes, vectors | IndexedDB or an explicit portable export | Markdown chunks and semantic queries go to the embedding model |
| AutoGroup preview | Memory; Undo IDs in session storage | Sanitized tab titles and URL origin/path after explicit activation |
| Dictation and explicitly captured tab audio | Memory and released after transcription | To the selected transcription model |

The Chromium manifest permissions are `activeTab`, `scripting`, `storage`, `tabs`, `tabGroups`, `sidePanel`, `tabCapture`, and `offscreen`. The Arc build omits `tabGroups` and `sidePanel`. Tab capture and the offscreen recorder run only after pressing a media Transcribe action; raw audio remains in memory. HTTP(S) access extracts pages; OpenRouter access performs model requests. Local `file://` pages require the extension's optional **Allow access to file URLs** switch.

<details>
<summary>Provider and tool details</summary>

OpenRouter routes models to upstream providers. BYOK credentials remain in OpenRouter; Learnr stores only the OpenRouter key. Web search and Web fetch are separate server tools. Saved-note search/read tools execute against the local index and return bounded material to Chat. Tool text and indexed Markdown are untrusted content, never instructions.

</details>

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run build:arc
npm run verify:build
npm run verify:build:arc
```

Production builds keep `package.json`, `package-lock.json`, the manifest, generated build information, and Settings About in sync. Learnr’s app version is permanently pinned to `1.0.0`; build IDs continue changing so individual builds remain identifiable.

Vite builds `sidepanel.html`, `settings.html`, `history.html`, `note.html`, the microphone permission page, the offscreen tab-audio recorder, service worker, and content script into `dist/` for Chromium or `dist-arc/` for Arc. After rebuilding, select **Reload** on the browser's extensions page and refresh source tabs with an old content script.

### Troubleshooting

- **Protected page:** switch from internal browser pages or the Chrome Web Store to an HTTP(S) page.
- **No page access:** reload the source tab after installation or rebuilding.
- **Local PDF unavailable:** enable **Allow access to file URLs**.
- **Model missing:** test the OpenRouter connection to refresh its account-specific catalog.
- **New notes not searchable:** open that workspace’s Saved-note library card and select **Refresh changes** on the relevant library.
- **Standalone says interrupted:** the operation-owning view closed; retry from a remaining view.
- **Folder permission expired:** reconnect the folder; imported vectors remain searchable.

Learnr's default target is current Chromium browsers with Manifest V3, Side Panel, File System Access, and `tabGroups` support. Chrome is the primary target. The separate Arc target uses a tab for Arc Split View and omits Side Panel and tab-group permissions.
