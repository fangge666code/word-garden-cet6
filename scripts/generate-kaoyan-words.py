"""Build the checked-in 3,500-word Kaoyan core vocabulary from ECDICT and Tatoeba."""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "data" / "kaoyan-words.js"
ATTRIBUTION_OUTPUT = ROOT / "src" / "data" / "kaoyan-examples-attribution.json"
TARGET_COUNT = 3500
WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z-]*")
TOKEN_PATTERN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
POS_PATTERN = re.compile(r"(?<![A-Za-z])(n|v|vt|vi|adj|a|adv|prep|conj|pron|num)\.", re.I)
ATTRIBUTION_PATTERN = re.compile(r"tatoeba\.org #(\d+)")
UNSUITABLE = re.compile(r"\b(kill|murder|suicide|sex|porn|damn|hell|steal|rob|drug|weapon)\b", re.I)


def number(value: str) -> int:
    return int(value) if value and value.isdigit() and int(value) > 0 else 10**9


def rank(row: dict[str, str]) -> tuple[int, int, int, int, str]:
    return (
        -int(row.get("collins") or 0),
        0 if row.get("oxford") else 1,
        min(number(row.get("frq", "")), number(row.get("bnc", ""))),
        number(row.get("frq", "")),
        row["word"],
    )


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
    if not found:
        for chunk in (corpus_pos or "").split("/"):
            raw = chunk.split(":", 1)[0].lower()
            value = aliases.get(raw, raw)
            if value in {"n", "v", "adj", "adv", "prep", "conj", "pron", "num"} and value not in found:
                found.append(value)
    return "/".join(f"{value}." for value in found[:3]) or "word"


def selected_rows(source: Path) -> list[dict[str, str]]:
    candidates = []
    with source.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = (row.get("word") or "").strip().lower()
            if "ky" not in set((row.get("tag") or "").split()):
                continue
            if not WORD_PATTERN.fullmatch(word) or len(word) > 24:
                continue
            if re.search(r"(?:^|/)0:", row.get("exchange") or ""):
                continue
            if not row.get("phonetic") or not row.get("translation"):
                continue
            meaning = clean_translation(row["translation"])
            if not meaning or not re.search(r"[\u4e00-\u9fff]", meaning):
                continue
            item = dict(row)
            item.update(word=word, meaning=meaning, normalized_pos=infer_pos(row["translation"], row.get("pos", "")))
            candidates.append(item)
    candidates.sort(key=rank)
    selected = []
    seen = set()
    for row in candidates:
        if row["word"] in seen:
            continue
        selected.append(row)
        seen.add(row["word"])
        if len(selected) == TARGET_COUNT:
            break
    if len(selected) != TARGET_COUNT:
        raise SystemExit(f"Expected {TARGET_COUNT} Kaoyan entries, got {len(selected)}")
    return selected


def inflections(word: str) -> set[str]:
    variants = {word, f"{word}s", f"{word}ed", f"{word}ing"}
    if word.endswith("e"):
        variants.update({f"{word}d", f"{word[:-1]}ing"})
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        variants.update({f"{word[:-1]}ies", f"{word[:-1]}ied"})
    return variants


def cet6_examples() -> dict[str, dict[str, str]]:
    id_map = json.loads((ROOT / "tests" / "fixtures" / "cet6-id-map-3000.json").read_text(encoding="utf-8"))
    examples = json.loads((ROOT / "src" / "data" / "cet6-examples.json").read_text(encoding="utf-8"))
    examples_by_id = {item["id"]: item for item in examples}
    return {item["word"].lower(): examples_by_id[item["id"]] for item in id_map if item["id"] in examples_by_id}


def tatoeba_examples(rows: list[dict[str, str]], source: Path) -> dict[str, dict[str, str]]:
    to_simplified = OpenCC("t2s").convert
    form_to_words: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        for form in inflections(row["word"]):
            form_to_words[form].add(row["word"])
    candidates: dict[str, list[tuple[tuple[int, int, int, str], dict[str, str]]]] = defaultdict(list)
    with source.open(encoding="utf-8", newline="") as handle:
        for parts in csv.reader(handle, delimiter="\t"):
            if len(parts) < 3:
                continue
            english, chinese, attribution = parts[:3]
            tokens = TOKEN_PATTERN.findall(english)
            if not 4 <= len(tokens) <= 18 or UNSUITABLE.search(english):
                continue
            source_ids = ATTRIBUTION_PATTERN.findall(attribution)
            if not source_ids:
                continue
            lower_tokens = {token.lower() for token in tokens}
            matching = set().union(*(form_to_words.get(token, set()) for token in lower_tokens))
            for word in matching:
                record = {
                    "example": english.strip(),
                    "exampleZh": to_simplified(chinese.strip()),
                    "source": "Tatoeba CC-BY 2.0 FR",
                    "sourceId": source_ids[0],
                    "attribution": attribution.strip(),
                }
                exact_penalty = 0 if word in lower_tokens else 2
                proper_name_penalty = sum(token[0].isupper() for token in tokens[1:])
                score = (exact_penalty + proper_name_penalty + int("?" in english or "!" in english), abs(len(tokens) - 10), len(chinese), english)
                candidates[word].append((score, record))
    selected = {}
    used = set()
    for row in rows:
        choices = sorted(candidates.get(row["word"], []), key=lambda item: item[0])
        choice = next((record for _, record in choices if record["example"].casefold() not in used), None)
        if choice:
            selected[row["word"]] = choice
            used.add(choice["example"].casefold())
    return selected


