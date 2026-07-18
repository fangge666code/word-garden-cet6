import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PRONUNCIATION_CLIPS, PRONUNCIATION_SAMPLE_RATE, pronunciationClip } from "../src/data/pronunciation-index.js";
import { PRONUNCIATION_CLIPS as KAOYAN_CLIPS, pronunciationClip as kaoyanPronunciationClip } from "../src/data/pronunciation-kaoyan-index.js";

test("all 3000 words map inside 30 valid PCM audio packages", async () => {
  assert.equal(PRONUNCIATION_SAMPLE_RATE, 16000);
  assert.equal(PRONUNCIATION_CLIPS.length, 3000);
  const dataSizes = new Map();
  for (let chunk = 1; chunk <= 30; chunk += 1) {
    const filename = `src/assets/pronunciation/chunk-${String(chunk).padStart(3, "0")}.wav`;
    const wav = await readFile(filename);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), PRONUNCIATION_SAMPLE_RATE);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString("ascii", 36, 40), "data");
    dataSizes.set(chunk, wav.readUInt32LE(40) / 2);
  }

  PRONUNCIATION_CLIPS.forEach(([chunk, start, length], index) => {
    assert.ok(chunk >= 1 && chunk <= 30, `word ${index + 1} has an invalid chunk`);
    assert.ok(start >= 0 && length > 0, `word ${index + 1} has an invalid slice`);
    assert.ok(start + length <= dataSizes.get(chunk), `word ${index + 1} exceeds its chunk`);
  });
  assert.match(pronunciationClip("cet6-0001")?.url ?? "", /^\.\/src\/assets\/pronunciation\/chunk-001\.wav\?v=/u);
  assert.match(pronunciationClip("cet6-3000")?.url ?? "", /^\.\/src\/assets\/pronunciation\/chunk-030\.wav\?v=/u);
  assert.equal(pronunciationClip("unknown"), null);
});

test("all 3500 Kaoyan words map inside 35 versioned female audio packages", async () => {
  assert.equal(KAOYAN_CLIPS.length, 3500);
  for (let chunk = 1; chunk <= 35; chunk += 1) {
    const filename = `src/assets/pronunciation-kaoyan/chunk-${String(chunk).padStart(3, "0")}.wav`;
    const wav = await readFile(filename);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 16000);
  }
  assert.match(kaoyanPronunciationClip("ky-0001")?.url ?? "", /pronunciation-kaoyan\/chunk-001\.wav\?v=/u);
  assert.match(kaoyanPronunciationClip("ky-3500")?.url ?? "", /pronunciation-kaoyan\/chunk-035\.wav\?v=/u);
  assert.equal(kaoyanPronunciationClip("cet6-0001"), null);
});
