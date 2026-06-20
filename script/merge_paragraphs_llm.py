#!/usr/bin/env python3
"""Join cross-block "泣き別れ" paragraphs in pdf/<slug>.yaml using an LLM.

The within-block merge in pdf_text_extractor.py already joins wrapped lines that
share a fitz block. This pass handles the remainder: a sentence split across
*separate* blocks (big decorative text, mid-word breaks). An LLM only decides
WHICH consecutive para fragments form one wrapped paragraph; the actual joining
is done deterministically here, so no text can be added, dropped, or reordered.
A per-page invariant (whitespace-stripped text must stay byte-identical) is the
machine-checked safety net. Decisions are cached by fragment hash, so re-running
is cheap and idempotent.

    ANTHROPIC_API_KEY=... uv run --project script python script/merge_paragraphs_llm.py
    # one deck:   ... merge_paragraphs_llm.py pdf/20190330_php-yurufuwa-ci-guide.yaml
    # cheaper:    ... merge_paragraphs_llm.py --model claude-haiku-4-5
    # preview:    ... merge_paragraphs_llm.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
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
CACHE_PATH = Path(__file__).resolve().parent / ".merge_cache.json"
WHITESPACE = re.compile(r"\s+")

SYSTEM_PROMPT = """\
PDFスライドから抽出した「段落断片(para)」の並びを受け取り、視覚的な行折り返しで\
分断された1つの文/段落を見つけて結合グループを判定する。実際の結合は呼び出し側が\
決定的に行うので、あなたは「どの連続インデックスを結合するか」だけを返す。

各 run の frags は、あるスライド1ページ内の連続する para 断片(読み順)。

結合する: 折り返しで切れた文 (["静的解析","ツールの種類"]→[[0,1]])、単語途中の\
分断 (["…ルーティ","ングがしたかった"]→[[0,1]])、複数行に渡る1文全体。
結合しない: それぞれ独立した完結した要点/箇条書きの並び、タイトルのメタ情報\
(会社名・氏名・日付・ハッシュタグ・会場)、コード断片 (<?php, {, }, =>, function,\
$変数, ファイルパス, アノテーション等) は絶対不可、ラベル+URL対、図/UIラベルの羅列、\
別個の固有名詞の列挙。迷ったら結合しない。

各グループは2個以上の連続した0始まりインデックス、昇順・非重複。結合すべきグループが\
無い run は decisions に含めない。"""

DECISION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "groups": {
                        "type": "array",
                        "items": {"type": "array", "items": {"type": "integer"}},
                    },
                },
                "required": ["id", "groups"],
            },
        }
    },
    "required": ["decisions"],
}


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


def frag_hash(frags: List[str]) -> str:
    return hashlib.sha256(json.dumps(frags, ensure_ascii=False).encode("utf-8")).hexdigest()


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


def ask_llm(client, model: str, batch: List[Dict[str, Any]]) -> Dict[str, List[List[int]]]:
    payload = [{"id": r["id"], "frags": r["frags"]} for r in batch]
    response = client.messages.create(
        model=model,
        max_tokens=16000,
        thinking={"type": "disabled"},
        system=SYSTEM_PROMPT,
        output_config={"format": {"type": "json_schema", "schema": DECISION_SCHEMA}},
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
    )
    if response.stop_reason == "refusal":
        raise SystemExit("LLM refused the request; aborting.")
    text = "".join(b.text for b in response.content if b.type == "text")
    parsed = json.loads(text)
    return {d["id"]: d.get("groups", []) for d in parsed.get("decisions", [])}


def apply_to_file(yaml_path: Path, decisions: Dict[str, List[List[int]]], runs: List[Dict[str, Any]], dry_run: bool) -> int:
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    text = data.get("text") or {}
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
        yaml_path.write_text(
            yaml.safe_dump(rebuilt, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
    return applied


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="Specific pdf/<slug>.yaml files (default: all of pdf/*.yaml).")
    parser.add_argument("--model", default="claude-opus-4-8", help="Claude model (default: %(default)s; claude-haiku-4-5 is far cheaper for this mechanical task).")
    parser.add_argument("--batch-size", type=int, default=80, help="Runs per LLM request (default: %(default)s).")
    parser.add_argument("--dry-run", action="store_true", help="Compute and report without writing YAML.")
    parser.add_argument("--no-cache", action="store_true", help="Ignore the decision cache and re-query every run.")
    args = parser.parse_args()

    targets = [Path(f) for f in args.files] if args.files else sorted(PDF_DIR.glob("*.yaml"))
    cache: Dict[str, List[List[int]]] = {}
    if CACHE_PATH.exists() and not args.no_cache:
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))

    runs_by_file = {p: collect_runs(p) for p in targets}
    all_runs = [r for runs in runs_by_file.values() for r in runs]
    uncached = [r for r in all_runs if frag_hash(r["frags"]) not in cache]
    print(f"runs: {len(all_runs)} | already cached: {len(all_runs) - len(uncached)} | to query: {len(uncached)}")

    if uncached:
        try:
            import anthropic
        except ImportError:
            raise SystemExit("anthropic SDK not installed. Run: uv sync --project script")
        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
        for off in range(0, len(uncached), args.batch_size):
            batch = uncached[off : off + args.batch_size]
            decisions = ask_llm(client, args.model, batch)
            for run in batch:
                cache[frag_hash(run["frags"])] = decisions.get(run["id"], [])
            print(f"  queried {min(off + len(batch), len(uncached))}/{len(uncached)}")
        if not args.no_cache:
            CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    total_applied = total_files = 0
    for path, runs in runs_by_file.items():
        decisions = {r["id"]: cache.get(frag_hash(r["frags"]), []) for r in runs}
        applied = apply_to_file(path, decisions, runs, args.dry_run)
        if applied:
            total_files += 1
            total_applied += applied
    verb = "would merge" if args.dry_run else "merged"
    print(f"{verb} {total_applied} group(s) across {total_files} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
