# Bilingual Vocabulary Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 3000 template-like English examples with original, natural CET-6 examples and matching Chinese translations while preserving every word ID.

**Architecture:** Examples live in a checked-in bilingual source file keyed by stable word ID. A generator joins that source to the existing vocabulary metadata and refuses incomplete data; a validator enforces coverage, uniqueness, language, length, banned phrases, target-word usage, and ID stability. The study card displays the new translation without changing progress storage or cloud schemas.

**Tech Stack:** Python 3 data tooling, JavaScript ES modules, Node.js test runner, vanilla HTML/CSS rendering.

---

## File structure

- Create `src/data/cet6-examples.json`: 3000 reviewed records `{ id, example, exampleZh }`.
- Create `scripts/validate-cet6-examples.py`: strict offline content and compatibility validation.
- Create `tests/fixtures/cet6-id-map-3000.json`: immutable pre-change ID/word mapping.
- Modify `scripts/generate-cet6-words.py`: consume bilingual source and remove template generation.
- Modify `src/data/cet6-words.js`: add `exampleZh` to all runtime records.
- Modify `tests/vocabulary.test.mjs`: complete bilingual data and stability assertions.
- Modify `src/app.js`: render Chinese translation below the English example.
- Modify `src/styles.css`: visually subordinate the translation.
- Modify `tests/pwa.test.mjs`: study-card integration assertion.

### Task 1: Freeze the full 3000-word identity map

**Files:**
- Create: `tests/fixtures/cet6-id-map-3000.json`
- Modify: `tests/vocabulary.test.mjs`

- [ ] **Step 1: Export the current stable mapping**

Run a Node one-liner that imports `WORDS` and writes pretty JSON containing only `{ id, word }` for all 3000 entries. The resulting file must start with `cet6-001 / abandon` and contain exactly 3000 objects.

- [ ] **Step 2: Add a failing full-map stability test**

Add:

```js
const fullIdMap = JSON.parse(await readFile(new URL("./fixtures/cet6-id-map-3000.json", import.meta.url), "utf8"));
test("all 3000 ids retain their original words", () => {
  assert.deepEqual(WORDS.map(({ id, word }) => ({ id, word })), fullIdMap);
});
```

The test passes before content edits and becomes the guardrail for every later batch.

- [ ] **Step 3: Run vocabulary tests**

Run: `node --test tests/vocabulary.test.mjs`  
Expected: PASS with the frozen mapping.

- [ ] **Step 4: Commit the identity guardrail**

```bash
git add tests/fixtures/cet6-id-map-3000.json tests/vocabulary.test.mjs
git commit -m "test: freeze complete CET-6 word identity map"
```

### Task 2: Bilingual source schema and strict validator

**Files:**
- Create: `src/data/cet6-examples.json`
- Create: `scripts/validate-cet6-examples.py`
- Modify: `tests/vocabulary.test.mjs`

- [ ] **Step 1: Seed the source schema with the first reviewed records**

Use UTF-8 JSON records shaped exactly as:

```json
[
  {
    "id": "cet6-001",
    "example": "She refused to abandon her long-term goal after one setback.",
    "exampleZh": "一次挫折后，她仍不肯放弃自己的长期目标。"
  },
  {
    "id": "cet6-002",
    "example": "The road came to an abrupt end at the edge of the forest.",
    "exampleZh": "这条路在森林边缘突然到了尽头。"
  }
]
```

- [ ] **Step 2: Add failing vocabulary requirements**

Extend completeness checks to require `exampleZh`; assert normalized English examples are unique, Chinese translations contain `\u4e00-\u9fff`, and no example matches the banned phrases `discusses the role of`, `use(s) .* to express`, `article uses`, `word .* appears frequently`, or `formal English texts`.

- [ ] **Step 3: Run the test and verify failure**

Run: `node --test tests/vocabulary.test.mjs`  
Expected: FAIL because runtime entries lack `exampleZh` and old templates remain.

- [ ] **Step 4: Implement the Python validator**

The script must load `cet6-examples.json`, the frozen 3000 mapping and current word metadata, then enforce:

```python
assert len(records) == 3000
assert {item["id"] for item in records} == {item["id"] for item in frozen_map}
assert all(re.search(r"[\u4e00-\u9fff]", item["exampleZh"]) for item in records)
assert len({normalize(item["example"]) for item in records}) == 3000
```

