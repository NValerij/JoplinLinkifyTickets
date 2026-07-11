# Linkify tickets — Joplin plugin

Turns ticket references like `ABC-123` into clickable links directly in Joplin's
Markdown editor (the CodeMirror 6 editor).

For example, given the note text:

```
тра-та-та бла-бла-бла ABC-123 тру-ту-ту
```

`ABC-123` is rendered in the editor as a link pointing to
`https://my.site/ABC-123` (equivalent to
`<a href="https://my.site/ABC-123">ABC-123</a>`).

The link is rendered as a widget while you are not editing that particular
ticket. As soon as the cursor/selection touches the ticket, it turns back into
plain, editable text.

Behavior details:

- Ticket identifiers are matched only on word boundaries, so text embedded in a
  longer word (e.g. `xABC-123y`) is not turned into a link.
- Tickets that are already part of a Markdown link, an autolink/URL, HTML or a
  code span/block are left untouched (no double-linking).
- A plain click on a ticket link places the cursor so you can immediately edit
  the text. Hold **Ctrl** (or **Cmd** on macOS) and click to open the link,
  consistent with how other links behave in the editor. The "hand" (pointer)
  cursor over a ticket only appears while the modifier is held.
- Tickets are also linkified in the **Viewer** (reading mode) and in the
  split "Editor + Viewer" layout, so they stay clickable after switching modes
  (e.g. with Ctrl+L).

## Configuration

Open **Options → Linkify tickets** to configure:

- **Base URL** — the ticket identifier is appended to this value.
  With the default `https://my.site/`, the ticket `ABC-123` links to
  `https://my.site/ABC-123`.
- **Ticket pattern** (advanced) — a JavaScript regular expression that matches
  ticket identifiers. Default: `[A-Z][A-Z0-9]+-[0-9]+` (matches `ABC-123`).

Changes to the settings are applied to the open editor immediately.

## Requirements

- Joplin 3.6 or newer (uses the CodeMirror 6 Markdown editor).
- On Joplin desktop before 3.1 you must enable the editor beta in
  **Options → General**.

## Development

Install dependencies and build the `.jpl` archive:

```bash
npm install
npm run dist
```

The packaged plugin is written to `publish/com.joplin.valerij-n.linkifytickets.jpl`.

To test it during development, add the project directory under
**Options → Plugins → Show Advanced Settings → Development plugins** and restart
Joplin.

## How it works

- [`src/index.ts`](src/index.ts:1) registers the plugin, the settings section,
  and the CodeMirror content script. It answers the `getSettings` message and
  pushes updated settings to the editor via an editor command when the settings
  change.
- [`src/contentScript.ts`](src/contentScript.ts:1) is the CodeMirror 6 content
  script. It uses a `MatchDecorator` (with the pattern wrapped in `\b` word
  boundaries) to find ticket identifiers and replaces each with a widget that
  renders an anchor element. The syntax tree is consulted to skip tickets that
  are already inside links, URLs, HTML or code. The decorations are marked as
  atomic ranges, and matches overlapping the selection are left as plain text so
  they remain editable. A plain click on a widget moves the cursor into the
  ticket for editing, while Ctrl/Cmd-click opens the link. A small extension
  tracks the Ctrl/Cmd key so the pointer cursor only shows while the modifier
  is held.
- [`src/markdownItContentScript.ts`](src/markdownItContentScript.ts:1) is the
  Viewer (Markdown-It) content script. It adds a core rule that replaces ticket
  identifiers in plain-text tokens with link tokens, skipping tokens that are
  already inside a link. It reads the settings synchronously via
  `pluginOptions.settingValue`.
- [`src/style.css`](src/style.css:1) styles the links in the editor and
  [`src/markdownItContentScript.css`](src/markdownItContentScript.css:1) styles
  them in the Viewer.
