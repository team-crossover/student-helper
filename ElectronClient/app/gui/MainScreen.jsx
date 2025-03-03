const React = require('react');
const { connect } = require('react-redux');
const { Header } = require('./Header.min.js');
const { SideBar } = require('./SideBar.min.js');
const { NoteList } = require('./NoteList.min.js');
const { NoteText } = require('./NoteText.min.js');
const { PromptDialog } = require('./PromptDialog.min.js');
const NotePropertiesDialog = require('./NotePropertiesDialog.min.js');
const Setting = require('lib/models/Setting.js');
const BaseModel = require('lib/BaseModel.js');
const Tag = require('lib/models/Tag.js');
const Note = require('lib/models/Note.js');
const { uuid } = require('lib/uuid.js');
const Folder = require('lib/models/Folder.js');
const { themeStyle } = require('../theme.js');
const { _ } = require('lib/locale.js');
const layoutUtils = require('lib/layout-utils.js');
const { bridge } = require('electron').remote.require('./bridge');
const eventManager = require('../eventManager');
const StudentHelperUtils = require('lib/StudentHelperUtils.js');

class MainScreenComponent extends React.Component {

	constructor() {
		super();

		this.notePropertiesDialog_close = this.notePropertiesDialog_close.bind(this);
	}

	notePropertiesDialog_close() {
		this.setState({ notePropertiesDialogOptions: {} });
	}

	componentWillMount() {
		this.setState({
			promptOptions: null,
			modalLayer: {
				visible: false,
				message: '',
			},
			notePropertiesDialogOptions: {},
		});
	}

	componentWillReceiveProps(newProps) {
		if (newProps.windowCommand) {
			this.doCommand(newProps.windowCommand);
		}
	}

	toggleVisiblePanes() {
		this.props.dispatch({
			type: 'NOTE_VISIBLE_PANES_TOGGLE',
		});
	}

	toggleSidebar() {
		this.props.dispatch({
			type: 'SIDEBAR_VISIBILITY_TOGGLE',
		});
	}

