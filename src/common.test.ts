import { describe, it, expect } from '@jest/globals';
import {
	defaults,
	LinkifySettings,
	escapeRegExp,
	buildUrl,
	buildMatchRegexp,
	interpretMatch,
	parseTicketUrl,
	displayLabel,
	parseTagFilter,
	noteMatchesTagFilter,
	TicketMatch,
} from './common';

// Builds a settings object from the defaults with optional overrides.
const makeSettings = (overrides: Partial<LinkifySettings> = {}): LinkifySettings => ({
	baseUrl: defaults.baseUrl,
	pattern: defaults.pattern,
	commentEmoji: defaults.commentEmoji,
	enabled: defaults.enabled,
	...overrides,
});

// Runs the full "editor" pipeline on `text`: build the regexp, take the first
// match, interpret it, and compute its label. Returns null when nothing matches.
const firstMatch = (
	text: string,
	settings: LinkifySettings,
): { match: TicketMatch; label: string; raw: string } | null => {
	const regexp = buildMatchRegexp(settings);
	const m = regexp.exec(text);
	if (!m) return null;
	const match = interpretMatch(m, settings);
	return { match, label: displayLabel(match, settings), raw: m[0] };
};

// Collects every match in `text` (like the editor/viewer would while scanning).
const allMatches = (text: string, settings: LinkifySettings): string[] => {
	const regexp = buildMatchRegexp(settings);
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = regexp.exec(text)) !== null) {
		out.push(m[0]);
		if (m.index === regexp.lastIndex) regexp.lastIndex++;
	}
	return out;
};

describe('escapeRegExp', () => {
	it('escapes regexp metacharacters', () => {
		expect(escapeRegExp('a.b*c+?')).toBe('a\\.b\\*c\\+\\?');
		expect(escapeRegExp('https://my.site/')).toBe('https://my\\.site/');
	});
});

describe('buildUrl', () => {
	it('joins base URL and ticket, avoiding double slashes', () => {
		expect(buildUrl('https://my.site/', 'ABC-123')).toBe('https://my.site/ABC-123');
		expect(buildUrl('https://my.site', 'ABC-123')).toBe('https://my.site/ABC-123');
	});

	it('returns the bare ticket when no base URL is set', () => {
		expect(buildUrl('', 'ABC-123')).toBe('ABC-123');
	});
});

describe('README link formats (default settings)', () => {
	const settings = makeSettings();

	it('bare ticket: ABC-123', () => {
		const r = firstMatch('Blah blah ABC-123 and more', settings)!;
		expect(r.raw).toBe('ABC-123');
		expect(r.match.url).toBe('https://my.site/ABC-123');
		expect(r.match.ticket).toBe('ABC-123');
		expect(r.match.hasComment).toBe(false);
		expect(r.match.isUrl).toBe(false);
		expect(r.label).toBe('ABC-123');
	});

	it('bare ticket with comment hash: ABC-123#comment-42', () => {
		const r = firstMatch('see ABC-123#comment-42 please', settings)!;
		expect(r.raw).toBe('ABC-123#comment-42');
		expect(r.match.url).toBe('https://my.site/ABC-123#comment-42');
		expect(r.match.ticket).toBe('ABC-123');
		expect(r.match.hasComment).toBe(true);
		expect(r.match.isUrl).toBe(false);
		expect(r.label).toBe('ABC-123💬');
	});

	it('full ticket URL: https://my.site/ABC-123', () => {
		const r = firstMatch('link https://my.site/ABC-123 here', settings)!;
		expect(r.raw).toBe('https://my.site/ABC-123');
		expect(r.match.url).toBe('https://my.site/ABC-123');
		expect(r.match.ticket).toBe('ABC-123');
		expect(r.match.hasComment).toBe(false);
		expect(r.match.isUrl).toBe(true);
		expect(r.label).toBe('ABC-123');
	});

	it('full ticket URL with comment hash: https://my.site/ABC-123#comment-42', () => {
		const r = firstMatch('link https://my.site/ABC-123#comment-42 here', settings)!;
		expect(r.raw).toBe('https://my.site/ABC-123#comment-42');
		expect(r.match.url).toBe('https://my.site/ABC-123#comment-42');
		expect(r.match.ticket).toBe('ABC-123');
		expect(r.match.hasComment).toBe(true);
		expect(r.match.isUrl).toBe(true);
		expect(r.label).toBe('ABC-123💬');
	});
});

describe('word boundaries and non-matches', () => {
	const settings = makeSettings();

	it('does not match a ticket embedded in a longer word', () => {
		expect(allMatches('xABC-123y', settings)).toEqual([]);
	});

	it('matches multiple tickets in one line', () => {
		expect(allMatches('ABC-1 and DEF-22 done', settings)).toEqual(['ABC-1', 'DEF-22']);
	});

	it('requires the KEY-NUMBER shape', () => {
		expect(allMatches('lowercase abc-1 or ABC- or -123', settings)).toEqual([]);
	});
});

