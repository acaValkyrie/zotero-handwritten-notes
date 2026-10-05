"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const PDFLib = require("../addon/vendor/pdf-lib.min.js");
const { createHandwrittenNotesPDF } = require("../addon/content/pdf-core.js");
const fx = require("./fixtures.js");

const core = createHandwrittenNotesPDF(PDFLib);
const { PDFDocument, PDFName, PDFDict } = PDFLib;
const { mmToPt, A4, buildPaperContent, createNotePdf, readPaperStyle, appendPage } = core;

const A4_BOX = { x: 0, y: 0, width: A4.width, height: A4.height };

// Drawing box an appended page uses: the CropBox of the previous last page (as read back from the file).
async function lastCropBox(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const cb = doc.getPages().at(-1).getCropBox();
  const r = (n) => Number(n.toFixed(4));
  return { x: r(cb.x), y: r(cb.y), width: r(cb.x + cb.width) - r(cb.x), height: r(cb.y + cb.height) - r(cb.y) };
}

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

function segments(content) {
  const re = /(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l/g;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push(m.slice(1, 5).map(Number));
  }
  return out;
}

function pageContentText(doc, index) {
  const page = doc.getPages()[index];
  const ref = page.node.get(PDFName.of("Contents"));
  if (!ref) {
    return null;
  }
  const stream = doc.context.lookup(ref);
  return Buffer.from(stream.getContents()).toString("latin1");
}

function near(a, b, tol) {
  assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
}

test("mmToPt and A4", () => {
  near(mmToPt(6), 17.00787, 1e-5);
  near(mmToPt(5), 14.17323, 1e-5);
  near(A4.width, 595.2756, 1e-3);
  near(A4.height, 841.8898, 1e-3);
  assert.ok(Object.isFrozen(A4));
  assert.ok(Object.isFrozen(core.PAPER_STYLES));
  assert.deepEqual([...core.PAPER_STYLES], ["blank", "ruled-6mm", "grid-5mm"]);
  assert.equal(core.isPaperStyle("grid-5mm"), true);
  assert.equal(core.isPaperStyle("nope"), false);
  assert.equal(core.METADATA_KEY, "ZoteroHandwrittenNotesPaperStyle");
});

test("buildPaperContent: blank is empty", () => {
  assert.equal(buildPaperContent("blank", A4_BOX), "");
});

test("buildPaperContent: ruled-6mm on A4", () => {
  const content = buildPaperContent("ruled-6mm", A4_BOX);
  assert.ok(content.startsWith("q\n0.5 w\n0.62 0.7 0.8 RG\n"));
  assert.ok(content.endsWith("S\nQ\n"));
  const segs = segments(content);
  assert.equal(segs.length, 47);
  const m = mmToPt(10);
  near(segs[0][1], A4.height - m, 1e-3);
  near(segs[0][0], m, 1e-3);
  near(segs[0][2], A4.width - m, 1e-3);
  near(segs[46][1], A4.height - m - 46 * mmToPt(6), 1e-3);
  assert.ok(segs[46][1] >= m - 1e-3);
  for (let i = 1; i < segs.length; i++) {
    near(segs[i - 1][1] - segs[i][1], mmToPt(6), 1e-3);
  }
  assert.notEqual(segs[1][1], Math.round(segs[1][1]));
  assert.ok(!content.includes("e"), "no exponent notation");
});

test("buildPaperContent: grid-5mm on A4", () => {
  const content = buildPaperContent("grid-5mm", A4_BOX);
  assert.ok(content.startsWith("q\n0.4 w\n0.75 0.8 0.86 RG\n"));
  const segs = segments(content);
  const verticals = segs.filter((s) => s[0] === s[2]);
  const horizontals = segs.filter((s) => s[1] === s[3]);
  assert.equal(verticals.length, 39);
  assert.equal(horizontals.length, 56);
  assert.equal(verticals.length + horizontals.length, segs.length);
  const m = mmToPt(10);
  near(verticals[0][0], m, 1e-3);
  near(verticals[38][0], m + 38 * mmToPt(5), 1e-3);
  const yLast = horizontals[55][1];
  const xLast = verticals[38][0];
  for (const v of verticals) {
    near(v[1], A4.height - m, 1e-3);
    near(v[3], yLast, 1e-3);
  }
  for (const h of horizontals) {
    near(h[0], m, 1e-3);
    near(h[2], xLast, 1e-3);
  }
  for (let i = 1; i < verticals.length; i++) {
    near(verticals[i][0] - verticals[i - 1][0], mmToPt(5), 1e-3);
  }
});

