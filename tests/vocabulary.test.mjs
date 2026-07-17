import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WORDS } from "../src/data/cet6-words.js";

const legacy = JSON.parse(await readFile(new URL("./fixtures/cet6-legacy-1500.json", import.meta.url), "utf8"));

test("the CET-6 vocabulary contains exactly 3000 entries", () => {
  assert.equal(WORDS.length, 3000);
});

test("the original 1500 ids still identify the same words", () => {
  assert.deepEqual(WORDS.slice(0, 1500).map(({ id, word }) => ({ id, word })), legacy);
});

test("vocabulary ids and words are unique", () => {
  assert.equal(new Set(WORDS.map((entry) => entry.id)).size, WORDS.length);
  assert.equal(new Set(WORDS.map((entry) => entry.word.toLowerCase())).size, WORDS.length);
});

test("every vocabulary entry is complete and clean", () => {
  for (const entry of WORDS) {
    for (const key of ["id", "word", "phonetic", "pos", "meaning", "example"]) {
      assert.equal(typeof entry[key], "string", `${entry.id} is missing ${key}`);
      assert.ok(entry[key].trim(), `${entry.id} has an empty ${key}`);
      assert.ok(!/[�]/u.test(entry[key]), `${entry.id} contains a replacement character`);
    }
  }
});