	async doCommand(command) {
		if (!command) return;

		const createNewNote = async (title, isTodo) => {
			const folderId = Setting.value('activeFolderId');
			if (!folderId) return;

			const newNote = {
				parent_id: folderId,
				is_todo: isTodo ? 1 : 0,
			};

			this.props.dispatch({
				type: 'NOTE_SET_NEW_ONE',
				item: newNote,
			});
		}

		let commandProcessed = true;

		if (command.name === 'newNote') {
			if (!this.props.folders.length) {
				bridge().showErrorMessageBox(_('Please create a notebook first.'));
				return;
			}

			await createNewNote(null, false);

		} else if (command.name === 'newTodo') {
			if (!this.props.folders.length) {
				bridge().showErrorMessageBox(_('Please create a notebook first'));
				return;
			}

			await createNewNote(null, true);

		} else if (command.name === 'newSemester') {
			this.setState({
				promptOptions: {
					label: _('Semester title:'),
					onClose: async (answer) => {
						if (answer) {
							let folder = null;
							try {
								folder = await Folder.save({ title: answer }, { userSideValidation: true });
							} catch (error) {
								bridge().showErrorMessageBox(error.message);
							}

							if (folder) {
								this.props.dispatch({
									type: 'FOLDER_SELECT',
									id: folder.id,
								});
							}
						}

						this.setState({ promptOptions: null });
					}
				},
			});

		} else if (command.name === 'newCourse') {
			const semesterId = Setting.value('activeFolderId');
			if (!semesterId) return;

			this.setState({
				promptOptions: {
					label: _('Course title:'),
					onClose: async (answer) => {
						if (answer) {
							let folder = Folder.newFolder();
							folder.title = answer;
							folder.parent_id = semesterId;
							try {
								folder = await Folder.save(folder, { userSideValidation: true });
							} catch (error) {
								bridge().showErrorMessageBox(error.message);
							}

							if (folder) {
								this.props.dispatch({
									type: 'FOLDER_SELECT',
									id: folder.id,
								});
							}
						}

						this.setState({ promptOptions: null });
					}
				},
			});

		} else if (command.name === 'setTags') {
			const tags = await Tag.tagsByNoteId(command.noteId);
			const tagTitles = tags.map((a) => { return a.title });

			this.setState({
				promptOptions: {
					label: _('Add or remove tags:'),
					description: _('Separate each tag by a comma.'),
					value: tagTitles.join(', '),
					onClose: async (answer) => {
						if (answer !== null) {
							const tagTitles = answer.split(',').map((a) => { return a.trim() });
							await Tag.setNoteTagsByTitles(command.noteId, tagTitles);
						}
						this.setState({ promptOptions: null });
					}
				},
			});

		} else if (command.name === 'renameFolder') {
			const folder = await Folder.load(command.id);
			if (!folder) return;

			this.setState({
				promptOptions: {
					label: _('New name:'),
					value: folder.title,
					onClose: async (answer) => {
						if (answer !== null) {
							try {
								folder.title = answer;
								await Folder.save(folder, { fields: ['title'], userSideValidation: true });
							} catch (error) {
								bridge().showErrorMessageBox(error.message);
							}
						}
						this.setState({ promptOptions: null });
					}
				},
			});

		} else if (command.name === 'renameTag') {
			const tag = await Tag.load(command.id);
			if (!tag) return;

			this.setState({
				promptOptions: {
					label: _('Rename tag:'),
					value: tag.title,
					onClose: async (answer) => {
						if (answer !== null) {
							try {
								tag.title = answer;
								await Tag.save(tag, { fields: ['title'], userSideValidation: true });
							} catch (error) {
								bridge().showErrorMessageBox(error.message);
							}
						}
						this.setState({ promptOptions: null });
					}
				}
			})

		} else if (command.name === 'search') {

			if (!this.searchId_) this.searchId_ = uuid.create();

			this.props.dispatch({
				type: 'SEARCH_UPDATE',
				search: {
					id: this.searchId_,
					title: command.query,
					query_pattern: command.query,
					query_folder_id: null,
					type_: BaseModel.TYPE_SEARCH,
				},
			});

			if (command.query) {
				this.props.dispatch({
					type: 'SEARCH_SELECT',
					id: this.searchId_,
				});
			}

		} else if (command.name === 'commandNoteProperties') {
			this.setState({
				notePropertiesDialogOptions: {
					noteId: command.noteId,
					visible: true,
				},
			});
		} else if (command.name === 'toggleVisiblePanes') {
			this.toggleVisiblePanes();
		} else if (command.name === 'toggleSidebar') {
			this.toggleSidebar();
		} else if (command.name === 'showModalMessage') {
			this.setState({ modalLayer: { visible: true, message: command.message } });
		} else if (command.name === 'hideModalMessage') {
			this.setState({ modalLayer: { visible: false, message: '' } });
		} else if (command.name === 'editAlarm') {
			const note = await Note.load(command.noteId);

			let defaultDate = new Date(Date.now() + 2 * 3600 * 1000);
			defaultDate.setMinutes(0);
			defaultDate.setSeconds(0);

			this.setState({
				promptOptions: {
					label: _('Set alarm:'),
					inputType: 'datetime',
					buttons: ['ok', 'cancel', 'clear'],
					value: note.todo_due ? new Date(note.todo_due) : defaultDate,
					onClose: async (answer, buttonType) => {
						let newNote = null;

						if (buttonType === 'clear') {
							newNote = {
								id: note.id,
								todo_due: 0,
							};
						} else if (answer !== null) {
							newNote = {
								id: note.id,
								todo_due: answer.getTime(),
							};
						}

						if (newNote) {
							await Note.save(newNote);
							eventManager.emit('alarmChange', { noteId: note.id });
						}

						this.setState({ promptOptions: null });
					}
				},
			});
		} else if (command.name === 'addCalendarEvent') {
			const note = await Note.load(command.noteId);
			const shared = require('lib/components/shared/note-screen-shared.js');
			await shared.addCalendarEvent(this, note);

		} else {
			commandProcessed = false;
		}

		if (commandProcessed) {
			this.props.dispatch({
				type: 'WINDOW_COMMAND',
				name: null,
			});
		}
	}

