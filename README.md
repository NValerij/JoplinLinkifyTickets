# Linkify tickets — Joplin plugin

Turns ticket references like `ABC-123` into clickable links in Joplin, both in
the Markdown **editor** (CodeMirror 6) and in the **Viewer** (rendered/reading
mode). The link target is configurable.

For example, given the note text:

```
тра-та-та бла-бла-бла ABC-123 тру-ту-ту
```

`ABC-123` becomes a link to `https://my.site/ABC-123` (equivalent to
`<a href="https://my.site/ABC-123">ABC-123</a>`).

---

## Behavior

- **Editor:** a ticket is shown as a link widget while you are not editing it.
  As soon as the cursor/selection touches the ticket, it turns back into plain,
  editable text.
- **Viewer:** tickets are linkified in reading mode and in the split
  "Editor + Viewer" layout, so they stay clickable after switching modes
  (e.g. with `Ctrl+L`).
- **Word boundaries:** identifiers are matched only on word boundaries, so text
  embedded in a longer word (e.g. `xABC-123y`) is not turned into a link.
- **No double-linking:** tickets already inside a Markdown link, an
  autolink/URL, HTML or a code span/block are left untouched.
- **Click behavior (editor):** a plain click places the cursor so you can edit
  the text immediately. Hold **Ctrl** (or **Cmd** on macOS) and click to open
  the link, matching how other links behave in the editor. The pointer ("hand")
  cursor over a ticket only appears while the modifier is held.

---

## Configuration

Open **Options → Linkify tickets**:

- **Base URL** — the ticket identifier is appended to this value. With the
  default `https://my.site/`, `ABC-123` links to `https://my.site/ABC-123`.
  A trailing slash is handled so the URL never contains a double slash.
- **Ticket pattern** (advanced) — a JavaScript regular expression matching
  ticket identifiers. Default: `[A-Z][A-Z0-9]+-[0-9]+`. The pattern is
  automatically wrapped in `\b(?:…)\b`; an invalid pattern falls back to the
  default.

Editor links update immediately when the settings change. Viewer changes take
effect on the next render (open another note and back, or restart Joplin).

---

## Requirements

- Joplin 3.6 or newer (uses the CodeMirror 6 Markdown editor).
- On Joplin desktop before 3.1, enable the editor beta in **Options → General**.

---

## Install / Development

```bash
npm install     # install dependencies
npm run dist    # build the .jpl archive
```

The packaged plugin is written to
`publish/com.joplin.valerij-n.linkifytickets.jpl`.

To test during development, add the project directory under
**Options → Plugins → Show Advanced Settings → Development plugins**, then fully
restart Joplin (**File → Quit**, not just close the window). A full restart is
required for the Viewer content script to reload.

Other scripts:

- `npm run updateVersion` — bump the version in `package.json` + `manifest.json`.
- `npm run update` — update the plugin framework via the `yo joplin` generator.

---

## Architecture

The plugin has two independent render paths that must be kept in sync, plus one
shared helper module.

```
src/
  index.ts                    Main plugin process: settings + registration
  common.ts                   Shared constants + helpers (single source of truth)
  contentScript.ts            Editor (CodeMirror 6) content script
  style.css                     └ editor link styling (asset of contentScript)
  markdownItContentScript.ts  Viewer (Markdown-It) content script
  markdownItContentScript.css   └ viewer link styling (asset of the above)
  manifest.json               Plugin metadata (id, version, min app version)
plugin.config.json            Lists extra scripts compiled besides index.ts
webpack.config.js             Build (do not edit; framework-managed)
```

### `src/common.ts` — shared source of truth

Exports everything both content scripts and the main script need, so setting IDs
and defaults are never duplicated:

- `settingIds` — `{ baseUrl, pattern }` setting keys.
- `defaults` — default `baseUrl` and `pattern`.
- `LinkifySettings` — `{ baseUrl, pattern }` type.
- `buildUrl(baseUrl, ticket)` — joins base URL + ticket, handling trailing `/`.
- `buildTicketRegexp(pattern)` — builds a global regexp wrapped in `\b(?:…)\b`,
  falling back to the default pattern (and logging) if the pattern is invalid.

### `src/index.ts` — main plugin process

