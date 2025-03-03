require('app-module-path').addPath(__dirname);

const { BaseApplication } = require('lib/BaseApplication');
const { FoldersScreenUtils } = require('lib/folders-screen-utils.js');
const Setting = require('lib/models/Setting.js');
const { shim } = require('lib/shim.js');
const BaseModel = require('lib/BaseModel.js');
const MasterKey = require('lib/models/MasterKey');
const { _, setLocale } = require('lib/locale.js');
const os = require('os');
const fs = require('fs-extra');
const Tag = require('lib/models/Tag.js');
const { reg } = require('lib/registry.js');
const { sprintf } = require('sprintf-js');
const { JoplinDatabase } = require('lib/joplin-database.js');
const { DatabaseDriverNode } = require('lib/database-driver-node.js');
const { ElectronAppWrapper } = require('./ElectronAppWrapper');
const { defaultState } = require('lib/reducer.js');
const packageInfo = require('./packageInfo.js');
const AlarmService = require('lib/services/AlarmService.js');
const AlarmServiceDriverNode = require('lib/services/AlarmServiceDriverNode');
const DecryptionWorker = require('lib/services/DecryptionWorker');
const InteropService = require('lib/services/InteropService');
const InteropServiceHelper = require('./InteropServiceHelper.js');
const ResourceService = require('lib/services/ResourceService');
const ClipperServer = require('lib/ClipperServer');
const StudentHelperUtils = require("lib/StudentHelperUtils.js");

const { bridge } = require('electron').remote.require('./bridge');
const Menu = bridge().Menu;
const MenuItem = bridge().MenuItem;

const appDefaultState = Object.assign({}, defaultState, {
	route: {
		type: 'NAV_GO',
		routeName: 'Main',
		props: {},
	},
	navHistory: [],
	fileToImport: null,
	windowCommand: null,
	noteVisiblePanes: ['editor', 'viewer'],
	sidebarVisibility: true,
	windowContentSize: bridge().windowContentSize(),
	watchedNoteFiles: [],
});

class Application extends BaseApplication {

	constructor() {
		super();
		this.lastMenuScreen_ = null;
		this.powerSaveBlockerId_ = null;
	}

	hasGui() {
		return true;
	}

	checkForUpdateLoggerPath() {
		return Setting.value('profileDir') + '/log-autoupdater.txt';
	}

	reducer(state = appDefaultState, action) {
		let newState = state;

		try {
			switch (action.type) {

				case 'NAV_BACK':
				case 'NAV_GO':

					const goingBack = action.type === 'NAV_BACK';

					if (goingBack && !state.navHistory.length) break;

					const currentRoute = state.route;

					newState = Object.assign({}, state);
					let newNavHistory = state.navHistory.slice();

					if (goingBack) {
						let newAction = null;
						while (newNavHistory.length) {
							newAction = newNavHistory.pop();
							if (newAction.routeName !== state.route.routeName) break;
						}

						if (!newAction) break;

						action = newAction;
					}

					if (!goingBack) newNavHistory.push(currentRoute);
					newState.navHistory = newNavHistory
					newState.route = action;
					break;

				case 'WINDOW_CONTENT_SIZE_SET':

					newState = Object.assign({}, state);
					newState.windowContentSize = action.size;
					break;

				case 'WINDOW_COMMAND':

					newState = Object.assign({}, state);
					let command = Object.assign({}, action);
					delete command.type;
					newState.windowCommand = command;
					break;

				case 'NOTE_VISIBLE_PANES_TOGGLE':

					let panes = state.noteVisiblePanes.slice();
					if (panes.length === 2) {
						panes = ['editor'];
					} else if (panes.indexOf('editor') >= 0) {
						panes = ['viewer'];
					} else if (panes.indexOf('viewer') >= 0) {
						panes = ['editor', 'viewer'];
					} else {
						panes = ['editor', 'viewer'];
					}

					newState = Object.assign({}, state);
					newState.noteVisiblePanes = panes;
					break;

				case 'NOTE_VISIBLE_PANES_SET':

					newState = Object.assign({}, state);
					newState.noteVisiblePanes = action.panes;
					break;

				case 'SIDEBAR_VISIBILITY_TOGGLE':

					newState = Object.assign({}, state);
					newState.sidebarVisibility = !state.sidebarVisibility;
					break;

				case 'SIDEBAR_VISIBILITY_SET':
					newState = Object.assign({}, state);
					newState.sidebarVisibility = action.visibility;
					break;

				case 'NOTE_FILE_WATCHER_ADD':

					if (newState.watchedNoteFiles.indexOf(action.id) < 0) {
						newState = Object.assign({}, state);
						const watchedNoteFiles = newState.watchedNoteFiles.slice();
						watchedNoteFiles.push(action.id);
						newState.watchedNoteFiles = watchedNoteFiles;
					}
					break;

				case 'NOTE_FILE_WATCHER_REMOVE':

					newState = Object.assign({}, state);
					const idx = newState.watchedNoteFiles.indexOf(action.id);
					if (idx >= 0) {
						const watchedNoteFiles = newState.watchedNoteFiles.slice();
						watchedNoteFiles.splice(idx, 1);
						newState.watchedNoteFiles = watchedNoteFiles;
					}
					break;

				case 'NOTE_FILE_WATCHER_CLEAR':

					newState = Object.assign({}, state);
					newState.watchedNoteFiles = [];
					break;

			}
		} catch (error) {
			error.message = 'In reducer: ' + error.message + ' Action: ' + JSON.stringify(action);
			throw error;
		}

		return super.reducer(newState, action);
	}

