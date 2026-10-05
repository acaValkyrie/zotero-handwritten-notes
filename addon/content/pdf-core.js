/*
 * PDF core for "Zotero Handwritten Notes".
 *
 * Environment-neutral: in Zotero it is loaded with Services.scriptloader.loadSubScript
 * (PDFLib already global) and createHandwrittenNotesPDF(PDFLib) is called by the caller;
 * in Node tests it is loaded with require().
 */

/**
 * Create the PDF core API bound to a pdf-lib instance.
 * @param {object} PDFLib pdf-lib namespace (UMD global).
 * @returns {object} API object.
 */
function createHandwrittenNotesPDF(PDFLib) {
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFArray, PDFNumber, PDFRef } = PDFLib;

  const PAPER_STYLES = Object.freeze(["blank", "ruled-6mm", "grid-5mm"]);
  const METADATA_KEY = "ZoteroHandwrittenNotesPaperStyle";
  const EPS = 1e-6;

  /**
   * Convert millimetres to PDF points (no rounding).
   * @param {number} mm
   * @returns {number}
   */
  function mmToPt(mm) {
    return (mm * 72) / 25.4;
  }

  const A4 = Object.freeze({ width: mmToPt(210), height: mmToPt(297) });

  /**
   * Error with a machine-readable code.
   */
  class HandwrittenNotesError extends Error {
    /**
     * @param {string} code One of INVALID_STYLE, ENCRYPTED, PARSE_FAILED, UNSUPPORTED_STRUCTURE, VALIDATION_FAILED.
     * @param {string} message
     * @param {unknown} [cause]
     */
    constructor(code, message, cause) {
      super(message);
      this.name = "HandwrittenNotesError";
      this.code = code;
      if (cause !== undefined) {
        this.cause = cause;
      }
    }
  }

  /**
   * @param {unknown} value
   * @returns {boolean} true if value is a known paper style.
   */
  function isPaperStyle(value) {
    return typeof value === "string" && PAPER_STYLES.includes(value);
  }

  function fmt(n) {
    let s = n.toFixed(4);
    if (s.includes(".")) {
      s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    if (s === "-0") {
      s = "0";
    }
    return s;
  }

  /**
   * Build the page content stream text for a paper style.
   * @param {string} style Paper style.
   * @param {{x:number,y:number,width:number,height:number}} box Drawing box in pt.
   * @returns {string} Content stream text, "" for blank or when no line fits.
   */
  function buildPaperContent(style, box) {
    if (style !== "ruled-6mm" && style !== "grid-5mm") {
      return "";
    }
    const m = mmToPt(10);
    const xLeft = box.x + m;
    const xRight = box.x + box.width - m;
    const yTop = box.y + box.height - m;
    const yBottom = box.y + m;
    const segs = [];
    let head;
    if (style === "ruled-6mm") {
      const step = mmToPt(6);
      for (let k = 0; yTop - k * step >= yBottom - EPS; k++) {
        const y = yTop - k * step;
        segs.push([xLeft, y, xRight, y]);
      }
      if (segs.length < 1) {
        return "";
      }
      head = "0.5 w\n0.62 0.7 0.8 RG";
    } else {
      const step = mmToPt(5);
      const xs = [];
      const ys = [];
      for (let i = 0; xLeft + i * step <= xRight + EPS; i++) {
        xs.push(xLeft + i * step);
      }
      for (let k = 0; yTop - k * step >= yBottom - EPS; k++) {
        ys.push(yTop - k * step);
      }
      if (xs.length < 2 || ys.length < 2) {
        return "";
      }
      const yLast = ys[ys.length - 1];
      const xLast = xs[xs.length - 1];
      for (const x of xs) {
        segs.push([x, yTop, x, yLast]);
      }
      for (const y of ys) {
        segs.push([xLeft, y, xLast, y]);
      }
      head = "0.4 w\n0.75 0.8 0.86 RG";
    }
    const lines = ["q", head];
    for (const [x1, y1, x2, y2] of segs) {
      lines.push(`${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l`);
    }
    lines.push("S", "Q");
    return lines.join("\n") + "\n";
  }

  const encoder = new TextEncoder();

  function enc(s) {
    return encoder.encode(s);
  }

  function concat(parts) {
    let total = 0;
    for (const p of parts) {
      total += p.length;
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  function latin1(bytes, start, end) {
    let s = "";
    const stop = end === undefined ? bytes.length : end;
    for (let i = start; i < stop; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, stop)));
    }
    return s;
  }

  /**
   * Copy any ArrayBuffer / ArrayBuffer view (possibly from another realm) into this realm's Uint8Array.
   * instanceof checks fail across realms (e.g. IOUtils.read results in a Zotero plugin sandbox).
   */
  function toBytes(input) {
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    }
    const tag = Object.prototype.toString.call(input);
    if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") {
      return new Uint8Array(input.slice(0));
    }
    throw new HandwrittenNotesError("PARSE_FAILED", "Input is not a byte array.");
  }

  async function loadDoc(bytes) {
    try {
      return await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      const encrypted =
        (PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) ||
        (e && e.constructor && e.constructor.name === "EncryptedPDFError") ||
        (e instanceof Error && /\bis encrypted\b/.test(e.message));
      if (encrypted) {
        throw new HandwrittenNotesError("ENCRYPTED", "The PDF is encrypted.", e);
      }
      throw new HandwrittenNotesError("PARSE_FAILED", "Failed to parse the PDF.", e);
    }
  }

  function unsupported(msg) {
    return new HandwrittenNotesError("UNSUPPORTED_STRUCTURE", msg);
  }

  /**
   * Locate the cross-reference section named by the last startxref.
   * @returns {{offset:number, kind:string, ref:object|null}}
   */
  function locateXref(doc, bytes) {
    const tailStart = Math.max(0, bytes.length - 4096);
    const tail = latin1(bytes, tailStart);
    const idx = tail.lastIndexOf("startxref");
    if (idx < 0) {
      throw unsupported("startxref not found.");
    }
    const m = /^\s*(\d+)/.exec(tail.slice(idx + "startxref".length, idx + "startxref".length + 64));
    if (!m) {
      throw unsupported("startxref offset not parsable.");
    }
    const offset = Number(m[1]);
    if (!(offset >= 0 && offset < bytes.length)) {
      throw unsupported("startxref offset out of range.");
    }
    let p = offset;
    while (p < bytes.length && (bytes[p] === 0x20 || bytes[p] === 0x0a || bytes[p] === 0x0d || bytes[p] === 0x09 || bytes[p] === 0x0c || bytes[p] === 0x00)) {
      p++;
    }
    const head = latin1(bytes, p, Math.min(bytes.length, p + 64));
    if (head.startsWith("xref")) {
      return { offset, kind: "table", ref: null };
    }
    const om = /^(\d+)\s+(\d+)\s+obj\b/.exec(head);
    if (om) {
      const ref = PDFRef.of(Number(om[1]), Number(om[2]));
      const obj = doc.context.lookup(ref);
      let dict = obj && obj.dict instanceof PDFDict ? obj.dict : null;
      if (!dict) {
        // pdf-lib does not register the XRef stream object itself; parse its dictionary directly.
        try {
          const parser = PDFLib.PDFObjectParser.forBytes(bytes.subarray(p + om[0].length), doc.context);
          const parsed = parser.parseObject();
          dict = parsed instanceof PDFDict ? parsed : parsed && parsed.dict instanceof PDFDict ? parsed.dict : null;
        } catch (e) {
          dict = null;
        }
      }
      const type = dict ? dict.get(PDFName.of("Type")) : null;
      if (!dict || !(type instanceof PDFName) || type.toString() !== "/XRef") {
        throw unsupported("startxref does not point to an XRef stream.");
      }
      return { offset, kind: "stream", ref, dict };
    }
    throw unsupported("startxref does not point to a cross-reference section.");
  }

  /**
   * Gather trailer data of the latest cross-reference section.
   * @returns {{Root:object, Info:object|undefined, ID:object|undefined, Encrypt:object|undefined, Size:number, xrefOffset:number, kind:string}}
   */
  function getTrailer(doc, bytes) {
    const loc = locateXref(doc, bytes);
    let Root;
    let Info;
    let ID;
    let Encrypt;
    let Size;
    if (loc.kind === "table") {
      const ti = doc.context.trailerInfo;
      Root = ti.Root;
      Info = ti.Info;
      ID = ti.ID;
      Encrypt = ti.Encrypt;
      const text = latin1(bytes, loc.offset);
      const sm = /trailer[\s\S]*?\/Size\s+(\d+)/.exec(text);
      if (!sm) {
        throw unsupported("Trailer /Size not found.");
      }
      Size = Number(sm[1]);
    } else {
      const d = loc.dict;
      Root = d.get(PDFName.of("Root"));
      Info = d.get(PDFName.of("Info"));
      ID = d.get(PDFName.of("ID"));
      Encrypt = d.get(PDFName.of("Encrypt"));
      const sz = d.lookup(PDFName.of("Size"));
      if (!(sz instanceof PDFNumber)) {
        throw unsupported("XRef stream /Size missing.");
      }
      Size = sz.asNumber();
    }
    if (!Root) {
      throw unsupported("Trailer /Root missing.");
    }
    return { Root, Info, ID, Encrypt, Size, xrefOffset: loc.offset, kind: loc.kind };
  }

  /**
   * Create a new single-page A4 note PDF.
   * @param {string} style Paper style.
   * @returns {Promise<Uint8Array>}
   */
  async function createNotePdf(style) {
    if (!isPaperStyle(style)) {
      throw new HandwrittenNotesError("INVALID_STYLE", `Unknown paper style: ${String(style)}`);
    }
    const doc = await PDFDocument.create();
    const page = doc.addPage([A4.width, A4.height]);
    const content = buildPaperContent(style, { x: 0, y: 0, width: A4.width, height: A4.height });
    if (content) {
      const stream = doc.context.stream(content);
      const ref = doc.context.register(stream);
      page.node.set(PDFName.of("Contents"), ref);
    }
    doc.setTitle("Handwritten Notes");
    doc.setCreator("Zotero Handwritten Notes");
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    info.set(PDFName.of(METADATA_KEY), PDFString.of(style));
    return doc.save({ useObjectStreams: false });
  }

  /**
   * Read the paper style stored in the Info dictionary.
   * @param {Uint8Array} bytes PDF bytes.
   * @returns {Promise<{status:"ok"|"missing"|"invalid", style:string|null, raw:string|null}>}
   */
  async function readPaperStyle(bytes) {
    bytes = toBytes(bytes);
    const doc = await loadDoc(bytes);
    let infoObj = doc.context.trailerInfo.Info;
    if (!infoObj) {
      try {
        infoObj = getTrailer(doc, bytes).Info;
      } catch (e) {
        infoObj = undefined;
      }
    }
    const info = infoObj ? doc.context.lookup(infoObj) : undefined;
    if (!(info instanceof PDFDict)) {
      return { status: "missing", style: null, raw: null };
    }
    const value = info.lookup(PDFName.of(METADATA_KEY));
    if (value === undefined) {
      return { status: "missing", style: null, raw: null };
    }
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const raw = value.decodeText();
      if (isPaperStyle(raw)) {
        return { status: "ok", style: raw, raw };
      }
      return { status: "invalid", style: null, raw };
    }
    return { status: "invalid", style: null, raw: null };
  }

  function boxArray(x, y, w, h) {
    return `[${fmt(x)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + h)}]`;
  }

  function offsetMatches(bytes, offset, num, gen) {
    const s = latin1(bytes, offset, Math.min(bytes.length, offset + 40));
    return s.startsWith(`${num} ${gen} obj`);
  }

  /**
   * Append a new page to a PDF using an incremental update (original bytes preserved).
   * @param {Uint8Array} bytes Original PDF bytes.
   * @param {string} style Paper style of the new page.
   * @returns {Promise<{bytes:Uint8Array, pageCount:number, previousPageCount:number}>}
   */
  async function appendPage(bytes, style) {
    if (!isPaperStyle(style)) {
      throw new HandwrittenNotesError("INVALID_STYLE", `Unknown paper style: ${String(style)}`);
    }
    bytes = toBytes(bytes);
    const doc = await loadDoc(bytes);
    const trailer = getTrailer(doc, bytes);
    if (trailer.Encrypt) {
      throw new HandwrittenNotesError("ENCRYPTED", "The PDF is encrypted.");
    }

    const catalog = doc.context.lookup(trailer.Root, PDFDict);
    const pagesRef = catalog.get(PDFName.of("Pages"));
    if (!(pagesRef instanceof PDFRef)) {
      throw unsupported("Catalog /Pages is not an indirect reference.");
    }
    const pagesDict = doc.context.lookup(pagesRef, PDFDict);
    const kids = pagesDict.lookup(PDFName.of("Kids"), PDFArray);
    const count = pagesDict.lookup(PDFName.of("Count"), PDFNumber).asNumber();
    if (count < 1 || count !== doc.getPageCount()) {
      throw unsupported("Page tree count mismatch.");
    }
    const originalPageRefs = doc.getPages().map((p) => p.ref.toString());

    // Geometry from the last page.
    const last = doc.getPages().at(-1);
    const media = last.getMediaBox();
    const crop = last.getCropBox();
    const angle = ((last.getRotation().angle % 360) + 360) % 360;
    // Boxes are written with fmt(); use the written (rounded) values everywhere.
    const rounded = (x, y, w, h) => ({
      x: Number(fmt(x)),
      y: Number(fmt(y)),
      width: Number(fmt(x + w)) - Number(fmt(x)),
      height: Number(fmt(y + h)) - Number(fmt(y)),
    });
    let mediaStr;
    let cropStr;
    let drawBox;
    let expectedMedia;
    if (angle === 0) {
      mediaStr = boxArray(media.x, media.y, media.width, media.height);
      cropStr = boxArray(crop.x, crop.y, crop.width, crop.height);
      drawBox = rounded(crop.x, crop.y, crop.width, crop.height);
      expectedMedia = rounded(media.x, media.y, media.width, media.height);
    } else {
      const swap = angle === 90 || angle === 270;
      const W = swap ? crop.height : crop.width;
      const H = swap ? crop.width : crop.height;
      mediaStr = boxArray(0, 0, W, H);
      cropStr = mediaStr;
      drawBox = rounded(0, 0, W, H);
      expectedMedia = drawBox;
    }
    const content = buildPaperContent(style, drawBox);
    const contentBytes = enc(content);

    let next = Math.max(trailer.Size, doc.context.largestObjectNumber + 1);
    const contentNum = content ? next++ : null;
    const pageNum = next++;
    const xrefNum = trailer.kind === "stream" ? next++ : null;

    const pagesNum = pagesRef.objectNumber;
    const pagesGen = pagesRef.generationNumber;

    const prefix = bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a && bytes[bytes.length - 1] !== 0x0d ? enc("\n") : new Uint8Array(0);
    let pos = bytes.length + prefix.length;
    const parts = [prefix];
    const written = []; // {num, gen, offset}
    const emit = (num, gen, body) => {
      const head = enc(`${num} ${gen} obj\n`);
      written.push({ num, gen, offset: pos });
      const chunks = [head, ...body];
      for (const c of chunks) {
        parts.push(c);
        pos += c.length;
      }
    };

    if (content) {
      emit(contentNum, 0, [
        enc(`<< /Length ${contentBytes.length} >>\nstream\n`),
        contentBytes,
        enc("\nendstream\nendobj\n"),
      ]);
    }

    let pageText = `<< /Type /Page /Parent ${pagesRef.toString()} /MediaBox ${mediaStr} /CropBox ${cropStr} /Rotate 0 /Resources << >>`;
    if (content) {
      pageText += ` /Contents ${contentNum} 0 R`;
    }
    pageText += " >>\nendobj\n";
    emit(pageNum, 0, [enc(pageText)]);

    let pagesText = "<< ";
    for (const [key, value] of pagesDict.entries()) {
      const k = key.toString();
      if (k === "/Kids" || k === "/Count") {
        continue;
      }
      pagesText += `${k} ${value.toString()} `;
    }
    const kidStrs = kids.asArray().map((k) => k.toString());
    kidStrs.push(`${pageNum} 0 R`);
    pagesText += `/Kids [${kidStrs.join(" ")}] /Count ${count + 1} >>\nendobj\n`;
    emit(pagesNum, pagesGen, [enc(pagesText)]);

    const highest = Math.max(...written.map((w) => w.num), xrefNum === null ? 0 : xrefNum);
    const newSize = Math.max(trailer.Size, highest + 1);
    const trailerKeys =
      `/Root ${trailer.Root.toString()}` +
      (trailer.Info ? ` /Info ${trailer.Info.toString()}` : "") +
      (trailer.ID ? ` /ID ${trailer.ID.toString()}` : "");

    let xrefStart;
    let recorded;
    if (trailer.kind === "table") {
      xrefStart = pos;
      const sorted = [...written].sort((a, b) => a.num - b.num);
      let t = "xref\n0 1\n0000000000 65535 f\r\n";
      for (const w of sorted) {
        t += `${w.num} 1\n${String(w.offset).padStart(10, "0")} ${String(w.gen).padStart(5, "0")} n\r\n`;
      }
      t += `trailer\n<< /Size ${newSize} ${trailerKeys} /Prev ${trailer.xrefOffset} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
      parts.push(enc(t));
      recorded = sorted;
    } else {
      xrefStart = pos;
      const all = [...written, { num: xrefNum, gen: 0, offset: xrefStart }].sort((a, b) => a.num - b.num);
      const rows = new Uint8Array(all.length * 7);
      all.forEach((w, i) => {
        const o = i * 7;
        rows[o] = 1;
        rows[o + 1] = (w.offset >>> 24) & 0xff;
        rows[o + 2] = (w.offset >>> 16) & 0xff;
        rows[o + 3] = (w.offset >>> 8) & 0xff;
        rows[o + 4] = w.offset & 0xff;
        rows[o + 5] = (w.gen >>> 8) & 0xff;
        rows[o + 6] = w.gen & 0xff;
      });
      const index = all.map((w) => `${w.num} 1`).join(" ");
      parts.push(enc(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${newSize} /W [1 4 2] /Index [${index}] /Prev ${trailer.xrefOffset} ${trailerKeys} /Length ${rows.length} >>\nstream\n`));
      parts.push(rows);
      parts.push(enc(`\nendstream\nendobj\nstartxref\n${xrefStart}\n%%EOF\n`));
      recorded = all;
    }

    const result = concat([bytes, ...parts]);

    // Validation.
    const fail = (msg, cause) => new HandwrittenNotesError("VALIDATION_FAILED", msg, cause);
    for (let i = 0; i < bytes.length; i++) {
      if (result[i] !== bytes[i]) {
        throw fail("Original bytes were modified.");
      }
    }
    for (const w of recorded) {
      if (!offsetMatches(result, w.offset, w.num, w.gen)) {
        throw fail(`Offset for object ${w.num} is wrong.`);
      }
    }
    let check;
    try {
      check = await PDFDocument.load(result, { updateMetadata: false });
    } catch (e) {
      throw fail("Result PDF failed to load.", e);
    }
    if (check.getPageCount() !== count + 1) {
      throw fail("Result page count mismatch.");
    }
    const checkPages = check.getPages();
    const mb = checkPages[checkPages.length - 1].getMediaBox();
    if (
      Math.abs(mb.x - expectedMedia.x) > EPS ||
      Math.abs(mb.y - expectedMedia.y) > EPS ||
      Math.abs(mb.width - expectedMedia.width) > EPS ||
      Math.abs(mb.height - expectedMedia.height) > EPS
    ) {
      throw fail("New page MediaBox mismatch.");
    }
    for (let i = 0; i < count; i++) {
      if (checkPages[i].ref.toString() !== originalPageRefs[i]) {
        throw fail(`Existing page ${i + 1} was replaced.`);
      }
    }

    return { bytes: result, pageCount: count + 1, previousPageCount: count };
  }

  return {
    PAPER_STYLES,
    isPaperStyle,
    mmToPt,
    A4,
    METADATA_KEY,
    buildPaperContent,
    createNotePdf,
    readPaperStyle,
    appendPage,
    HandwrittenNotesError,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createHandwrittenNotesPDF };
}
