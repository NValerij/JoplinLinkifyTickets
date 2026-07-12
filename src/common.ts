// Shared helpers and constants used by the main plugin script and both content
// scripts (editor and viewer).

export const settingIds = {
	baseUrl: 'linkifyTickets.baseUrl',
	pattern: 'linkifyTickets.pattern',
	commentEmoji: 'linkifyTickets.commentEmoji',
	// A comma-separated list of tag titles. When non-empty, the plugin only runs
	// on notes carrying at least one of these tags.
	requiredTag: 'linkifyTickets.requiredTag',
	// Internal (non-public) flag recomputed by the main process for the current
	// note, so the Viewer content script can read it synchronously.
	active: 'linkifyTickets.active',
};

export const defaults = {
	baseUrl: 'https://my.site/',
	pattern: '[A-Z][A-Z0-9]+-[0-9]+',
	// Speech balloon 💬 — appended to the label when a ticket URL points to a
	// specific comment (i.e. it has a "#hash" fragment).
	commentEmoji: '💬',
	// Empty means "run everywhere" (the original behavior).
	requiredTag: '',
	// Default to running; the main process narrows this per note.
	enabled: true,
};

export interface LinkifySettings {
	baseUrl: string;
	pattern: string;
	commentEmoji: string;
	// Whether the plugin should run on the current note (computed from the
	// requiredTag setting and the note's tags). Defaults to true.
	enabled: boolean;
}

// Splits a comma-separated tag filter into a list of trimmed, non-empty,
// lower-cased tag titles.
export const parseTagFilter = (requiredTag: string): string[] => {
	if (!requiredTag) return [];
	return requiredTag
		.split(',')
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag) => tag.length > 0);
};

// Decides whether the plugin should run on a note, given the configured tag
// filter and the titles of the tags attached to the note. An empty filter means
// "run everywhere"; otherwise the note must carry at least one of the tags.
export const noteMatchesTagFilter = (requiredTag: string, noteTagTitles: string[]): boolean => {
	const wanted = parseTagFilter(requiredTag);
	if (wanted.length === 0) return true;
	const have = new Set(noteTagTitles.map((title) => title.trim().toLowerCase()));
	return wanted.some((tag) => have.has(tag));
};

// Result of interpreting a single regexp match.
export interface TicketMatch {
	// The URL the link should point to (includes the "#hash" when present).
	url: string;
	// The bare ticket identifier, e.g. "ABC-123".
	ticket: string;
	// True when the source pointed to a specific comment (i.e. had a "#hash").
	hasComment: boolean;
	// True when the matched source text was a full ticket URL (as opposed to a
	// bare "ABC-123" reference). Used by the editor to decide whether being
	// inside a URL syntax node should cause the match to be skipped.
	isUrl: boolean;
}

// Escapes a string so it can be embedded literally into a RegExp.
export const escapeRegExp = (value: string): string => {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Builds the full URL for a bare ticket identifier, avoiding double slashes.
export const buildUrl = (baseUrl: string, ticket: string): string => {
	if (!baseUrl) return ticket;
	return baseUrl.endsWith('/') ? baseUrl + ticket : `${baseUrl}/${ticket}`;
};

// Returns the URL prefix used to detect (and generate) ticket URLs. It always
// ends with a single "/". Empty when no base URL is configured.
const getUrlPrefix = (baseUrl: string): string => {
	if (!baseUrl) return '';
	return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
};

// Builds a global regexp matching either:
//   - a full ticket URL  "<baseUrl>ABC-123" with an optional "#hash", or
//   - a bare ticket      "ABC-123" (wrapped in a word boundary), also with an
//     optional "#hash" fragment (e.g. "ABC-123#comment-42").
//
// The user pattern is wrapped in a non-capturing group, and all of the plugin's
// own capture groups are *named*, so a user pattern containing capture groups
// cannot break match interpretation. Falls back to the default pattern if the
// user pattern is invalid.
export const buildMatchRegexp = (settings: LinkifySettings): RegExp => {
	const build = (pattern: string): RegExp => {
		const ticket = `(?:${pattern})`;
		const prefix = getUrlPrefix(settings.baseUrl);
		const alternatives: string[] = [];

		if (prefix) {
			alternatives.push(
				`(?<url>${escapeRegExp(prefix)}(?<urlticket>${ticket})(?<hash>#[^\\s)]+)?)`,
			);
		}
		alternatives.push(`\\b(?<bare>${ticket})(?<barehash>#[^\\s)]+)?`);

		return new RegExp(alternatives.join('|'), 'g');
	};

	try {
		return build(settings.pattern);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('Linkify tickets: invalid pattern, using default.', error);
		return build(defaults.pattern);
	}
};

// Parses a standalone URL string and returns a TicketMatch when it is a ticket
// URL (i.e. "<baseUrl>ABC-123" with an optional "#hash"), otherwise null. Used
// by the viewer to shorten links whose href points to a ticket.
export const parseTicketUrl = (url: string, settings: LinkifySettings): TicketMatch | null => {
	const prefix = settings.baseUrl
		? (settings.baseUrl.endsWith('/') ? settings.baseUrl : `${settings.baseUrl}/`)
		: '';
	if (!prefix) return null;

	const build = (pattern: string) =>
		new RegExp(`^${escapeRegExp(prefix)}(?<urlticket>(?:${pattern}))(?<hash>#[^\\s)]+)?$`);

	let regexp: RegExp;
	try {
		regexp = build(settings.pattern);
	} catch (error) {
		regexp = build(defaults.pattern);
	}

	const match = url.match(regexp);
	if (!match || !match.groups) return null;
	return {
		url,
		ticket: match.groups.urlticket,
		hasComment: !!match.groups.hash,
		isUrl: true,
	};
};

// Interprets a match produced by buildMatchRegexp into a TicketMatch.
export const interpretMatch = (match: RegExpMatchArray, settings: LinkifySettings): TicketMatch => {
	const groups = match.groups || {};
	if (groups.url !== undefined) {
		return {
			url: groups.url,
			ticket: groups.urlticket,
			hasComment: !!groups.hash,
			isUrl: true,
		};
	}
	const ticket = groups.bare;
	const hash = groups.barehash || '';
	return {
		url: buildUrl(settings.baseUrl, ticket) + hash,
		ticket,
		hasComment: !!hash,
		isUrl: false,
	};
};

// The text shown for a ticket link: the identifier, plus the comment emoji when
// the URL points to a specific comment. No space is inserted before the emoji.
export const displayLabel = (match: TicketMatch, settings: LinkifySettings): string => {
	const emoji = settings.commentEmoji || defaults.commentEmoji;
	return match.hasComment ? `${match.ticket}${emoji}` : match.ticket;
};
