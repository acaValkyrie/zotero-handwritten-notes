import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addonDir = path.join(root, "addon");
const buildDir = path.join(root, "build");

function fail(message) {
  console.error(`build error: ${message}`);
  process.exit(1);
}

// ---- CRC-32 (self-implemented) ----
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---- manifest ----
function readManifest() {
  const manifestPath = path.join(addonDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    fail(`cannot read addon/manifest.json: ${e.message}`);
  }
  const zotero = manifest.applications && manifest.applications.zotero;
  const version = manifest.version;
  if (!version) fail("manifest.version is missing");
  if (!zotero) fail("manifest.applications.zotero is missing");
  for (const key of ["id", "strict_min_version", "strict_max_version"]) {
    if (!zotero[key]) fail(`manifest.applications.zotero.${key} is missing`);
  }
  if (!manifest.homepage_url) fail("manifest.homepage_url is missing");
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/.exec(manifest.homepage_url);
  if (!m) fail("homepage_url must be https://github.com/<owner>/<repo>");
  return {
    version,
    id: zotero.id,
    min: zotero.strict_min_version,
    max: zotero.strict_max_version,
    owner: m[1],
    repo: m[2],
  };
}

// ---- file collection ----
function collectFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, rel));
    else if (entry.isFile()) out.push({ name: rel, data: fs.readFileSync(full) });
  }
  return out;
}

// ---- ZIP writer ----
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const FLAGS = 0x0800; // UTF-8 names

function buildZip(files) {
  const localParts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const comp = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    if (f.data.length >= 0xffffffff || comp.length >= 0xffffffff || offset >= 0xffffffff) {
      fail(`zip64 required for ${f.name}; not supported`);
    }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(FLAGS, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    localParts.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(FLAGS, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  if (files.length >= 0xffff || offset + centralBuf.length >= 0xffffffff) {
    fail("zip64 required; not supported");
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

// ---- ZIP verification (own reader) ----
function verifyZip(zip, files) {
  const eocdPos = zip.length - 22;
  if (eocdPos < 0 || zip.readUInt32LE(eocdPos) !== 0x06054b50) fail("verify: EOCD not found");
  const count = zip.readUInt16LE(eocdPos + 10);
  let pos = zip.readUInt32LE(eocdPos + 16);
  if (count !== files.length) fail(`verify: entry count ${count} != ${files.length}`);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) fail("verify: bad central header");
    const method = zip.readUInt16LE(pos + 10);
    const crc = zip.readUInt32LE(pos + 16);
    const csize = zip.readUInt32LE(pos + 20);
    const usize = zip.readUInt32LE(pos + 24);
    const nlen = zip.readUInt16LE(pos + 28);
    const elen = zip.readUInt16LE(pos + 30);
    const clen = zip.readUInt16LE(pos + 32);
    const lho = zip.readUInt32LE(pos + 42);
    const name = zip.toString("utf8", pos + 46, pos + 46 + nlen);
    pos += 46 + nlen + elen + clen;
    const src = files[i];
    if (name !== src.name) fail(`verify: entry ${i} name ${name} != ${src.name}`);
    if (method !== 8) fail(`verify: ${name} method ${method}`);
    if (zip.readUInt32LE(lho) !== 0x04034b50) fail(`verify: bad local header for ${name}`);
    const lnlen = zip.readUInt16LE(lho + 26);
    const lelen = zip.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const data = zlib.inflateRawSync(zip.subarray(start, start + csize));
    if (data.length !== usize || !data.equals(src.data)) fail(`verify: content mismatch for ${name}`);
    if (crc32(data) !== crc || crc !== crc32(src.data)) fail(`verify: CRC mismatch for ${name}`);
  }
}

// ---- main ----
const args = process.argv.slice(2);
let checkTag = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--check-tag") {
    checkTag = args[++i];
    if (!checkTag) fail("--check-tag requires a value");
  } else {
    fail(`unknown argument: ${args[i]}`);
  }
}

const info = readManifest();
if (checkTag !== null && checkTag !== `v${info.version}`) {
  fail(`tag ${checkTag} does not match manifest version v${info.version}`);
}

const files = collectFiles(addonDir).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
if (files.length === 0) fail("addon/ contains no files");

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

const xpiName = `zotero-handwritten-notes-${info.version}.xpi`;
const xpiPath = path.join(buildDir, xpiName);
const zip = buildZip(files);
fs.writeFileSync(xpiPath, zip);
const sha256 = crypto.createHash("sha256").update(zip).digest("hex");

const updates = {
  addons: {
    [info.id]: {
      updates: [
        {
          version: info.version,
          update_link: `https://github.com/${info.owner}/${info.repo}/releases/download/v${info.version}/${xpiName}`,
          update_hash: `sha256:${sha256}`,
          applications: {
            zotero: {
              strict_min_version: info.min,
              strict_max_version: info.max,
            },
          },
        },
      ],
    },
  },
};
const updatesPath = path.join(buildDir, "updates.json");
fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + "\n");

verifyZip(fs.readFileSync(xpiPath), files);

console.log(`xpi:     ${xpiPath}`);
console.log(`updates: ${updatesPath}`);
console.log(`entries: ${files.length}`);
console.log(`size:    ${zip.length} bytes`);
console.log(`sha256:  ${sha256}`);