describe('parseTicketUrl (viewer link shortening)', () => {
	const settings = makeSettings();

	it('recognises a bare ticket URL', () => {
		const parsed = parseTicketUrl('https://my.site/ABC-123', settings)!;
		expect(parsed).not.toBeNull();
		expect(parsed.ticket).toBe('ABC-123');
		expect(parsed.hasComment).toBe(false);
		expect(displayLabel(parsed, settings)).toBe('ABC-123');
	});

	it('recognises a ticket URL with a comment hash', () => {
		const parsed = parseTicketUrl('https://my.site/ABC-123#comment-42', settings)!;
		expect(parsed.ticket).toBe('ABC-123');
		expect(parsed.hasComment).toBe(true);
		expect(displayLabel(parsed, settings)).toBe('ABC-123💬');
	});

	it('returns null for non-ticket URLs', () => {
		expect(parseTicketUrl('https://my.site/about', settings)).toBeNull();
		expect(parseTicketUrl('https://other.site/ABC-123', settings)).toBeNull();
	});

	it('returns null when there is trailing junk (anchored match)', () => {
		expect(parseTicketUrl('https://my.site/ABC-123/extra', settings)).toBeNull();
	});
});

describe('custom comment emoji', () => {
	it('uses the configured emoji', () => {
		const settings = makeSettings({ commentEmoji: '📝' });
		const r = firstMatch('ABC-1#c', settings)!;
		expect(r.label).toBe('ABC-1📝');
	});

	it('falls back to the default emoji when empty', () => {
		const settings = makeSettings({ commentEmoji: '' });
		const r = firstMatch('ABC-1#c', settings)!;
		expect(r.label).toBe('ABC-1💬');
	});
});

describe('invalid / advanced patterns', () => {
	it('falls back to the default pattern when the user pattern is invalid', () => {
		const settings = makeSettings({ pattern: '[unterminated' });
		// Should not throw and should still match default-shaped tickets.
		expect(allMatches('ABC-123', settings)).toEqual(['ABC-123']);
	});

	it('is not broken by capture groups in the user pattern', () => {
		const settings = makeSettings({ pattern: '([A-Z]+)-([0-9]+)' });
		const r = firstMatch('ABC-123', settings)!;
		expect(r.match.ticket).toBe('ABC-123');
		expect(r.match.url).toBe('https://my.site/ABC-123');
	});
});

// The README claims the plugin works with trackers whose URLs look like
// `<base>/<KEY-NUMBER>`. This documents how to support GitHub/GitLab-style
// `issue/1234` references by combining a base URL with a matching pattern.
describe('issue/1234 style references (GitHub/GitLab)', () => {
	it('works when the pattern includes the "issues/" segment', () => {
		const settings = makeSettings({
			baseUrl: 'https://github.com/org/repo/',
			pattern: 'issues?/[0-9]+',
		});

		const bare = firstMatch('fixed in issue/1234 today', settings)!;
		expect(bare.raw).toBe('issue/1234');
		expect(bare.match.url).toBe('https://github.com/org/repo/issue/1234');
		// The label is the whole matched token (no shortening to just the number).
		expect(bare.label).toBe('issue/1234');

		const url = firstMatch('see https://github.com/org/repo/issues/1234 ok', settings)!;
		expect(url.raw).toBe('https://github.com/org/repo/issues/1234');
		expect(url.match.isUrl).toBe(true);
		expect(url.label).toBe('issues/1234');
	});

	it('put "issues/" only in the base URL to shorten to the bare number', () => {
		// With the segment in the base URL, a full URL shortens to just "1234",
		// but note a bare "1234" in prose would then match any number — usually
		// not what you want, so this style is best for links only.
		const settings = makeSettings({
			baseUrl: 'https://github.com/org/repo/issues/',
			pattern: '[0-9]+',
		});
		const parsed = parseTicketUrl('https://github.com/org/repo/issues/1234', settings)!;
		expect(parsed.ticket).toBe('1234');
		expect(displayLabel(parsed, settings)).toBe('1234');
	});

	it('supports Jira-style /browse/KEY-NUMBER URLs', () => {
		const settings = makeSettings({ baseUrl: 'https://jira.example.com/browse/' });
		const parsed = parseTicketUrl('https://jira.example.com/browse/ABC-123', settings)!;
		expect(parsed.ticket).toBe('ABC-123');
		expect(displayLabel(parsed, settings)).toBe('ABC-123');
	});
});

describe('parseTagFilter', () => {
	it('returns an empty list for an empty filter', () => {
		expect(parseTagFilter('')).toEqual([]);
	});

	it('splits, trims and lower-cases comma-separated tags', () => {
		expect(parseTagFilter(' Work , Tickets ')).toEqual(['work', 'tickets']);
	});

	it('drops empty entries produced by stray commas', () => {
		expect(parseTagFilter('work,,  ,tickets,')).toEqual(['work', 'tickets']);
	});
});

describe('noteMatchesTagFilter', () => {
	it('runs everywhere when the filter is empty', () => {
		expect(noteMatchesTagFilter('', [])).toBe(true);
		expect(noteMatchesTagFilter('', ['anything'])).toBe(true);
	});

	it('runs everywhere when the filter is only whitespace/commas', () => {
		expect(noteMatchesTagFilter('  ,  ', ['whatever'])).toBe(true);
	});

	it('matches when the note carries the required tag (case-insensitive)', () => {
		expect(noteMatchesTagFilter('work', ['Work'])).toBe(true);
		expect(noteMatchesTagFilter('Work', ['work', 'other'])).toBe(true);
	});

	it('matches when the note carries any one of several required tags', () => {
		expect(noteMatchesTagFilter('work, tickets', ['tickets'])).toBe(true);
	});

	it('does not match when the note carries none of the required tags', () => {
		expect(noteMatchesTagFilter('work, tickets', ['personal'])).toBe(false);
		expect(noteMatchesTagFilter('work', [])).toBe(false);
	});

	it('ignores surrounding whitespace on the note tag titles', () => {
		expect(noteMatchesTagFilter('work', [' Work '])).toBe(true);
	});
});
