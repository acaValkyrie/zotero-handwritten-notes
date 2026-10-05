var HandwrittenNotesPaperStyleDialog = {
  MODES: ["create", "add", "add-multiple", "remove"],

  init() {
    const io = window.arguments[0];
    const group = document.getElementById("paper-style");
    group.value = io.defaultStyle || "blank";

    const mode = this.MODES.includes(io.mode) ? io.mode : "create";
    document.l10n.setAttributes(document.documentElement, "handwritten-notes-dialog-" + mode);
    document.l10n.setAttributes(document.getElementById("dialog"), "handwritten-notes-dialog-" + mode);

    const showStyle = io.showStyle !== false && mode !== "remove";
    const showCount = !!io.showCount;

    if (!showStyle) {
      document.getElementById("style-label").hidden = true;
      group.hidden = true;
    }

    if (io.info) {
      const info = document.getElementById("info");
      info.hidden = false;
      document.l10n.setAttributes(info, io.info.l10nID, io.info.args);
    }

    if (io.notice) {
      const notice = document.getElementById("notice");
      notice.hidden = false;
      document.l10n.setAttributes(notice, "handwritten-notes-notice-" + io.notice);
    }

    const input = document.getElementById("page-count");
    const countMax = Number.isInteger(io.countMax) && io.countMax >= 1 ? io.countMax : 100;
    const parseCount = () => {
      const text = input.value.trim();
      const n = Number(text);
      return text !== "" && Number.isInteger(n) && n >= 1 && n <= countMax ? n : null;
    };
    if (showCount) {
      document.getElementById("count-row").hidden = false;
      if (mode === "remove") {
        document.l10n.setAttributes(document.getElementById("count-label"), "handwritten-notes-remove-count");
      }
      input.max = String(countMax);
      input.value = String(Number.isInteger(io.defaultCount) ? io.defaultCount : 5);
      input.focus();
      input.select();

      if (io.rangeInfo && Number.isInteger(io.pageCount)) {
        const range = document.getElementById("range");
        const update = () => {
          const n = parseCount();
          if (n === null) {
            range.removeAttribute("data-l10n-id");
            range.textContent = "";
            range.hidden = true;
            return;
          }
          range.hidden = false;
          if (n === 1) {
            document.l10n.setAttributes(range, "handwritten-notes-remove-single", { page: io.pageCount });
          }
          else {
            document.l10n.setAttributes(range, "handwritten-notes-remove-range", {
              from: io.pageCount - n + 1,
              to: io.pageCount
            });
          }
        };
        input.addEventListener("input", update);
        update();
      }
    }

    if (io.note) {
      const note = document.getElementById("note");
      note.hidden = false;
      document.l10n.setAttributes(note, io.note);
    }

    document.addEventListener("dialogaccept", (event) => {
      if (showCount) {
        const n = parseCount();
        if (n === null) {
          event.preventDefault();
          input.focus();
          input.select();
          return;
        }
        io.count = n;
      }
      io.result = showStyle ? (group.value || null) : (io.defaultStyle || null);
    });
  }
};