test("buildPaperContent: too small box yields empty string", () => {
  assert.equal(buildPaperContent("ruled-6mm", { x: 0, y: 0, width: 100, height: 20 }), "");
  assert.equal(buildPaperContent("grid-5mm", { x: 0, y: 0, width: 100, height: 20 }), "");
});

test("createNotePdf: one A4 page per style with metadata", async () => {
  for (const style of core.PAPER_STYLES) {
    const bytes = await createNotePdf(style);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(doc.getPageCount(), 1);
    const mb = doc.getPage(0).getMediaBox();
    near(mb.width, A4.width, 1e-6);
    near(mb.height, A4.height, 1e-6);
    const hasContents = doc.getPage(0).node.has(PDFName.of("Contents"));
    assert.equal(hasContents, style !== "blank");
    assert.deepEqual(await readPaperStyle(bytes), { status: "ok", style, raw: style, pageCount: 1 });
    assert.equal(doc.getTitle(), "Handwritten Notes");
  }
});

test("createNotePdf: invalid style", async () => {
  await assert.rejects(() => createNotePdf("zzz"), { code: "INVALID_STYLE" });
});

test("appendPage x3 on created notes", async () => {
  for (const style of core.PAPER_STYLES) {
    let bytes = await createNotePdf(style);
    for (let n = 2; n <= 4; n++) {
      const before = bytes;
      const box = await lastCropBox(before);
      const res = await appendPage(before, style);
      assert.equal(res.pageCount, n);
      assert.equal(res.previousPageCount, n - 1);
      assert.ok(isPrefix(before, res.bytes));
      bytes = res.bytes;
      assert.deepEqual(await readPaperStyle(bytes), { status: "ok", style, raw: style, pageCount: n });
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      assert.equal(doc.getPageCount(), n);
      const text = pageContentText(doc, n - 1);
      if (style === "blank") {
        assert.equal(text, null);
      } else {
        assert.equal(text, buildPaperContent(style, box));
      }
      const mb = doc.getPage(n - 1).getMediaBox();
      near(mb.width, A4.width, 1e-3);
      assert.equal(doc.getPage(n - 1).getRotation().angle, 0);
    }
  }
});

test("appendPage: different style than the original", async () => {
  const base = await createNotePdf("blank");
  const box = await lastCropBox(base);
  const res = await appendPage(base, "grid-5mm");
  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  assert.equal(pageContentText(doc, 1), buildPaperContent("grid-5mm", box));
  assert.equal((await readPaperStyle(res.bytes)).style, "blank");
});

test("appendPage: invalid style", async () => {
  const base = await createNotePdf("blank");
  await assert.rejects(() => appendPage(base, "x"), { code: "INVALID_STYLE" });
});

test("appendPage on xref-stream PDF keeps annotations", async () => {
  const bytes = await fx.buildXrefStreamPdf();
  assert.ok(Buffer.from(bytes).toString("latin1").includes("/XRef"));
  const before = await PDFDocument.load(bytes, { updateMetadata: false });
  const annotsBefore = before.getPage(0).node.lookup(PDFName.of("Annots"), PDFLib.PDFArray);
  const annotBefore = annotsBefore.lookup(0, PDFDict).toString();
  assert.ok(annotBefore.includes("/Square"));

  const res = await appendPage(bytes, "ruled-6mm");
  assert.equal(res.pageCount, 4);
  assert.ok(isPrefix(bytes, res.bytes));
  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFLib.PDFArray);
  assert.equal(annots.lookup(0, PDFDict).toString(), annotBefore);
  assert.equal(pageContentText(doc, 3), buildPaperContent("ruled-6mm", { x: 0, y: 0, width: 400, height: 300 }));

  // second append on top of the stream-based update
  const res2 = await appendPage(res.bytes, "blank");
  assert.equal(res2.pageCount, 5);
  assert.ok(isPrefix(res.bytes, res2.bytes));
});

