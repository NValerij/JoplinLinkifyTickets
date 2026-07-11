# Linkify tickets — Joplin plugin

Turns ticket references like `ABC-123` into clickable links in Joplin, both in
the Markdown **editor** (CodeMirror 6) and in the **Viewer** (rendered/reading
mode). It also **shortens** full ticket URLs back to the identifier. The link
target is configurable.

For example, given the note text:

```
тра-та-та бла-бла-бла ABC-123 тру-ту-ту
```

`ABC-123` becomes a link to `https://my.site/ABC-123` (equivalent to
`<a href="https://my.site/ABC-123">ABC-123</a>`).

Conversely, a full ticket URL — and a bare reference carrying a `#hash`
fragment — is shortened for display:

| Source text                              | Shown as        | Links to                                 |
| ---------------------------------------- | --------------- | ---------------------------------------- |
| `ABC-123`                                | `ABC-123`       | `https://my.site/ABC-123`                |
| `ABC-123#comment-42`                     | `ABC-123💬`     | `https://my.site/ABC-123#comment-42`     |
| `https://my.site/ABC-123`                | `ABC-123`       | `https://my.site/ABC-123`                |
| `https://my.site/ABC-123#comment-42`     | `ABC-123💬`     | `https://my.site/ABC-123#comment-42`     |

When a reference points to a specific comment (it has a `#hash` fragment) —
whether written as a full URL or a bare `TICKET#hash` — a configurable comment
emoji (default 💬) is appended directly to the shortened label (no space).

---

## Behavior

- **Editor:** a ticket/URL is shown as a link widget while you are not editing
  it. As soon as the cursor/selection touches it, it turns back into the plain,
  editable original text.
- **Viewer:** tickets and ticket URLs are linkified/shortened in reading mode
  and in the split "Editor + Viewer" layout, so they stay clickable after
  switching modes (e.g. with `Ctrl+L`). This includes URLs that the renderer
  has already auto-linked.
- **Word boundaries:** bare identifiers are matched only on word boundaries, so
  text embedded in a longer word (e.g. `xABC-123y`) is not turned into a link.
- **No double-linking:** bare tickets already inside a Markdown link, an
  autolink/URL, HTML or a code span/block are left untouched. (Existing links
  whose target is a ticket URL are still shortened.)
- **Click behavior (editor):** a plain click places the cursor so you can edit
  the text immediately. Hold **Ctrl** (or **Cmd** on macOS) and click to open
  the link, matching how other links behave in the editor. The pointer ("hand")
  cursor over a ticket only appears while the modifier is held.

---

## Configuration

Open **Options → Linkify tickets**:

- **Base URL** — appended to a bare identifier, and used to recognise ticket
  URLs to shorten. With the default `https://my.site/`, `ABC-123` links to
  `https://my.site/ABC-123`. A trailing slash is handled so the URL never
  contains a double slash.
- **Comment emoji** — appended to the shortened label when a ticket URL has a
  `#hash` fragment (points to a specific comment). Default: 💬. Can be set to
  any string, or emptied to disable.
- **Ticket pattern** (advanced) — a JavaScript regular expression matching
  ticket identifiers. Default: `[A-Z][A-Z0-9]+-[0-9]+`. Bare matches are wrapped
  in `\b(?:…)\b`; an invalid pattern falls back to the default.

Editor links update immediately when the settings change. Viewer changes take
effect on the next render (open another note and back, or restart Joplin).

---

## Requirements

- Joplin 3.6 or newer (uses the CodeMirror 6 Markdown editor).
- On Joplin desktop before 3.1, enable the editor beta in **Options → General**.

---

## Documentation

Joplin plugin development references used by this plugin:

- Plugin development — getting started:
  <https://joplinapp.org/help/api/get_started/plugins>
- Table of contents tutorial (webviews, settings, messaging):
  <https://joplinapp.org/help/api/tutorials/toc_plugin>
- Markdown editor (CodeMirror 6) plugin tutorial:
  <https://joplinapp.org/help/api/tutorials/cm6_plugin>
- Plugin API reference:
  <https://joplinapp.org/help/api/references/plugin_api_index>
- `ContentScriptType` (CodeMirror vs Markdown-It content scripts;
  `pluginOptions.settingValue`, `postMessage`):
  <https://joplinapp.org/api/references/plugin_api/enums/contentscripttype.html>
- `joplin.settings` (sections, settings, `onChange`):
  <https://joplinapp.org/api/references/plugin_api/classes/joplinsettings.html>
- Plugin theming (CSS variables such as `--joplin-url-color`):
  <https://joplinapp.org/help/api/references/plugin_theming>
- CodeMirror 6 reference (used for editor decorations):
  <https://codemirror.net/docs/ref/>
