"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const PDFLib = require("../addon/vendor/pdf-lib.min.js");
const { createHandwrittenNotesPDF } = require("../addon/content/pdf-core.js");
const fx = require("./fixtures.js");

const core = createHandwrittenNotesPDF(PDFLib);
const { PDFDocument, PDFName } = PDFLib;

function isPrefix(prefix, whole) {
  if (prefix.length > whole.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== whole[i]) {
      return false;
    }
  }
  return true;
}

const contentsRef = (page) => {
  const c = page.node.get(PDFName.of("Contents"));
  return c ? c.toString() : null;
};

for (const style of core.PAPER_STYLES) {
  for (const n of [1, 3, 100]) {
    test(`appendPages: ${n} page(s) on ${style}`, async () => {
      const note = await core.createNotePdf(style);
      const res = await core.appendPages(note, style, n);
      assert.equal(res.previousPageCount, 1);
      assert.equal(res.pageCount, 1 + n);
      assert.equal(res.addedCount, n);
      assert.ok(isPrefix(note, res.bytes));
      const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
      assert.equal(doc.getPageCount(), 1 + n);
      assert.equal((await core.readPaperStyle(res.bytes)).style, style);
      const pages = doc.getPages();
      const refs = new Set(pages.slice(1).map(contentsRef));
      assert.equal(refs.size, 1, "all new pages share the same /Contents");
      if (style === "blank") {
        assert.deepEqual([...refs], [null]);
      } else {
        assert.notEqual([...refs][0], null);
        assert.notEqual([...refs][0], contentsRef(pages[0]));
      }
      for (const p of pages.slice(1)) {
        assert.ok(Math.abs(p.getWidth() - core.A4.width) < 1e-3);
        assert.ok(Math.abs(p.getHeight() - core.A4.height) < 1e-3);
      }
    });
  }
}

test("appendPages: xref-stream fixture", async () => {
  const src = await fx.buildXrefStreamPdf();
  const res = await core.appendPages(src, "grid-5mm", 4);
  assert.equal(res.previousPageCount, 3);
  assert.equal(res.pageCount, 7);
  assert.ok(isPrefix(src, res.bytes));
  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 7);
  assert.equal(new Set(doc.getPages().slice(3).map(contentsRef)).size, 1);
});

test("appendPages: invalid counts -> INVALID_COUNT", async () => {
  const note = await core.createNotePdf("blank");
  for (const bad of [0, 101, 1.5, "3", -1, NaN, undefined]) {
    await assert.rejects(() => core.appendPages(note, "blank", bad), { code: "INVALID_COUNT" }, String(bad));
  }
});

test("appendPages twice in a row", async () => {
  const note = await core.createNotePdf("ruled-6mm");
  const a = await core.appendPages(note, "ruled-6mm", 2);
  const b = await core.appendPages(a.bytes, "ruled-6mm", 3);
  assert.equal(b.previousPageCount, 3);
  assert.equal(b.pageCount, 6);
  assert.ok(isPrefix(a.bytes, b.bytes));
  const doc = await PDFDocument.load(b.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 6);
});