Tokenize English with `[A-Za-z]+(?:[-'][A-Za-z]+)*`, require 7-18 tokens, reject banned phrases and Unicode replacement characters, and accept target words through either exact lemma presence or an explicit `INFLECTION_EXCEPTIONS` mapping stored at the top of the script.

Use `argparse` to implement `--allow-incomplete` and `--through cet6-NNN`. In incomplete mode the file must contain every ID from `cet6-001` through the requested boundary in order, may contain no later IDs, and all checks still apply to that prefix. With no flags, require all 3000 records.

- [ ] **Step 5: Confirm validation fails clearly on the partial source**

Run: `python scripts/validate-cet6-examples.py`  
Expected: FAIL with `Expected 3000 bilingual examples, got 2`.

- [ ] **Step 6: Commit the schema and validator**

```bash
git add src/data/cet6-examples.json scripts/validate-cet6-examples.py tests/vocabulary.test.mjs
git commit -m "test: define bilingual example quality gates"
```

### Task 3: Author and review examples 1-1000

**Files:**
- Modify: `src/data/cet6-examples.json`

- [ ] **Step 1: Author IDs cet6-001 through cet6-500**

For each record, use the existing `word`, `pos`, and first/common `meaning`; write a 7-18-word original sentence that demonstrates the meaning and a natural Chinese translation of that sentence. Do not quote or define the word metalinguistically.

- [ ] **Step 2: Run the validator for duplicate and structural feedback**

Run: `python scripts/validate-cet6-examples.py --allow-incomplete --through cet6-500`  
Expected: PASS for IDs 001-500 with zero duplicate, banned-template, language or length errors.

- [ ] **Step 3: Author IDs cet6-501 through cet6-1000**

Apply the same content rules, checking ambiguous words against the existing Chinese meaning rather than inventing a new sense.

- [ ] **Step 4: Validate and manually sample every twentieth record**

Run: `python scripts/validate-cet6-examples.py --allow-incomplete --through cet6-1000`  
Expected: PASS. Manually compare 50 sampled English/Chinese pairs with `word`, `pos`, and `meaning`; correct any semantic mismatch before committing.

- [ ] **Step 5: Commit batch 1**

```bash
git add src/data/cet6-examples.json
git commit -m "content: add bilingual examples 1 through 1000"
```

### Task 4: Author and review examples 1001-2000

**Files:**
- Modify: `src/data/cet6-examples.json`

- [ ] **Step 1: Author IDs cet6-1001 through cet6-1500**

Use the same original sentence, common-sense, 7-18-word and matched-translation rules from Task 3.

- [ ] **Step 2: Validate through ID 1500**

Run: `python scripts/validate-cet6-examples.py --allow-incomplete --through cet6-1500`  
Expected: PASS.

- [ ] **Step 3: Author IDs cet6-1501 through cet6-2000**

For words with multiple parts of speech, demonstrate the first part of speech shown in the word metadata unless the first Chinese gloss clearly belongs to another listed part.

- [ ] **Step 4: Validate and manually sample every twentieth record**

Run: `python scripts/validate-cet6-examples.py --allow-incomplete --through cet6-2000`  
Expected: PASS; manually reviewed sample contains no grammar or translation errors.

- [ ] **Step 5: Commit batch 2**

```bash
git add src/data/cet6-examples.json
git commit -m "content: add bilingual examples 1001 through 2000"
```

### Task 5: Author and review examples 2001-3000

**Files:**
- Modify: `src/data/cet6-examples.json`

- [ ] **Step 1: Author IDs cet6-2001 through cet6-2500**

Keep situations concrete and self-contained; avoid repeated report/research/article contexts unless that context is genuinely natural for the target word.

- [ ] **Step 2: Validate through ID 2500**

Run: `python scripts/validate-cet6-examples.py --allow-incomplete --through cet6-2500`  
Expected: PASS.

- [ ] **Step 3: Author IDs cet6-2501 through cet6-3000**

Complete the source without modifying IDs or word metadata.

- [ ] **Step 4: Run strict full validation and manual sampling**

Run: `python scripts/validate-cet6-examples.py`  
Expected: PASS with exactly 3000 examples. Manually review every twentieth record plus every record named in `INFLECTION_EXCEPTIONS`.

- [ ] **Step 5: Commit batch 3**

