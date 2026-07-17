"""Validate the checked-in bilingual CET-6 example source."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES_PATH = ROOT / "src" / "data" / "cet6-examples.json"
ID_MAP_PATH = ROOT / "tests" / "fixtures" / "cet6-id-map-3000.json"
TARGET_COUNT = 3000
ID_PATTERN = re.compile(r"cet6-(\d{3,4})$")
TOKEN_PATTERN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
CHINESE_PATTERN = re.compile(r"[\u4e00-\u9fff]")
BANNED_PATTERNS = tuple(re.compile(pattern, re.I) for pattern in (
    r"discusses? the role of",
    r"researchers? use .+ to express",
    r"articles? use",
    r"words? .+ appears? frequently",
    r"formal English texts?",
))
INFLECTION_EXCEPTIONS = {
    "be": {"am", "is", "are", "was", "were", "been", "being"},
    "go": {"goes", "went", "gone", "going"},
    "have": {"has", "had", "having"},
    "make": {"makes", "made", "making"},
    "take": {"takes", "took", "taken", "taking"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-incomplete", action="store_true")
    parser.add_argument("--through", help="last required contiguous id, for example cet6-500")
    return parser.parse_args()


def normalize(sentence: str) -> str:
    return " ".join(TOKEN_PATTERN.findall(sentence.lower()))


def inflections(word: str) -> set[str]:
    variants = {word, f"{word}s", f"{word}ed", f"{word}ing"}
    if word.endswith("e"):
        variants.update({f"{word}d", f"{word[:-1]}ing"})
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        variants.update({f"{word[:-1]}ies", f"{word[:-1]}ied"})
    variants.update(INFLECTION_EXCEPTIONS.get(word, set()))
    return variants


def fail(errors: list[str]) -> None:
    for error in errors[:50]:
        print(error, file=sys.stderr)
    if len(errors) > 50:
        print(f"... and {len(errors) - 50} more errors", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    args = parse_args()
    records = json.loads(EXAMPLES_PATH.read_text(encoding="utf-8"))
    frozen = json.loads(ID_MAP_PATH.read_text(encoding="utf-8"))
    frozen_by_id = {item["id"]: item["word"].lower() for item in frozen}
    errors: list[str] = []

    if args.allow_incomplete:
        through = args.through or (records[-1]["id"] if records else "cet6-000")
        match = ID_PATTERN.fullmatch(through)
        if not match:
            raise SystemExit("--through must look like cet6-500")
        expected_count = int(match.group(1))
    else:
        expected_count = TARGET_COUNT

    if not args.allow_incomplete and len(records) != expected_count:
        errors.append(f"Expected {expected_count} bilingual examples, got {len(records)}")
    expected_ids = [item["id"] for item in frozen[:expected_count]]
    actual_ids = [item.get("id") for item in records]
    frozen_order = [item["id"] for item in frozen if item["id"] in set(actual_ids)]
    if actual_ids != frozen_order:
        errors.append("Example ids must follow the same order as the frozen word map")
    if args.allow_incomplete:
        if not set(expected_ids).issubset(actual_ids):
            errors.append(f"Examples must cover every id through {expected_ids[-1]}")
    elif actual_ids != expected_ids:
        errors.append("Example ids must contain the complete frozen word map")

    normalized: dict[str, str] = {}
    for record in records:
        record_id = record.get("id", "<missing-id>")
        example = record.get("example")
        translation = record.get("exampleZh")
        if not isinstance(example, str) or not example.strip():
            errors.append(f"{record_id}: missing English example")
            continue
        if not isinstance(translation, str) or not translation.strip():
            errors.append(f"{record_id}: missing Chinese translation")
            continue
        if "\ufffd" in example or "\ufffd" in translation:
            errors.append(f"{record_id}: contains a replacement character")
        if not CHINESE_PATTERN.search(translation):
            errors.append(f"{record_id}: Chinese translation has no Chinese characters")
        tokens = TOKEN_PATTERN.findall(example)
        minimum_words = 4 if str(record.get("source", "")).startswith("Tatoeba") else 7
        if not minimum_words <= len(tokens) <= 18:
            errors.append(f"{record_id}: English example must contain {minimum_words}-18 words, got {len(tokens)}")
        for pattern in BANNED_PATTERNS:
            if pattern.search(example):
                errors.append(f"{record_id}: contains banned template language")
                break
        key = normalize(example)
        if key in normalized:
            errors.append(f"{record_id}: duplicates {normalized[key]}")
        normalized[key] = record_id
        word = frozen_by_id.get(record_id)
        lower_tokens = {token.lower() for token in tokens}
        if word and lower_tokens.isdisjoint(inflections(word)):
            errors.append(f"{record_id}: example does not contain {word} or an accepted inflection")

    if errors:
        fail(errors)
    print(f"Validated {len(records)} bilingual examples through {expected_ids[-1] if expected_ids else 'none'}")


if __name__ == "__main__":
    main()