	async generalMiddleware(store, next, action) {
		if (action.type == 'SETTING_UPDATE_ONE' && action.key == 'locale' || action.type == 'SETTING_UPDATE_ALL') {
			setLocale(Setting.value('locale'));
			// The bridge runs within the main process, with its own instance of locale.js
			// so it needs to be set too here.
			bridge().setLocale(Setting.value('locale'));
			this.refreshMenu();
		}

		if (action.type == 'SETTING_UPDATE_ONE' && action.key == 'showTrayIcon' || action.type == 'SETTING_UPDATE_ALL') {
			this.updateTray();
		}

		if (action.type == 'SETTING_UPDATE_ONE' && action.key == 'style.editor.fontFamily' || action.type == 'SETTING_UPDATE_ALL') {
			this.updateEditorFont();
		}

		if (["NOTE_UPDATE_ONE", "NOTE_DELETE", "FOLDER_UPDATE_ONE", "FOLDER_DELETE"].indexOf(action.type) >= 0) {
			if (!await reg.syncTarget().syncStarted()) reg.scheduleSync(30 * 1000, { syncSteps: ["update_remote", "delete_remote"] });
		}

		if (['EVENT_NOTE_ALARM_FIELD_CHANGE', 'NOTE_DELETE'].indexOf(action.type) >= 0) {
			await AlarmService.updateNoteNotification(action.id, action.type === 'NOTE_DELETE');
		}

		const result = await super.generalMiddleware(store, next, action);
		const newState = store.getState();

		if (action.type === 'NAV_GO' || action.type === 'NAV_BACK') {
			app().updateMenu(newState.route.routeName);
		}

		if (['NOTE_VISIBLE_PANES_TOGGLE', 'NOTE_VISIBLE_PANES_SET'].indexOf(action.type) >= 0) {
			Setting.setValue('noteVisiblePanes', newState.noteVisiblePanes);
		}

		if (['SIDEBAR_VISIBILITY_TOGGLE', 'SIDEBAR_VISIBILITY_SET'].indexOf(action.type) >= 0) {
			Setting.setValue('sidebarVisibility', newState.sidebarVisibility);
		}

		if (action.type === 'SYNC_STARTED') {
			if (!this.powerSaveBlockerId_) this.powerSaveBlockerId_ = bridge().powerSaveBlockerStart('prevent-app-suspension');
		}

		if (action.type === 'SYNC_COMPLETED') {
			if (this.powerSaveBlockerId_) {
				bridge().powerSaveBlockerStop(this.powerSaveBlockerId_);
				this.powerSaveBlockerId_ = null;
			}
		}

		if (['SEARCH_SELECT', 'FOLDER_SELECT', 'TAG_SELECT'].indexOf(action.type) >= 0) {
			this.refreshMenu();
		}

		return result;
	}

