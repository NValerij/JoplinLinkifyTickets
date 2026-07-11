// Shared helpers and constants used by the main plugin script and both content
// scripts (editor and viewer).

export const settingIds = {
	baseUrl: 'linkifyTickets.baseUrl',
	pattern: 'linkifyTickets.pattern',
};

export const defaults = {
	baseUrl: 'https://my.site/',
	pattern: '[A-Z][A-Z0-9]+-[0-9]+',
};

export interface LinkifySettings {
	baseUrl: string;
	pattern: string;
}

// Builds the full URL for a given ticket identifier, avoiding double slashes.
export const buildUrl = (baseUrl: string, ticket: string): string => {
	if (!baseUrl) return ticket;
	return baseUrl.endsWith('/') ? baseUrl + ticket : `${baseUrl}/${ticket}`;
};

// Builds a global regexp from the user pattern, wrapped in word boundaries so
// identifiers embedded in a longer word (e.g. "xABC-123y") are not matched.
// Falls back to the default pattern if the user pattern is invalid.
export const buildTicketRegexp = (pattern: string): RegExp => {
	try {
		return new RegExp(`\\b(?:${pattern})\\b`, 'g');
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('Linkify tickets: invalid pattern, using default.', error);
		return new RegExp(`\\b(?:${defaults.pattern})\\b`, 'g');
	}
};
