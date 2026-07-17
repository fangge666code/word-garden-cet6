import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WORDS } from "../src/data/cet6-words.js";

const legacy = JSON.parse(await readFile(new URL("./fixtures/cet6-legacy-1500.json", import.meta.url), "utf8"));
const fullIdMap = JSON.parse(await readFile(new URL("./fixtures/cet6-id-map-3000.json", import.meta.url), "utf8"));

test("the CET-6 vocabulary contains exactly 3000 entries", () => {
  assert.equal(WORDS.length, 3000);
});

test("the original 1500 ids still identify the same words", () => {
  assert.deepEqual(WORDS.slice(0, 1500).map(({ id, word }) => ({ id, word })), legacy);
});

test("all 3000 ids retain their original words", () => {
  assert.deepEqual(WORDS.map(({ id, word }) => ({ id, word })), fullIdMap);
});

test("vocabulary ids and words are unique", () => {
  assert.equal(new Set(WORDS.map((entry) => entry.id)).size, WORDS.length);
  assert.equal(new Set(WORDS.map((entry) => entry.word.toLowerCase())).size, WORDS.length);
});

test("every vocabulary entry is complete and clean", () => {
  for (const entry of WORDS) {
    for (const key of ["id", "word", "phonetic", "pos", "meaning", "example", "exampleZh"]) {
      assert.equal(typeof entry[key], "string", `${entry.id} is missing ${key}`);
      if (key !== "exampleZh") assert.ok(entry[key].trim(), `${entry.id} has an empty ${key}`);
      assert.ok(!/[�]/u.test(entry[key]), `${entry.id} contains a replacement character`);
    }
  }
});

test("reviewed bilingual examples are connected to their vocabulary entries", async () => {
  const examples = JSON.parse(await readFile(new URL("../src/data/cet6-examples.json", import.meta.url), "utf8"));
  for (const item of examples) {
    const word = WORDS.find((entry) => entry.id === item.id);
    assert.equal(word.example, item.example, `${item.id} has the wrong English example`);
    assert.equal(word.exampleZh, item.exampleZh, `${item.id} has the wrong Chinese example`);
  }
});
