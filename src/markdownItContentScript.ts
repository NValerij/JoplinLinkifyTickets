// Viewer (Markdown renderer) content script.
//
// Turns ticket references like ABC-123 into links in the rendered note (the
// Viewer / reading mode, and the split "Editor + Viewer" layout). It also
// shortens full ticket URLs (e.g. "https://my.site/ABC-123") to the identifier,
// appending a comment emoji when the URL points to a specific comment ("#hash").
// This applies both to tickets/URLs written as plain text and to existing links
// (including URLs auto-linked by the renderer) whose target is a ticket URL.
//
// Settings are read synchronously through `pluginOptions.settingValue`, which is
// provided to Markdown-It content scripts by Joplin.

import {
	settingIds, defaults, LinkifySettings,
	buildMatchRegexp, interpretMatch, displayLabel, parseTicketUrl,
} from './common';

export default (_context: { contentScriptId: string }) => {
	return {
		plugin: (markdownIt: any, pluginOptions: any) => {
			const readSetting = (key: string, fallback: string): string => {
				try {
					const value = pluginOptions?.settingValue(key);
					return value ? value : fallback;
				} catch (error) {
					return fallback;
				}
			};

			// The internal `active` flag is recomputed by the main process for the
			// current note (based on the tag filter). Default to active.
			const isActive = (): boolean => {
				try {
					const value = pluginOptions?.settingValue(settingIds.active);
					return value === undefined ? true : !!value;
				} catch (error) {
					return true;
				}
			};

			const getSettings = (): LinkifySettings => ({
				baseUrl: readSetting(settingIds.baseUrl, defaults.baseUrl),
				pattern: readSetting(settingIds.pattern, defaults.pattern),
				commentEmoji: readSetting(settingIds.commentEmoji, defaults.commentEmoji),
				enabled: isActive(),
			});

			// Splits a plain-text token into text and ticket-link tokens (handling
			// both bare tickets and full ticket URLs). Returns null when nothing
			// is matched.
			const splitTextToken = (token: any, regexp: RegExp, settings: LinkifySettings): any[] | null => {
				const text: string = token.content;
				const Token = token.constructor;
				const nodes: any[] = [];
				let lastIndex = 0;
				regexp.lastIndex = 0;

				const addText = (content: string) => {
					if (!content) return;
					const node = new Token('text', '', 0);
					node.content = content;
					nodes.push(node);
				};

				let match: RegExpExecArray | null;
				while ((match = regexp.exec(text)) !== null) {
					const interpreted = interpretMatch(match, settings);
					addText(text.slice(lastIndex, match.index));

					const open = new Token('link_open', 'a', 1);
					open.attrSet('href', interpreted.url);
					open.attrSet('class', 'linkify-ticket');
					nodes.push(open);
					addText(displayLabel(interpreted, settings));
					nodes.push(new Token('link_close', 'a', -1));

					lastIndex = match.index + match[0].length;
				}

				if (!nodes.length) return null;
				addText(text.slice(lastIndex));
				return nodes;
			};

			// Core rule: walk every inline token's children.
			markdownIt.core.ruler.push('linkify_tickets', (state: any) => {
				const settings = getSettings();
				// Skipped on notes that do not match the configured tag filter.
				if (!settings.enabled) return true;
				const regexp = buildMatchRegexp(settings);

				for (const blockToken of state.tokens) {
					if (blockToken.type !== 'inline' || !blockToken.children) continue;

					const children = blockToken.children;
					const newChildren: any[] = [];

					for (let i = 0; i < children.length; i++) {
						const child = children[i];

						// Existing link whose href is a ticket URL: shorten the
						// visible text (between link_open and link_close).
						if (child.type === 'link_open') {
							const href = child.attrGet('href') || '';
							const parsed = parseTicketUrl(href, settings);
							const close = findLinkClose(children, i);

							if (parsed && close !== -1) {
								child.attrJoin('class', 'linkify-ticket');
								newChildren.push(child);

								const label = new (child.constructor)('text', '', 0);
								label.content = displayLabel(parsed, settings);
								newChildren.push(label);
								newChildren.push(children[close]);

								i = close; // skip the original inner tokens
								continue;
							}
						}

						// Plain text outside links: linkify bare tickets/URLs.
						if (child.type === 'text') {
							const replacement = splitTextToken(child, regexp, settings);
							if (replacement) {
								newChildren.push(...replacement);
								continue;
							}
						}

						newChildren.push(child);
					}

					blockToken.children = newChildren;
				}

				return true;
			});

			// Finds the index of the matching link_close for a link_open at
			// `openIndex`, accounting for nested links.
			function findLinkClose(children: any[], openIndex: number): number {
				let depth = 0;
				for (let i = openIndex; i < children.length; i++) {
					if (children[i].type === 'link_open') depth++;
					else if (children[i].type === 'link_close') {
						depth--;
						if (depth === 0) return i;
					}
				}
				return -1;
			}
		},
		assets: () => {
			return [{ name: 'markdownItContentScript.css' }];
		},
	};
};
