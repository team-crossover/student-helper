const React = require("react");
const { connect } = require("react-redux");
const shared = require("lib/components/shared/side-menu-shared.js");
const { Synchronizer } = require("lib/synchronizer.js");
const BaseModel = require("lib/BaseModel.js");
const Folder = require("lib/models/Folder.js");
const Note = require("lib/models/Note.js");
const Tag = require("lib/models/Tag.js");
const { _ } = require("lib/locale.js");
const { themeStyle } = require("../theme.js");
const { bridge } = require("electron").remote.require("./bridge");
const Menu = bridge().Menu;
const MenuItem = bridge().MenuItem;
const InteropServiceHelper = require("../InteropServiceHelper.js");
const StudentHelperUtils = require("lib/StudentHelperUtils.js");

class SideBarComponent extends React.Component {


	constructor() {
		super();

		this.onFolderDragStart_ = (event) => {
			const folderId = event.currentTarget.getAttribute('folderid');
			if (!folderId) return;

			event.dataTransfer.setDragImage(new Image(), 1, 1);
			event.dataTransfer.clearData();
			event.dataTransfer.setData('text/x-jop-folder-ids', JSON.stringify([folderId]));
		};

		this.onFolderDragOver_Semester = (event) => {
			if (event.dataTransfer.types.indexOf("text/x-jop-folder-ids") >= 0) event.preventDefault();
		};

		this.onFolderDragOver_Course = (event) => {
			if (event.dataTransfer.types.indexOf("text/x-jop-note-ids") >= 0) event.preventDefault();
		};

		this.onFolderDrop_Semester = async (event) => {
			const folderId = event.currentTarget.getAttribute('folderid');
			const dt = event.dataTransfer;
			if (!dt) return;

			if (dt.types.indexOf("text/x-jop-folder-ids") >= 0) {
				event.preventDefault();

				const folderIds = JSON.parse(dt.getData("text/x-jop-folder-ids"));
				for (let i = 0; i < folderIds.length; i++) {
					await Folder.moveToFolder(folderIds[i], folderId);
				}
			}
		};

		this.onFolderDrop_Course = async (event) => {
			const folderId = event.currentTarget.getAttribute('folderid');
			const dt = event.dataTransfer;
			if (!dt) return;

			if (dt.types.indexOf("text/x-jop-note-ids") >= 0) {
				event.preventDefault();

				const noteIds = JSON.parse(dt.getData("text/x-jop-note-ids"));
				for (let i = 0; i < noteIds.length; i++) {
					await Note.moveToFolder(noteIds[i], folderId);
				}
			}
		};

		this.onTagDrop_ = async (event) => {
			const tagId = event.currentTarget.getAttribute('tagid');
			const dt = event.dataTransfer;
			if (!dt) return;

			if (dt.types.indexOf("text/x-jop-note-ids") >= 0) {
				event.preventDefault();

				const noteIds = JSON.parse(dt.getData("text/x-jop-note-ids"));
				for (let i = 0; i < noteIds.length; i++) {
					await Tag.addNote(tagId, noteIds[i]);
				}
			}
		}

		this.onFolderToggleClick_ = async (event) => {
			const folderId = event.currentTarget.getAttribute('folderid');

			this.props.dispatch({
				type: 'FOLDER_TOGGLE',
				id: folderId,
			});
		};
	}

