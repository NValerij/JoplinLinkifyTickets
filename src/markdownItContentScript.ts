// Viewer (Markdown renderer) content script.
//
// Turns ticket references like ABC-123 into links in the rendered note (the
// Viewer / reading mode, and the split "Editor + Viewer" layout). Settings are
// read synchronously through `pluginOptions.settingValue`, which is provided to
// Markdown-It content scripts by Joplin.

import { settingIds, defaults, buildUrl, buildTicketRegexp } from './common';

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

			// Splits a plain-text token into a mix of text and ticket-link tokens.
			// Returns null when there is nothing to linkify.
			const splitTextToken = (token: any, regexp: RegExp, baseUrl: string): any[] | null => {
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
					const ticket = match[0];
					addText(text.slice(lastIndex, match.index));

					const open = new Token('link_open', 'a', 1);
					open.attrSet('href', buildUrl(baseUrl, ticket));
					open.attrSet('class', 'linkify-ticket');
					nodes.push(open);
					addText(ticket);
					nodes.push(new Token('link_close', 'a', -1));

					lastIndex = match.index + ticket.length;
				}

				if (!nodes.length) return null;
				addText(text.slice(lastIndex));
				return nodes;
			};

			// Core rule: walk every inline token's children, replacing tickets in
			// plain-text nodes. Text inside existing links is skipped.
			markdownIt.core.ruler.push('linkify_tickets', (state: any) => {
				const baseUrl = readSetting(settingIds.baseUrl, defaults.baseUrl);
				const regexp = buildTicketRegexp(readSetting(settingIds.pattern, defaults.pattern));

				for (const blockToken of state.tokens) {
					if (blockToken.type !== 'inline' || !blockToken.children) continue;

					const newChildren: any[] = [];
					let linkDepth = 0;

					for (const child of blockToken.children) {
						if (child.type === 'link_open') linkDepth++;

						const replacement = (child.type === 'text' && linkDepth === 0)
							? splitTextToken(child, regexp, baseUrl)
							: null;
						newChildren.push(...(replacement ?? [child]));

						if (child.type === 'link_close' && linkDepth > 0) linkDepth--;
					}

					blockToken.children = newChildren;
				}

				return true;
			});
		},
		assets: () => {
			return [{ name: 'markdownItContentScript.css' }];
		},
	};
};
