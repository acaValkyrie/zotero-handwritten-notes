var chromeHandle;

function install() {}

function uninstall() {}

function startup({ id, version, rootURI }) {
  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = aomStartup.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
    ["content", "handwritten-notes", rootURI + "content/"]
  ]);

  Services.scriptloader.loadSubScript(rootURI + "vendor/pdf-lib.min.js");
  Services.scriptloader.loadSubScript(rootURI + "content/pdf-core.js");
  Services.scriptloader.loadSubScript(rootURI + "content/handwritten-notes.js");

  HandwrittenNotes.init({ id, version, rootURI, core: createHandwrittenNotesPDF(PDFLib) });
  Zotero.HandwrittenNotes = HandwrittenNotes;
  HandwrittenNotes.registerMenus();
  HandwrittenNotes.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  HandwrittenNotes.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  HandwrittenNotes.removeFromWindow(window);
}

function shutdown() {
  HandwrittenNotes.removeFromAllWindows();
  HandwrittenNotes.unregisterMenus();
  chromeHandle?.destruct();
  chromeHandle = null;
  delete Zotero.HandwrittenNotes;
  HandwrittenNotes = undefined;
}
