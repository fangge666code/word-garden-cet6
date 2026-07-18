import assert from "node:assert/strict";
import test from "node:test";
import { BOOKS, getBook, moduleStorageKey } from "../src/data/books.js";

test("CET-6 and Kaoyan are separate complete learning modules", () => {
  assert.equal(BOOKS.cet6.words.length, 3000);
  assert.equal(BOOKS.kaoyan.words.length, 3500);
  assert.ok(BOOKS.cet6.words.every((word) => word.id.startsWith("cet6-")));
  assert.ok(BOOKS.kaoyan.words.every((word) => word.id.startsWith("ky-")));
  assert.equal(new Set([...BOOKS.cet6.words, ...BOOKS.kaoyan.words].map((word) => word.id)).size, 6500);
});

test("module storage keys isolate anonymous and signed-in progress", () => {
  assert.equal(moduleStorageKey("data", null, "cet6"), "data:cet6");
  assert.equal(moduleStorageKey("data", null, "kaoyan"), "data:kaoyan");
  assert.equal(moduleStorageKey("user", "u1", "cet6"), "user:u1:cet6");
  assert.equal(getBook("unknown").id, "cet6");
});

test("every Kaoyan word has study-ready bilingual content", () => {
  const words = BOOKS.kaoyan.words;
  assert.equal(new Set(words.map((word) => word.word)).size, words.length);
  for (const word of words) {
    assert.ok(word.word && word.phonetic && word.pos && word.meaning && word.example && word.exampleZh);
  }
});
