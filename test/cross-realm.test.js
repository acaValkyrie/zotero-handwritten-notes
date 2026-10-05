"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const PDFLib = require("../addon/vendor/pdf-lib.min.js");
const { createHandwrittenNotesPDF } = require("../addon/content/pdf-core.js");

const core = createHandwrittenNotesPDF(PDFLib);

function foreignBytes(src) {
  const n = src.length;
  const out = vm.runInNewContext("new Uint8Array(n)", { n });
  out.set(src);
  return out;
}

test("foreign-realm Uint8Array is not an instance of this realm's Uint8Array", async () => {
  const f = foreignBytes(new Uint8Array(4));
  assert.equal(f instanceof Uint8Array, false);
});

test("readPaperStyle and appendPage accept a Uint8Array from another realm", async () => {
  const note = await core.createNotePdf("ruled-6mm");
  const f = foreignBytes(note);
  const info = await core.readPaperStyle(f);
  assert.deepEqual(info, { status: "ok", style: "ruled-6mm", raw: "ruled-6mm", pageCount: 1 });
  const res = await core.appendPage(f, "grid-5mm");
  assert.equal(res.previousPageCount, 1);
  assert.equal(res.pageCount, 2);
  assert.equal(res.bytes.length > note.length, true);
  assert.deepEqual(Array.from(res.bytes.subarray(0, note.length)), Array.from(note));
});

test("non-byte input is rejected with PARSE_FAILED", async () => {
  await assert.rejects(() => core.readPaperStyle("nope"), { code: "PARSE_FAILED" });
  await assert.rejects(() => core.appendPage({}, "blank"), { code: "PARSE_FAILED" });
});
