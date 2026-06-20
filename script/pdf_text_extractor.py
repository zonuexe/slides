from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path
from statistics import median
from typing import Any, Dict, Iterable, List, Optional

import fitz  # PyMuPDF
import yaml

# 1 ページ分のブロック列。各ブロックは次のいずれか:
#   {"kind": "heading", "level": 1-3, "text": str}
#   {"kind": "para", "text": str}
#   {"kind": "list", "items": [str, ...]}
PageBlocks = List[Dict[str, Any]]
PageMap = Dict[str, PageBlocks]

# フォントサイズが本文(最頻サイズ)の何倍以上なら見出しとみなすか
HEADING_RATIO = 1.2
# 見出しレベルの最大値
MAX_HEADING_LEVEL = 3
# 行頭の箇条書きマーカー (誤検出しやすい "-" や "*" は含めない)
BULLET_CHARS = "•‣◦・·▪▫●○■□◆◇▶➤»›→✓✔"
BULLET_PREFIX = re.compile(rf"^[{re.escape(BULLET_CHARS)}]+\s*")
WHITESPACE = re.compile(r"\s+")


def _join_wrapped(prev: str, nxt: str) -> str:
    """Join two wrapped lines: space only between ASCII words, else no gap (CJK)."""
    if prev and nxt and prev[-1].isascii() and prev[-1].isalnum() and nxt[0].isascii() and nxt[0].isalnum():
        return f"{prev} {nxt}"
    return f"{prev}{nxt}"


class Line:
    __slots__ = ("text", "size", "bold", "x0", "block")

    def __init__(self, text: str, size: float, bold: bool, x0: float, block: int):
        self.text = text
        self.size = size
        self.bold = bold
        self.x0 = x0
        self.block = block


def _clean_text(text: str) -> str:
    """Normalise span text: drop control/replacement chars, collapse spaces."""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("�", "").replace("\x00", "")
    text = text.replace(" ", " ").replace("\t", " ")
    return WHITESPACE.sub(" ", text).strip()


def _is_bold(span: Dict[str, Any]) -> bool:
    # flags bit 4 (16) marks synthetic/embedded bold; fall back to font name.
    if span.get("flags", 0) & 16:
        return True
    name = (span.get("font") or "").lower()
    return any(k in name for k in ("bold", "black", "heavy", "semibold", "demi"))


def _collect_lines(page: "fitz.Page") -> List[Line]:
    """Flatten a page into ordered visual lines with size/bold metadata."""
    data = page.get_text("dict", sort=True)
    lines: List[Line] = []
    for block_index, block in enumerate(data.get("blocks", [])):
        if block.get("type") != 0:  # skip image blocks
            continue
        for raw_line in block.get("lines", []):
            spans = raw_line.get("spans", [])
            text = _clean_text("".join(span.get("text", "") for span in spans))
            if not text:
                continue
            sizes = [span.get("size", 0.0) for span in spans if span.get("text", "").strip()]
            size = max(sizes) if sizes else 0.0
            bold = any(_is_bold(span) for span in spans if span.get("text", "").strip())
            x0 = raw_line.get("bbox", [0, 0, 0, 0])[0]
            lines.append(Line(text, round(size, 1), bold, x0, block_index))
    return lines


def _body_size(lines: List[Line]) -> float:
    """Estimate the dominant body-text size (mode, then median fallback)."""
    sizes = [line.size for line in lines if line.size > 0]
    if not sizes:
        return 0.0
    counts: Dict[float, int] = {}
    for size in sizes:
        counts[size] = counts.get(size, 0) + 1
    top = max(counts.values())
    # 最頻が複数あるときは小さい方 (本文は小さく数が多い側に寄る)
    mode = min(size for size, count in counts.items() if count == top)
    return min(mode, median(sizes)) if mode else median(sizes)


def _is_page_number(text: str) -> bool:
    return bool(re.fullmatch(r"[0-9０-９]{1,3}", text))


def _heading_levels(sizes: Iterable[float]) -> Dict[float, int]:
    """Map distinct heading sizes (desc) to levels 1..MAX_HEADING_LEVEL."""
    ordered = sorted({s for s in sizes}, reverse=True)
    return {size: min(rank, MAX_HEADING_LEVEL) for rank, size in enumerate(ordered, start=1)}


