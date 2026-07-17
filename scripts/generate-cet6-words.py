"""Generate the checked-in 3,000-word CET-6 dataset from ECDICT.

Usage: python scripts/generate-cet6-words.py path/to/ecdict.csv
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "data" / "cet6-words.js"
TARGET_COUNT = 3000
LEGACY_COUNT = 1500
WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z-]*")
POS_PATTERN = re.compile(r"(?<![A-Za-z])(n|v|vt|vi|adj|a|adv|prep|conj|pron|num)\.", re.I)


def read_existing() -> list[list[str]]:
    entries: list[list[str]] = []
    for line in OUTPUT.read_text(encoding="utf-8").splitlines():
        stripped = line.strip().removesuffix(",")
        if stripped.startswith("["):
            entries.append(json.loads(stripped))
    if len(entries) < LEGACY_COUNT:
        raise SystemExit(f"Expected at least {LEGACY_COUNT} existing entries, got {len(entries)}")
    return entries[:LEGACY_COUNT]


def rank(row: dict[str, str]) -> tuple[int, int, str]:
    def number(value: str) -> int:
        return int(value) if value and value.isdigit() and int(value) > 0 else 10**9

    return min(number(row.get("frq", "")), number(row.get("bnc", ""))), number(row.get("frq", "")), row["word"].lower()


def clean_translation(value: str) -> str:
    value = value.replace("\\n", "\n").replace("\r", "\n")
    value = re.sub(r"\[[^\]]*\]", "", value)
    parts = []
    for item in re.split(r"[\n；;]+", value):
        item = re.sub(r"\s+", " ", item).strip(" ,，。")
        item = re.sub(r"^(?:(?:n|v|vt|vi|adj|a|adv|prep|conj|pron|num)\.\s*)+", "", item, flags=re.I)
        if not item or item.startswith("(人名)"):
            continue
        if item not in parts:
            parts.append(item)
        if len(parts) == 3:
            break
    return "；".join(parts)[:110].rstrip("；")


def infer_pos(translation: str, corpus_pos: str) -> str:
    found = []
    aliases = {"a": "adj", "vt": "v", "vi": "v"}
    for match in POS_PATTERN.finditer(translation):
        value = aliases.get(match.group(1).lower(), match.group(1).lower())
        if value not in found:
            found.append(value)
    if not found and corpus_pos:
        for chunk in corpus_pos.split("/"):
            raw = chunk.split(":", 1)[0].lower()
            value = aliases.get(raw, raw)
            if value in {"n", "v", "adj", "adv", "prep", "conj", "pron", "num"} and value not in found:
                found.append(value)
    return "/".join(f"{value}." for value in found[:3]) or "word"


def make_example(word: str, pos: str) -> str:
    if "n." in pos:
        return f'The report discusses the role of "{word}" in a broader academic context.'
    if "v." in pos:
        return f'The researchers use "{word}" to express the central action in this argument.'
    if "adj." in pos:
        return f'The article uses "{word}" to describe the situation more precisely.'
    if "adv." in pos:
        return f'The word "{word}" helps the writer express the relationship more precisely.'
    return f'The word "{word}" appears frequently in formal English texts.'


def select_rows(source: Path, existing_words: set[str], needed: int) -> list[list[str]]:
    candidates: list[dict[str, str]] = []
    with source.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = (row.get("word") or "").strip().lower()
            tags = set((row.get("tag") or "").split())
            if "cet6" not in tags:
                continue
            if not WORD_PATTERN.fullmatch(word) or len(word) > 24 or word in existing_words:
                continue
            if not row.get("phonetic") or not row.get("translation"):
                continue
            meaning = clean_translation(row["translation"])
            if not meaning or not re.search(r"[\u4e00-\u9fff]", meaning):
                continue
            row = dict(row)
            row["word"] = word
            row["meaning"] = meaning
            candidates.append(row)

    candidates.sort(key=rank)
    selected = []
    seen = set(existing_words)
    for row in candidates:
        if row["word"] in seen:
            continue
        pos = infer_pos(row["translation"], row.get("pos", ""))
        selected.append([
            row["word"],
            f'/{row["phonetic"].strip().strip("/")}/',
            pos,
            row["meaning"],
            make_example(row["word"], pos),
        ])
        seen.add(row["word"])
        if len(selected) == needed:
            break
    return selected


def write_output(entries: list[list[str]]) -> None:
    lines = ["// Core entries are maintained locally; additions are derived from ECDICT (MIT).", "export const WORDS = ["]
    for entry in entries:
        lines.append(f"  {json.dumps(entry, ensure_ascii=False)},")
    lines.extend([
        "].map(([word, phonetic, pos, meaning, example], index) => ({",
        "  id: `cet6-${String(index + 1).padStart(\"3\", \"0\")}` ,",
        "  word,",
        "  phonetic,",
        "  pos,",
        "  meaning,",
        "  example,",
        "}));",
        "",
    ])
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Pass the path to ecdict.csv")
    existing = read_existing()
    additions = select_rows(Path(sys.argv[1]), {entry[0].lower() for entry in existing}, TARGET_COUNT - len(existing))
    entries = existing + additions
    if len(entries) != TARGET_COUNT:
        raise SystemExit(f"Expected {TARGET_COUNT} entries, got {len(entries)}")
    write_output(entries)
    print(f"Generated {len(entries)} entries in {OUTPUT}")


if __name__ == "__main__":
    main()
