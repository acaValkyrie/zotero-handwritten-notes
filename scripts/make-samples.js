"use strict";

// Dev-only: write sample PDFs for cross-checking with other PDF libraries.
// Usage: node scripts/make-samples.js <out-dir>

const fs = require("node:fs");
const path = require("node:path");

const PDFLib = require("../addon/vendor/pdf-lib.min.js");
const { createHandwrittenNotesPDF } = require("../addon/content/pdf-core.js");
const fx = require("../test/fixtures.js");

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    throw new Error("usage: node scripts/make-samples.js <out-dir>");
  }
  fs.mkdirSync(outDir, { recursive: true });
  const core = createHandwrittenNotesPDF(PDFLib);

  for (const style of core.PAPER_STYLES) {
    let bytes = await core.createNotePdf(style);
    bytes = (await core.appendPage(bytes, style)).bytes;
    bytes = (await core.appendPage(bytes, style)).bytes;
    fs.writeFileSync(path.join(outDir, `note-${style}.pdf`), bytes);
  }

  const xrefStream = await fx.buildXrefStreamPdf();
  const appended = await core.appendPage(xrefStream, "ruled-6mm");
  fs.writeFileSync(path.join(outDir, "xref-stream-appended.pdf"), appended.bytes);
}

main().catch((e) => {
  process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
