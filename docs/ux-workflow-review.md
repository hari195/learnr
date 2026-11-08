# learnr workflow review

## Product promise

learnr should make thoughtful note-taking from web material faster and more complete without pulling the user out of reading. The clearest product loop is:

> Notice something → capture it → think with learnr → shape the result → save it.

The product already supports this loop, but its power is exposed as many separate features. The main UX opportunity is not adding capability; it is making the loop feel like one continuous action.

## How it works today

### 1. Connect and configure

The user opens learnr from the browser toolbar or shortcut. First use requires an OpenRouter key, model choices, and a note folder. Advanced options include independent AI roles, prompts, guardrails, workspaces, note indexing, usage warnings, media tools, and appearance.

### 2. Start from the current page

learnr extracts the active page and opens directly into a focused chat composer. It can follow the active tab, restore the newest chat for a URL, handle PDFs and YouTube context, and link additional tabs or a Chrome tab group.

### 3. Collect and think

The user can ask questions, use suggested prompts, attach files, dictate, highlight page or chat passages, keep images, save explicit snippets with `/keep`, link old notes with `/link`, and ask learnr about a selection. Web and saved-note search can enrich the discussion.

### 4. Create the note

The user clicks the pencil icon, uses `Command+Return`, or the browser draft shortcut. learnr streams a draft into a separate view using the page, conversation, highlights, kept material, linked notes, images, and configured drafting prompt.

### 5. Edit and save

The user edits the filename, destination folder, and raw Markdown, then saves to the chosen local folder. The draft is retained, filename collisions are handled, and a success card offers the saved file.

### 6. Resume later

Chats, drafts, source context, highlights, AI jobs, and usage persist. The user can restore recent chats, search chat and note history, switch workspaces, or open the conversation in a standalone tab.

## What already supports flow well

- Opening lands on the real task, with the composer focused; there is no returning-user welcome screen.
- Current-page extraction, active-tab following, and URL-based chat restoration reduce setup work.
- Selection actions insert context without sending immediately, preserving user control.
- Streaming, visible stop controls, background jobs, and persisted drafts prevent AI work from trapping the user.
- Chat and drafting are separate AI roles, which fits the difference between exploring and producing.
- Drafts are editable and never saved automatically.
- Local-first storage, collision handling, history, and workspace separation create trust.
- Success is shown inside learnr and the panel remains open.

## Where the flow currently breaks

### 1. The mental model is fragmented

The user encounters highlights, `/keep` artifacts, linked notes, chat attachments, images sent to the model, images kept for the note, conversation sources, and the draft. These distinctions are technically useful but force the user to decide *how learnr stores something* when their intention is simply “this matters for my note.”

### 2. The composer has too many competing actions

Attach, keep image, dictate, send, and create note all sit in the primary input row, while search, recent chats, sources, workspace, standalone view, and settings occupy the header. The send and draft actions are icon-only and visually similar. In a narrow panel, the core loop is surrounded by tool choices.

### 3. The empty state is inspirational but not contextual

“What caught your attention?” is pleasant, but the next actions are generic workspace prompts. learnr already knows the page type, title, selected text, extraction result, prior chat, and whether related notes exist. It could offer a much more relevant first move.

### 4. Note readiness is invisible

Material accumulates across the conversation, highlights drawer, and artifacts, but there is no single answer to “what will go into my note?” The pencil icon does not communicate readiness, included material, or what drafting will do.

### 5. Drafting creates a context switch

The draft view replaces the conversation with a filename, folder, and raw Markdown editor. The user can edit, but cannot naturally continue asking learnr to shorten a section, challenge a claim, add a connection, or rewrite only the selection while looking at the draft.

### 6. Setup exposes the product architecture

The settings are powerful, but first-run success requires navigating a large system of providers, roles, folders, tools, prompts, and guardrails. Users need only a connection and save destination to experience the core value; the rest can wait until relevant.

### 7. Recovery is inconsistent

PDF errors offer retry, but many other errors are dismissible text without an immediate fix. Destructive history and workspace actions use confirmation dialogs instead of a reversible undo. Save success offers “Open file,” but no clear exit ramp back to reading or into a fresh note.

## Recommended experience

### One mental model: the Note Tray

