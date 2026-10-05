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
          icon: "chrome://handwritten-notes/content/icons/menu-create.svg",
          onShowing: (event, context) => {
            const item = selectedItem(context);
            context.setVisible(!!item && item.isRegularItem());
          },
          onCommand: run((win, item) => this.createNotes(win, item))
        },
        {
          menuType: "menuitem",
          l10nID: "handwritten-notes-menu-add-page",
          icon: "chrome://handwritten-notes/content/icons/menu-add-page.svg",
          onShowing: (event, context) => {
            const item = selectedItem(context);
            context.setVisible(!!item && item.isAttachment() && item.isPDFAttachment());
          },
          onCommand: run((win, item) => this.addPage(win, item))
        },
        {
          menuType: "menuitem",
          l10nID: "handwritten-notes-menu-add-pages",
          icon: "chrome://handwritten-notes/content/icons/menu-add-page.svg",
          onShowing: (event, context) => {
            const item = selectedItem(context);
            context.setVisible(!!item && item.isAttachment() && item.isPDFAttachment());
          },
          onCommand: run((win, item) => this.addPages(win, item))
        },
        {
          menuType: "menuitem",
          l10nID: "handwritten-notes-menu-remove-pages",
          icon: "chrome://handwritten-notes/content/icons/menu-remove-pages.svg",
          onShowing: (event, context) => {
            const item = selectedItem(context);
            context.setVisible(!!item && item.isAttachment() && item.isPDFAttachment());
          },
          onCommand: run((win, item) => this.removePages(win, item))
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
      case "NOT_NOTEBOOK": return "remove-not-notebook";
      case "VALIDATION_FAILED":
      case "INVALID_COUNT":
      case "INVALID_STYLE": return "generate-failed";
      default: return "generic";
    }
  },

  showProgress(win, text) {
    const pw = new Zotero.ProgressWindow({ window: win });
    pw.changeHeadline(this.str("handwritten-notes-progress-title"));
    for (const line of [].concat(text)) {
      pw.addDescription(line);
    }
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

  async promptAddPages(win, { notice = null, showStyle, defaultStyle }) {
    const io = {
      mode: "add-multiple",
      notice,
      showStyle,
      showCount: true,
      defaultStyle,
      defaultCount: 5,
      result: null,
      count: null
    };
    win.openDialog(
      "chrome://handwritten-notes/content/paper-style-dialog.xhtml",
      "",
      "chrome,modal,centerscreen",
      io
    );
    return io.result && io.count ? { style: io.result, count: io.count } : null;
  },

  async promptRemovePages(win, { pageCount, maxPage }) {
    const io = {
      mode: "remove",
      showStyle: false,
      showCount: true,
      defaultCount: 1,
      countMax: pageCount - 1,
      rangeInfo: true,
      pageCount,
      note: "handwritten-notes-remove-sync-note",
      info: maxPage
        ? { l10nID: "handwritten-notes-remove-annotated-upto", args: { page: maxPage, total: pageCount } }
        : { l10nID: "handwritten-notes-remove-no-annotations", args: { total: pageCount } },
      result: null,
      count: null
    };
    win.openDialog(
      "chrome://handwritten-notes/content/paper-style-dialog.xhtml",
      "",
      "chrome,modal,centerscreen",
      io
    );
    return io.count || null;
  },

  // Confirmation before deleting annotated pages (cancel is the default button).
  async confirmRemoveAnnotated(win, { from, to, count }) {
    const pressed = Zotero.Prompt.confirm({
      window: win,
      title: this.str("handwritten-notes-remove-confirm-title"),
      text: this.str("handwritten-notes-remove-confirm-text", { from, to, count }),
      button0: this.str("handwritten-notes-remove-confirm-button"),
      button1: Zotero.Prompt.BUTTON_TITLE_CANCEL,
      defaultButton: 1
    });
    return pressed === 0;
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

  // Shared steps for changing the PDF file of an attachment

  // Library, sync-state and file checks, then read the file. Returns null (after alerting) on failure.
  async readAttachmentFile(win, item) {
    if (!this.checkLibraryEditable(win, item)) return null;

    if (item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE
        || item.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_URL) {
      const local = Zotero.Sync.Storage.Local;
      const state = item.attachmentSyncState;
      if (state === local.SYNC_STATE_TO_DOWNLOAD
          || state === local.SYNC_STATE_FORCE_DOWNLOAD
          || state === local.SYNC_STATE_IN_CONFLICT) {
        this.alert(win, "sync-required");
        return null;
      }
    }

    const path = await item.getFilePathAsync();
    if (!path) {
      this.alert(win, "file-not-found");
      return null;
    }

    try {
      const statBefore = await IOUtils.stat(path);
      const original = await IOUtils.read(path);
      return { path, statBefore, original };
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, "read-failed");
      return null;
    }
  },

  // Replace the file with newBytes (temp write + read-back + stat check + move), then tell Zotero.
  // Returns false (after alerting) if the file was not replaced.
  async replaceAttachmentFile(win, item, { path, statBefore }, newBytes) {
    const tmp = PathUtils.join(
      PathUtils.parent(path),
      ".handwritten-notes-" + this.randomSuffix() + ".tmp"
    );
    let failure = null;
    try {
      await IOUtils.write(tmp, newBytes);
      const written = await IOUtils.read(tmp);
      if (written.length !== newBytes.length) {
        throw new Error("Temporary file length mismatch");
      }
      for (let i = 0; i < written.length; i++) {
        if (written[i] !== newBytes[i]) {
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
      return false;
    }
    return true;
  },

  // From here on the file has been replaced; problems only affect notification.
  async notifyFileChanged(win, item) {
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
  },

  async refreshAfterChange(item) {
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
  },

  // Add Page / Add Multiple Pages

  async addPage(win, item) {
    return this.appendToAttachment(win, item, { multiple: false });
  },

  async addPages(win, item) {
    return this.appendToAttachment(win, item, { multiple: true });
  },

  async appendToAttachment(win, item, { multiple }) {
    const file = await this.readAttachmentFile(win, item);
    if (!file) return;

    let result;
    let style;
    try {
      const info = await this.core.readPaperStyle(file.original);
      const known = info.status === "ok";
      const notice = known ? null : (info.status === "missing" ? "unknown" : "invalid");
      let count = 1;
      if (multiple) {
        const answer = await this.promptAddPages(win, {
          notice,
          showStyle: !known,
          defaultStyle: known ? info.style : "blank"
        });
        if (!answer) return;
        ({ style, count } = answer);
      }
      else if (known) {
        style = info.style;
      }
      else {
        style = await this.promptPaperStyle(win, { mode: "add", notice });
        if (!style) return;
      }
      result = await this.core.appendPages(file.original, style, count);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, this.errorKey(e));
      return;
    }

    if (!await this.replaceAttachmentFile(win, item, file, result.bytes)) return;
    this.log("Appended " + result.addedCount + " page(s) to " + file.path
      + " (" + result.previousPageCount + " -> " + result.pageCount + ")");

    await this.notifyFileChanged(win, item);
    await this.refreshAfterChange(item);

    const styleName = this.str("handwritten-notes-style-name-" + style);
    this.showProgress(win, multiple
      ? this.str("handwritten-notes-pages-added", { count: result.addedCount, style: styleName, total: result.pageCount })
      : this.str("handwritten-notes-page-added", { page: result.pageCount, style: styleName }));
  },

  // Remove Pages

  // Annotations of the attachment as [{ id, pageIndex }] (unparsable positions are skipped).
  annotationPages(item) {
    const list = [];
    for (const annotation of item.getAnnotations()) {
      try {
        const pageIndex = JSON.parse(annotation.annotationPosition).pageIndex;
        if (!Number.isInteger(pageIndex)) {
          throw new Error("Annotation " + annotation.id + " has no page index");
        }
        list.push({ id: annotation.id, pageIndex });
      }
      catch (e) {
        Zotero.logError(e);
      }
    }
    return list;
  },

  async removePages(win, item) {
    const file = await this.readAttachmentFile(win, item);
    if (!file) return;

    let info;
    try {
      info = await this.core.readPaperStyle(file.original);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, this.errorKey(e));
      return;
    }
    if (info.status !== "ok") {
      this.alert(win, "remove-not-notebook");
      return;
    }
    const pageCount = info.pageCount;
    if (pageCount < 2) {
      this.alert(win, "remove-single-page");
      return;
    }

    const known = this.annotationPages(item);
    const maxPage = known.length ? Math.max(...known.map((a) => a.pageIndex)) + 1 : 0;
    const count = await this.promptRemovePages(win, { pageCount, maxPage });
    if (!count) return;

    // Annotations may have changed while the dialog was open.
    const from = pageCount - count + 1;
    const doomed = this.annotationPages(item).filter((a) => a.pageIndex >= pageCount - count);
    if (doomed.length) {
      const confirmed = await this.confirmRemoveAnnotated(win, { from, to: pageCount, count: doomed.length });
      if (!confirmed) return;
    }

    let result;
    try {
      result = await this.core.removeLastPages(file.original, count);
    }
    catch (e) {
      Zotero.logError(e);
      this.alert(win, this.errorKey(e));
      return;
    }

    if (!await this.replaceAttachmentFile(win, item, file, result.bytes)) return;
    this.log("Removed " + result.removedCount + " page(s) from " + file.path
      + " (" + result.previousPageCount + " -> " + result.pageCount + ")");

    await this.notifyFileChanged(win, item);

    // Only after the file was replaced: delete the annotations of the removed pages.
    let erased = 0;
    if (doomed.length) {
      try {
        await Zotero.Items.erase(doomed.map((a) => a.id));
        erased = doomed.length;
      }
      catch (e) {
        Zotero.logError(e);
        this.alert(win, "annotations-failed");
      }
    }

    await this.refreshAfterChange(item);

    const lines = [this.str("handwritten-notes-pages-removed", { count: result.removedCount, total: result.pageCount })];
    if (erased) {
      lines.push(this.str("handwritten-notes-annotations-removed", { count: erased }));
    }
    this.showProgress(win, lines);
  }
};