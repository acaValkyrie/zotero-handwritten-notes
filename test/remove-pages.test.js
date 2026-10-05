"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const PDFLib = require("../addon/vendor/pdf-lib.min.js");
const { createHandwrittenNotesPDF } = require("../addon/content/pdf-core.js");
const fx = require("./fixtures.js");

const core = createHandwrittenNotesPDF(PDFLib);
const { PDFDocument, PDFName, PDFString, PDFDict } = PDFLib;

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

async function note(style, pages) {
  const created = await core.createNotePdf(style);
  return pages > 1 ? (await core.appendPages(created, style, pages - 1)).bytes : created;
}

async function pageRefs(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => p.ref.toString());
}

for (const style of core.PAPER_STYLES) {
  for (const n of [1, 2]) {
    test(`removeLastPages: remove ${n} from a 5-page ${style} note`, async () => {
      const src = await note(style, 5);
      const before = await pageRefs(src);
      const res = await core.removeLastPages(src, n);
      assert.equal(res.previousPageCount, 5);
      assert.equal(res.pageCount, 5 - n);
      assert.equal(res.removedCount, n);
      assert.ok(isPrefix(src, res.bytes));
      assert.deepEqual(await pageRefs(res.bytes), before.slice(0, 5 - n));
      const info = await core.readPaperStyle(res.bytes);
      assert.equal(info.status, "ok");
      assert.equal(info.style, style);
      assert.equal(info.pageCount, 5 - n);
    });
  }
}

test("removeLastPages: remove then append again", async () => {
  const src = await note("grid-5mm", 3);
  const appended = await core.appendPages(src, "grid-5mm", 4); // 7 pages
  const removed = await core.removeLastPages(appended.bytes, 3); // 4 pages
  assert.equal(removed.pageCount, 4);
  const again = await core.appendPages(removed.bytes, "grid-5mm", 2);
  assert.equal(again.previousPageCount, 4);
  assert.equal(again.pageCount, 6);
  assert.ok(isPrefix(removed.bytes, again.bytes));
  const info = await core.readPaperStyle(again.bytes);
  assert.equal(info.style, "grid-5mm");
  assert.equal(info.pageCount, 6);
  const doc = await PDFDocument.load(again.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 6);
});

test("removeLastPages: xref-stream notebook", async () => {
  const base = await PDFDocument.load(await fx.buildXrefStreamPdf(), { updateMetadata: false });
  const info = base.context.lookup(base.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of(core.METADATA_KEY), PDFString.of("ruled-6mm"));
  const src = await base.save({ useObjectStreams: true });
  assert.equal((await core.readPaperStyle(src)).pageCount, 3);
  const res = await core.removeLastPages(src, 2);
  assert.equal(res.pageCount, 1);
  assert.ok(isPrefix(src, res.bytes));
  assert.equal((await core.readPaperStyle(res.bytes)).status, "ok");
  const grown = await core.appendPages(res.bytes, "ruled-6mm", 2);
  assert.equal(grown.pageCount, 3);
});

test("removeLastPages: errors", async () => {
  const foreign = await PDFDocument.create();
  foreign.addPage([200, 200]);
  foreign.addPage([200, 200]);
  const foreignBytes = await foreign.save({ useObjectStreams: false });
  await assert.rejects(() => core.removeLastPages(foreignBytes, 1), { code: "NOT_NOTEBOOK" });
  const invalidStyle = await fx.buildInvalidStylePdf();
  await assert.rejects(() => core.removeLastPages(invalidStyle, 1), { code: "NOT_NOTEBOOK" });

  const five = await note("blank", 5);
  for (const bad of [0, 5, 1.5, "1", -1]) {
    await assert.rejects(() => core.removeLastPages(five, bad), { code: "INVALID_COUNT" }, String(bad));
  }
  const single = await core.createNotePdf("blank");
  await assert.rejects(() => core.removeLastPages(single, 1), { code: "INVALID_COUNT" });
});

test("removeLastPages: nested page tree -> UNSUPPORTED_STRUCTURE", async () => {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([200, 200]);
  const p2 = doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  const rootRef = doc.catalog.get(PDFName.of("Pages"));
  const root = doc.context.lookup(rootRef, PDFDict);
  const kids = root.lookup(PDFName.of("Kids")).asArray();
  const mid = doc.context.obj({ Type: "Pages", Kids: [p1.ref, p2.ref, kids[2]], Count: 3, Parent: rootRef });
  const midRef = doc.context.register(mid);
  for (const p of [p1, p2]) {
    p.node.set(PDFName.of("Parent"), midRef);
  }
  root.set(PDFName.of("Kids"), doc.context.obj([midRef]));
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of(core.METADATA_KEY), PDFString.of("blank"));
  const bytes = await doc.save({ useObjectStreams: false });
  assert.equal((await core.readPaperStyle(bytes)).pageCount, 3);
  await assert.rejects(() => core.removeLastPages(bytes, 1), { code: "UNSUPPORTED_STRUCTURE" });
});