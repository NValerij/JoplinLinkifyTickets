# Linkify tickets — a Joplin plugin

Do you paste ticket numbers like `ABC-123` into your Joplin notes and wish they
were clickable? This plugin turns those references into links that open the
ticket in your issue tracker — and, going the other way, shortens long ticket
URLs back to the tidy `ABC-123` form.

It works with any tracker whose ticket URLs follow a `<base URL>/<KEY-NUMBER>`
shape, which covers most of the popular ones:

- **Jira** (`https://jira.example.com/browse/ABC-123`)
- **Azure DevOps / TFS** (`https://dev.azure.com/org/project/_workitems/edit/1234`)
- **YouTrack** (`https://youtrack.example.com/issue/ABC-123`)
- **GitHub / GitLab issues** (`https://github.com/org/repo/issues/123`)
- **Redmine**, **Bugzilla**, **Trac**, and similar

You point the plugin at your tracker's base URL once, and every matching key in
your notes becomes a link.

## Example

Given this note text:

```
Blah blah blah ABC-123 and some more text
```

`ABC-123` becomes a clickable link to `https://my.site/ABC-123` (equivalent to
`<a href="https://my.site/ABC-123">ABC-123</a>`).

The plugin also works in reverse — a full ticket URL is **shortened** to the
short key when displayed, so pasted links stay readable:

| You type / paste                     | Shown as    | Opens                                |
| ------------------------------------ | ----------- | ------------------------------------ |
| `ABC-123`                            | `ABC-123`   | `https://my.site/ABC-123`            |
| `ABC-123#comment-42`                 | `ABC-123💬` | `https://my.site/ABC-123#comment-42` |
| `https://my.site/ABC-123`            | `ABC-123`   | `https://my.site/ABC-123`            |
| `https://my.site/ABC-123#comment-42` | `ABC-123💬` | `https://my.site/ABC-123#comment-42` |

When a reference points to a specific comment (its URL has a `#hash` fragment),
a small comment emoji (💬 by default) is appended to the label so you can tell
comment links apart at a glance.

### How it behaves

- **In the editor** a ticket is shown as a link while you are not editing it.
  The moment your cursor or selection touches it, it turns back into the plain,
  editable text — so linking never gets in the way of typing.
- **In the Viewer** (reading mode and the split "Editor + Viewer" layout)
  tickets and ticket URLs stay clickable after you switch modes (e.g. `Ctrl+L`).
- **Clicking in the editor:** a plain click just places the cursor for editing.
  Hold **Ctrl** (or **Cmd** on macOS) and click to open the link — the same as
  other editor links. The hand cursor only appears while the modifier is held.
- **It stays out of the way:** references already inside a Markdown link, a
  URL/autolink, HTML, or a code span/block are left untouched, and bare keys are
  only matched on word boundaries (so `xABC-123y` is *not* linked).

## Requirements

- Joplin **3.6** or newer (this plugin uses the CodeMirror 6 Markdown editor).
- On Joplin desktop before 3.1, enable the editor beta in **Options → General**.

---

## Configuration

Open **Options → Linkify tickets** and adjust:

- **Base URL** — the address your ticket keys should link to (and the prefix
  used to recognise ticket URLs for shortening). Default: `https://my.site/`.
  With that value, `ABC-123` links to `https://my.site/ABC-123`. A trailing
  slash is optional — the plugin never produces a double slash.
- **Comment emoji** — appended to the label when a link points to a specific
  comment (its URL has a `#hash` fragment). Default: 💬. Set it to any string,
  or clear it to disable the marker.
- **Ticket pattern** *(advanced)* — a JavaScript regular expression describing
  what a ticket key looks like. Default: `[A-Z][A-Z0-9]+-[0-9]+` (e.g.
  `ABC-123`, `PROJ2-45`). An invalid pattern falls back to the default.

Editor links update immediately when you change a setting. Viewer changes take
effect on the next render — open another note and come back, or restart Joplin.

---

## Building locally

You only need to build from source if you want to modify the plugin or install
an unreleased version. Here is the full path from a clean machine.

### 1. Install Node.js

Install the LTS release of **Node.js** (which includes `npm`) from
<https://nodejs.org/>. Confirm it is available:

```bash
node --version
npm --version
```

### 2. Install the project dependencies

From the project root:

```bash
npm install
```

This downloads everything listed in `package.json` (webpack, the TypeScript
toolchain, and the CodeMirror type packages).

### 3. Build the plugin

```bash
npm run dist
```

The packaged plugin is written to
`publish/com.joplin.valerij-n.linkifytickets.jpl`. Under the hood `npm run dist`
runs three webpack passes in sequence: `buildMain` (compiles `index.ts` and
copies assets) → `buildExtraScripts` (compiles each content script) →
`createArchive` (produces the `.jpl` archive and its info `.json`).

### 4. Load it into Joplin for testing

Add the project directory under **Options → Plugins → Show Advanced Settings →
Development plugins**, then fully restart Joplin (**File → Quit**, not just
closing the window). A complete restart is required for the Viewer content
script to reload.

### Handy scripts

- `npm run updateVersion` — bump the version in `package.json` + `manifest.json`.
- `npm run update` — update the plugin framework via the `yo joplin` generator.

---

## Project structure & development notes

*This section is for people working on the plugin itself; you don't need it to
use it.*

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
webpack.config.js             Build (framework-managed; do not edit)
```

The plugin has **two independent render paths** — the editor (CodeMirror 6) and
the Viewer (Markdown-It) — plus one shared helper module that keeps them in
sync.

### `src/common.ts` — shared source of truth

Exports everything both content scripts and the main script need, so setting IDs
and matching/labelling logic are never duplicated:

- `settingIds` — `{ baseUrl, pattern, commentEmoji }` setting keys.
- `defaults` — default `baseUrl`, `pattern` and `commentEmoji` (💬).
- `LinkifySettings` — `{ baseUrl, pattern, commentEmoji }` type.
- `TicketMatch` — an interpreted match: `{ url, ticket, hasComment, isUrl }`.
- `escapeRegExp(value)` — escapes a string for literal use in a RegExp.
- `buildUrl(baseUrl, ticket)` — joins base URL + ticket, handling trailing `/`.
- `buildMatchRegexp(settings)` — a global regexp matching **either** a full
  ticket URL (`<baseUrl>TICKET` + optional `#hash`) **or** a bare ticket
  (`\b(?:pattern)` + optional `#hash`). All of the plugin's own groups are
  *named* (`url`, `urlticket`, `hash`, `bare`, `barehash`) so a user pattern
  containing capture groups can't break interpretation. Falls back to the
  default pattern if the user pattern is invalid.
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
  - skips matches inside excluded syntax-tree nodes. Bare keys use the full
    `skipInsideNodes` set (Link, Image, URL, Autolink, InlineCode, CodeText,
    FencedCode, CodeBlock, Comment, HTMLTag, HTMLBlock); full ticket **URLs**
    use the narrower `skipUrlInsideNodes` set (which omits URL/Autolink) so the
    URL is still shortened;
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

### Gotchas for future edits

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

### Further reading

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
