"""Dev-only cross-check of generated sample PDFs with pypdf and pdfplumber.

Usage: python scripts/verify-pypdf.py <out-dir>
(Generate the samples first: node scripts/make-samples.js <out-dir>)
"""

import logging
import sys
from pathlib import Path

import pdfplumber
import pypdf

MM = 72 / 25.4


class Collector(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.records = []

    def emit(self, record):
        self.records.append(record.getMessage())


def check_file(path, collector):
    collector.records.clear()
    reader = pypdf.PdfReader(str(path), strict=True)
    n = len(reader.pages)
    print(f"{path.name}: {n} pages")
    for i, page in enumerate(reader.pages, 1):
        mb = page.mediabox
        print(f"  page {i}: mediabox [{float(mb.left):.4f} {float(mb.bottom):.4f} {float(mb.right):.4f} {float(mb.top):.4f}]")
    if collector.records:
        raise SystemExit(f"FAIL {path.name}: pypdf warnings: {collector.records}")
    return n


def check_ruled_spacing(path):
    with pdfplumber.open(str(path)) as pdf:
        page = pdf.pages[0]
        ys = {round(float(l["y0"]), 4) for l in page.lines if abs(l["y0"] - l["y1"]) < 1e-6}
        ys = sorted(ys, reverse=True)
        print(f"  horizontal lines on page 1: {len(ys)}; first {ys[:3]} last {ys[-2:]}")
        if len(ys) != 47:
            raise SystemExit(f"FAIL: expected 47 horizontal lines, got {len(ys)}")
        for a, b in zip(ys, ys[1:]):
            if abs((a - b) - 6 * MM) > 0.01:
                raise SystemExit(f"FAIL: spacing {a - b} != {6 * MM}")
        print(f"  spacing OK (6 mm = {6 * MM:.5f} pt, tolerance 0.01)")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    out_dir = Path(sys.argv[1])
    collector = Collector()
    logging.getLogger("pypdf").addHandler(collector)
    logging.getLogger("pypdf").setLevel(logging.WARNING)

    expected = {
        "note-blank.pdf": 3,
        "note-ruled-6mm.pdf": 3,
        "note-grid-5mm.pdf": 3,
        "xref-stream-appended.pdf": 4,
    }
    for name, pages in expected.items():
        path = out_dir / name
        n = check_file(path, collector)
        if n != pages:
            raise SystemExit(f"FAIL {name}: expected {pages} pages, got {n}")
    check_ruled_spacing(out_dir / "note-ruled-6mm.pdf")
    print("ALL OK")


if __name__ == "__main__":
    main()