NOUN_TEMPLATES = [
    ("The study examines the role of {word} in modern society.", "这项研究考察了{meaning}在现代社会中的作用。"),
    ("The report provides new evidence about {word}.", "这份报告提供了有关{meaning}的新证据。"),
    ("Public discussion of {word} has increased in recent years.", "近年来，公众对{meaning}的讨论有所增加。"),
    ("Researchers measured the effect of {word} on daily life.", "研究人员测量了{meaning}对日常生活的影响。"),
]
VERB_TEMPLATES = [
    ("The new evidence may {word} our understanding of the issue.", "新证据可能会{meaning}我们对这一问题的理解。"),
    ("Researchers tried to {word} the results with reliable data.", "研究人员试图用可靠数据来{meaning}这些结果。"),
    ("The policy could {word} how communities use public resources.", "这项政策可能会{meaning}社区使用公共资源的方式。"),
    ("Good planning can help teams {word} unexpected problems.", "良好规划能够帮助团队{meaning}意外问题。"),
]
ADJECTIVE_TEMPLATES = [
    ("The researchers described the change as {word} rather than temporary.", "研究人员认为这种变化是{meaning}的，而不是暂时的。"),
    ("A more {word} approach may produce better results.", "一种更{meaning}的方法可能会产生更好的结果。"),
    ("The article offers a {word} explanation of the problem.", "这篇文章对该问题给出了{meaning}的解释。"),
    ("The difference became {word} after the second experiment.", "第二次实验后，这种差异变得{meaning}。"),
]
ADVERB_TEMPLATES = [
    ("The team responded {word} when new evidence appeared.", "新证据出现时，团队{meaning}作出了回应。"),
    ("The two groups performed {word} under the same conditions.", "在相同条件下，两个小组的表现{meaning}。"),
    ("The author {word} explains why the policy changed.", "作者{meaning}解释了政策变化的原因。"),
    ("The results were {word} different from our expectations.", "结果与我们的预期{meaning}不同。"),
]
OTHER_TEMPLATES = [
    ('Students often encounter the word "{word}" in academic reading.', "学生在学术阅读中经常遇到表示“{meaning}”的这个词。"),
    ('The term "{word}" is useful when discussing this topic.', "讨论这一主题时，表示“{meaning}”的这个词很有用。"),
    ('The writer chose "{word}" to express the idea precisely.', "作者选择这个表示“{meaning}”的词来准确表达观点。"),
    ('Understanding "{word}" makes the passage easier to follow.', "理解这个表示“{meaning}”的词能让文章更容易读懂。"),
]


def original_example(row: dict[str, str], index: int) -> dict[str, str]:
    pos = row["normalized_pos"]
    if "n." in pos:
        templates = NOUN_TEMPLATES
    elif "v." in pos:
        templates = VERB_TEMPLATES
    elif "adj." in pos:
        templates = ADJECTIVE_TEMPLATES
    elif "adv." in pos:
        templates = ADVERB_TEMPLATES
    else:
        templates = OTHER_TEMPLATES
    english, chinese = templates[index % len(templates)]
    meaning = re.split(r"[；，,]", row["meaning"])[0].strip()
    return {
        "example": english.format(word=row["word"], meaning=meaning),
        "exampleZh": chinese.format(word=row["word"], meaning=meaning),
        "source": "Word Garden original",
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: generate-kaoyan-words.py path/to/ecdict.csv path/to/cmn.txt")
    rows = selected_rows(Path(sys.argv[1]))
    reused = cet6_examples()
    tatoeba = tatoeba_examples(rows, Path(sys.argv[2]))
    records = []
    attributions = []
    source_counts = defaultdict(int)
    for index, row in enumerate(rows, start=1):
        example = reused.get(row["word"]) or tatoeba.get(row["word"]) or original_example(row, index)
        source_counts[example["source"]] += 1
        record_id = f"ky-{index:04d}"
        if example["source"].startswith("Tatoeba"):
            attributions.append({"id": record_id, **example})
        records.append([
            row["word"],
            f'/{row["phonetic"].strip().strip("/")}/',
            row["normalized_pos"],
            row["meaning"],
            example["example"],
            example["exampleZh"],
        ])

    lines = ["// Generated from ECDICT (MIT) with attributed/original bilingual examples.", "export const KAOYAN_WORDS = ["]
    lines.extend(f"  {json.dumps(record, ensure_ascii=False)}," for record in records)
    lines.extend([
        "].map(([word, phonetic, pos, meaning, example, exampleZh], index) => ({",
        "  id: `ky-${String(index + 1).padStart(\"4\", \"0\")}`,",
        "  word, phonetic, pos, meaning, example, exampleZh,",
        "}));",
        "",
    ])
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    ATTRIBUTION_OUTPUT.write_text(json.dumps(attributions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(records)} Kaoyan entries: {dict(source_counts)}")


if __name__ == "__main__":
    main()