```bash
git add src/data/cet6-examples.json scripts/validate-cet6-examples.py
git commit -m "content: complete 3000 bilingual CET-6 examples"
```

### Task 6: Join bilingual examples into the runtime word list

**Files:**
- Modify: `scripts/generate-cet6-words.py`
- Modify: `src/data/cet6-words.js`
- Modify: `tests/vocabulary.test.mjs`

- [ ] **Step 1: Add a failing runtime assertion**

Assert the first record equals:

```js
assert.equal(WORDS[0].exampleZh, "一次挫折后，她仍不肯放弃自己的长期目标。");
```

and every runtime record contains exactly one corresponding source example by ID.

- [ ] **Step 2: Run vocabulary tests and verify failure**

Run: `node --test tests/vocabulary.test.mjs`  
Expected: FAIL because the runtime mapper does not expose `exampleZh`.

- [ ] **Step 3: Remove template generation and require bilingual input**

Delete `make_example`. Load `src/data/cet6-examples.json` into an ID-keyed map, reject missing/extra IDs, and emit rows shaped:

```python
[word, phonetic, pos, meaning, examples[word_id]["example"], examples[word_id]["exampleZh"]]
```

Change the JavaScript mapper to:

```js
].map(([word, phonetic, pos, meaning, example, exampleZh], index) => ({
  id: `cet6-${String(index + 1).padStart("3", "0")}`,
  word, phonetic, pos, meaning, example, exampleZh,
}));
```

- [ ] **Step 4: Regenerate and validate the runtime data**

Update the generator so running it without an ECDICT argument reads all 3000 existing rows as immutable metadata and only reapplies the bilingual source; retain the optional ECDICT argument solely for a future vocabulary rebuild. Run `python scripts/generate-cet6-words.py`, then run `python scripts/validate-cet6-examples.py` and `node --test tests/vocabulary.test.mjs`.  
Expected: both PASS and the frozen 3000 ID map is unchanged.

- [ ] **Step 5: Commit generated runtime data**

```bash
git add scripts/generate-cet6-words.py src/data/cet6-words.js tests/vocabulary.test.mjs
git commit -m "feat: bundle reviewed bilingual examples"
```

### Task 7: Display Chinese translations on study cards

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `tests/pwa.test.mjs`

- [ ] **Step 1: Add failing study-card integration assertions**

Assert the study card renders `word.exampleZh` with class `example-translation` immediately after the English `blockquote.example`, and the stylesheet defines that class.

- [ ] **Step 2: Run the PWA test and verify failure**

Run: `node --test tests/pwa.test.mjs`  
Expected: FAIL because the translation is not rendered.

- [ ] **Step 3: Render and style the translation**

Add:

```html
<blockquote class="example">${escapeHtml(word.example)}</blockquote>
<p class="example-translation">${escapeHtml(word.exampleZh)}</p>
```

Style it with smaller type, muted color, matching left padding and comfortable line height. Keep it hidden with the rest of the card back until the card flips.

- [ ] **Step 4: Run focused tests and build**

Run: `node --test tests/vocabulary.test.mjs tests/pwa.test.mjs && pnpm build`  
Expected: PASS and production build succeeds.

- [ ] **Step 5: Commit card rendering**

```bash
git add src/app.js src/styles.css tests/pwa.test.mjs
git commit -m "feat: show Chinese example translations"
```

### Task 8: Full content regression

**Files:**
- Modify if required by failures: files already listed in Tasks 1-7

- [ ] **Step 1: Run strict content validation**

Run: `python scripts/validate-cet6-examples.py`  
Expected: PASS with 3000 records, 3000 unique English examples and zero banned phrases.

- [ ] **Step 2: Run all application tests**

Run: `pnpm test`  
Expected: all tests PASS with zero failures.

- [ ] **Step 3: Build Web and Android assets**

Run: `pnpm build && pnpm run android:sync`  
Expected: both commands exit 0 and the generated Android asset word list contains `exampleZh`.

- [ ] **Step 4: Manually inspect representative cards**

Inspect at least one noun, verb, adjective, adverb, multi-part-of-speech word and irregular inflection. Confirm English pronunciation still works, the English example is natural, the Chinese line matches it, and the mobile card does not overflow.

- [ ] **Step 5: Commit only if regression fixes were needed**

```bash
git add src scripts tests android/app/src/main/assets
git commit -m "fix: complete bilingual example verification"
```
