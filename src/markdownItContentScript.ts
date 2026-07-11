// Viewer (Markdown renderer) content script.
//
// Turns ticket references like ABC-123 into links in the rendered note (the
// Viewer / reading mode, and the split "Editor + Viewer" layout). Settings are
// read synchronously through `pluginOptions.settingValue`, which is provided to
// Markdown-It content scripts by Joplin.

const baseUrlSettingId = 'linkifyTickets.baseUrl';
const patternSettingId = 'linkifyTickets.pattern';

const defaultBaseUrl = 'https://my.site/';
const defaultPattern = '[A-Z][A-Z0-9]+-[0-9]+';

const buildUrl = (baseUrl: string, ticket: string): string => {
	if (!baseUrl) return ticket;
	if (baseUrl.endsWith('/')) return baseUrl + ticket;
	return `${baseUrl}/${ticket}`;
};

export default (_context: { contentScriptId: string }) => {
	return {
		plugin: (markdownIt: any, pluginOptions: any) => {
			const readSetting = (key: string, fallback: string): string => {
				try {
					const value = pluginOptions ? pluginOptions.settingValue(key) : undefined;
					return (value === undefined || value === null || value === '') ? fallback : value;
				} catch (error) {
					return fallback;
				}
			};

			const buildRegexp = (): RegExp => {
				const pattern = readSetting(patternSettingId, defaultPattern);
				try {
					return new RegExp(`\\b(?:${pattern})\\b`, 'g');
				} catch (error) {
					return new RegExp(`\\b(?:${defaultPattern})\\b`, 'g');
				}
			};

			// Splits a plain-text token into a mix of text and ticket-link tokens.
			const splitTextToken = (token: any, regexp: RegExp, baseUrl: string): any[] | null => {
				const text: string = token.content;
				regexp.lastIndex = 0;

				const nodes: any[] = [];
				let lastIndex = 0;
				let match: RegExpExecArray | null;
				let found = false;

				while ((match = regexp.exec(text)) !== null) {
					found = true;
					const ticket = match[0];
					const start = match.index;
					const end = start + ticket.length;

					if (start > lastIndex) {
						const textNode = new (token.constructor)('text', '', 0);
						textNode.content = text.slice(lastIndex, start);
						nodes.push(textNode);
					}

					const url = buildUrl(baseUrl, ticket);

					const linkOpen = new (token.constructor)('link_open', 'a', 1);
					linkOpen.attrSet('href', url);
					linkOpen.attrSet('class', 'linkify-ticket');
					nodes.push(linkOpen);

					const linkText = new (token.constructor)('text', '', 0);
					linkText.content = ticket;
					nodes.push(linkText);

					const linkClose = new (token.constructor)('link_close', 'a', -1);
					nodes.push(linkClose);

					lastIndex = end;
				}

				if (!found) return null;

				if (lastIndex < text.length) {
					const textNode = new (token.constructor)('text', '', 0);
					textNode.content = text.slice(lastIndex);
					nodes.push(textNode);
				}

				return nodes;
			};

			// Core rule: walk every inline token's children, replacing tickets in
			// plain-text nodes. Nodes inside existing links or code are skipped.
			markdownIt.core.ruler.push('linkify_tickets', (state: any) => {
				const baseUrl = readSetting(baseUrlSettingId, defaultBaseUrl);
				const regexp = buildRegexp();

				for (const blockToken of state.tokens) {
					if (blockToken.type !== 'inline' || !blockToken.children) continue;

					const children = blockToken.children;
					const newChildren: any[] = [];
					let linkDepth = 0;

					for (const child of children) {
						if (child.type === 'link_open') linkDepth++;

						const canLinkify = child.type === 'text' && linkDepth === 0;
						if (canLinkify) {
							const replacement = splitTextToken(child, regexp, baseUrl);
							if (replacement) {
								newChildren.push(...replacement);
							} else {
								newChildren.push(child);
							}
						} else {
							newChildren.push(child);
						}

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
