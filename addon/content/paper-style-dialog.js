var HandwrittenNotesPaperStyleDialog = {
  init() {
    const io = window.arguments[0];
    const group = document.getElementById("paper-style");
    group.value = io.defaultStyle || "blank";

    const mode = io.mode === "add" ? "add" : "create";
    document.l10n.setAttributes(document.documentElement, "handwritten-notes-dialog-" + mode);
    document.l10n.setAttributes(document.getElementById("dialog"), "handwritten-notes-dialog-" + mode);

    if (io.notice) {
      const notice = document.getElementById("notice");
      notice.hidden = false;
      document.l10n.setAttributes(notice, "handwritten-notes-notice-" + io.notice);
    }

    document.addEventListener("dialogaccept", () => {
      io.result = group.value || null;
    });
  }
};
