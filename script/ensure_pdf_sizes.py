#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, Any

import fitz  # PyMuPDF
import yaml

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "pdf"


def get_page_size(pdf_path: Path) -> Dict[str, int]:
    with fitz.open(pdf_path) as doc:
        if not doc.page_count:
            return {"max_width": 1024, "max_height": 768}
        page = doc[0]
        try:
            rect = page.rect
            width = int(round(float(rect.width)))
            height = int(round(float(rect.height)))
            if page.rotation in (90, 270):
                width, height = height, width
        except Exception:
            width, height = 1024, 768
        return {"max_width": width, "max_height": height}


def ensure_size(pdf_file: Path, yaml_file: Path) -> bool:
    data: Dict[str, Any] = {}
    if yaml_file.exists():
        with yaml_file.open("r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle)
            if isinstance(loaded, dict):
                data = loaded
    size = data.get("size")
    if (
        isinstance(size, dict)
        and isinstance(size.get("max_width"), int)
        and isinstance(size.get("max_height"), int)
    ):
        return False

    dimensions = get_page_size(pdf_file)
    data["size"] = dimensions
    with yaml_file.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, allow_unicode=True, sort_keys=False)
    return True


def main() -> int:
    changed = False
    for yaml_path in sorted(PDF_DIR.glob("*.yaml")):
        pdf_path = yaml_path.with_suffix(".pdf")
        if not pdf_path.exists():
            continue
        if ensure_size(pdf_path, yaml_path):
            print(f"updated size: {yaml_path}")
            changed = True
    if not changed:
        print("size entries were already present for all YAML files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