- markdown-it (used for the Viewer content script):
  <https://github.com/markdown-it/markdown-it>

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
and matching/labelling logic are never duplicated:

- `settingIds` — `{ baseUrl, pattern, commentEmoji }` setting keys.
- `defaults` — default `baseUrl`, `pattern` and `commentEmoji` (💬).
- `LinkifySettings` — `{ baseUrl, pattern, commentEmoji }` type.
- `TicketMatch` — interpreted match: `{ url, ticket, hasComment, isUrl }`.
- `escapeRegExp(value)` — escapes a string for literal use in a RegExp.
- `buildUrl(baseUrl, ticket)` — joins base URL + ticket, handling trailing `/`.
- `buildMatchRegexp(settings)` — a global regexp matching **either** a full
  ticket URL (`<baseUrl>TICKET` + optional `#hash`) **or** a bare ticket
  (`\b(?:pattern)` + optional `#hash`). All of the plugin's own groups are *named*
  (`url`, `urlticket`, `hash`, `bare`) so a user pattern containing capture
  groups can't break interpretation. Falls back to the default pattern if the
  user pattern is invalid.
- `interpretMatch(match, settings)` — turns a regexp match into a `TicketMatch`.
- `parseTicketUrl(url, settings)` — returns a `TicketMatch` if a standalone URL
  string is a ticket URL, else `null` (used by the Viewer to shorten existing
  links).
- `displayLabel(match, settings)` — the visible text: the identifier, with the
  comment emoji appended directly (no space) when `hasComment` is true.

### `src/index.ts` — main plugin process

- Registers the **settings section** and the three settings (base URL, pattern,
  comment emoji).
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
  from a `MatchDecorator` using `buildMatchRegexp`. For each match it:
  - skips matches inside excluded syntax-tree nodes (`isInsideExcludedNode`
    walks parents against `skipInsideNodes`: Link, Image, URL, Autolink,
    InlineCode, CodeText, FencedCode, CodeBlock, Comment, HTMLTag, HTMLBlock);
  - skips matches overlapping the current selection (so text stays editable);
  - otherwise replaces the range with a `TicketLinkWidget` whose text is
    `displayLabel(...)` and whose href is `interpretMatch(...).url`.
    `Decoration.replace` already makes the widget atomic, so no separate
    `atomicRanges` provider is needed.
- `TicketLinkWidget.toDOM` renders an `<a>`; `mousedown` opens the URL on
  Ctrl/Cmd, otherwise moves the cursor into the reference (`view.posAtDOM` +
  `dispatch({ selection })`) and focuses the editor.
- Settings live in a `Compartment`, swapped via the
  `linkifyTickets__updateSettings` command when settings change.
- `modifierTracking` (`EditorView.domEventHandlers`) toggles the
  `cm-linkify-mod-active` class while Ctrl/Cmd is held; the CSS uses it to switch
  the cursor from `text` to `pointer`.

### `src/markdownItContentScript.ts` — viewer (Markdown-It)

- Reads settings **synchronously** via `pluginOptions.settingValue(key)` (the
  supported mechanism for Markdown-It content scripts — the Viewer does not talk
  to `index.ts`).
- Adds a `markdownIt.core.ruler` rule `linkify_tickets` that walks each `inline`
  token's `children` and:
  - for an **existing link** (`link_open`) whose `href` is a ticket URL
    (`parseTicketUrl`), replaces the inner content with the shortened label and
    adds the `linkify-ticket` class (handles renderer auto-linked URLs too);
  - for **plain text**, replaces bare tickets and ticket URLs with
    `link_open` / `text` / `link_close` tokens (`splitTextToken`).

---

## Key facts & gotchas (for future edits)

- **Two render paths.** Any change to matching/linking/shortening logic must be
  applied to BOTH `contentScript.ts` (editor) and `markdownItContentScript.ts`
  (viewer). Keep shared logic in `common.ts`.
- **A `RegExp` cannot be serialized** across `postMessage`, and the viewer never
  receives settings from `index.ts` — so regexps are built locally in each
  content script via the shared helpers, not pre-built in `index.ts`.
- **CodeMirror packages are type-only.** `@codemirror/*` deps are
  `devDependencies` used purely for types; `webpack.config.js` externalizes them
  so Joplin's own copies are used at runtime. Do not bundle them.
- **`webpack.config.js` is framework-managed** — avoid editing it. New content
  scripts must be added to `plugin.config.json` `extraScripts` (paths relative
  to `src/`) so they are compiled alongside `index.ts`.
- **CSS assets** are declared from each content script's `assets()` return value
  and copied to `dist/` by webpack (paths relative to `src/`).
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
