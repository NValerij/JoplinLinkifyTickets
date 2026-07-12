// Editor (CodeMirror 6) content script.
//
// Turns ticket references like ABC-123 into clickable link widgets in the
// Markdown editor. It also shortens full ticket URLs (e.g.
// "https://my.site/ABC-123") down to the identifier, adding a comment emoji
// when the URL points to a specific comment ("#hash"). Uses a MatchDecorator,
// which is the idiomatic CodeMirror way to build regexp-based decorations.

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, MatchDecorator } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { LinkifySettings, defaults, buildMatchRegexp, interpretMatch, displayLabel } from './common';

// Syntax-tree node names inside which a *bare* ticket must NOT be linkified, to
// avoid double-linking tickets that are already part of a link, URL or code.
const skipInsideNodes = new Set<string>([
	'Link', 'Image', 'URL', 'Autolink', 'InlineCode',
	'CodeText', 'FencedCode', 'CodeBlock', 'Comment', 'HTMLTag', 'HTMLBlock',
]);

// For a full ticket *URL* match we still want to collapse it even though the URL
// itself is recognised as a `URL`/`Autolink` node. We only skip it when it is
// the href of a Markdown link/image or when it lives inside code/HTML.
const skipUrlInsideNodes = new Set<string>([
	'Link', 'Image', 'InlineCode',
	'CodeText', 'FencedCode', 'CodeBlock', 'Comment', 'HTMLTag', 'HTMLBlock',
]);

const isInsideExcludedNode = (view: EditorView, pos: number, skip: Set<string>): boolean => {
	let node: any = syntaxTree(view.state).resolveInner(pos, 1);
	while (node) {
		if (skip.has(node.name)) return true;
		node = node.parent;
	}
	return false;
};

// Renders a ticket reference as a clickable anchor element. `label` is the
// shortened text shown to the user; `url` is where the link points.
class TicketLinkWidget extends WidgetType {
	public constructor(
		private readonly label: string,
		private readonly url: string,
		private readonly view: EditorView,
	) {
		super();
	}

	public eq(other: TicketLinkWidget) {
		return other.label === this.label && other.url === this.url;
	}

	public toDOM() {
		const anchor = document.createElement('a');
		anchor.textContent = this.label;
		anchor.href = this.url;
		anchor.title = `${this.url}\n(Ctrl/Cmd + click to open)`;
		anchor.className = 'cm-linkify-ticket';

		anchor.addEventListener('mousedown', (event) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				// Open only with the modifier, like other editor links.
				window.open(this.url, '_blank');
			} else {
				// A plain click places the cursor so the ticket can be edited.
				this.view.dispatch({ selection: { anchor: this.view.posAtDOM(anchor) } });
				this.view.focus();
			}
		});

		return anchor;
	}

	public ignoreEvent() {
		return false;
	}
}

// Builds the ViewPlugin that decorates tickets for the given settings. When the
// settings disable the plugin for the current note (tag filter), it returns an
// empty extension so nothing is linkified.
const createLinkifyPlugin = (settings: LinkifySettings) => {
	if (settings.enabled === false) return [];

	const decorator = new MatchDecorator({
		regexp: buildMatchRegexp(settings),
		decorate: (add, from, to, match, view) => {
			const interpreted = interpretMatch(match, settings);
			// Bare tickets are skipped inside any link/URL/code node; full ticket
			// URLs are still collapsed even though the URL is its own node.
			const skip = interpreted.isUrl ? skipUrlInsideNodes : skipInsideNodes;
			if (isInsideExcludedNode(view, from, skip)) return;
			// Skip matches the selection touches, so they stay editable.
			for (const range of view.state.selection.ranges) {
				if (range.from <= to && range.to >= from) return;
			}
			add(from, to, Decoration.replace({
				widget: new TicketLinkWidget(displayLabel(interpreted, settings), interpreted.url, view),
			}));
		},
	});

	return ViewPlugin.fromClass(class {
		public decorations: DecorationSet;

		public constructor(view: EditorView) {
			this.decorations = decorator.createDeco(view);
		}

		public update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = decorator.createDeco(update.view);
			}
		}
	}, {
		decorations: (instance) => instance.decorations,
	});
};

// Toggles a class on the editor while Ctrl/Cmd is held, so the pointer cursor
// over ticket links only appears with the modifier pressed (like real links).
const modifierTracking = EditorView.domEventHandlers({
	keydown: (event, view) => { view.dom.classList.toggle('cm-linkify-mod-active', event.ctrlKey || event.metaKey); return false; },
	keyup: (_event, view) => { view.dom.classList.remove('cm-linkify-mod-active'); return false; },
	mousemove: (event, view) => { view.dom.classList.toggle('cm-linkify-mod-active', event.ctrlKey || event.metaKey); return false; },
	mouseleave: (_event, view) => { view.dom.classList.remove('cm-linkify-mod-active'); return false; },
});

export default (context: { contentScriptId: string, postMessage: any }) => {
	return {
		plugin: async (codeMirrorWrapper: any) => {
			// This content script only targets the CodeMirror 6 editor.
			if (!codeMirrorWrapper.cm6) return;

			// A compartment lets us reconfigure the plugin when settings change.
			const compartment = new Compartment();

			let settings: LinkifySettings = defaults;
			try {
				settings = (await context.postMessage('getSettings')) || defaults;
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error('Linkify tickets: failed to load settings.', error);
			}

			codeMirrorWrapper.addExtension([
				compartment.of(createLinkifyPlugin(settings)),
				modifierTracking,
			]);

			codeMirrorWrapper.registerCommand('linkifyTickets__updateSettings', (newSettings: LinkifySettings) => {
				codeMirrorWrapper.editor.dispatch({
					effects: [compartment.reconfigure(createLinkifyPlugin(newSettings || settings))],
				});
			});
		},
		assets: () => {
			return [{ name: './style.css' }];
		},
	};
};
