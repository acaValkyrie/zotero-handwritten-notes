"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const PDFLib = require("../addon/vendor/pdf-lib.min.js");
const { createHandwrittenNotesPDF } = require("../addon/content/pdf-core.js");

const core = createHandwrittenNotesPDF(PDFLib);
const { PDFDocument, PDFName, PDFNumber } = PDFLib;
const { mmToPt, appendPage } = core;

/** Build a classic-xref PDF (Latin-1 bytes) from object bodies; objs[i] is object i+1 (1 = Catalog). */
function classic(objs, trailerExtra = "") {
  let s = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs = [];
  objs.forEach((body, i) => {
    offs.push(s.length);
    s += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f\r\n`;
  for (const o of offs) {
    s += `${String(o).padStart(10, "0")} 00000 n\r\n`;
  }
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}

function onePage(pageExtra = "", pagesExtra = "", trailerExtra = "") {
  return classic(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [3 0 R] /Count 1 ${pagesExtra}>>`,
      `<< /Type /Page /Parent 2 0 R ${pageExtra}>>`,
    ],
    trailerExtra
  );
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

async function lastPage(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPages().at(-1);
  const ref = page.node.get(PDFName.of("Contents"));
  const content = ref ? Buffer.from(doc.context.lookup(ref).getContents()).toString("latin1") : null;
  return { doc, page, content };
}

function indexOfBytes(hay, needle, from = 0) {
  return Buffer.from(hay).indexOf(Buffer.from(needle), from);
}

test("A: binary trailer /ID bytes survive byte-exact", async () => {
  const id1 = "\x8a\xff\x10\xe9ABCDEFGH\x80\xfe";
  const id2 = "\xe9\x10\xff\x8aZYXWVUTS\x81\xfd";
  const bytes = onePage("/MediaBox [0 0 612 792] ", "", `/ID [(${id1}) (${id2})] `);
  const { bytes: out } = await appendPage(bytes, "ruled-6mm");
  const tail = Buffer.from(out).subarray(bytes.length);
  for (const id of [id1, id2]) {
    assert.ok(tail.indexOf(Buffer.from(`(${id})`, "latin1")) >= 0, "ID string must be byte-exact in new trailer");
  }
  assert.equal(tail.indexOf(Buffer.from([0xc2, 0x8a])), -1, "no UTF-8 expansion");
});

test("A: custom binary literal string in Pages dict survives byte-exact", async () => {
  const val = "\x80\xfe\xe9\x01zz";
  const bytes = onePage("/MediaBox [0 0 612 792] ", `/Foo (${val}) `);
  const { bytes: out } = await appendPage(bytes, "blank");
  const tail = Buffer.from(out).subarray(bytes.length);
  assert.ok(tail.indexOf(Buffer.from(`/Foo (${val})`, "latin1")) >= 0);
});

test("B: reversed MediaBox is normalized", async () => {
  const bytes = onePage("/MediaBox [612 792 0 0] ");
  const { bytes: out, pageCount } = await appendPage(bytes, "ruled-6mm");
  assert.equal(pageCount, 2);
  const { page, content } = await lastPage(out);
  assert.ok(content, "has /Contents");
  const mb = page.getMediaBox();
  assert.deepEqual([mb.x, mb.y, mb.width, mb.height], [0, 0, 612, 792]);
  const segs = segments(content);
  assert.ok(segs.length > 0);
  for (const [x1, y1, x2, y2] of segs) {
    for (const v of [x1, x2]) assert.ok(v >= 0 && v <= 612);
    for (const v of [y1, y2]) assert.ok(v >= 0 && v <= 792);
  }
});

test("C: CropBox outside MediaBox is clipped to MediaBox", async () => {
  const bytes = onePage("/MediaBox [0 0 612 792] /CropBox [-200 -200 1000 1000] ");
  const { bytes: out } = await appendPage(bytes, "grid-5mm");
  const { page, content } = await lastPage(out);
  const cb = page.getCropBox();
  assert.deepEqual([cb.x, cb.y, cb.width, cb.height], [0, 0, 612, 792]);
  const m = mmToPt(10);
  const segs = segments(content);
  assert.ok(segs.length > 0);
  const eps = 1e-3;
  for (const [x1, y1, x2, y2] of segs) {
    for (const v of [x1, x2]) assert.ok(v >= m - eps && v <= 612 - m + eps, `x ${v}`);
    for (const v of [y1, y2]) assert.ok(v >= m - eps && v <= 792 - m + eps, `y ${v}`);
  }
});

test("C: disjoint CropBox falls back to MediaBox", async () => {
  const bytes = onePage("/MediaBox [0 0 612 792] /CropBox [2000 2000 3000 3000] ");
  const { bytes: out } = await appendPage(bytes, "ruled-6mm");
  const { page } = await lastPage(out);
  const cb = page.getCropBox();
  assert.deepEqual([cb.x, cb.y, cb.width, cb.height], [0, 0, 612, 792]);
});

test("D: startxref is found beyond 4096 trailing bytes", async () => {
  const base = onePage("/MediaBox [0 0 612 792] ");
  const bytes = Buffer.concat([base, Buffer.from(" \n".repeat(2500), "latin1")]);
  assert.ok(bytes.length - base.length > 4096);
  const { bytes: out, pageCount } = await appendPage(bytes, "ruled-6mm");
  assert.equal(pageCount, 2);
  const doc = await PDFDocument.load(out, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
});

test("E: /UserUnit 2 is copied and lengths are divided by it", async () => {
  const bytes = onePage("/MediaBox [0 0 612 792] /UserUnit 2 ");
  const { bytes: out } = await appendPage(bytes, "ruled-6mm");
  const { page, content } = await lastPage(out);
  const uu = page.node.lookup(PDFName.of("UserUnit"), PDFNumber);
  assert.equal(uu.asNumber(), 2);
  const segs = segments(content);
  assert.ok(segs.length > 2);
  const step = segs[0][1] - segs[1][1];
  assert.ok(Math.abs(step - mmToPt(6) / 2) < 1e-3, `step ${step}`);
  assert.ok(Math.abs(segs[0][0] - mmToPt(10) / 2) < 1e-3);
});

test("E: no /UserUnit keeps default and does not write one", async () => {
  const bytes = onePage("/MediaBox [0 0 612 792] ");
  const { bytes: out } = await appendPage(bytes, "ruled-6mm");
  const { page, content } = await lastPage(out);
  assert.equal(page.node.lookup(PDFName.of("UserUnit")), undefined);
  const segs = segments(content);
  assert.ok(Math.abs(segs[0][1] - segs[1][1] - mmToPt(6)) < 1e-3);
});

test("E: invalid /UserUnit is UNSUPPORTED_STRUCTURE", async () => {
  for (const v of ["0", "-1", "(x)"]) {
    const bytes = onePage(`/MediaBox [0 0 612 792] /UserUnit ${v} `);
    await assert.rejects(appendPage(bytes, "blank"), (e) => e.code === "UNSUPPORTED_STRUCTURE");
  }
});