- Registers the **settings section** and the two string settings.
- Registers both content scripts:
  - `ContentScriptType.CodeMirrorPlugin` → `./contentScript.js`
  - `ContentScriptType.MarkdownItPlugin` → `./markdownItContentScript.js`
- Answers the editor's `getSettings` message via `joplin.contentScripts.onMessage`.
- On `joplin.settings.onChange`, pushes updated settings to the live editor with
  `joplin.commands.execute('editor.execCommand', { name: 'linkifyTickets__updateSettings', args: [settings] })`.

### `src/contentScript.ts` — editor (CodeMirror 6)

- Guard: returns early unless `codeMirrorWrapper.cm6` is set (CM6 only).
- Loads settings once via `context.postMessage('getSettings')`.
- `createLinkifyPlugin(settings)` builds a `ViewPlugin` whose decorations come
  from a `MatchDecorator` using `buildTicketRegexp`. For each match it:
  - skips tickets inside excluded syntax-tree nodes (`isInsideExcludedNode`
    walks parents against `skipInsideNodes`: Link, Image, URL, Autolink,
    InlineCode, CodeText, FencedCode, CodeBlock, Comment, HTMLTag, HTMLBlock);
  - skips matches overlapping the current selection (so the ticket stays
    editable);
  - otherwise replaces the range with a `TicketLinkWidget` (anchor element).
    `Decoration.replace` already makes the widget atomic, so no separate
    `atomicRanges` provider is needed.
- `TicketLinkWidget.toDOM` renders an `<a>`; `mousedown` opens the URL on
  Ctrl/Cmd, otherwise moves the cursor into the ticket (`view.posAtDOM` +
  `dispatch({ selection })`) and focuses the editor.
- Settings are held in a `Compartment` and swapped via the
  `linkifyTickets__updateSettings` command (registered with
  `codeMirrorWrapper.registerCommand`) when settings change.
- `modifierTracking` (`EditorView.domEventHandlers`) toggles the
  `cm-linkify-mod-active` class on the editor while Ctrl/Cmd is held; the CSS
  uses that class to switch the cursor from `text` to `pointer`.

### `src/markdownItContentScript.ts` — viewer (Markdown-It)

- Reads settings **synchronously** via `pluginOptions.settingValue(key)` (the
  supported mechanism for Markdown-It content scripts — the viewer does not talk
  to `index.ts`).
- Adds a `markdownIt.core.ruler` rule `linkify_tickets` that walks each `inline`
  token's `children`, and within plain `text` nodes (when not inside a link,
  tracked by `linkDepth`) replaces ticket matches with
  `link_open` / `text` / `link_close` tokens (`splitTextToken`). Links get the
  `linkify-ticket` class for styling.

---

## Key facts & gotchas (for future edits)

- **Two render paths.** Any change to matching/linking logic must be applied to
  BOTH `contentScript.ts` (editor) and `markdownItContentScript.ts` (viewer).
  Keep shared logic in `common.ts`.
- **A `RegExp` cannot be serialized** across `postMessage`, and the viewer never
  receives settings from `index.ts` — so regexps are built locally in each
  content script via the shared `buildTicketRegexp`, not pre-built in `index.ts`.
- **CodeMirror packages are type-only.** `@codemirror/*` deps are `devDependencies`
  used purely for types; `webpack.config.js` externalizes them so Joplin's own
  copies are used at runtime. Do not bundle them (that breaks the editor).
- **`webpack.config.js` is framework-managed** — avoid editing it. New content
  scripts must be added to `plugin.config.json` `extraScripts` (paths relative
  to `src/`) so they are compiled alongside `index.ts`.
- **CSS assets** are declared from each content script's `assets()` return
  value and are copied to `dist/` by webpack (paths relative to `src/`).
- **Viewer reloads on full restart only.** After changing the Markdown-It
  script, quit Joplin completely to see the effect.
- **Styling uses Joplin theme variables** (e.g. `--joplin-url-color`) so links
  look correct in light and dark themes.

---

## Build workflow summary

`npm run dist` runs three webpack passes in sequence:
`buildMain` (compiles `index.ts`, copies assets) → `buildExtraScripts`
(compiles each `extraScripts` entry) → `createArchive` (produces the `.jpl` and
the plugin info `.json` in `publish/`).
