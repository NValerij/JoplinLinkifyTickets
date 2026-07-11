import joplin from 'api';
import { ContentScriptType, SettingItemType } from 'api/types';
import { settingIds, defaults, LinkifySettings } from './common';

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
		[settingIds.pattern]: {
			section: sectionName,
			value: defaults.pattern,
			public: true,
			advanced: true,
			type: SettingItemType.String,
			label: 'Ticket pattern (regular expression)',
			description: 'A JavaScript regular expression that matches ticket identifiers. Default matches identifiers like ABC-123.',
		},
	});
};

const getSettings = async (): Promise<LinkifySettings> => {
	return {
		baseUrl: (await joplin.settings.value(settingIds.baseUrl)) as string,
		pattern: (await joplin.settings.value(settingIds.pattern)) as string,
	};
};

// Pushes the current settings to the running editor content script so that the
// links update immediately when the user changes the settings.
const updateContentScriptSettings = async () => {
	try {
		await joplin.commands.execute('editor.execCommand', {
			name: 'linkifyTickets__updateSettings',
			args: [await getSettings()],
		});
	} catch (error) {
		// The command is only available when a CodeMirror 6 editor is active.
		// eslint-disable-next-line no-console
		console.info('Linkify tickets: could not update editor settings yet.', error);
	}
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

		await joplin.settings.onChange(async () => {
			await updateContentScriptSettings();
		});
	},
});
