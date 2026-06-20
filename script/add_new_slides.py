#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import yaml
import re
import shutil
from pathlib import Path
from typing import Iterable, List, Dict, Any, Optional

LINK_EXTRACTOR_CMD = [
    "uv",
    "run",
    "--project",
    "script",
    "python",
    "script/pdf_link_extractor.py",
    "--update-meta",
]


ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "pdf"
SLIDES_DIR = ROOT / "slides"
HASHTAG_PATTERN = re.compile(r"#([\w\-]+)")


def detect_convert_command() -> List[str]:
    for cmd in (["magick", "convert"], ["convert"]):
        if shutil.which(cmd[0]):
            return cmd
    raise SystemExit("ImageMagick 'convert' (or 'magick') is required.")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate assets (PNG + YAML) for newly added PDFs and write slides/<slug>.yaml."
    )
    parser.add_argument(
        "--pdf", action="append", default=[], help="Specific PDF(s) to process."
    )
    parser.add_argument(
        "--all-staged",
        action="store_true",
        help="Process all staged PDFs (default behaviour if no explicit PDF is passed).",
    )
    return parser.parse_args()


def list_staged_pdfs() -> List[Path]:
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--cached", "--diff-filter=AM", "--", "pdf"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"git diff failed: {exc}") from exc
    paths = []
    for line in result.stdout.splitlines():
        raw = Path(line.strip())
        if raw.suffix.lower() != ".pdf":
            continue
        path = (ROOT / raw).resolve()
        if path.exists():
            paths.append(path)
    return paths


def generate_thumbnail(pdf_path: Path) -> Path:
    convert_cmd = shutil.which("magick")
    if convert_cmd:
        cmd = ["magick", "convert"]
    else:
        convert_cmd = shutil.which("convert")
        if not convert_cmd:
            raise SystemExit("ImageMagick 'convert' (or 'magick') is required.")
        cmd = ["convert"]

    output_path = pdf_path.with_suffix(".png")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
        tmp_name = tmp_file.name

    convert_args = cmd + [
        "-quiet",
        "-density",
        "200",
        f"{pdf_path}[0]",
        "-thumbnail",
        "1200x630>",
        "-strip",
        "-background",
        "white",
        "-alpha",
        "remove",
        "-alpha",
        "off",
        f"png32:{tmp_name}",
    ]
    subprocess.run(convert_args, check=True)
    Path(tmp_name).replace(output_path)

    compress_png(output_path)

    return output_path


def compress_png(image_path: Path) -> None:
    zopflipng = shutil.which("zopflipng")
    if not zopflipng:
        return

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
        tmp_name = tmp_file.name

    try:
        subprocess.run(
            [zopflipng, "-m", "-y", str(image_path), tmp_name],
            check=True,
        )
        Path(tmp_name).replace(image_path)
    finally:
        try:
            Path(tmp_name).unlink()
        except FileNotFoundError:
            pass


def ensure_meta_file(pdf_path: Path) -> Path:
    meta_path = pdf_path.with_suffix(".yaml")
    if not meta_path.exists():
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.touch()
    return meta_path


def run_text_extractor(pdf_path: Path) -> Path:
    meta_path = ensure_meta_file(pdf_path)
    target = str(pdf_path)
    try:
        subprocess.run(
            [
                "uv",
                "run",
                "--project",
                "script",
                "python",
                "script/pdf_text_extractor.py",
                target,
            ],
            cwd=ROOT,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"pdf_text_extractor failed for {pdf_path}: {exc}") from exc
    return meta_path


def extract_first_page_text(meta: Dict[str, Any]) -> List[str]:
    texts: List[str] = []
    text_section = meta.get("text")
    if not isinstance(text_section, dict):
        return texts
    first_page = text_section.get("p1")
    if not isinstance(first_page, list):
        return texts

    def collect(node: Dict[str, Any], buffer: List[str]) -> None:
        if not isinstance(node, dict):
            return
        node_type = node.get("node")
        if node_type in {"text", "bold"}:
            content = node.get("content")
            if isinstance(content, str) and content.strip():
                buffer.append(content.strip())
        for child in node.get("children", []) or []:
            collect(child, buffer)

    for entry in first_page:
        collect(entry, texts)
    return texts


