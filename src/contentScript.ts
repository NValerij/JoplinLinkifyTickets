import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, MatchDecorator } from '@codemirror/view';
import { Compartment, RangeSet } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

interface LinkifySettings {
	baseUrl: string;
	pattern: string;
}

const defaultSettings: LinkifySettings = {
	baseUrl: 'https://my.site/',
	pattern: '[A-Z][A-Z0-9]+-[0-9]+',
};

// Syntax-tree node names inside which a ticket must NOT be linkified. This
// prevents double-linking tickets that are already part of a Markdown link,
// an autolink/URL, or code.
const skipInsideNodes = new Set<string>([
	'Link',
	'Image',
	'URL',
	'Autolink',
	'InlineCode',
	'CodeText',
	'FencedCode',
	'CodeBlock',
	'Comment',
	'HTMLTag',
	'HTMLBlock',
]);

// Builds the full URL for a given ticket identifier.
const buildUrl = (baseUrl: string, ticket: string): string => {
	if (!baseUrl) return ticket;
	// Avoid producing double slashes when the base URL already ends with "/".
	if (baseUrl.endsWith('/')) return baseUrl + ticket;
	return `${baseUrl}/${ticket}`;
};

// Returns true when the given range is located inside a node where tickets
// should be left untouched (e.g. an existing Markdown link or code span).
const isInsideExcludedNode = (view: EditorView, from: number, to: number): boolean => {
	let node: any = syntaxTree(view.state).resolveInner(from, 1);
	while (node) {
		if (skipInsideNodes.has(node.name)) return true;
		node = node.parent;
	}
	return false;
};

// Widget that renders a ticket identifier as a clickable anchor element.
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
			if (event.ctrlKey || event.metaKey) {
				// Behave like other editor links: open only with the modifier.
				event.preventDefault();
				window.open(this.url, '_blank');
				return;
			}

			// A plain click should place the cursor on the ticket so the user
			// can immediately edit the text instead of following the link.
			event.preventDefault();
			const pos = this.view.posAtDOM(anchor);
			this.view.dispatch({ selection: { anchor: pos } });
			this.view.focus();
		});

		return anchor;
	}

	public ignoreEvent() {
		return false;
	}
}

// Creates a MatchDecorator for the given settings. Matches that overlap the
// current selection are shown as plain text so the ticket stays editable.
const createDecorator = (settings: LinkifySettings): MatchDecorator => {
	// Wrap the pattern in word boundaries so identifiers embedded in the middle
	// of a longer word (e.g. "xABC-123y") are not matched.
	const buildRegexp = (pattern: string) => new RegExp(`\\b(?:${pattern})\\b`, 'g');

	let regexp: RegExp;
	try {
		regexp = buildRegexp(settings.pattern);
	} catch (error) {
		// Fall back to the default pattern if the user entered an invalid one.
		// eslint-disable-next-line no-console
		console.error('Linkify tickets: invalid pattern, using default.', error);
		regexp = buildRegexp(defaultSettings.pattern);
	}

	return new MatchDecorator({
		regexp,
		decorate: (add, from, to, match, view) => {
			const ticket = match[0];

			// Skip tickets that are already part of a link, URL or code span.
			if (isInsideExcludedNode(view, from, to)) {
				return;
			}

			// If the selection/cursor overlaps this match, keep it editable.
			for (const range of view.state.selection.ranges) {
				if (range.from <= to && range.to >= from) {
					return;
				}
			}

			const url = buildUrl(settings.baseUrl, ticket);
			add(from, to, Decoration.replace({
				widget: new TicketLinkWidget(ticket, url, view),
			}));
		},
	});
};

// Builds the ViewPlugin that maintains the link decorations.
const createLinkifyPlugin = (settings: LinkifySettings) => {
	const decorator = createDecorator(settings);

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
		provide: (plugin) => EditorView.atomicRanges.of((view) => {
			return view.plugin(plugin)?.decorations ?? (RangeSet.empty as RangeSet<Decoration>);
		}),
	});
};

// Toggles a class on the editor while Ctrl/Cmd is held so that the "hand"
// (pointer) cursor over ticket links only appears with the modifier pressed,
// matching how regular links behave in the editor.
const modifierClass = 'cm-linkify-mod-active';
const modifierTrackingExtension = () => {
	const setState = (view: EditorView, active: boolean) => {
		view.dom.classList.toggle(modifierClass, active);
	};

	return EditorView.domEventHandlers({
		keydown: (event, view) => {
			if (event.ctrlKey || event.metaKey) setState(view, true);
			return false;
		},
		keyup: (_event, view) => {
			// Any key release: re-evaluate on next mousemove/keydown. Simplest is
			// to clear when the modifier is no longer held.
			setState(view, false);
			return false;
		},
		mousemove: (event, view) => {
			setState(view, event.ctrlKey || event.metaKey);
			return false;
		},
		mouseleave: (_event, view) => {
			setState(view, false);
			return false;
		},
	});
};

export default (context: { contentScriptId: string, postMessage: any }) => {
	return {
		plugin: async (codeMirrorWrapper: any) => {
			// This content script only targets the CodeMirror 6 editor.
			if (!codeMirrorWrapper.cm6) return;

			// A compartment lets us reconfigure the linkify plugin when the
			// settings change, without recreating the whole editor.
			const linkifyCompartment = new Compartment();

			let settings: LinkifySettings = defaultSettings;
			try {
				const received = await context.postMessage('getSettings');
				if (received) settings = received;
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error('Linkify tickets: failed to load settings.', error);
			}

			codeMirrorWrapper.addExtension([
				linkifyCompartment.of(createLinkifyPlugin(settings)),
				modifierTrackingExtension(),
			]);

			// Allow the main plugin script to push updated settings.
			codeMirrorWrapper.registerCommand('linkifyTickets__updateSettings', (newSettings: LinkifySettings) => {
				const applied = newSettings || settings;
				codeMirrorWrapper.editor.dispatch({
					effects: [linkifyCompartment.reconfigure(createLinkifyPlugin(applied))],
				});
			});
		},
		assets: () => {
			return [{ name: './style.css' }];
		},
	};
};
