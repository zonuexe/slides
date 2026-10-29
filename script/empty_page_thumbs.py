#!/usr/bin/env python3
"""Render low-res PNGs for PDF pages that have no extracted text.

Output lives next to the PDF as ``pdf/<stem>/pN.png`` (1-based page numbers).
Stale thumbs for pages that later gained text are removed.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import fitz
import yaml

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "pdf"
TARGET_WIDTH = 480


def page_has_text(nodes: Any) -> bool:
    if not isinstance(nodes, list) or not nodes:
        return False
    for block in nodes:
        if not isinstance(block, dict):
            continue
        if block.get("kind") == "list":
            items = block.get("items") or []
            if any(str(item).strip() for item in items):
                return True
        elif str(block.get("text") or "").strip():
            return True
    return False


def empty_page_numbers(text_map: Any) -> list[int]:
    if not isinstance(text_map, dict):
        return []
    pages: list[int] = []
    for key, nodes in text_map.items():
        if not isinstance(key, str) or not key.startswith("p"):
            continue
        try:
            number = int(key[1:])
        except ValueError:
            continue
        if number >= 1 and not page_has_text(nodes):
            pages.append(number)
    pages.sort()
    return pages


def thumbs_dir_for(pdf_path: Path) -> Path:
    return pdf_path.with_suffix("")


def thumb_path(pdf_path: Path, page_number: int) -> Path:
    return thumbs_dir_for(pdf_path) / f"p{page_number}.png"


def _load_text_map(yaml_path: Path) -> Any:
    if not yaml_path.exists():
        return None
    with yaml_path.open("r", encoding="utf-8") as handle:
        meta = yaml.safe_load(handle) or {}
    if not isinstance(meta, dict):
        return None
    return meta.get("text")


def _rewrite_png(image_path: Path, dest: Path) -> None:
    magick = shutil.which("magick")
    if magick is None:
        raise RuntimeError("zopflipng could not decode PNG and magick is unavailable")
    subprocess.run([magick, str(image_path), str(dest)], check=True)


def _compress_png(image_path: Path) -> None:
    zopflipng = shutil.which("zopflipng")
    if not zopflipng:
        return

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
        tmp_name = tmp_file.name

    rewritten: Path | None = None
    try:
        result = subprocess.run(
            [zopflipng, "-m", "-y", str(image_path), tmp_name],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            rewritten = Path(f"{tmp_name}.src.png")
            _rewrite_png(image_path, rewritten)
            subprocess.run(
                [zopflipng, "-m", "-y", str(rewritten), tmp_name],
                check=True,
            )
        Path(tmp_name).replace(image_path)
    finally:
        try:
            Path(tmp_name).unlink()
        except FileNotFoundError:
            pass
        if rewritten is not None:
            rewritten.unlink(missing_ok=True)


def _render_page(page: fitz.Page, dest: Path) -> None:
    width = float(page.rect.width) or 1.0
    zoom = TARGET_WIDTH / width
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    dest.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(dest))
    _compress_png(dest)


def _existing_thumb_pages(directory: Path) -> list[int]:
    if not directory.is_dir():
        return []
    found: list[int] = []
    for path in directory.glob("p*.png"):
        stem = path.stem
        if not stem.startswith("p"):
            continue
        try:
            found.append(int(stem[1:]))
        except ValueError:
            continue
    return found


def sync_empty_page_thumbs(
    pdf_path: Path, yaml_path: Path | None = None
) -> dict[str, int]:
    """Create/remove empty-page thumbnails for one PDF. Returns write/skip/remove counts."""
    pdf_path = pdf_path.resolve()
    yaml_path = (yaml_path or pdf_path.with_suffix(".yaml")).resolve()
    stats = {"written": 0, "skipped": 0, "removed": 0}

    text_map = _load_text_map(yaml_path)
    wanted = set(empty_page_numbers(text_map))
    directory = thumbs_dir_for(pdf_path)

    for number in _existing_thumb_pages(directory):
        if number not in wanted:
            thumb_path(pdf_path, number).unlink(missing_ok=True)
            stats["removed"] += 1

    if not wanted:
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
        return stats

    pdf_mtime = pdf_path.stat().st_mtime
    yaml_mtime = yaml_path.stat().st_mtime if yaml_path.exists() else 0.0
    source_mtime = max(pdf_mtime, yaml_mtime)

    doc = fitz.open(pdf_path)
    try:
        page_count = doc.page_count
        for number in sorted(wanted):
            if number > page_count:
                continue
            dest = thumb_path(pdf_path, number)
            if dest.exists() and dest.stat().st_mtime >= source_mtime:
                stats["skipped"] += 1
                continue
            _render_page(doc[number - 1], dest)
            stats["written"] += 1
    finally:
        doc.close()

    return stats


def iter_pdf_targets(pdf_dir: Path, targets: Sequence[str]) -> Iterable[Path]:
    if targets:
        for raw in targets:
            path = Path(raw)
            if not path.is_absolute():
                path = (ROOT / path).resolve()
            if path.suffix.lower() != ".pdf":
                continue
            if path.exists():
                yield path
            else:
                print(f"[warn] skip missing PDF: {path}", file=sys.stderr)
        return
    yield from sorted(pdf_dir.glob("*.pdf"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Render low-res PNGs for PDF pages that have no extracted text."
    )
    parser.add_argument(
        "--pdf-dir",
        default=PDF_DIR,
        type=Path,
        help="PDF directory (default: %(default)s)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Redraw even when the PNG is newer than the PDF.",
    )
    parser.add_argument(
        "targets", nargs="*", help="Optional specific PDF files to process."
    )
    args = parser.parse_args()

    pdf_dir: Path = args.pdf_dir
    if not pdf_dir.is_absolute():
        pdf_dir = (ROOT / pdf_dir).resolve()
    if not pdf_dir.exists():
        print(f"[error] pdf directory not found: {pdf_dir}", file=sys.stderr)
        return 1

    processed = False
    totals = {"written": 0, "skipped": 0, "removed": 0}
    for pdf_path in iter_pdf_targets(pdf_dir, args.targets):
        if args.force:
            directory = thumbs_dir_for(pdf_path)
            for number in _existing_thumb_pages(directory):
                thumb_path(pdf_path, number).unlink(missing_ok=True)
        stats = sync_empty_page_thumbs(pdf_path)
        processed = True
        for key in totals:
            totals[key] += stats[key]
        print(
            f"{pdf_path.name}: wrote {stats['written']}, "
            f"skipped {stats['skipped']}, removed {stats['removed']}"
        )

    if not processed:
        print("[warn] no files processed.", file=sys.stderr)
        return 1
    print(
        f"total: wrote {totals['written']}, skipped {totals['skipped']}, removed {totals['removed']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