def derive_title(texts: List[str], slug: str) -> str:
    for line in texts:
        trimmed = line.strip()
        if trimmed:
            return trimmed
    return slug.replace("_", " ")


def derive_hashtags(texts: Iterable[str]) -> List[str]:
    seen = []
    for text in texts:
        for tag in HASHTAG_PATTERN.findall(text):
            if tag not in seen:
                seen.append(tag)
    return seen


def derive_size(meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    size = meta.get("size")
    if isinstance(size, dict):
        max_width = size.get("max_width")
        max_height = size.get("max_height")
        result: Dict[str, Any] = {}
        if isinstance(max_width, (int, float)):
            result["max_width"] = int(max_width)
        if isinstance(max_height, (int, float)):
            result["max_height"] = int(max_height)
        return result if result else None
    return None


def derive_links(meta: Dict[str, Any]) -> List[Dict[str, str]]:
    links_section = meta.get("links")
    if not isinstance(links_section, dict):
        return []
    collected: Dict[str, Dict[str, str]] = {}
    for items in links_section.values():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            url = item.get("url")
            if not isinstance(url, str) or not url.strip():
                continue
            url = url.strip()
            title = item.get("title")
            entry = {"url": url}
            if isinstance(title, str) and title.strip():
                entry["title"] = title.strip()
            collected[url] = entry
    return list(collected.values())


def write_slide_files(entries: List[Dict[str, Any]]) -> None:
    SLIDES_DIR.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        data = dict(entry)
        slug = data.pop("_slug")
        slide_path = SLIDES_DIR / f"{slug}.yaml"
        with slide_path.open("w", encoding="utf-8") as handle:
            yaml.dump(data, handle, allow_unicode=True, sort_keys=False)


def main() -> int:
    args = parse_arguments()

    pdfs: List[Path] = []
    if args.pdf:
        pdfs = [
            Path(p) if Path(p).is_absolute() else (ROOT / p).resolve() for p in args.pdf
        ]
    else:
        pdfs = list_staged_pdfs()

    pdfs = [p.resolve() for p in pdfs if p.suffix.lower() == ".pdf"]
    if not pdfs:
        print("No PDFs to process.", file=sys.stderr)
        return 0

    processed_entries: List[Dict[str, Any]] = []
    for pdf_path in pdfs:
        if not pdf_path.exists():
            print(f"Skip missing PDF: {pdf_path}", file=sys.stderr)
            continue
        try:
            pdf_path.relative_to(ROOT)
        except ValueError:
            print(f"Skip PDF outside repository: {pdf_path}", file=sys.stderr)
            continue
        print(f"Processing {pdf_path}...")
        generate_thumbnail(pdf_path)
        meta_path = run_text_extractor(pdf_path)
        try:
            ensure_meta_file(pdf_path)
            subprocess.run(
                LINK_EXTRACTOR_CMD + ["--meta-file", str(meta_path), str(pdf_path)],
                cwd=ROOT,
                check=True,
            )
        except subprocess.CalledProcessError as exc:
            raise SystemExit(
                f"pdf_link_extractor failed for {pdf_path}: {exc}"
            ) from exc

        with meta_path.open("r", encoding="utf-8") as handle:
            meta = yaml.safe_load(handle) or {}

        texts = extract_first_page_text(meta)
        slug = pdf_path.stem
        title = derive_title(texts, slug)
        hashtags = derive_hashtags(texts)
        size = derive_size(meta)
        links = derive_links(meta)

        date_part = slug.split("_", 1)[0]
        date_formatted = (
            f"{date_part[:4]}-{date_part[4:6]}-{date_part[6:8]}"
            if len(date_part) >= 8 and date_part.isdigit()
            else ""
        )

        # file / meta / image は slug から導出されるので保存しない。
        # 新規 PDF の stem は slug と一致するため stem 上書きも不要。
        entry: Dict[str, Any] = {
            "_slug": slug,
            "title": title,
            "date": date_formatted,
            "download": pdf_path.name,
        }
        if hashtags:
            entry["hashtags"] = hashtags
        processed_entries.append(entry)

    if processed_entries:
        write_slide_files(processed_entries)
        print(
            f"Wrote {len(processed_entries)} slide file(s) under slides/."
        )
    return 0


if __name__ == "__main__":
    import shutil

    sys.exit(main())
