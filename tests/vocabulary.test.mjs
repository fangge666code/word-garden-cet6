import assert from "node:assert/strict";
import test from "node:test";
import { WORDS } from "../src/data/cet6-words.js";

test("the CET-6 core vocabulary contains exactly 1500 entries", () => {
  assert.equal(WORDS.length, 1500);
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
