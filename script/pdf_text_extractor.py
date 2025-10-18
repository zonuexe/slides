from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, NamedTuple, Optional, Tuple

import pdfplumber
import yaml

BULLET_CHAR = "•"
LINE_ROUND_DIGITS = 1
GAP_THRESHOLD = 1.5

Segment = Tuple[str, bool]


class LineData(NamedTuple):
    segments: List[Segment]
    top: float
    bottom: float
    left: float
    right: float
    width: float
    height: float
    center: float
PageNodes = List[Dict[str, object]]
PageMap = Dict[str, PageNodes]

CID_MAP = {
    "7979": "篇",
}
CID_PATTERN = re.compile(r"\(cid:(\d+)\)")
CID_SEQUENCE_MAP = {
    "(cid:1964)(cid:1417)(cid:3899)(cid:1516)(cid:2742)(cid:3419)": "公開用完全版",
}


def clean_character(text: str) -> str:
    """Normalize raw character data from the PDF."""
    if not text:
        return ""
    for sequence, replacement in CID_SEQUENCE_MAP.items():
        if sequence in text:
            text = text.replace(sequence, replacement)
    text = text.replace("\x03", "")  # EOT
    text = text.replace("\t", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    text = CID_PATTERN.sub(lambda match: CID_MAP.get(match.group(1), match.group(0)), text)
    return text


def clean_segment_text(text: str) -> str:
    """Trim trailing control characters while keeping leading/trailing spaces."""
    if not text:
        return ""
    text = text.replace("\n", " ")
    return text


def is_bold_font(fontname: Optional[str]) -> bool:
    """Best-effort bold detection using font metadata."""
    if not fontname:
        return False
    lowered = fontname.lower()
    keywords = (
        "bold",
        "black",
        "heavy",
        "semibold",
        "demi",
        "medium",
        "extrabold",
    )
    return any(keyword in lowered for keyword in keywords)


SPLIT_PATTERNS: List[re.Pattern[str]] = [
    re.compile(r"(.*in PHP)(pixiv.*)"),
    re.compile(r"([A-Za-z\s]+)([ぁ-んァ-ヶ一-龯\s]+)"),
    re.compile(r"([A-Za-z\s]{20,})([A-Za-z\s]+Inc\.?)"),
]


def _split_text_content(text: str) -> List[str]:
    """Re-split edge cases where titles and company names are glued."""
    for pattern in SPLIT_PATTERNS:
        match = pattern.fullmatch(text)
        if match:
            return [group for group in match.groups() if group]
    return [text]


def merge_adjacent_nodes(nodes: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Combine consecutive nodes of the same type."""
    merged: List[Dict[str, str]] = []
    for node in nodes:
        node_type = node.get("node")
        if node_type == "br":
            merged.append({"node": "br"})
            continue
        if node_type in {"text", "bold"}:
            content = node.get("content", "")
            if not content:
                continue
            if merged and merged[-1].get("node") == node_type:
                merged[-1]["content"] += content
            else:
                merged.append({"node": node_type, "content": content})
            continue
        merged.append(dict(node))
    return merged


def needs_space(node: Dict[str, str]) -> bool:
    """Check whether the last node requires an extra space before appending new content."""
    if node.get("node") not in {"text", "bold"}:
        return False
    content = node.get("content", "")
    if not content:
        return False
    return not content.endswith((" ", "\u3000"))


def _strip_trailing_page_number(children: List[Dict[str, str]]) -> Tuple[List[Dict[str, str]], bool]:
    """Remove digit-only tail nodes that represent page numbers."""
    trimmed = list(children)
    removed = False
    while trimmed:
        child = trimmed[-1]
        if child.get("node") not in {"text", "bold"}:
            break
        content = child.get("content", "")
        if content is None:
            content = ""
        stripped = content.strip()
        if stripped == "":
            trimmed.pop()
            removed = True
            continue
        if stripped.isdigit():
            trimmed.pop()
            removed = True
            continue
        break
    return trimmed, removed


def _is_page_number_node(node: Dict[str, object], target: str) -> bool:
    """Return True when the entire paragraph matches the page number marker."""
    if node.get("node") != "p":
        return False
    children = node.get("children")
    if not isinstance(children, list) or not children:
        return False
    text_fragments: List[str] = []
    for child in children:
        if child.get("node") not in {"text", "bold"}:
            return False
        content = child.get("content", "")
        if content is None:
            content = ""
        text_fragments.append(content)
    combined = "".join(text_fragments).strip()
    return combined.isdigit() and combined == target


def _remove_page_numbers(nodes: PageNodes, page_number: int) -> PageNodes:
    """Strip page number markers from the node list."""
    cleaned = list(nodes)
    while cleaned:
        last = cleaned[-1]
        if last.get("node") != "p":
            break
        children = last.get("children")
        if not isinstance(children, list):
            break
        trimmed, removed = _strip_trailing_page_number(children)
        if not removed:
            break
        if trimmed:
            last["children"] = trimmed
            break
        cleaned.pop()

    target = str(page_number)
    filtered: PageNodes = []
    for node in cleaned:
        if _is_page_number_node(node, target):
            continue
        filtered.append(node)
    return filtered


def extract_segments_from_page(page) -> List[LineData]:
    """Group characters into ordered segments per visual line."""
    grouped: Dict[float, List[dict]] = defaultdict(list)
    for char in page.chars:
        text = clean_character(char.get("text", ""))
        if not text:
            continue
        line_key = round(char["top"], LINE_ROUND_DIGITS)
        grouped[line_key].append(char)

    lines: List[LineData] = []
    for key in sorted(grouped.keys()):
        chars = sorted(grouped[key], key=lambda c: c["x0"])
        if not chars:
            continue
        segments: List[Segment] = []
        current_text = ""
        current_bold: Optional[bool] = None
        prev_x1: Optional[float] = None
        prev_char_width: Optional[float] = None
        for char in chars:
            raw_text = clean_character(char.get("text", ""))
            if not raw_text:
                prev_x1 = char.get("x1")
                prev_char_width = char.get("x1", 0) - char.get("x0", 0)
                continue
            gap = 0.0
            if prev_x1 is not None:
                gap = char["x0"] - prev_x1
            char_width = char.get("x1", 0) - char.get("x0", 0)
            threshold = max(
                GAP_THRESHOLD, (char_width + (prev_char_width or char_width)) / 4
            )
            text = raw_text
            if gap > threshold:
                text = " " + text
            bold = is_bold_font(char.get("fontname"))
            if current_bold is None:
                current_bold = bold
            if bold != current_bold:
                cleaned = clean_segment_text(current_text)
                if cleaned:
                    segments.append((cleaned, current_bold))
                current_text = text
                current_bold = bold
            else:
                current_text += text
            prev_x1 = char.get("x1")
            prev_char_width = char_width
        cleaned = clean_segment_text(current_text)
        if cleaned:
            segments.append((cleaned, current_bold is True))
        if not segments:
            continue

        min_top = min(c["top"] for c in chars)
        max_bottom = max(
            c.get("bottom", c["top"] + c.get("height", 0.0)) for c in chars
        )
        min_left = min(c["x0"] for c in chars)
        max_right = max(c["x1"] for c in chars)
        width = max(1.0, max_right - min_left)
        height = max(1.0, max_bottom - min_top)
        center = min_left + (width / 2.0)
        lines.append(
            LineData(
                segments=segments,
                top=min_top,
                bottom=max_bottom,
                left=min_left,
                right=max_right,
                width=width,
                height=height,
                center=center,
            )
        )
    return lines


def segments_to_nodes(segments: Iterable[Segment]) -> List[Dict[str, str]]:
    """Convert line segments into node dictionaries."""
    nodes: List[Dict[str, str]] = []
    for text, is_bold in segments:
        parts = _split_text_content(text)
        for part in parts:
            if not part:
                continue
            node_type = "bold" if is_bold else "text"
            nodes.append({"node": node_type, "content": part})
    return merge_adjacent_nodes(nodes)


def _line_relationship(previous: LineData, current: LineData) -> str:
    """Classify how two consecutive lines should be combined."""
    baseline = max(previous.height, current.height, 1.0)
    vertical_gap = current.top - previous.bottom
    if vertical_gap > baseline * 0.8:
        return "break"
    height_ratio = min(previous.height, current.height) / baseline
    if height_ratio < 0.4 and vertical_gap > baseline * 0.3:
        return "break"

    indent_diff = abs(current.left - previous.left)
    center_diff = abs(current.center - previous.center)
    width_ratio = current.width / max(previous.width, 1.0)
    inverse_width_ratio = previous.width / max(current.width, 1.0)

    if indent_diff > baseline * 1.4 and center_diff > baseline * 1.4:
        return "break"

    if (
        indent_diff > baseline * 0.35
        or center_diff > baseline * 0.5
        or width_ratio > 1.8
        or inverse_width_ratio > 1.8
    ):
        return "line_break"

    return "space"


def process_lines(lines: List[LineData]) -> PageNodes:
    """Transform lines into paragraph/ul nodes."""
    page_nodes: PageNodes = []
    pending_paragraph: List[Dict[str, str]] = []
    bullet_items: List[Dict[str, str]] = []
    bullet_holdover = False
    previous_line: Optional[LineData] = None

    for line in lines:
        combined_text = "".join(text for text, _ in line.segments)
        stripped = combined_text.strip()
        nodes = segments_to_nodes(line.segments)

        if not stripped:
            if pending_paragraph:
                page_nodes.append(
                    {"node": "p", "children": merge_adjacent_nodes(pending_paragraph)}
                )
                pending_paragraph = []
            if bullet_items:
                page_nodes.append({"node": "ul", "children": list(bullet_items)})
                bullet_items = []
            bullet_holdover = False
            previous_line = None
            continue

        if stripped == BULLET_CHAR:
            bullet_holdover = True
            previous_line = None
            continue

        bullet_texts: List[str] = []
        is_bullet = False

        if bullet_holdover:
            bullet_texts.append(stripped)
            is_bullet = True
            bullet_holdover = False
        elif stripped.startswith(BULLET_CHAR):
            content = stripped.lstrip(BULLET_CHAR).strip()
            if content:
                bullet_texts.append(content)
                is_bullet = True
        elif BULLET_CHAR in stripped:
            parts = [
                part.strip() for part in stripped.split(BULLET_CHAR) if part.strip()
            ]
            if len(parts) > 1:
                bullet_texts.extend(parts)
                is_bullet = True

        if is_bullet:
            if pending_paragraph:
                page_nodes.append(
                    {"node": "p", "children": merge_adjacent_nodes(pending_paragraph)}
                )
                pending_paragraph = []
            previous_line = None
            for text in bullet_texts:
                bullet_items.append({"node": "li", "content": text})
            continue

        if bullet_items:
            page_nodes.append({"node": "ul", "children": list(bullet_items)})
            bullet_items = []
        bullet_holdover = False

        if not nodes:
            previous_line = None
            continue

        if not pending_paragraph:
            pending_paragraph = list(nodes)
            previous_line = line
            continue

        relation = "break"
        if previous_line is not None:
            relation = _line_relationship(previous_line, line)

        if relation == "break":
            page_nodes.append(
                {"node": "p", "children": merge_adjacent_nodes(pending_paragraph)}
            )
            pending_paragraph = list(nodes)
        else:
            if relation == "line_break":
                if not pending_paragraph or pending_paragraph[-1].get("node") != "br":
                    pending_paragraph.append({"node": "br"})
            else:
                if needs_space(pending_paragraph[-1]):
                    pending_paragraph.append({"node": "text", "content": " "})
            pending_paragraph.extend(nodes)
        previous_line = line

    if pending_paragraph:
        page_nodes.append(
            {"node": "p", "children": merge_adjacent_nodes(pending_paragraph)}
        )
    if bullet_items:
        page_nodes.append({"node": "ul", "children": list(bullet_items)})

    return page_nodes


def extract_pdf_to_nodes(pdf_path: Path) -> PageMap:
    """Extract structured nodes for each page in the PDF."""
    page_map: PageMap = {}
    with pdfplumber.open(pdf_path) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            lines = extract_segments_from_page(page)
            nodes = process_lines(lines)
            nodes = _remove_page_numbers(nodes, index)
            page_map[f"p{index}"] = nodes
    return page_map


def update_yaml_text(yaml_path: Path, text_map: PageMap) -> None:
    """Insert the generated text map into the YAML file."""
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if yaml_path.exists():
        with yaml_path.open("r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle)
            if isinstance(loaded, dict):
                data = loaded
    data["text"] = text_map
    with yaml_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, allow_unicode=True, sort_keys=False)


def iter_pdf_targets(pdf_dir: Path, explicit: Iterable[str]) -> Iterable[Path]:
    """Select target PDF files either explicitly or via directory scan."""
    if explicit:
        for item in explicit:
            path = Path(item)
            if not path.suffix.lower().endswith("pdf"):
                path = pdf_dir / f"{path.stem}.pdf"
            if path.exists():
                yield path
            else:
                print(f"[warn] skip missing PDF: {path}", file=sys.stderr)
    else:
        yield from sorted(pdf_dir.glob("*.pdf"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract PDF text and update corresponding YAML text nodes."
    )
    parser.add_argument(
        "--pdf-dir",
        default="pdf",
        type=Path,
        help="Directory containing PDF files (default: %(default)s)",
    )
    parser.add_argument(
        "--yaml-dir",
        default="pdf",
        type=Path,
        help="Directory containing YAML files (default: %(default)s)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print progress information for each processed file.",
    )
    parser.add_argument(
        "targets",
        nargs="*",
        help="Optional specific PDF files to process.",
    )
    args = parser.parse_args()

    pdf_dir = args.pdf_dir
    yaml_dir = args.yaml_dir
    if not pdf_dir.exists():
        print(f"[error] pdf directory not found: {pdf_dir}", file=sys.stderr)
        return 1

    processed = False
    for pdf_path in iter_pdf_targets(pdf_dir, args.targets):
        yaml_path = yaml_dir / f"{pdf_path.stem}.yaml"
        if not yaml_path.exists():
            print(
                f"[warn] missing YAML counterpart for {pdf_path.name}", file=sys.stderr
            )
            continue
        text_map = extract_pdf_to_nodes(pdf_path)
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