test("appendPage: Letter pages with inherited MediaBox and CropBox on last page", async () => {
  const bytes = await fx.buildLetterInheritedPdf();
  const res = await appendPage(bytes, "grid-5mm");
  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 3);
  const np = doc.getPage(2);
  const mb = np.getMediaBox();
  assert.deepEqual([mb.x, mb.y, mb.width, mb.height], [0, 0, 612, 792]);
  const cb = np.getCropBox();
  assert.deepEqual([cb.x, cb.y, cb.width, cb.height], [36, 36, 540, 720]);
  assert.equal(
    pageContentText(doc, 2),
    buildPaperContent("grid-5mm", { x: 36, y: 36, width: 540, height: 720 }),
  );
  assert.equal(np.getRotation().angle, 0);
});

test("appendPage: rotated last page gives displayed-size page with /Rotate 0", async () => {
  const bytes = await fx.buildRotatedPdf();
  const res = await appendPage(bytes, "ruled-6mm");
  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 3);
  const np = doc.getPage(2);
  const mb = np.getMediaBox();
  assert.deepEqual([mb.x, mb.y, mb.width, mb.height], [0, 0, 792, 612]);
  const cb = np.getCropBox();
  assert.deepEqual([cb.x, cb.y, cb.width, cb.height], [0, 0, 792, 612]);
  assert.equal(np.node.get(PDFName.of("Rotate")).toString(), "0");
  assert.equal(np.getRotation().angle, 0);
  assert.equal(pageContentText(doc, 2), buildPaperContent("ruled-6mm", { x: 0, y: 0, width: 792, height: 612 }));
});

test("readPaperStyle: missing and invalid", async () => {
  const noInfo = await fx.buildNoInfoPdf();
  assert.deepEqual(await readPaperStyle(noInfo), { status: "missing", style: null, raw: null, pageCount: 1 });
  const noKey = await PDFDocument.create();
  noKey.addPage([200, 200]);
  assert.equal((await readPaperStyle(await noKey.save())).status, "missing");
  const invalid = await fx.buildInvalidStylePdf("ruled-7mm");
  assert.deepEqual(await readPaperStyle(invalid), { status: "invalid", style: null, raw: "ruled-7mm", pageCount: 1 });
});

test("readPaperStyle works on xref-stream PDFs", async () => {
  const bytes = await fx.buildXrefStreamPdf();
  assert.equal((await readPaperStyle(bytes)).status, "missing");
});

test("garbage bytes -> PARSE_FAILED", async () => {
  const garbage = new TextEncoder().encode("this is definitely not a pdf");
  await assert.rejects(() => appendPage(garbage, "blank"), (e) => {
    assert.equal(e.code, "PARSE_FAILED");
    assert.ok(e instanceof core.HandwrittenNotesError);
    assert.ok(e.cause);
    return true;
  });
  await assert.rejects(() => readPaperStyle(garbage), { code: "PARSE_FAILED" });
});

test("broken startxref -> UNSUPPORTED_STRUCTURE (never rewritten)", async () => {
  const good = await createNotePdf("ruled-6mm");
  const broken = fx.breakToken(good, "startxref", "startxrex");
  await assert.rejects(() => appendPage(broken, "blank"), { code: "UNSUPPORTED_STRUCTURE" });
  // startxref pointing into nowhere
  const s = Buffer.from(good).toString("latin1");
  const idx = s.lastIndexOf("startxref");
  const bogus = Buffer.from(s.slice(0, idx) + "startxref\n99999999\n%%EOF\n", "latin1");
  await assert.rejects(() => appendPage(new Uint8Array(bogus), "blank"), { code: "UNSUPPORTED_STRUCTURE" });
});

test("encrypted PDF -> ENCRYPTED", async () => {
  const bytes = fx.buildEncryptedPdf();
  await assert.rejects(() => appendPage(bytes, "blank"), { code: "ENCRYPTED" });
  await assert.rejects(() => readPaperStyle(bytes), { code: "ENCRYPTED" });
});

test("appendPage: rotated unrounded A4 last page", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([A4.width, A4.height]).setRotation(PDFLib.degrees(90));
  const bytes = await doc.save({ useObjectStreams: false });
  const res = await appendPage(bytes, "ruled-6mm");
  const out = await PDFDocument.load(res.bytes, { updateMetadata: false });
  assert.equal(out.getPageCount(), 2);
  const np = out.getPage(1);
  const mb = np.getMediaBox();
  near(mb.x, 0, 1e-9);
  near(mb.y, 0, 1e-9);
  near(mb.width, 841.8898, 1e-9);
  near(mb.height, 595.2756, 1e-9);
  assert.equal(np.node.get(PDFName.of("Rotate")).toString(), "0");
});
