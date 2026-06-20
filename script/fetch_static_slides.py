#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def load_slugs(slides_dir: Path) -> list[str]:
    if not slides_dir.is_dir():
        raise SystemExit(f"slides directory not found: {slides_dir}")
    slugs = [path.stem for path in slides_dir.glob("*.yaml")]
    if not slugs:
        raise SystemExit(f"No slide files found under: {slides_dir}")
    return sorted(slugs)


def resolve_output_path(url_path: str) -> Path:
    parsed = urllib.parse.urlparse(url_path)
    path = parsed.path
    if path.startswith("/slides/"):
        path = path[len("/slides/") :]
    elif path == "/slides":
        path = ""
    if not path or path == "/":
        return Path("index.html")
    if path.endswith("/"):
        return Path(path.lstrip("/")) / "index.html"
    return Path(path.lstrip("/"))


def ensure_parent(path: Path) -> None:
    if path.parent:
        path.parent.mkdir(parents=True, exist_ok=True)


def fetch(url: str, accept: str | None = None) -> bytes:
    request = urllib.request.Request(url)
    if accept:
        request.add_header("Accept", accept)
    try:
        with urllib.request.urlopen(request) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"HTTP error {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Failed to reach {url}: {exc.reason}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch slide pages from a running site and store them as static files."
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:5173",
        help="Base URL of the running slides site (default: %(default)s)",
    )
    parser.add_argument(
        "--slides-dir",
        default="slides",
        help="Path to the slides/ directory (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        default=".",
        help="Directory where files will be written (default: current directory)",
    )
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    slides_dir = Path(args.slides_dir)
    output_dir = Path(args.output_dir)

    slugs = load_slugs(slides_dir)

    targets: list[tuple[str, str | None]] = []
    targets.append(("/slides/", None))
    targets.append(("/slides/index.js", "application/javascript"))
    for slug in slugs:
        targets.append((f"/slides/{slug}/", None))
        targets.append((f"/slides/{slug}/oembed.json", "application/json"))
        targets.append((f"/slides/{slug}/oembed.xml", "application/xml"))

    for path, accept in targets:
        url = f"{base_url}{path}"
        content = fetch(url, accept)
        relative_path = resolve_output_path(path)
        destination = output_dir / relative_path
        ensure_parent(destination)
        with destination.open("wb") as handle:
            handle.write(content)
        print(f"saved {destination}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
