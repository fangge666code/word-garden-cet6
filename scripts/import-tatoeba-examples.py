"""Select simple CC-BY English/Chinese Tatoeba pairs for the CET-6 word list.

Usage: python scripts/import-tatoeba-examples.py path/to/cmn.txt
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    from opencc import OpenCC
except ImportError:  # The generated file remains usable; CI does not re-import the corpus.
    OpenCC = None

ROOT = Path(__file__).resolve().parents[1]
ID_MAP_PATH = ROOT / "tests" / "fixtures" / "cet6-id-map-3000.json"
OUTPUT_PATH = ROOT / "src" / "data" / "cet6-tatoeba-examples.json"
TOKEN_PATTERN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
ATTRIBUTION_PATTERN = re.compile(r"tatoeba\.org #(\d+)")
IRREGULAR = {
    "be": {"am", "is", "are", "was", "were", "been", "being"},
    "do": {"does", "did", "done", "doing"},
    "go": {"goes", "went", "gone", "going"},
    "have": {"has", "had", "having"},
    "make": {"makes", "made", "making"},
    "take": {"takes", "took", "taken", "taking"},
}
UNSUITABLE = re.compile(r"\b(kill|murder|suicide|sex|porn|damn|hell|steal|rob|drug|weapon)\b", re.I)


def inflections(word: str) -> set[str]:
    variants = {word, f"{word}s", f"{word}ed", f"{word}ing"}
    if word.endswith("e"):
        variants.update({f"{word}d", f"{word[:-1]}ing"})
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        variants.update({f"{word[:-1]}ies", f"{word[:-1]}ied"})
    variants.update(IRREGULAR.get(word, set()))
    return variants


def candidate_score(english: str, chinese: str, target_word: str) -> tuple[int, int, int, str]:
    tokens = TOKEN_PATTERN.findall(english)
    lower_tokens = {token.lower() for token in tokens}
    exact_penalty = 0 if target_word in lower_tokens else 2
    proper_name_penalty = sum(token[0].isupper() for token in tokens[1:])
    punctuation_penalty = int("?" in english or "!" in english)
    return exact_penalty + proper_name_penalty + punctuation_penalty, abs(len(tokens) - 10), len(chinese), english


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Pass the path to Tatoeba's cmn.txt")
    rows = json.loads(ID_MAP_PATH.read_text(encoding="utf-8"))
    to_simplified = OpenCC("t2s").convert if OpenCC else (lambda value: value)
    form_to_ids: dict[str, set[str]] = defaultdict(set)
    forms_by_id: dict[str, set[str]] = {}
    words_by_id: dict[str, str] = {}
    for row in rows:
        word = row["word"].lower()
        words_by_id[row["id"]] = word
        forms = inflections(word)
        forms_by_id[row["id"]] = forms
        for form in forms:
            form_to_ids[form].add(row["id"])

    candidates: dict[str, list[tuple[tuple[int, int, int, str], dict[str, str]]]] = defaultdict(list)
    with Path(sys.argv[1]).open(encoding="utf-8", newline="") as handle:
        for parts in csv.reader(handle, delimiter="\t"):
            if len(parts) < 3:
                continue
            english, chinese, attribution = parts[:3]
            chinese = to_simplified(chinese)
            tokens = TOKEN_PATTERN.findall(english)
            if not 4 <= len(tokens) <= 18 or not re.search(r"[\u4e00-\u9fff]", chinese):
                continue
            if UNSUITABLE.search(english) or "\ufffd" in english or "\ufffd" in chinese:
                continue
            lower_tokens = {token.lower() for token in tokens}
            matching_ids = set().union(*(form_to_ids.get(token, set()) for token in lower_tokens))
            source_ids = ATTRIBUTION_PATTERN.findall(attribution)
            if not source_ids:
                continue
            for record_id in matching_ids:
                record = {
                    "id": record_id,
                    "example": english.strip(),
                    "exampleZh": chinese.strip(),
                    "source": "Tatoeba CC-BY 2.0 FR",
                    "sourceId": source_ids[0],
                    "attribution": attribution.strip(),
                }
                score = candidate_score(english, chinese, words_by_id[record_id])
                candidates[record_id].append((score, record))

    selected = []
    used_sentences = set()
    for row in rows:
        choices = sorted(candidates.get(row["id"], []), key=lambda item: item[0])
        choice = next((record for _, record in choices if record["example"].casefold() not in used_sentences), None)
        if choice:
            selected.append(choice)
            used_sentences.add(choice["example"].casefold())

    OUTPUT_PATH.write_text(json.dumps(selected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Selected {len(selected)} attributed Tatoeba pairs for {len(rows)} CET-6 words")


if __name__ == "__main__":
    main()
