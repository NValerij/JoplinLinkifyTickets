// Editor (CodeMirror 6) content script.
//
// Turns ticket references like ABC-123 into clickable link widgets in the
// Markdown editor. Uses a MatchDecorator, which is the idiomatic CodeMirror way
// to build regexp-based decorations.

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, MatchDecorator } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { LinkifySettings, defaults, buildUrl, buildTicketRegexp } from './common';

// Syntax-tree node names inside which a ticket must NOT be linkified, to avoid
// double-linking tickets that are already part of a link, URL or code.
const skipInsideNodes = new Set<string>([
	'Link', 'Image', 'URL', 'Autolink', 'InlineCode',
	'CodeText', 'FencedCode', 'CodeBlock', 'Comment', 'HTMLTag', 'HTMLBlock',
]);

const isInsideExcludedNode = (view: EditorView, pos: number): boolean => {
	let node: any = syntaxTree(view.state).resolveInner(pos, 1);
	while (node) {
		if (skipInsideNodes.has(node.name)) return true;
		node = node.parent;
	}
	return false;
};

// Renders a ticket identifier as a clickable anchor element.
class TicketLinkWidget extends WidgetType {
	public constructor(
		private readonly ticket: string,
		private readonly url: string,
		private readonly view: EditorView,
	) {
		super();
	}

	public eq(other: TicketLinkWidget) {
		return other.ticket === this.ticket && other.url === this.url;
	}

	public toDOM() {
		const anchor = document.createElement('a');
		anchor.textContent = this.ticket;
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

// Builds the ViewPlugin that decorates tickets for the given settings.
const createLinkifyPlugin = (settings: LinkifySettings) => {
	const decorator = new MatchDecorator({
		regexp: buildTicketRegexp(settings.pattern),
		decorate: (add, from, to, match, view) => {
			// Skip tickets inside links/code, or those the selection touches
			// (so they stay editable).
			if (isInsideExcludedNode(view, from)) return;
			for (const range of view.state.selection.ranges) {
				if (range.from <= to && range.to >= from) return;
			}
			add(from, to, Decoration.replace({
				widget: new TicketLinkWidget(match[0], buildUrl(settings.baseUrl, match[0]), view),
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