	refreshMenu() {
		const screen = this.lastMenuScreen_;
		this.lastMenuScreen_ = null;
		this.updateMenu(screen);
	}

	updateMenu(screen) {
		if (this.lastMenuScreen_ === screen) return;

		const sortNoteItems = [];
		const sortNoteOptions = Setting.enumOptions('notes.sortOrder.field');
		for (let field in sortNoteOptions) {
			if (!sortNoteOptions.hasOwnProperty(field)) continue;
			sortNoteItems.push({
				label: sortNoteOptions[field],
				screens: ['Main'],
				type: 'checkbox',
				checked: Setting.value('notes.sortOrder.field') === field,
				click: () => {
					Setting.setValue('notes.sortOrder.field', field);
					this.refreshMenu();
				}
			});
		}

		const importItems = [];
		const exportItems = [];
		const ioService = new InteropService();
		const ioModules = ioService.modules();
		for (let i = 0; i < ioModules.length; i++) {
			const module = ioModules[i];
			if (module.type === 'exporter') {
				exportItems.push({
					label: module.fullLabel(),
					screens: ['Main'],
					click: async () => {
						await InteropServiceHelper.export(this.dispatch.bind(this), module);
					}
				});
			} else {
				for (let j = 0; j < module.sources.length; j++) {
					const moduleSource = module.sources[j];
					importItems.push({
						label: module.fullLabel(moduleSource),
						screens: ['Main'],
						click: async () => {
							let path = null;

							const selectedFolderId = this.store().getState().selectedFolderId;

							if (moduleSource === 'file') {
								path = bridge().showOpenDialog({
									filters: [{ name: module.description, extensions: module.fileExtensions }]
								});
							} else {
								path = bridge().showOpenDialog({
									properties: ['openDirectory', 'createDirectory'],
								});
							}

							if (!path || (Array.isArray(path) && !path.length)) return;

							if (Array.isArray(path)) path = path[0];

							this.dispatch({
								type: 'WINDOW_COMMAND',
								name: 'showModalMessage',
								message: _('Importing from "%s" as "%s" format. Please wait...', path, module.format),
							});

							const importOptions = {};
							importOptions.path = path;
							importOptions.format = module.format;
							importOptions.destinationFolderId = !module.isNoteArchive && moduleSource === 'file' ? selectedFolderId : null;

							const service = new InteropService();
							try {
								const result = await service.import(importOptions);
								console.info('Import result: ', result);
							} catch (error) {
								bridge().showErrorMessageBox(error.message);
							}

							this.dispatch({
								type: 'WINDOW_COMMAND',
								name: 'hideModalMessage',
							});
						}
					});
				}
			}
		}

		exportItems.push({
			label: 'PDF - ' + _('PDF File'),
			screens: ['Main'],
			click: async () => {
				this.dispatch({
					type: 'WINDOW_COMMAND',
					name: 'exportPdf',
				});
			}
		});


		const state = this.store() && this.store().getState();
		const isSemesterSelected = state && StudentHelperUtils.isSemesterSelected(state.selectedFolderId, state.folders, state.notesParentType);
		const isCourseSelected = state && StudentHelperUtils.isCourseSelected(state.selectedFolderId, state.folders, state.notesParentType);

		const template = [
			{
				label: _('File'),
				submenu: [{
					label: _('New semester'),
					accelerator: 'CommandOrControl+Shift+S',
					screens: ['Main'],
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newSemester',
						});
					}
				}, {
					label: _('New course'),
					accelerator: 'CommandOrControl+Shift+C',
					screens: ['Main'],
					enabled: isSemesterSelected,
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newCourse',
						});
					}
				}, {
					type: 'separator',
				}, {
					label: _('New assignment'),
					accelerator: 'CommandOrControl+T',
					screens: ['Main'],
					enabled: isCourseSelected,
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newTodo',
						});
					}
				}, {
					label: _('New note'),
					accelerator: 'CommandOrControl+N',
					screens: ['Main'],
					enabled: isCourseSelected,
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newNote',
						});
					}
				}, {
					type: 'separator',
				}, {
					label: _('Import'),
					submenu: importItems,
				}, {
					label: _('Export'),
					submenu: exportItems,
				}, {
					type: 'separator',
				}, {
					label: _('Print'),
					accelerator: 'CommandOrControl+P',
					screens: ['Main'],
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'print',
						});
					}
				}, {
					type: 'separator',
					platforms: ['darwin'],
				}, {
					label: _('Hide %s', 'Student Helper'),
					platforms: ['darwin'],
					accelerator: 'CommandOrControl+H',
					click: () => { bridge().electronApp().hide() }
				}, {
					type: 'separator',
				}, {
					label: _('Quit'),
					accelerator: 'CommandOrControl+Q',
					click: () => { bridge().electronApp().quit() }
				}]
			}, {
				label: _('Edit'),
				submenu: [{
					label: _('Copy'),
					role: 'copy',
					accelerator: 'CommandOrControl+C',
				}, {
					label: _('Cut'),
					role: 'cut',
					accelerator: 'CommandOrControl+X',
				}, {
					label: _('Paste'),
					role: 'paste',
					accelerator: 'CommandOrControl+V',
				}, {
					type: 'separator',
					screens: ['Main'],
				}, {
					label: _('Bold'),
					screens: ['Main'],
					accelerator: 'CommandOrControl+B',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'textBold',
						});
					},
				}, {
					label: _('Italic'),
					screens: ['Main'],
					accelerator: 'CommandOrControl+I',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'textItalic',
						});
					},
				}, {
					label: _('Insert Date Time'),
					screens: ['Main'],
					visible: false,
					accelerator: 'CommandOrControl+Shift+T',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'insertDateTime',
						});
					},
				}, {
					type: 'separator',
					screens: ['Main'],
				}, {
					label: _('Edit in external editor'),
					screens: ['Main'],
					accelerator: 'CommandOrControl+E',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'commandStartExternalEditing',
						});
					},
				}, {
					label: _('Search in all the notes'),
					screens: ['Main'],
					accelerator: 'CommandOrControl+F',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'focus_search',
						});
					},
				}],
			}, {
				label: _('View'),
				submenu: [{
					label: _('Toggle sidebar'),
					screens: ['Main'],
					accelerator: 'F10',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'toggleSidebar',
						});
					}
				}, {
					label: _('Toggle editor layout'),
					screens: ['Main'],
					accelerator: 'CommandOrControl+L',
					click: () => {
						this.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'toggleVisiblePanes',
						});
					}
				}, {
					type: 'separator',
					screens: ['Main'],
				}, {
					label: Setting.settingMetadata('notes.sortOrder.field').label(),
					screens: ['Main'],
					submenu: sortNoteItems,
				}, {
					label: Setting.settingMetadata('notes.sortOrder.reverse').label(),
					type: 'checkbox',
					checked: Setting.value('notes.sortOrder.reverse'),
					screens: ['Main'],
					click: () => {
						Setting.setValue('notes.sortOrder.reverse', !Setting.value('notes.sortOrder.reverse'));
					},
				}, {
					label: Setting.settingMetadata('uncompletedTodosOnTop').label(),
					type: 'checkbox',
					checked: Setting.value('uncompletedTodosOnTop'),
					screens: ['Main'],
					click: () => {
						Setting.setValue('uncompletedTodosOnTop', !Setting.value('uncompletedTodosOnTop'));
					},
				}, {
					label: Setting.settingMetadata('showCompletedTodos').label(),
					type: 'checkbox',
					checked: Setting.value('showCompletedTodos'),
					screens: ['Main'],
					click: () => {
						Setting.setValue('showCompletedTodos', !Setting.value('showCompletedTodos'));
					},
				}],
			}, {
				label: _('Tools'),
				submenu: [{
					label: _('Synchronisation status'),
					click: () => {
						this.dispatch({
							type: 'NAV_GO',
							routeName: 'Status',
						});
					}
				}, {
					type: 'separator',
					screens: ['Main'],
				}, {
					label: _('Web clipper options'),
					click: () => {
						this.dispatch({
							type: 'NAV_GO',
							routeName: 'ClipperConfig',
						});
					}
				}, {
					label: _('Encryption options'),
					click: () => {
						this.dispatch({
							type: 'NAV_GO',
							routeName: 'EncryptionConfig',
						});
					}
				}, {
					label: _('General Options'),
					accelerator: 'CommandOrControl+,',
					click: () => {
						this.dispatch({
							type: 'NAV_GO',
							routeName: 'Config',
						});
					}
				}],
			}, {
				label: _('Help'),
				submenu: [{
					label: _('Website and documentation'),
					accelerator: 'F1',
					click() { bridge().openExternal('https://joplin.cozic.net') }
				}, {
					label: _('Make a donation'),
					click() { bridge().openExternal('https://joplin.cozic.net/donate') }
				}, {
					label: _('Check for updates...'),
					click: () => {
						bridge().checkForUpdates(false, bridge().window(), this.checkForUpdateLoggerPath());
					}
				}, {
					type: 'separator',
					screens: ['Main'],
				}, {
					label: _('About Student Helper'),
					click: () => {
						const p = packageInfo;
						let message = [
							p.description,
							'',
							'Copyright © 2016-2018 Laurent Cozic',
							'Copyright © 2018 João Pedro Arruda, Nelson Siqueira, Sofia Moraes',
							_('%s %s (%s, %s)', p.name, p.version, Setting.value('env'), process.platform),
						];
						bridge().showInfoMessageBox(message.join('\n'), {
							icon: bridge().electronApp().buildDir() + '/icons/32x32.png',
						});
					}
				}]
			},
		];

		function isEmptyMenu(template) {
			for (let i = 0; i < template.length; i++) {
				const t = template[i];
				if (t.type !== 'separator') return false;
			}
			return true;
		}

		function removeUnwantedItems(template, screen) {
			const platform = shim.platformName();

			let output = [];
			for (let i = 0; i < template.length; i++) {
				const t = Object.assign({}, template[i]);
				if (t.screens && t.screens.indexOf(screen) < 0) continue;
				if (t.platforms && t.platforms.indexOf(platform) < 0) continue;
				if (t.submenu) t.submenu = removeUnwantedItems(t.submenu, screen);
				if (('submenu' in t) && isEmptyMenu(t.submenu)) continue;
				output.push(t);
			}

			// Remove empty separator for now empty sections
			let temp = [];
			let previous = null;
			for (let i = 0; i < output.length; i++) {
				const t = Object.assign({}, output[i]);
				if (t.type === 'separator') {
					if (!previous) continue;
					if (previous.type === 'separator') continue;
				}
				temp.push(t);
				previous = t;
			}
			output = temp;

			return output;
		}

		let screenTemplate = removeUnwantedItems(template, screen);

		const menu = Menu.buildFromTemplate(screenTemplate);
		Menu.setApplicationMenu(menu);

		this.lastMenuScreen_ = screen;
	}

	updateTray() {
		const app = bridge().electronApp();

		if (app.trayShown() === Setting.value('showTrayIcon')) return;

		if (!Setting.value('showTrayIcon')) {
			app.destroyTray();
		} else {
			const contextMenu = Menu.buildFromTemplate([
				{ label: _('Open %s', app.electronApp().getName()), click: () => { app.window().show(); } },
				{ type: 'separator' },
				{ label: _('Exit'), click: () => { app.quit() } },
			])
			app.createTray(contextMenu);
		}
	}

	updateEditorFont() {
		const fontFamilies = [];
		if (Setting.value('style.editor.fontFamily')) fontFamilies.push('"' + Setting.value('style.editor.fontFamily') + '"');
		fontFamilies.push('monospace');

		// The '*' and '!important' parts are necessary to make sure Russian text is displayed properly
		// https://github.com/laurent22/joplin/issues/155

		const css = '.ace_editor * { font-family: ' + fontFamilies.join(', ') + ' !important; }';
		const styleTag = document.createElement('style');
		styleTag.type = 'text/css';
		styleTag.appendChild(document.createTextNode(css));
		document.head.appendChild(styleTag);
	}

	async start(argv) {
		const electronIsDev = require('electron-is-dev');

		// If running inside a package, the command line, instead of being "node.exe <path> <flags>" is "joplin.exe <flags>" so
		// insert an extra argument so that they can be processed in a consistent way everywhere.
		if (!electronIsDev) argv.splice(1, 0, '.');

		argv = await super.start(argv);

		AlarmService.setDriver(new AlarmServiceDriverNode({ appName: packageInfo.build.appId }));
		AlarmService.setLogger(reg.logger());

		reg.setShowErrorMessageBoxHandler((message) => { bridge().showErrorMessageBox(message) });

		if (Setting.value('openDevTools')) {
			bridge().window().webContents.openDevTools();
		}

		this.updateMenu('Main');

		this.initRedux();

		// Since the settings need to be loaded before the store is created, it will never
		// receive the SETTING_UPDATE_ALL even, which mean state.settings will not be
		// initialised. So we manually call dispatchUpdateAll() to force an update.
		Setting.dispatchUpdateAll();

		await FoldersScreenUtils.refreshFolders();

		const tags = await Tag.allWithNotes();

		this.dispatch({
			type: 'TAG_UPDATE_ALL',
			items: tags,
		});

		const masterKeys = await MasterKey.all();

		this.dispatch({
			type: 'MASTERKEY_UPDATE_ALL',
			items: masterKeys,
		});

		this.store().dispatch({
			type: 'FOLDER_SELECT',
			id: Setting.value('activeFolderId'),
		});

		this.store().dispatch({
			type: 'FOLDER_SET_COLLAPSED_ALL',
			ids: Setting.value('collapsedFolderIds'),
		});

		if (shim.isLinux()) bridge().setAllowPowerSaveBlockerToggle(true);

		// Note: Auto-update currently doesn't work in Linux: it downloads the update
		// but then doesn't install it on exit.
		if (shim.isWindows() || shim.isMac()) {
			const runAutoUpdateCheck = () => {
				if (Setting.value('autoUpdateEnabled')) {
					bridge().checkForUpdates(true, bridge().window(), this.checkForUpdateLoggerPath());
				}
			}

			// Initial check on startup
			setTimeout(() => { runAutoUpdateCheck() }, 5000);
			// Then every x hours
			setInterval(() => { runAutoUpdateCheck() }, 12 * 60 * 60 * 1000);
		}

		this.updateTray();

		setTimeout(() => {
			AlarmService.garbageCollect();
		}, 1000 * 60 * 60);

		if (Setting.value('startMinimized') && Setting.value('showTrayIcon')) {
			bridge().window().hide();
		}

		ResourceService.runInBackground();

		if (Setting.value('env') === 'dev') {
			AlarmService.updateAllNotifications();
		} else {
			reg.scheduleSync().then(() => {
				// Wait for the first sync before updating the notifications, since synchronisation
				// might change the notifications.
				AlarmService.updateAllNotifications();

				DecryptionWorker.instance().scheduleStart();
			});
		}

		const clipperLogger = new Logger();
		clipperLogger.addTarget('file', { path: Setting.value('profileDir') + '/log-clipper.txt' });
		clipperLogger.addTarget('console');

		ClipperServer.instance().setLogger(clipperLogger);
		ClipperServer.instance().setDispatch(this.store().dispatch);

		if (Setting.value('clipperServer.autoStart')) {
			ClipperServer.instance().start();
		}
	}

}

let application_ = null;

function app() {
	if (!application_) application_ = new Application();
	return application_;
}

module.exports = { app };
