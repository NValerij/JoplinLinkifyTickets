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
  script. It uses a `MatchDecorator` to find ticket identifiers and replaces
  each with a widget that renders an anchor element. The decorations are marked
  as atomic ranges, and matches overlapping the selection are left as plain text
  so they remain editable.
- [`src/style.css`](src/style.css:1) styles the rendered links.
