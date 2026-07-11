import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, MatchDecorator } from '@codemirror/view';
import { Compartment, RangeSet } from '@codemirror/state';

interface LinkifySettings {
	baseUrl: string;
	pattern: string;
}

const defaultSettings: LinkifySettings = {
	baseUrl: 'https://my.site/',
	pattern: '[A-Z][A-Z0-9]+-[0-9]+',
};

// Builds the full URL for a given ticket identifier.
const buildUrl = (baseUrl: string, ticket: string): string => {
	if (!baseUrl) return ticket;
	// Avoid producing double slashes when the base URL already ends with "/".
	if (baseUrl.endsWith('/')) return baseUrl + ticket;
	return `${baseUrl}/${ticket}`;
};

// Widget that renders a ticket identifier as a clickable anchor element.
class TicketLinkWidget extends WidgetType {
	public constructor(private readonly ticket: string, private readonly url: string) {
		super();
	}

	public eq(other: TicketLinkWidget) {
		return other.ticket === this.ticket && other.url === this.url;
	}

	public toDOM() {
		const anchor = document.createElement('a');
		anchor.textContent = this.ticket;
		anchor.href = this.url;
		anchor.title = this.url;
		anchor.className = 'cm-linkify-ticket';
		anchor.addEventListener('mousedown', (event) => {
			// Open the link externally instead of navigating the editor webview.
			event.preventDefault();
			window.open(this.url, '_blank');
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
	let regexp: RegExp;
	try {
		regexp = new RegExp(settings.pattern, 'g');
	} catch (error) {
		// Fall back to the default pattern if the user entered an invalid one.
		// eslint-disable-next-line no-console
		console.error('Linkify tickets: invalid pattern, using default.', error);
		regexp = new RegExp(defaultSettings.pattern, 'g');
	}

	return new MatchDecorator({
		regexp,
		decorate: (add, from, to, match, view) => {
			const ticket = match[0];

			// If the selection/cursor overlaps this match, keep it editable.
			for (const range of view.state.selection.ranges) {
				if (range.from <= to && range.to >= from) {
					return;
				}
			}

			const url = buildUrl(settings.baseUrl, ticket);
			add(from, to, Decoration.replace({
				widget: new TicketLinkWidget(ticket, url),
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

			codeMirrorWrapper.addExtension(
				linkifyCompartment.of(createLinkifyPlugin(settings)),
			);

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
