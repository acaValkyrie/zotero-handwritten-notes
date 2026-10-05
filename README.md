# Zotero Handwritten Notes

A Zotero 10 plugin that attaches a handwriting notebook PDF to any paper in your library, so you can read the paper on your computer and take handwritten notes next to it on an iPad with Apple Pencil.

## Features

- Create handwritten-note PDFs attached to Zotero items
- Blank paper
- 6 mm ruled paper
- 5 mm grid paper
- Add pages while preserving Zotero annotations
- Designed for iPad + Apple Pencil

## Requirements

- Zotero 10.x desktop (Windows, macOS, or Linux)
- To write on an iPad: Zotero for iOS/iPadOS, with Zotero Sync configured for both data and files

The plugin runs on the desktop app only. The iPad app uses the PDFs and ink annotations that sync from the desktop; nothing has to be installed on the iPad.

## Installation

1. Download `zotero-handwritten-notes-<version>.xpi` from the [latest release](https://github.com/acaValkyrie/zotero-handwritten-notes/releases/latest).
2. In Zotero, open **Tools → Plugins**.
3. Drag the `.xpi` file onto the Plugins window, or use the gear menu → **Install Plugin From File…**.

Zotero checks the release feed for updates automatically.

## Usage

### Create a notebook

1. Right-click a regular item (journal article, conference paper, preprint, thesis, …).
2. Choose **Create Handwritten Notes**.
3. Pick a paper style and click **Create**.

A one-page A4 PDF named `Handwritten Notes.pdf` is added as a child attachment of the item:

```text
Paper Item
├── paper.pdf
└── Handwritten Notes.pdf
```

If the item already has one, the new notebook is named `Handwritten Notes 2.pdf`, `Handwritten Notes 3.pdf`, and so on. Existing files are never overwritten.

Sync, then open `Handwritten Notes.pdf` on your iPad and write on it with the ink tool. Your handwriting is saved as Zotero ink annotations and syncs like any other annotation.

### Add a page

When you run out of space:

1. On the desktop, right-click the notebook PDF.
2. Choose **Add Page**.

A page in the same paper style is appended to the end of the notebook. Sync again and the new page appears on the iPad.

**Add Page** also works on other PDF attachments. In that case the plugin cannot know which paper style to use, so it asks you.

## Paper Styles

All styles are A4 portrait (210 mm × 297 mm). Lines are thin, light-colored vector paths, so they stay sharp at any zoom and keep the file small. No images are embedded.

### Blank

An empty page with nothing drawn on it.

### Ruled — 6 mm

Horizontal lines exactly 6 mm apart, inside a 10 mm margin.

### Grid — 5 mm

Square 5 mm × 5 mm grid, inside a 10 mm margin.

Spacing is computed from 1 mm = 72 / 25.4 pt and written without rounding to whole points. Pages appended to a PDF with a different page size keep the same physical spacing.

## How It Works

- **New notebooks** are generated with [pdf-lib](https://github.com/Hopding/pdf-lib) and imported as stored attachments, so Zotero File Sync uploads them.
- **The paper style** is recorded in the PDF's document information dictionary (`/ZoteroHandwrittenNotesPaperStyle`). It travels with the file, so **Add Page** on another computer knows the style too, and it does not touch the item's bibliographic fields.
- **Adding a page** uses a PDF *incremental update*:
  - The original file is kept byte for byte, and the new page, an updated page tree, and a new cross-reference section are appended after it.
  - Existing pages are never re-generated, re-rendered, resized, rotated, or reordered, so the page objects your annotations point at stay exactly the same.
  - Zotero annotations live in Zotero's database, keyed by page index. Appending at the end does not change any existing page index, and the plugin never copies, moves, or flattens annotations.
- **The new page** uses the previous last page's MediaBox and CropBox. If that page is rotated, the new page gets the same visible size without rotation, so the lines run the right way.
- **Before the original is replaced**, the result is written to a temporary file, read back, and checked:
  - The original bytes are unchanged.
  - Every new cross-reference offset is correct.
  - The page count went up by exactly one.
  - Existing page objects were not replaced.

  If anything fails, or the file changed on disk in the meantime, the original PDF is left untouched.
- **After replacing the file**, the plugin updates Zotero the same way Zotero's own "Rotate Pages" command does:
  - It marks the attachment for upload.
  - It reloads any open reader tab.
  - It re-indexes the full text.

## Sync Behavior

Day to day, only annotations sync:

```text
Apple Pencil → ink annotation → Zotero data sync
```

When you add a page:

```text
Add Page → PDF file updated → Zotero file sync → iPad downloads the new file
```

After that, only annotations sync again. Add pages on the desktop and let the new file sync to the iPad before writing on the new page there.

## Compatibility

| | Status |
|---|---|
| Zotero 10.x desktop on Windows, macOS, Linux | Supported |
| Zotero 9.x and earlier | Not supported |
| Zotero beta / nightly builds, Zotero 11+ | Untested |
| Zotero for iOS/iPadOS | Not a plugin target; uses the synced PDFs and annotations |

Encrypted PDFs, and PDFs whose cross-reference data cannot be located reliably, are rejected without modification.

## Development

Requires Node.js 20 or later. There are no npm dependencies.

```sh
npm test         # unit tests for PDF generation and page appending
npm run build    # writes build/zotero-handwritten-notes-<version>.xpi and build/updates.json
```

To run the plugin from source:

1. Close Zotero.
2. In your Zotero profile's `extensions` directory, create a file named `handwritten-notes@acavalkyrie.github.io` whose content is the absolute path of this repository's `addon` directory.
3. Start Zotero.

Use a separate profile and data directory for development (`zotero -P`).

Layout:

```text
addon/
├── manifest.json, bootstrap.js
├── content/
│   ├── pdf-core.js               # paper drawing, PDF creation, incremental page append
│   ├── handwritten-notes.js      # Zotero menus, attachment handling, file replacement
│   └── paper-style-dialog.*      # paper style dialog
├── locale/{en-US,ja-JP}/         # Fluent strings
└── vendor/pdf-lib.min.js         # pdf-lib 1.17.1 (MIT)
scripts/
├── build.mjs                     # dependency-free XPI builder
├── make-samples.js, verify-pypdf.py   # optional cross-check with pypdf
test/                             # node:test unit tests
```

Releases: bump `version` in `addon/manifest.json`, commit, and push a tag `v<version>`. GitHub Actions builds the XPI and `updates.json` and attaches both to a GitHub release. The plugin's `update_url` points at `releases/latest/download/updates.json`.

## License

[MIT](LICENSE). Bundles [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1, © Andrew Dillon, MIT License ([addon/vendor/pdf-lib.LICENSE.md](addon/vendor/pdf-lib.LICENSE.md)).