def _build_blocks(lines: List[Line]) -> PageBlocks:
    body = _body_size(lines)
    heading_cut = body * HEADING_RATIO if body else 0.0
    heading_sizes = [
        line.size
        for line in lines
        if heading_cut and line.size >= heading_cut and not BULLET_PREFIX.match(line.text)
    ]
    levels = _heading_levels(heading_sizes)

    blocks: PageBlocks = []
    list_items: List[str] = []
    pending_bullet = False
    # 直前に出した para ブロックの (dict, 元fitzブロック番号, サイズ)。
    # 同一ブロック・同一サイズの連続 para 行は折り返しとみなして結合する。
    last_para: Optional[Dict[str, Any]] = None
    last_para_key: Optional[tuple] = None

    def flush_list() -> None:
        nonlocal list_items, last_para, last_para_key
        if list_items:
            blocks.append({"kind": "list", "items": list_items})
            list_items = []
            last_para = last_para_key = None

    for line in lines:
        text = line.text
        if _is_page_number(text) and (not body or line.size <= body * 1.1):
            continue

        # 箇条書きマーカー単独行 → 次行を項目として扱う
        if text in BULLET_CHARS:
            pending_bullet = True
            continue

        is_bullet = pending_bullet or bool(BULLET_PREFIX.match(text))
        pending_bullet = False
        if is_bullet:
            item = BULLET_PREFIX.sub("", text).strip()
            if item:
                list_items.append(item)
            last_para = last_para_key = None
            continue

        flush_list()
        if line.size in levels:
            blocks.append({"kind": "heading", "level": levels[line.size], "text": text})
            last_para = last_para_key = None
        else:
            key = (line.block, line.size)
            if last_para is not None and key == last_para_key:
                last_para["text"] = _join_wrapped(last_para["text"], text)
            else:
                last_para = {"kind": "para", "text": text}
                last_para_key = key
                blocks.append(last_para)

    flush_list()
    return blocks


def extract_pdf_to_pages(pdf_path: Path) -> PageMap:
    """Extract structured blocks for each page in the PDF."""
    page_map: PageMap = {}
    with fitz.open(pdf_path) as doc:
        for index, page in enumerate(doc, start=1):
            page_map[f"p{index}"] = _build_blocks(_collect_lines(page))
    return page_map


def update_yaml_text(yaml_path: Path, text_map: PageMap) -> None:
    """Insert the generated text map into the YAML file, keeping other keys."""
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    data: Dict[str, Any] = {}
    if yaml_path.exists():
        with yaml_path.open("r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle)
            if isinstance(loaded, dict):
                data = loaded
    # text を先頭に保ちつつ他キー (links/size) を維持する
    rebuilt: Dict[str, Any] = {"text": text_map}
    for key, value in data.items():
        if key != "text":
            rebuilt[key] = value
    with yaml_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(rebuilt, handle, allow_unicode=True, sort_keys=False)


def iter_pdf_targets(pdf_dir: Path, explicit: Iterable[str]) -> Iterable[Path]:
    """Select target PDF files either explicitly or via directory scan."""
    explicit = list(explicit)
    if explicit:
        for item in explicit:
            path = Path(item)
            if path.suffix.lower() != ".pdf":
                path = pdf_dir / f"{path.stem}.pdf"
            if path.exists():
                yield path
            else:
                print(f"[warn] skip missing PDF: {path}", file=sys.stderr)
    else:
        yield from sorted(pdf_dir.glob("*.pdf"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract PDF text into structured per-page blocks and update YAML."
    )
    parser.add_argument("--pdf-dir", default="pdf", type=Path, help="PDF directory (default: %(default)s)")
    parser.add_argument("--yaml-dir", default="pdf", type=Path, help="YAML directory (default: %(default)s)")
    parser.add_argument("--verbose", action="store_true", help="Print progress per file.")
    parser.add_argument("targets", nargs="*", help="Optional specific PDF files to process.")
    args = parser.parse_args()

    pdf_dir: Path = args.pdf_dir
    yaml_dir: Path = args.yaml_dir
    if not pdf_dir.exists():
        print(f"[error] pdf directory not found: {pdf_dir}", file=sys.stderr)
        return 1

    processed = False
    for pdf_path in iter_pdf_targets(pdf_dir, args.targets):
        yaml_path = yaml_dir / f"{pdf_path.stem}.yaml"
        text_map = extract_pdf_to_pages(pdf_path)
        update_yaml_text(yaml_path, text_map)
        processed = True
        if args.verbose:
            print(f"[info] updated {yaml_path}")

    if not processed:
        print("[warn] no files processed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
