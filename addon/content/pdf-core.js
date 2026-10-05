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
  const MAX_ADD_PAGES = 100;

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
     * @param {string} code One of INVALID_STYLE, INVALID_COUNT, NOT_NOTEBOOK, ENCRYPTED, PARSE_FAILED, UNSUPPORTED_STRUCTURE, VALIDATION_FAILED.
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
   * @param {number} [unit] Page /UserUnit; mm lengths are divided by it (default 1).
   * @returns {string} Content stream text, "" for blank or when no line fits.
   */
  function buildPaperContent(style, box, unit = 1) {
    if (style !== "ruled-6mm" && style !== "grid-5mm") {
      return "";
    }
    const m = mmToPt(10) / unit;
    const xLeft = box.x + m;
    const xRight = box.x + box.width - m;
    const yTop = box.y + box.height - m;
    const yBottom = box.y + m;
    const segs = [];
    let head;
    if (style === "ruled-6mm") {
      const step = mmToPt(6) / unit;
      for (let k = 0; yTop - k * step >= yBottom - EPS; k++) {
        const y = yTop - k * step;
        segs.push([xLeft, y, xRight, y]);
      }
      if (segs.length < 1) {
        return "";
      }
      head = "0.5 w\n0.62 0.7 0.8 RG";
    } else {
      const step = mmToPt(5) / unit;
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

  /**
   * Encode a binary string (one char per byte, as pdf-lib keeps literal strings) as Latin-1 bytes.
   */
  function enc(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0xff) {
        throw new Error(`Character code ${c} at ${i} is not representable as Latin-1.`);
      }
      out[i] = c & 0xff;
    }
    return out;
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
    const key = enc("startxref");
    let idx = -1;
    for (let i = bytes.length - key.length; i >= 0 && idx < 0; i--) {
      let j = 0;
      while (j < key.length && bytes[i + j] === key[j]) {
        j++;
      }
      if (j === key.length) {
        idx = i;
      }
    }
    if (idx < 0) {
      throw unsupported("startxref not found.");
    }
    const after = idx + key.length;
    const m = /^\s*(\d+)/.exec(latin1(bytes, after, Math.min(bytes.length, after + 64)));
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
   * @returns {Promise<{status:"ok"|"missing"|"invalid", style:string|null, raw:string|null, pageCount:number}>}
   */
  async function readPaperStyle(bytes) {
    bytes = toBytes(bytes);
    const doc = await loadDoc(bytes);
    const pageCount = doc.getPageCount();
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
      return { status: "missing", style: null, raw: null, pageCount };
    }
    const value = info.lookup(PDFName.of(METADATA_KEY));
    if (value === undefined) {
      return { status: "missing", style: null, raw: null, pageCount };
    }
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const raw = value.decodeText();
      if (isPaperStyle(raw)) {
        return { status: "ok", style: raw, raw, pageCount };
      }
      return { status: "invalid", style: null, raw, pageCount };
    }
    return { status: "invalid", style: null, raw: null, pageCount };
  }

  function boxArray(x, y, w, h) {
    return `[${fmt(x)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + h)}]`;
  }

  function offsetMatches(bytes, offset, num, gen) {
    const s = latin1(bytes, offset, Math.min(bytes.length, offset + 40));
    return s.startsWith(`${num} ${gen} obj`);
  }

  /**
   * Load a PDF and the root of its page tree for an incremental update.
   * @returns {Promise<{doc:object, trailer:object, pagesRef:object, pagesDict:object, kids:object, count:number, pageRefs:string[]}>}
   */
  async function loadPageTree(bytes) {
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
    return { doc, trailer, pagesRef, pagesDict, kids, count, pageRefs: doc.getPages().map((p) => p.ref.toString()) };
  }

  /**
   * Serialize an incremental update (new/rewritten objects + xref section) after the original bytes.
   * @param {Uint8Array} bytes Original bytes.
   * @param {object} trailer Result of getTrailer.
   * @param {{num:number, gen:number, body:Uint8Array[]}[]} objects Objects in write order.
   * @param {number|null} xrefNum Object number of the xref stream (stream kind only).
   * @returns {{result:Uint8Array, recorded:{num:number, gen:number, offset:number}[]}}
   */
  function writeUpdate(bytes, trailer, objects, xrefNum) {
    const prefix = bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a && bytes[bytes.length - 1] !== 0x0d ? enc("\n") : new Uint8Array(0);
    let pos = bytes.length + prefix.length;
    const parts = [prefix];
    const written = []; // {num, gen, offset}
    for (const obj of objects) {
      written.push({ num: obj.num, gen: obj.gen, offset: pos });
      for (const c of [enc(`${obj.num} ${obj.gen} obj\n`), ...obj.body]) {
        parts.push(c);
        pos += c.length;
      }
    }

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
    return { result: concat([bytes, ...parts]), recorded };
  }

  function validationError(msg, cause) {
    return new HandwrittenNotesError("VALIDATION_FAILED", msg, cause);
  }

  /**
   * Check that the original bytes are a prefix of the result and every recorded offset is right.
   */
  function verifyUpdate(bytes, result, recorded) {
    for (let i = 0; i < bytes.length; i++) {
      if (result[i] !== bytes[i]) {
        throw validationError("Original bytes were modified.");
      }
    }
    for (const w of recorded) {
      if (!offsetMatches(result, w.offset, w.num, w.gen)) {
        throw validationError(`Offset for object ${w.num} is wrong.`);
      }
    }
  }

  async function reloadResult(result) {
    try {
      return await PDFDocument.load(result, { updateMetadata: false });
    } catch (e) {
      throw validationError("Result PDF failed to load.", e);
    }
  }

  /**
   * Text of the Pages root object with new /Kids and /Count (other entries kept).
   */
  function pagesObjectText(pagesDict, kidStrs, count) {
    let text = "<< ";
    for (const [key, value] of pagesDict.entries()) {
      const k = key.toString();
      if (k === "/Kids" || k === "/Count") {
        continue;
      }
      text += `${k} ${value.toString()} `;
    }
    return text + `/Kids [${kidStrs.join(" ")}] /Count ${count} >>\nendobj\n`;
  }

  /**
   * Append new pages to a PDF using one incremental update (original bytes preserved).
   * All new pages are identical and share one content stream.
   * @param {Uint8Array} bytes Original PDF bytes.
   * @param {string} style Paper style of the new pages.
   * @param {number} addCount Number of pages to add (integer, 1-100).
   * @returns {Promise<{bytes:Uint8Array, pageCount:number, previousPageCount:number, addedCount:number}>}
   */
  async function appendPages(bytes, style, addCount) {
    if (!isPaperStyle(style)) {
      throw new HandwrittenNotesError("INVALID_STYLE", `Unknown paper style: ${String(style)}`);
    }
    if (typeof addCount !== "number" || !Number.isInteger(addCount) || addCount < 1 || addCount > MAX_ADD_PAGES) {
      throw new HandwrittenNotesError("INVALID_COUNT", `Page count must be an integer from 1 to ${MAX_ADD_PAGES}.`);
    }
    bytes = toBytes(bytes);
    const { doc, trailer, pagesRef, pagesDict, kids, count, pageRefs: originalPageRefs } = await loadPageTree(bytes);
    // Geometry from the last page.
    const last = doc.getPages().at(-1);
    const norm = (b) => {
      const x1 = b.x + b.width;
      const y1 = b.y + b.height;
      return { x: Math.min(b.x, x1), y: Math.min(b.y, y1), width: Math.abs(b.width), height: Math.abs(b.height) };
    };
    const media = norm(last.getMediaBox());
    const cropRaw = norm(last.getCropBox());
    // Effective crop = CropBox ∩ MediaBox (MediaBox when empty).
    const ix0 = Math.max(media.x, cropRaw.x);
    const iy0 = Math.max(media.y, cropRaw.y);
    const ix1 = Math.min(media.x + media.width, cropRaw.x + cropRaw.width);
    const iy1 = Math.min(media.y + media.height, cropRaw.y + cropRaw.height);
    const crop = ix1 - ix0 > 0 && iy1 - iy0 > 0 ? { x: ix0, y: iy0, width: ix1 - ix0, height: iy1 - iy0 } : media;
    const angle = ((last.getRotation().angle % 360) + 360) % 360;
    // /UserUnit of the last page itself (not inherited).
    let unit = 1;
    let unitStr = null;
    const uuRaw = last.node.lookup(PDFName.of("UserUnit"));
    if (uuRaw !== undefined) {
      if (!(uuRaw instanceof PDFNumber) || !Number.isFinite(uuRaw.asNumber()) || uuRaw.asNumber() <= 0) {
        throw unsupported("Invalid /UserUnit.");
      }
      unit = uuRaw.asNumber();
      if (unit !== 1) {
        unitStr = unit.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
        unit = Number(unitStr);
        if (!(unit > 0)) {
          throw unsupported("Invalid /UserUnit.");
        }
      }
    }
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
    const content = buildPaperContent(style, drawBox, unit);
    const contentBytes = enc(content);

    let next = Math.max(trailer.Size, doc.context.largestObjectNumber + 1);
    const contentNum = content ? next++ : null;
    const pageNums = [];
    for (let i = 0; i < addCount; i++) {
      pageNums.push(next++);
    }
    const xrefNum = trailer.kind === "stream" ? next++ : null;

    const objects = [];
    if (content) {
      objects.push({
        num: contentNum,
        gen: 0,
        body: [enc(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, enc("\nendstream\nendobj\n")],
      });
    }

    let pageText = `<< /Type /Page /Parent ${pagesRef.toString()} /MediaBox ${mediaStr} /CropBox ${cropStr} /Rotate 0 /Resources << >>`;
    if (unitStr !== null) {
      pageText += ` /UserUnit ${unitStr}`;
    }
    if (content) {
      pageText += ` /Contents ${contentNum} 0 R`;
    }
    pageText += " >>\nendobj\n";
    for (const num of pageNums) {
      objects.push({ num, gen: 0, body: [enc(pageText)] });
    }

    const kidStrs = kids.asArray().map((k) => k.toString());
    for (const num of pageNums) {
      kidStrs.push(`${num} 0 R`);
    }
    objects.push({
      num: pagesRef.objectNumber,
      gen: pagesRef.generationNumber,
      body: [enc(pagesObjectText(pagesDict, kidStrs, count + addCount))],
    });

    const { result, recorded } = writeUpdate(bytes, trailer, objects, xrefNum);

    // Validation.
    verifyUpdate(bytes, result, recorded);
    const check = await reloadResult(result);
    if (check.getPageCount() !== count + addCount) {
      throw validationError("Result page count mismatch.");
    }
    const checkPages = check.getPages();
    for (let i = 0; i < count; i++) {
      if (checkPages[i].ref.toString() !== originalPageRefs[i]) {
        throw validationError(`Existing page ${i + 1} was replaced.`);
      }
    }
    for (let i = count; i < count + addCount; i++) {
      const mb = checkPages[i].getMediaBox();
      if (
        Math.abs(mb.x - expectedMedia.x) > EPS ||
        Math.abs(mb.y - expectedMedia.y) > EPS ||
        Math.abs(mb.width - expectedMedia.width) > EPS ||
        Math.abs(mb.height - expectedMedia.height) > EPS
      ) {
        throw validationError(`New page ${i + 1} MediaBox mismatch.`);
      }
    }

    return { bytes: result, pageCount: count + addCount, previousPageCount: count, addedCount: addCount };
  }

  /**
   * Append one page to a PDF (see appendPages).
   * @param {Uint8Array} bytes Original PDF bytes.
   * @param {string} style Paper style of the new page.
   * @returns {Promise<{bytes:Uint8Array, pageCount:number, previousPageCount:number, addedCount:number}>}
   */
  async function appendPage(bytes, style) {
    return appendPages(bytes, style, 1);
  }

  /**
   * Remove pages from the end of a notebook created by this plugin, using one incremental update
   * that rewrites only the Pages root. The page objects themselves stay in the file.
   * @param {Uint8Array} bytes Original PDF bytes.
   * @param {number} removeCount Number of pages to remove (integer, 1 to pageCount - 1).
   * @returns {Promise<{bytes:Uint8Array, pageCount:number, previousPageCount:number, removedCount:number}>}
   */
  async function removeLastPages(bytes, removeCount) {
    bytes = toBytes(bytes);
    const style = await readPaperStyle(bytes);
    if (style.status !== "ok") {
      throw new HandwrittenNotesError("NOT_NOTEBOOK", "The PDF was not created by Handwritten Notes.");
    }
    const pageCount = style.pageCount;
    if (typeof removeCount !== "number" || !Number.isInteger(removeCount) || removeCount < 1 || removeCount > pageCount - 1) {
      throw new HandwrittenNotesError("INVALID_COUNT", `Page count must be an integer from 1 to ${pageCount - 1}.`);
    }
    const { doc, trailer, pagesRef, pagesDict, kids, count } = await loadPageTree(bytes);
    const kidList = kids.asArray();
    if (kidList.length !== count) {
      throw unsupported("Page tree is not flat.");
    }
    for (const kid of kidList) {
      const node = kid instanceof PDFRef ? doc.context.lookup(kid) : undefined;
      const type = node instanceof PDFDict ? node.lookup(PDFName.of("Type")) : undefined;
      if (!(type instanceof PDFName) || type.toString() !== "/Page") {
        throw unsupported("Page tree is not flat.");
      }
    }
    const keep = count - removeCount;
    const keptStrs = kidList.slice(0, keep).map((k) => k.toString());

    let next = Math.max(trailer.Size, doc.context.largestObjectNumber + 1);
    const xrefNum = trailer.kind === "stream" ? next++ : null;
    const objects = [
      {
        num: pagesRef.objectNumber,
        gen: pagesRef.generationNumber,
        body: [enc(pagesObjectText(pagesDict, keptStrs, keep))],
      },
    ];
    const { result, recorded } = writeUpdate(bytes, trailer, objects, xrefNum);

    verifyUpdate(bytes, result, recorded);
    const check = await reloadResult(result);
    if (check.getPageCount() !== keep) {
      throw validationError("Result page count mismatch.");
    }
    const checkPages = check.getPages();
    for (let i = 0; i < keep; i++) {
      if (checkPages[i].ref.toString() !== keptStrs[i]) {
        throw validationError(`Page ${i + 1} reference changed.`);
      }
    }

    return { bytes: result, pageCount: keep, previousPageCount: count, removedCount: removeCount };
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
    appendPages,
    removeLastPages,
    HandwrittenNotesError,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createHandwrittenNotesPDF };
}
