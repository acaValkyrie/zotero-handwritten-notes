var HandwrittenNotes = {
  id: null,
  version: null,
  rootURI: null,
  core: null,
  l10n: null,
  menuID: null,
  busy: new Set(),

  init({ id, version, rootURI, core }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.core = core;
    this.l10n = new Localization(["handwritten-notes.ftl"], true);
  },

  log(msg) {
    Zotero.debug("[Handwritten Notes] " + msg);
  },

  str(id, args) {
    return this.l10n.formatValueSync(id, args);
  },

  // Windows

  addToWindow(window) {
    window.MozXULElement.insertFTLIfNeeded("handwritten-notes.ftl");
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="handwritten-notes.ftl"]')?.remove();
  },

  addToAllWindows() {
    for (const win of Zotero.getMainWindows()) {
      this.addToWindow(win);
    }
  },

  removeFromAllWindows() {
    for (const win of Zotero.getMainWindows()) {
      this.removeFromWindow(win);
    }
  },

  // Menus

  registerMenus() {
    const selectedItem = (context) => (context.items?.length === 1 ? context.items[0] : null);
    const run = (fn) => (event, context) => {
      const win = event.target.ownerGlobal;
      const item = selectedItem(context);
      if (!item) return;
      this.runCommand(win, item, fn);
    };

    const registered = Zotero.MenuManager.registerMenu({
      menuID: "handwritten-notes-item-menu",
      pluginID: this.id,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "handwritten-notes-menu-create",
          onShowing: (event, context) => {
            const item = selectedItem(context);
            context.setVisible(!!item && item.isRegularItem());
          },
          onCommand: run((win, item) => this.createNotes(win, item))
        },
        {
          menuType: "menuitem",
          l10nID: "handwritten-notes-menu-add-page",
          onShowing: (event, context) => {
            const item = selectedItem(context);
            context.setVisible(!!item && item.isAttachment() && item.isPDFAttachment());
          },
          onCommand: run((win, item) => this.addPage(win, item))
        }
      ]
    });
    this.menuID = registered || null;
    if (!registered) {
      this.log("Menu registration failed");
    }
  },

  unregisterMenus() {
    if (this.menuID) {
      Zotero.MenuManager.unregisterMenu(this.menuID);
      this.menuID = null;
    }
  },

  async runCommand(win, item, fn) {
    if (this.busy.has(item.id)) {
      return;
    }
    this.busy.add(item.id);
    try {
      await fn(win, item);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, "generic");
    }
    finally {
      this.busy.delete(item.id);
    }
  },

  // UI helpers

  alert(win, key) {
    Services.prompt.alert(
      win,
      this.str("handwritten-notes-error-title"),
      this.str("handwritten-notes-error-" + key)
    );
  },

  errorKey(e) {
    switch (e?.code) {
      case "ENCRYPTED": return "encrypted";
      case "PARSE_FAILED": return "read-failed";
      case "UNSUPPORTED_STRUCTURE": return "unsupported";
      case "VALIDATION_FAILED":
      case "INVALID_STYLE": return "generate-failed";
      default: return "generic";
    }
  },

  showProgress(win, text) {
    const pw = new Zotero.ProgressWindow({ window: win });
    pw.changeHeadline(this.str("handwritten-notes-progress-title"));
    pw.addDescription(text);
    pw.show();
    pw.startCloseTimer(4000);
  },

  checkLibraryEditable(win, item) {
    const library = Zotero.Libraries.get(item.libraryID);
    if (!library.editable || !library.filesEditable) {
      this.alert(win, "not-editable");
      return false;
    }
    return true;
  },

  async promptPaperStyle(win, { mode, notice = null }) {
    const io = { mode, notice, defaultStyle: "blank", result: null };
    win.openDialog(
      "chrome://handwritten-notes/content/paper-style-dialog.xhtml",
      "",
      "chrome,modal,centerscreen",
      io
    );
    return io.result;
  },

  async removeQuietly(path, options) {
    try {
      await IOUtils.remove(path, options);
    }
    catch (e) {
      Zotero.logError(e);
    }
  },

  randomSuffix() {
    return Date.now() + "-" + Math.random().toString(36).slice(2);
  },

  // Create Handwritten Notes

  async createNotes(win, parentItem) {
    if (!this.checkLibraryEditable(win, parentItem)) return;

    const style = await this.promptPaperStyle(win, { mode: "create" });
    if (!style) return;

    let bytes;
    try {
      bytes = await this.core.createNotePdf(style);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, this.errorKey(e) === "generic" ? "generate-failed" : this.errorKey(e));
      return;
    }

    const used = new Set();
    for (const att of Zotero.Items.get(parentItem.getAttachments())) {
      if (att.attachmentFilename) used.add(att.attachmentFilename.toLowerCase());
      used.add((att.getField("title") || "").toLowerCase());
    }
    let base;
    let fileName;
    for (let n = 1; ; n++) {
      base = n === 1 ? "Handwritten Notes" : "Handwritten Notes " + n;
      fileName = base + ".pdf";
      if (!used.has(fileName.toLowerCase())) break;
    }

    const tmpDir = PathUtils.join(
      Zotero.getTempDirectory().path,
      "handwritten-notes-" + this.randomSuffix()
    );
    let attachment;
    try {
      await IOUtils.makeDirectory(tmpDir, { ignoreExisting: true });
      const tmpFile = PathUtils.join(tmpDir, fileName);
      await IOUtils.write(tmpFile, bytes);
      attachment = await Zotero.Attachments.importFromFile({
        file: tmpFile,
        parentItemID: parentItem.id,
        libraryID: parentItem.libraryID,
        title: fileName,
        fileBaseName: base,
        contentType: "application/pdf"
      });
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, "attach-failed");
      return;
    }
    finally {
      await this.removeQuietly(tmpDir, { recursive: true, ignoreAbsent: true });
    }

    this.log("Created " + fileName);
    this.showProgress(win, this.str("handwritten-notes-created", { fileName }));
    try {
      await Zotero.getActiveZoteroPane()?.selectItem(attachment.id);
    }
    catch (e) {
      Zotero.logError(e);
    }
  },

  // Add Page

  async addPage(win, item) {
    if (!this.checkLibraryEditable(win, item)) return;

    if (item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE
        || item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_URL) {
      const local = Zotero.Sync.Storage.Local;
      const state = item.attachmentSyncState;
      if (state === local.SYNC_STATE_TO_DOWNLOAD
          || state === local.SYNC_STATE_FORCE_DOWNLOAD
          || state === local.SYNC_STATE_IN_CONFLICT) {
        this.alert(win, "sync-required");
        return;
      }
    }

    const path = await item.getFilePathAsync();
    if (!path) {
      this.alert(win, "file-not-found");
      return;
    }

    let statBefore;
    let original;
    try {
      statBefore = await IOUtils.stat(path);
      original = await IOUtils.read(path);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, "read-failed");
      return;
    }

    let result;
    let style;
    try {
      const info = await this.core.readPaperStyle(original);
      if (info.status === "ok") {
        style = info.style;
      }
      else {
        style = await this.promptPaperStyle(win, {
          mode: "add",
          notice: info.status === "missing" ? "unknown" : "invalid"
        });
        if (!style) return;
      }
      result = await this.core.appendPage(original, style);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, this.errorKey(e));
      return;
    }

    const tmp = PathUtils.join(
      PathUtils.parent(path),
      ".handwritten-notes-" + this.randomSuffix() + ".tmp"
    );
    let failure = null;
    try {
      await IOUtils.write(tmp, result.bytes);
      const written = await IOUtils.read(tmp);
      if (written.length !== result.bytes.length) {
        throw new Error("Temporary file length mismatch");
      }
      for (let i = 0; i < written.length; i++) {
        if (written[i] !== result.bytes[i]) {
          throw new Error("Temporary file content mismatch at byte " + i);
        }
      }

      const statNow = await IOUtils.stat(path);
      if (statNow.size !== statBefore.size || statNow.lastModified !== statBefore.lastModified) {
        failure = "file-changed";
        throw new Error("Original file changed during the operation");
      }
      await IOUtils.move(tmp, path);
    }
    catch (e) {
      Zotero.logError(e);
      failure = failure || "save-failed";
    }
    finally {
      await this.removeQuietly(tmp, { ignoreAbsent: true });
    }
    if (failure) {
      this.alert(win, failure);
      return;
    }
    this.log("Appended page to " + path + " (" + result.previousPageCount + " -> " + result.pageCount + ")");

    // From here on the page has been added; problems only affect notification.
    try {
      const mtime = Math.floor((await item.attachmentModificationTime) / 1000);
      item.attachmentLastProcessedModificationTime = mtime;
      if (item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE
          || item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_URL) {
        item.attachmentSyncState = Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD;
      }
      await item.saveTx({ skipAll: true });
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, "notify-failed");
    }

    for (const reader of (Zotero.Reader._readers || [])) {
      try {
        if (reader.itemID === item.id) {
          await reader.reload();
        }
      }
      catch (e) {
        Zotero.logError(e);
      }
    }

    Zotero.FullText.indexItems([item.id], { ignoreErrors: true })
      .catch((e) => Zotero.logError(e));

    this.showProgress(win, this.str("handwritten-notes-page-added", {
      page: result.pageCount,
      style: this.str("handwritten-notes-style-name-" + style)
    }));
  }
};
