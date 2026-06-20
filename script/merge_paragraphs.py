#!/usr/bin/env python3
"""Deterministic helper for the paragraph-merge skill (no LLM in this file).

The agent provides the judgment (which consecutive `para` fragments form one
wrapped paragraph); this script provides the mechanical, reversible-safe parts:

  inventory  emit the cross-block para runs an agent should judge
  apply      apply an agent-written decisions file, joining deterministically
             and refusing to write any page whose text would change
  status     count remaining multi-para runs

The actual joining uses _join_wrapped from pdf_text_extractor, and a per-page
whitespace-stripped invariant guarantees no text is added, dropped, or
reordered — only paragraph boundaries and inter-word spacing move.

    uv run --project script python script/merge_paragraphs.py inventory --out /tmp/para_runs.json
    # agent reads /tmp/para_runs.json, writes /tmp/para_decisions.json as {id: [[i,j,...], ...]}
    uv run --project script python script/merge_paragraphs.py apply --decisions /tmp/para_decisions.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_text_extractor import _join_wrapped  # deterministic CJK/ASCII-aware join

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "pdf"
WHITESPACE = re.compile(r"\s+")


def page_signature(blocks: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        if isinstance(block.get("text"), str):
            parts.append(block["text"])
        for item in block.get("items") or []:
            parts.append(item)
    return WHITESPACE.sub("", "".join(parts))


def collect_runs(yaml_path: Path) -> List[Dict[str, Any]]:
    """Maximal runs of >=2 consecutive para blocks within each page."""
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    runs: List[Dict[str, Any]] = []
    for page, blocks in (data.get("text") or {}).items():
        if not isinstance(blocks, list):
            continue
        i = 0
        while i < len(blocks):
            block = blocks[i]
            if isinstance(block, dict) and block.get("kind") == "para":
                j = i
                frags: List[str] = []
                while j < len(blocks) and isinstance(blocks[j], dict) and blocks[j].get("kind") == "para":
                    frags.append(blocks[j]["text"])
                    j += 1
                if len(frags) >= 2:
                    runs.append({"id": f"{yaml_path.stem}|{page}|{i}", "page": page, "start": i, "frags": frags})
                i = j
            else:
                i += 1
    return runs


def valid_groups(groups: Any, n: int) -> List[List[int]]:
    seen: set = set()
    out: List[List[int]] = []
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, list) or len(group) < 2:
            continue
        if any(not isinstance(i, int) or not (0 <= i < n) for i in group):
            continue
        if group != list(range(group[0], group[-1] + 1)) or seen & set(group):
            continue
        seen.update(group)
        out.append(group)
    return out


def apply_to_file(yaml_path: Path, decisions: Dict[str, List[List[int]]], dry_run: bool) -> int:
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    text = data.get("text") or {}
    runs = collect_runs(yaml_path)
    before = {pg: page_signature(bl) for pg, bl in text.items()}

    applied = 0
    # apply each page's runs from last to first so earlier edits don't shift indices
    for run in sorted(runs, key=lambda r: (r["page"], -r["start"])):
        groups = valid_groups(decisions.get(run["id"], []), len(run["frags"]))
        if not groups:
            continue
        blocks = text.get(run["page"])
        start, frags = run["start"], run["frags"]
        seg = blocks[start : start + len(frags)]
        if len(seg) != len(frags) or any(
            not isinstance(b, dict) or b.get("kind") != "para" or b.get("text") != frags[k]
            for k, b in enumerate(seg)
        ):
            print(f"  skip (segment mismatch): {run['id']}", file=sys.stderr)
            continue
        gstart = {g[0]: g for g in groups}
        new: List[Dict[str, Any]] = []
        k = 0
        while k < len(frags):
            if k in gstart:
                g = gstart[k]
                merged = frags[g[0]]
                for idx in g[1:]:
                    merged = _join_wrapped(merged, frags[idx])
                new.append({"kind": "para", "text": merged})
                applied += 1
                k = g[-1] + 1
            else:
                new.append({"kind": "para", "text": frags[k]})
                k += 1
        blocks[start : start + len(frags)] = new

    if not applied:
        return 0
    after = {pg: page_signature(bl) for pg, bl in text.items()}
    if any(before[pg] != after.get(pg) for pg in before):
        print(f"  INVARIANT VIOLATED, not writing: {yaml_path.name}", file=sys.stderr)
        return 0
    if not dry_run:
        rebuilt = {"text": text, **{k: v for k, v in data.items() if k != "text"}}
        yaml_path.write_text(yaml.safe_dump(rebuilt, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return applied


def resolve_targets(files: List[str]) -> List[Path]:
    return [Path(f) for f in files] if files else sorted(PDF_DIR.glob("*.yaml"))


def cmd_inventory(args: argparse.Namespace) -> int:
    runs = [
        {"id": r["id"], "frags": r["frags"]}
        for path in resolve_targets(args.files)
        for r in collect_runs(path)
    ]
    payload = json.dumps(runs, ensure_ascii=False, indent=0)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"{len(runs)} run(s) -> {args.out}")
    else:
        print(payload)
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    raw = json.loads(Path(args.decisions).read_text(encoding="utf-8"))
    # accept either {id: groups} or [{"id":..., "groups":...}, ...]
    decisions = raw if isinstance(raw, dict) else {d["id"]: d.get("groups", []) for d in raw}
    total = files = 0
    for path in resolve_targets(args.files):
        applied = apply_to_file(path, decisions, args.dry_run)
        if applied:
            files += 1
            total += applied
    verb = "would merge" if args.dry_run else "merged"
    print(f"{verb} {total} group(s) across {files} file(s)")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    runs = sum(len(collect_runs(p)) for p in resolve_targets(args.files))
    print(f"remaining multi-para runs: {runs}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_inv = sub.add_parser("inventory", help="Emit cross-block para runs to judge.")
    p_inv.add_argument("files", nargs="*", help="pdf/<slug>.yaml files (default: all).")
    p_inv.add_argument("--out", help="Write JSON here instead of stdout.")
    p_inv.set_defaults(func=cmd_inventory)

    p_app = sub.add_parser("apply", help="Apply a decisions file (id -> groups).")
    p_app.add_argument("--decisions", required=True, help="JSON of merge decisions.")
    p_app.add_argument("files", nargs="*", help="pdf/<slug>.yaml files (default: all).")
    p_app.add_argument("--dry-run", action="store_true", help="Report without writing.")
    p_app.set_defaults(func=cmd_apply)

    p_st = sub.add_parser("status", help="Count remaining multi-para runs.")
    p_st.add_argument("files", nargs="*", help="pdf/<slug>.yaml files (default: all).")
    p_st.set_defaults(func=cmd_status)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
