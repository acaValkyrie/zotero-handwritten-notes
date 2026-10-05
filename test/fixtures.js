"use strict";

const PDFLib = require("../addon/vendor/pdf-lib.min.js");

const { PDFDocument, PDFName, PDFString, PDFDict, PDFArray, degrees } = PDFLib;

function pagesDictOf(doc) {
  return doc.context.lookup(doc.catalog.get(PDFName.of("Pages")), PDFDict);
}

/** Document with an xref stream (object streams), 3 pages, a /Square annotation on page 1. */
async function buildXrefStreamPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("Xref stream fixture");
  const p1 = doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Square",
    Rect: [10, 10, 50, 50],
    C: [1, 0, 0],
    Contents: PDFString.of("dummy"),
  });
  const annotRef = doc.context.register(annot);
  p1.node.set(PDFName.of("Annots"), doc.context.obj([annotRef]));
  return doc.save({ useObjectStreams: true });
}

/** Letter pages with MediaBox inherited from the Pages root and a CropBox on the last page. */
async function buildLetterInheritedPdf() {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([612, 792]), doc.addPage([612, 792])];
  const root = pagesDictOf(doc);
  root.set(PDFName.of("MediaBox"), doc.context.obj([0, 0, 612, 792]));
  for (const p of pages) {
    p.node.delete(PDFName.of("MediaBox"));
  }
  pages[1].setCropBox(36, 36, 540, 720);
  return doc.save({ useObjectStreams: false });
}

/** Last page /Rotate 90 and the Pages root /Rotate 90 (inherited by other pages). */
async function buildRotatedPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const last = doc.addPage([612, 792]);
  pagesDictOf(doc).set(PDFName.of("Rotate"), doc.context.obj(90));
  last.setRotation(degrees(90));
  return doc.save({ useObjectStreams: false });
}

/** Document without an Info dictionary. */
async function buildNoInfoPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([300, 300]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** Document whose paper style entry holds an unknown value. */
async function buildInvalidStylePdf(value = "ruled-7mm") {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.setTitle("Invalid style");
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of("ZoteroHandwrittenNotesPaperStyle"), PDFString.of(value));
  return doc.save({ useObjectStreams: false });
}

/** Hand-written minimal classic PDF whose trailer references an /Encrypt dictionary. */
function buildEncryptedPdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    "<< /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Replace the first occurrence of an ASCII token (same length) in a byte array copy. */
function breakToken(bytes, token, replacement) {
  const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const idx = s.lastIndexOf(token);
  if (idx < 0 || replacement.length !== token.length) {
    throw new Error("breakToken failed");
  }
  const out = new Uint8Array(bytes);
  for (let i = 0; i < token.length; i++) {
    out[idx + i] = replacement.charCodeAt(i);
  }
  return out;
}

module.exports = {
  PDFLib,
  PDFArray,
  buildXrefStreamPdf,
  buildLetterInheritedPdf,
  buildRotatedPdf,
  buildNoInfoPdf,
  buildInvalidStylePdf,
  buildEncryptedPdf,
  breakToken,
};