Unify all note-bound material into one persistent **Note Tray**. Page passages, conversation excerpts, images, kept thoughts, and linked notes become different item types inside the same tray. Attachments intended only for the current question can remain in the composer.

The tray should show a compact count beside a clearly labeled **Draft note** action. Opening it answers three questions:

1. What have I collected?
2. What will the model use?
3. What will appear verbatim in the note?

This removes internal vocabulary from the main flow while preserving all current capabilities underneath.

### A calmer primary surface

Keep the default panel to four visible ideas:

- current source;
- conversation;
- composer and Send;
- Note Tray and Draft note.

Move media-specific capture, multi-page linking, and other low-frequency tools behind one contextual `+` menu. Reveal Stop in place of Send only while working. Use text labels for **Send** and **Draft note** until both actions are unmistakable.

### Contextual first moves

Replace static suggestions with three actions based on state:

- **Understand:** “Summarize the author’s main claim.”
- **Challenge:** “What is weak, missing, or uncertain?”
- **Connect:** “Relate this to my existing notes.”

If text is selected, prefill the composer with that selection and offer “Explain,” “Challenge,” and “Keep for note.” If a prior chat exists, lead with **Resume**. If extraction fails, explain the limitation and present a direct remedy or an alternate input.

### Draft without leaving the conversation

Open the draft as a resizable sheet or side-by-side surface above the existing conversation rather than a separate destination. Keep a small “Ask learnr to revise” field attached to the draft. Selection-aware commands should support:

- make this shorter;
- make this more precise;
- add evidence from the source;
- connect this to a saved note;
- turn this into my writing voice.

The user should be able to move between thinking and shaping without losing either surface.

### Progressive setup

Use a two-step first-run path inside the panel:

1. Connect OpenRouter.
2. Choose the notes folder.

Then return directly to the page and focus the composer. Model roles, indexing, prompts, workspaces, guardrails, media analysis, and usage controls stay in full settings and are introduced only when the user invokes a related feature.

### Close the loop after saving

Keep the success card visible and offer:

- **Back to reading** (primary);
- Open note;
- Copy link/path;
- Undo save for a short, clearly explained window where filesystem support makes this safe.

The panel should retain the conversation and saved state so the user can continue if desired.

## Priority plan

### Now — highest leverage, lowest structural cost

1. Rename the pencil action to a visible **Draft note** button and show the number of collected items.
2. Consolidate highlights, `/keep`, linked notes, and note-bound images under a user-facing **Note Tray** label.
3. Reduce the composer row to the input, one `+` menu, Send, and Draft note.
4. Generate contextual empty-state actions from page and selection state.
5. Give every visible error a next action: Retry, Connect, Choose folder, Change model, or Learn more.
6. Add **Back to reading** to save success and keep confirmation visible.

### Next — preserve flow through drafting

1. Make the draft a sheet or split view that keeps the conversation available.
2. Add selection-aware draft revision through natural-language instructions.
3. Show a pre-draft summary: sources, tray items, linked notes, and estimated scope.
4. Add recoverable undo for chat/history deletion where feasible.
5. Introduce a minimal first-run setup and defer advanced settings.

### Later — intelligent assistance

1. Learn which first actions, note structures, folders, and levels of detail the user prefers.
2. Suggest related saved notes before drafting, but require an explicit user choice to include them.
3. Offer a “quick capture” path that saves selected text plus a short user annotation without requiring a full AI draft.
4. Provide reusable note recipes such as literature note, argument map, concept note, and synthesis note—chosen contextually, not as permanent main-screen controls.

## Measures of improvement

Track locally and only if consistent with learnr’s privacy stance:

- time from opening learnr to the first user action;
- percentage of sessions reaching a saved note;
- time and interaction count from first capture to draft;
- time and interaction count from draft to save;
- percentage of drafts revised through learnr versus raw Markdown only;
- abandoned drafts later resumed;
- errors recovered from without leaving the panel.

The north-star signal is not message count. It is **useful notes saved with less interruption to reading**.

## Design principle

Every feature should strengthen one of three moments: **collect, think, or shape**. If it does not need to be visible in the current moment, it should remain available through progressive disclosure. learnr should feel less like a compact AI workstation and more like a quiet layer between reading and a finished note.