	style() {
		const theme = themeStyle(this.props.theme);

		const itemHeight = 25;

		let style = {
			root: {
				backgroundColor: theme.backgroundColor2,
			},
			listItemContainer: {
				boxSizing: "border-box",
				height: itemHeight,
				// paddingLeft: 14,
				display: "flex",
				alignItems: "stretch",
			},
			listItem: {
				fontFamily: theme.fontFamily,
				fontSize: theme.fontSize,
				textDecoration: "none",
				color: theme.color2,
				cursor: "default",
				opacity: 0.8,
				whiteSpace: "nowrap",
				display: "flex",
				flex: 1,
				alignItems: 'center',
			},
			listItemSelected: {
				backgroundColor: theme.selectedColor2,
			},
			listItemSemester: {
				fontWeight: "bold",
			},
			listItemExpandIcon: {
				color: theme.color2,
				cursor: "default",
				opacity: 0.8,
				// fontFamily: theme.fontFamily,
				fontSize: theme.fontSize,
				textDecoration: "none",
				paddingRight: 5,
				display: "flex",
				alignItems: 'center',
			},
			conflictFolder: {
				color: theme.colorError2,
				fontWeight: "bold",
			},
			header: {
				height: itemHeight * 1.8,
				fontFamily: theme.fontFamily,
				fontSize: theme.fontSize * 1.3,
				textDecoration: "none",
				boxSizing: "border-box",
				color: theme.color2,
				paddingLeft: 8,
				display: "flex",
				alignItems: "center",
			},
			button: {
				padding: 6,
				fontFamily: theme.fontFamily,
				fontSize: theme.fontSize,
				textDecoration: "none",
				boxSizing: "border-box",
				color: theme.color2,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				border: "1px solid rgba(255,255,255,0.2)",
				marginTop: 10,
				marginLeft: 5,
				marginRight: 5,
				cursor: "default",
			},
			syncReport: {
				fontFamily: theme.fontFamily,
				fontSize: Math.round(theme.fontSize * 0.9),
				color: theme.color2,
				opacity: 0.5,
				display: "flex",
				alignItems: "left",
				justifyContent: "top",
				flexDirection: "column",
				marginTop: 10,
				marginLeft: 5,
				marginRight: 5,
				minHeight: 70,
				wordWrap: "break-word",
				//width: "100%",
			},
		};

		style.tagItem = Object.assign({}, style.listItem);
		style.tagItem.paddingLeft = 23;
		style.tagItem.height = itemHeight;

		return style;
	}

	coursesHeaderContextMenu(event) {
		const menu = new Menu();

		menu.append(
			new MenuItem({
				label: _("New semester"),
				click: async () => {
					this.props.dispatch({
						type: 'WINDOW_COMMAND',
						name: 'newSemester',
					});
				},
			})
		);

		menu.popup(bridge().window());
	}

	itemContextMenu(event) {
		const itemId = event.target.getAttribute("data-id");
		if (itemId === Folder.conflictFolderId()) return;

		const itemType = Number(event.target.getAttribute("data-type"));
		if (!itemId || !itemType) throw new Error("No data on element");

		let deleteMessage = "";
		if (itemType === BaseModel.TYPE_FOLDER) {
			deleteMessage = _("Delete notebook? All notes and sub-notebooks within this notebook will also be deleted.");
		} else if (itemType === BaseModel.TYPE_TAG) {
			deleteMessage = _("Remove this tag from all the notes?");
		} else if (itemType === BaseModel.TYPE_SEARCH) {
			deleteMessage = _("Remove this search from the sidebar?");
		}

		const menu = new Menu();

		let item = null;
		if (itemType === BaseModel.TYPE_FOLDER) {
			item = BaseModel.byId(this.props.folders, itemId);
		}

		const isSemesterFolder = itemType === BaseModel.TYPE_FOLDER && StudentHelperUtils.isSemesterFolder(itemId, this.props.folders);
		const isCourseFolder = itemType === BaseModel.TYPE_FOLDER && StudentHelperUtils.isCourseFolder(itemId, this.props.folders);

		if (isSemesterFolder) {
			menu.append(
				new MenuItem({
					label: _("New course"),
					click: async () => {
						await this.props.dispatch({
							type: 'FOLDER_SELECT',
							id: itemId,
						});
						this.props.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newCourse',
						});
					},
				})
			);