	styles(themeId, width, height, messageBoxVisible, isSidebarVisible) {
		const styleKey = themeId + '_' + width + '_' + height + '_' + messageBoxVisible + '_' + (+isSidebarVisible);
		if (styleKey === this.styleKey_) return this.styles_;

		const theme = themeStyle(themeId);

		this.styleKey_ = styleKey;

		this.styles_ = {};

		this.styles_.header = {
			width: width,
		};

		this.styles_.messageBox = {
			width: width,
			height: 30,
			display: 'flex',
			alignItems: 'center',
			paddingLeft: 10,
			backgroundColor: theme.warningBackgroundColor,
		}

		const rowHeight = height - theme.headerHeight - (messageBoxVisible ? this.styles_.messageBox.height : 0);

		this.styles_.sideBar = {
			width: Math.floor(layoutUtils.size(width * .2, 150, 300)),
			height: rowHeight,
			display: 'inline-block',
			verticalAlign: 'top',
		};

		if (isSidebarVisible === false) {
			this.styles_.sideBar.width = 0;
			this.styles_.sideBar.display = 'none';
		}

		this.styles_.noteList = {
			width: Math.floor(layoutUtils.size(width * .2, 150, 300)),
			height: rowHeight,
			display: 'inline-block',
			verticalAlign: 'top',
		};

		this.styles_.noteText = {
			width: Math.floor(layoutUtils.size(width - this.styles_.sideBar.width - this.styles_.noteList.width, 0)),
			height: rowHeight,
			display: 'inline-block',
			verticalAlign: 'top',
		};

		this.styles_.prompt = {
			width: width,
			height: height,
		};

		this.styles_.modalLayer = Object.assign({}, theme.textStyle, {
			zIndex: 10000,
			position: 'absolute',
			top: 0,
			left: 0,
			backgroundColor: theme.backgroundColor,
			width: width - 20,
			height: height - 20,
			padding: 10,
		});

		return this.styles_;
	}

