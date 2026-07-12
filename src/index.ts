import joplin from 'api';
import { ContentScriptType, SettingItemType } from 'api/types';
import { settingIds, defaults, LinkifySettings, noteMatchesTagFilter } from './common';

const sectionName = 'linkifyTicketsSection';

const contentScriptId = 'linkify-tickets-cm6';
const markdownItContentScriptId = 'linkify-tickets-markdownit';

const registerSettings = async () => {
	await joplin.settings.registerSection(sectionName, {
		label: 'Linkify tickets',
		description: 'Settings for the "Linkify tickets" plugin. Turns ticket references like ABC-123 into links in the Markdown editor.',
		iconName: 'fas fa-link',
	});

	await joplin.settings.registerSettings({
		[settingIds.baseUrl]: {
			section: sectionName,
			value: defaults.baseUrl,
			public: true,
			type: SettingItemType.String,
			label: 'Base URL',
			description: 'The ticket identifier is appended to this URL. Example: with "https://my.site/" the ticket "ABC-123" links to "https://my.site/ABC-123".',
		},
		[settingIds.commentEmoji]: {
			section: sectionName,
			value: defaults.commentEmoji,
			public: true,
			type: SettingItemType.String,
			label: 'Comment emoji',
			description: 'Appended to the shortened label when a ticket URL points to a specific comment (i.e. has a "#hash" fragment). Example: "ABC-123 💬".',
		},
		[settingIds.requiredTag]: {
			section: sectionName,
			value: defaults.requiredTag,
			public: true,
			type: SettingItemType.String,
			label: 'Only on notes tagged (optional)',
			description: 'When set, the plugin only runs on notes carrying this tag. Separate several tags with commas (a note needs any one of them). Leave empty to run on every note.',
		},
		[settingIds.pattern]: {
			section: sectionName,
			value: defaults.pattern,
			public: true,
			advanced: true,
			type: SettingItemType.String,
			label: 'Ticket pattern (regular expression)',
			description: 'A JavaScript regular expression that matches ticket identifiers. Default matches identifiers like ABC-123.',
		},
		[settingIds.active]: {
			section: sectionName,
			value: true,
			public: false,
			type: SettingItemType.Bool,
			label: 'Active on the current note (internal)',
		},
	});
};

// Reads the tag titles attached to a note, following pagination.
const getNoteTagTitles = async (noteId: string): Promise<string[]> => {
	const titles: string[] = [];
	let page = 1;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const result = await joplin.data.get(['notes', noteId, 'tags'], {
			fields: ['id', 'title'],
			page,
		});
		for (const tag of result.items) titles.push(tag.title);
		if (!result.has_more) break;
		page += 1;
	}
	return titles;
};

// Recomputes whether the plugin should be active on the currently selected note
// and stores the result in the internal `active` setting (read by the Viewer).
// Returns the computed value.
const computeActiveForCurrentNote = async (): Promise<boolean> => {
	const requiredTag = (await joplin.settings.value(settingIds.requiredTag)) as string;
	let active = true;
	if (requiredTag) {
		try {
			const note = await joplin.workspace.selectedNote();
			const titles = note ? await getNoteTagTitles(note.id) : [];
			active = noteMatchesTagFilter(requiredTag, titles);
		} catch (error) {
			// If we cannot determine the tags, err on the side of running.
			// eslint-disable-next-line no-console
			console.info('Linkify tickets: could not read note tags.', error);
			active = true;
		}
	}
	await joplin.settings.setValue(settingIds.active, active);
	return active;
};

const getSettings = async (active?: boolean): Promise<LinkifySettings> => {
	const enabled = active !== undefined
		? active
		: ((await joplin.settings.value(settingIds.active)) as boolean);
	return {
		baseUrl: (await joplin.settings.value(settingIds.baseUrl)) as string,
		pattern: (await joplin.settings.value(settingIds.pattern)) as string,
		commentEmoji: (await joplin.settings.value(settingIds.commentEmoji)) as string,
		enabled,
	};
};

// Pushes the current settings to the running editor content script so that the
// links update immediately when the settings or the active note change.
const updateContentScriptSettings = async (active: boolean) => {
	try {
		await joplin.commands.execute('editor.execCommand', {
			name: 'linkifyTickets__updateSettings',
			args: [await getSettings(active)],
		});
	} catch {
		// The command is only available when a CodeMirror 6 editor is active
		// (e.g. in the Viewer/reading mode, or when no note is open). This is an
		// expected, harmless condition, so we silently ignore it.
	}
};

// The last active state we pushed, so polling only sends an update to the
// editor when the value actually changes.
let lastActive: boolean | null = null;

// Recomputes the active state for the current note and pushes it to the editor.
// When `force` is false the editor is only updated if the value changed since
// the previous push (used by the poll to avoid needless churn).
//
// Note: only the editor is updated live. The Markdown viewer (reading mode)
// caches its rendered output and there is no plugin API to force it to
// re-render without reloading the note, so a viewer change requires switching
// to another note and back (see the comment on the poll below).
const refresh = async (force = true) => {
	const active = await computeActiveForCurrentNote();
	if (force || active !== lastActive) {
		await updateContentScriptSettings(active);
	}
	lastActive = active;
};

joplin.plugins.register({
	onStart: async function() {
		await registerSettings();

		await joplin.contentScripts.onMessage(contentScriptId, async (message: any) => {
			if (message === 'getSettings') {
				return await getSettings();
			}
		});

		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			contentScriptId,
			'./contentScript.js',
		);

		// Viewer / reading mode: linkify tickets in the rendered note. This
		// content script reads the settings directly via pluginOptions.
		await joplin.contentScripts.register(
			ContentScriptType.MarkdownItPlugin,
			markdownItContentScriptId,
			'./markdownItContentScript.js',
		);

		// Recompute the active state whenever the selected note changes.
		await joplin.workspace.onNoteSelectionChange(async () => {
			await refresh();
		});

		// Recompute when the current note's content/properties change.
		await joplin.workspace.onNoteChange(async () => {
			await refresh();
		});

		// React to setting changes. Ignore changes to the internal `active`
		// setting (which we write ourselves) to avoid an update loop.
		await joplin.settings.onChange(async (event: any) => {
			const keys: string[] = (event && event.keys) || [];
			if (keys.length === 1 && keys[0] === settingIds.active) return;
			await refresh();
		});

		// Adding or removing a tag does not fire any of the events above
		// (tags are stored as separate note<->tag associations, and there is
		// no dedicated tag-change event in the plugin API). Poll the current
		// note's tags so the plugin turns on/off shortly after a tag is
		// added/removed, without having to switch notes. The poll only pushes
		// an update to the editor when the computed state actually changes.
		setInterval(() => {
			refresh(false).catch(() => {
				// Ignore transient failures; the next tick will retry.
			});
		}, 2000);

		// Initial computation for the note open at startup.
		await refresh();
	},
});