			menu.append(new MenuItem({ type: "separator" }));
		}
		else if (isCourseFolder) {
			menu.append(
				new MenuItem({
					label: _("New assignment"),
					click: async () => {
						await this.props.dispatch({
							type: 'FOLDER_SELECT',
							id: itemId,
						});
						this.props.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newTodo',
						});
					},
				})
			);

			menu.append(
				new MenuItem({
					label: _("New note"),
					click: async () => {
						await this.props.dispatch({
							type: 'FOLDER_SELECT',
							id: itemId,
						});
						this.props.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newNote',
						});
					},
				})
			);

			menu.append(new MenuItem({ type: "separator" }));
		}

		menu.append(
			new MenuItem({
				label: _("Delete"),
				click: async () => {
					const ok = bridge().showConfirmMessageBox(deleteMessage);
					if (!ok) return;

					if (itemType === BaseModel.TYPE_FOLDER) {
						await Folder.delete(itemId);
					} else if (itemType === BaseModel.TYPE_TAG) {
						await Tag.untagAll(itemId);
					} else if (itemType === BaseModel.TYPE_SEARCH) {
						this.props.dispatch({
							type: "SEARCH_DELETE",
							id: itemId,
						});
					}
				},
			})
		);

		if (itemType === BaseModel.TYPE_FOLDER && !item.encryption_applied) {
			menu.append(
				new MenuItem({
					label: _("Rename"),
					click: async () => {
						this.props.dispatch({
							type: "WINDOW_COMMAND",
							name: "renameFolder",
							id: itemId,
						});
					},
				})
			);

			// menu.append(
			// 	new MenuItem({
			// 		label: _("Move"),
			// 		click: async () => {
			// 			this.props.dispatch({
			// 				type: "WINDOW_COMMAND",
			// 				name: "renameFolder",
			// 				id: itemId,
			// 			});
			// 		},
			// 	})
			// );

			menu.append(new MenuItem({ type: "separator" }));

			const InteropService = require("lib/services/InteropService.js");

			const exportMenu = new Menu();
			const ioService = new InteropService();
			const ioModules = ioService.modules();
			for (let i = 0; i < ioModules.length; i++) {
				const module = ioModules[i];
				if (module.type !== 'exporter') continue;

				exportMenu.append(new MenuItem({
					label: module.fullLabel(), click: async () => {
						await InteropServiceHelper.export(this.props.dispatch.bind(this), module, { sourceFolderIds: [itemId] });
					}
				}));
			}

			menu.append(
				new MenuItem({
					label: _("Export"),
					submenu: exportMenu,
				})
			);
		}

		if (itemType === BaseModel.TYPE_TAG) {
			menu.append(
				new MenuItem({
					label: _('Rename'),
					click: async () => {
						this.props.dispatch({
							type: "WINDOW_COMMAND",
							name: "renameTag",
							id: itemId
						});
					},
				})
			);
		}

		menu.popup(bridge().window());
	}

	folderItem_click(folder) {
		this.props.dispatch({
			type: "FOLDER_SELECT",
			id: folder ? folder.id : null,
		});
	}

	tagItem_click(tag) {
		this.props.dispatch({
			type: "TAG_SELECT",
			id: tag ? tag.id : null,
		});
	}

	searchItem_click(search) {
		this.props.dispatch({
			type: "SEARCH_SELECT",
			id: search ? search.id : null,
		});
	}

	async sync_click() {
		await shared.synchronize_press(this);
	}

	folderItem(folder, selected, hasChildren, depth) {
		const isSemesterFolder = (depth == 0);

		let style = Object.assign({}, this.style().listItem);
		if (isSemesterFolder) style = Object.assign(style, this.style().listItemSemester);
		if (folder.id === Folder.conflictFolderId()) style = Object.assign(style, this.style().conflictFolder);

		const itemTitle = Folder.displayTitle(folder);

		let containerStyle = Object.assign({}, this.style().listItemContainer);
		// containerStyle.paddingLeft = containerStyle.paddingLeft + depth * 10;

		if (selected) containerStyle = Object.assign(containerStyle, this.style().listItemSelected);

		let expandLinkStyle = Object.assign({}, this.style().listItemExpandIcon);
		let expandIconStyle = {
			visibility: hasChildren ? 'visible' : 'hidden',
			paddingLeft: 8 + depth * 10,
		}

		const iconName = this.props.collapsedFolderIds.indexOf(folder.id) >= 0 ? 'fa-plus-square' : 'fa-minus-square';
		const expandIcon = <i style={expandIconStyle} className={"fa " + iconName}></i>
		const expandLink = hasChildren ? <a style={expandLinkStyle} href="#" folderid={folder.id} onClick={this.onFolderToggleClick_}>{expandIcon}</a> : <span style={expandLinkStyle}>{expandIcon}</span>

		return (
			<div className="list-item-container"
				style={containerStyle}
				key={folder.id}
				onDragStart={this.onFolderDragStart_}
				onDragOver={isSemesterFolder ? this.onFolderDragOver_Semester : this.onFolderDragOver_Course}
				onDrop={isSemesterFolder ? this.onFolderDrop_Semester : this.onFolderDrop_Course}
				draggable={!isSemesterFolder}
				folderid={folder.id}>
				{expandLink}
				<a className="list-item"
					href="#"
					data-id={folder.id}
					data-type={BaseModel.TYPE_FOLDER}
					onContextMenu={event => this.itemContextMenu(event)}
					style={style}
					folderid={folder.id}
					onClick={() => {
						this.folderItem_click(folder);
					}}
					onDoubleClick={this.onFolderToggleClick_}>
					{itemTitle}
				</a>
			</div>
		);
	}

	tagItem(tag, selected) {
		let style = Object.assign({}, this.style().tagItem);
		if (selected) style = Object.assign(style, this.style().listItemSelected);
		return (
			<a
				className="list-item"
				href="#"
				data-id={tag.id}
				data-type={BaseModel.TYPE_TAG}
				onContextMenu={event => this.itemContextMenu(event)}
				tagid={tag.id}
				key={tag.id}
				style={style}
				onDrop={this.onTagDrop_}
				onClick={() => {
					this.tagItem_click(tag);
				}}
			>
				{Tag.displayTitle(tag)}
			</a>
		);
	}

	searchItem(search, selected) {
		let style = Object.assign({}, this.style().listItem);
		if (selected) style = Object.assign(style, this.style().listItemSelected);
		return (
			<a
				className="list-item"
				href="#"
				data-id={search.id}
				data-type={BaseModel.TYPE_SEARCH}
				onContextMenu={event => this.itemContextMenu(event)}
				key={search.id}
				style={style}
				onClick={() => {
					this.searchItem_click(search);
				}}
			>
				{search.title}
			</a>
		);
	}

	makeDivider(key) {
		return <div style={{ height: 2, backgroundColor: "blue" }} key={key} />;
	}

	makeHeader(key, label, iconName, extraProps = {}) {
		const style = this.style().header;
		const icon = <i style={{ fontSize: style.fontSize * 1.2, marginRight: 5 }} className={"fa " + iconName} />;
		return (
			<div style={style} key={key} {...extraProps}>
				{icon}
				{label}
			</div>
		);
	}

	synchronizeButton(type) {
		const style = this.style().button;
		const iconName = type === "sync" ? "fa-refresh" : "fa-times";
		const label = type === "sync" ? _("Synchronise") : _("Cancel");
		const icon = <i style={{ fontSize: style.fontSize, marginRight: 5 }} className={"fa " + iconName} />;
		return (
			<a
				className="synchronize-button"
				style={style}
				href="#"
				key="sync_button"
				onClick={() => {
					this.sync_click();
				}}
			>
				{icon}
				{label}
			</a>
		);
	}

	render() {
		const theme = themeStyle(this.props.theme);
		const style = Object.assign({}, this.style().root, this.props.style, {
			overflowX: "hidden",
			overflowY: "auto",
		});

		let items = [];

		items.push(this.makeHeader("folderHeader", _("Courses"), "fa-graduation-cap", {
			onDrop: this.onFolderDrop_,
			onContextMenu: (event) => { this.coursesHeaderContextMenu(event) },
			folderid: '',
		}));

		if (this.props.folders.length) {
			const folderItems = shared.renderFolders(this.props, this.folderItem.bind(this));
			items = items.concat(folderItems);
		}

		items.push(this.makeHeader("tagHeader", _("Tags"), "fa-tags"));

		if (this.props.tags.length) {
			const tagItems = shared.renderTags(this.props, this.tagItem.bind(this));

			items.push(
				<div className="tags" key="tag_items">
					{tagItems}
				</div>
			);
		}

		let lines = Synchronizer.reportToLines(this.props.syncReport);
		const syncReportText = [];
		for (let i = 0; i < lines.length; i++) {
			syncReportText.push(
				<div key={i} style={{ wordWrap: "break-word", width: "100%" }}>
					{lines[i]}
				</div>
			);
		}

		items.push(this.synchronizeButton(this.props.syncStarted ? "cancel" : "sync"));

		items.push(
			<div style={this.style().syncReport} key="sync_report">
				{syncReportText}
			</div>
		);

		return (
			<div className="side-bar" style={style}>
				{items}
			</div>
		);
	}
}

const mapStateToProps = state => {
	return {
		folders: state.folders,
		tags: state.tags,
		searches: state.searches,
		syncStarted: state.syncStarted,
		syncReport: state.syncReport,
		selectedFolderId: state.selectedFolderId,
		selectedTagId: state.selectedTagId,
		selectedSearchId: state.selectedSearchId,
		notesParentType: state.notesParentType,
		locale: state.settings.locale,
		theme: state.settings.theme,
		collapsedFolderIds: state.collapsedFolderIds,
	};
};

const SideBar = connect(mapStateToProps)(SideBarComponent);

module.exports = { SideBar };