	render() {
		const style = this.props.style;
		const promptOptions = this.state.promptOptions;
		const folders = this.props.folders;
		const notes = this.props.notes;
		const messageBoxVisible = this.props.hasDisabledSyncItems || this.props.showMissingMasterKeyMessage;
		const sidebarVisibility = this.props.sidebarVisibility;
		const styles = this.styles(this.props.theme, style.width, style.height, messageBoxVisible, sidebarVisibility);
		const theme = themeStyle(this.props.theme);
		const selectedFolderId = this.props.selectedFolderId;
		const notesParentType = this.props.notesParentType;
		const onConflictFolder = this.props.selectedFolderId === Folder.conflictFolderId();
		const isSemesterSelected = StudentHelperUtils.isSemesterSelected(selectedFolderId, folders, notesParentType);
		const isCourseSelected = StudentHelperUtils.isCourseSelected(selectedFolderId, folders, notesParentType);

		const headerItems = [];

		headerItems.push({
			title: _('Toggle sidebar'),
			iconName: 'fa-bars',
			iconRotation: this.props.sidebarVisibility ? 0 : 90,
			onClick: () => { this.doCommand({ name: 'toggleSidebar' }) }
		});

		headerItems.push({
			title: _('New semester'),
			iconName: 'fa-calendar-o',
			onClick: () => { this.doCommand({ name: 'newSemester' }) },
		});

		headerItems.push({
			title: _('New course'),
			iconName: 'fa-graduation-cap',
			enabled: isSemesterSelected,
			onClick: () => { this.doCommand({ name: 'newCourse' }) },
		});

		headerItems.push({
			title: _('New assignment'),
			iconName: 'fa-clock-o',
			enabled: isCourseSelected && !!folders.length && !onConflictFolder,
			onClick: () => { this.doCommand({ name: 'newTodo' }) },
		});

		headerItems.push({
			title: _('New note'),
			iconName: 'fa-file-o',
			enabled: isCourseSelected && !!folders.length && !onConflictFolder,
			onClick: () => { this.doCommand({ name: 'newNote' }) },
		});

		headerItems.push({
			title: _('Toggle layout'),
			iconName: 'fa-columns',
			enabled: !!notes.length,
			onClick: () => { this.doCommand({ name: 'toggleVisiblePanes' }) },
		});

		headerItems.push({
			title: _('Search...'),
			iconName: 'fa-search',
			onQuery: (query) => { this.doCommand({ name: 'search', query: query }) },
			type: 'search',
		});

		if (!this.promptOnClose_) {
			this.promptOnClose_ = (answer, buttonType) => {
				return this.state.promptOptions.onClose(answer, buttonType);
			}
		}

		const onViewDisabledItemsClick = () => {
			this.props.dispatch({
				type: 'NAV_GO',
				routeName: 'Status',
			});
		}

		const onViewMasterKeysClick = () => {
			this.props.dispatch({
				type: 'NAV_GO',
				routeName: 'EncryptionConfig',
			});
		}

		let messageComp = null;

		if (messageBoxVisible) {
			let msg = null;
			if (this.props.hasDisabledSyncItems) {
				msg = <span>{_('Some items cannot be synchronised.')} <a href="#" onClick={() => { onViewDisabledItemsClick() }}>{_('View them now')}</a></span>
			} else if (this.props.showMissingMasterKeyMessage) {
				msg = <span>{_('Some items cannot be decrypted.')} <a href="#" onClick={() => { onViewMasterKeysClick() }}>{_('Set the password')}</a></span>
			}

			messageComp = (
				<div style={styles.messageBox}>
					<span style={theme.textStyle}>
						{msg}
					</span>
				</div>
			);
		}

		const modalLayerStyle = Object.assign({}, styles.modalLayer, { display: this.state.modalLayer.visible ? 'block' : 'none' });

		const notePropertiesDialogOptions = this.state.notePropertiesDialogOptions;

		return (
			<div style={style}>
				<div style={modalLayerStyle}>{this.state.modalLayer.message}</div>

				<NotePropertiesDialog
					theme={this.props.theme}
					noteId={notePropertiesDialogOptions.noteId}
					visible={!!notePropertiesDialogOptions.visible}
					onClose={this.notePropertiesDialog_close}
				/>

				<PromptDialog
					autocomplete={promptOptions && ('autocomplete' in promptOptions) ? promptOptions.autocomplete : null}
					defaultValue={promptOptions && promptOptions.value ? promptOptions.value : ''}
					theme={this.props.theme}
					style={styles.prompt}
					onClose={this.promptOnClose_}
					label={promptOptions ? promptOptions.label : ''}
					description={promptOptions ? promptOptions.description : null}
					visible={!!this.state.promptOptions}
					buttons={promptOptions && ('buttons' in promptOptions) ? promptOptions.buttons : null}
					inputType={promptOptions && ('inputType' in promptOptions) ? promptOptions.inputType : null} />

				<Header style={styles.header} showBackButton={false} items={headerItems} />
				{messageComp}
				<SideBar style={styles.sideBar} />
				<NoteList style={styles.noteList} />
				<NoteText style={styles.noteText} visiblePanes={this.props.noteVisiblePanes} />
			</div>
		);
	}

}

const mapStateToProps = (state) => {
	return {
		theme: state.settings.theme,
		windowCommand: state.windowCommand,
		noteVisiblePanes: state.noteVisiblePanes,
		sidebarVisibility: state.sidebarVisibility,
		folders: state.folders,
		notes: state.notes,
		hasDisabledSyncItems: state.hasDisabledSyncItems,
		showMissingMasterKeyMessage: state.notLoadedMasterKeys.length && state.masterKeys.length,
		selectedFolderId: state.selectedFolderId,
		sidebarVisibility: state.sidebarVisibility,
		notesParentType: state.notesParentType,
	};
};

const MainScreen = connect(mapStateToProps)(MainScreenComponent);

module.exports = { MainScreen };
