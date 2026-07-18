import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PRONUNCIATION_CLIPS as CET6_GB, pronunciationClip as cet6GbClip } from "../src/data/pronunciation-index.js";
import { PRONUNCIATION_CLIPS as KAOYAN_GB, pronunciationClip as kaoyanGbClip } from "../src/data/pronunciation-kaoyan-index.js";
import { PRONUNCIATION_CLIPS as CET6_US, pronunciationClip as cet6UsClip } from "../src/data/pronunciation-us-index.js";
import { PRONUNCIATION_CLIPS as KAOYAN_US, pronunciationClip as kaoyanUsClip } from "../src/data/pronunciation-kaoyan-us-index.js";

async function validatePackages({ clips, count, chunks, directory, firstId, lastId, resolveClip }) {
  assert.equal(clips.length, count);
  const dataSizes = new Map();
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    const filename = `src/assets/${directory}/chunk-${String(chunk).padStart(3, "0")}.wav`;
    const wav = await readFile(filename);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(34), 16);
    dataSizes.set(chunk, wav.readUInt32LE(40) / 2);
  }
  clips.forEach(([chunk, start, length], index) => {
    assert.ok(chunk >= 1 && chunk <= chunks, `word ${index + 1} has an invalid chunk`);
    assert.ok(start >= 0 && length > 0, `word ${index + 1} has an invalid slice`);
    assert.ok(start + length <= dataSizes.get(chunk), `word ${index + 1} exceeds its chunk`);
  });
  assert.match(resolveClip(firstId)?.url ?? "", new RegExp(`${directory}/chunk-001\\.wav\\?v=`, "u"));
  assert.match(resolveClip(lastId)?.url ?? "", new RegExp(`${directory}/chunk-${String(chunks).padStart(3, "0")}\\.wav\\?v=`, "u"));
}

test("all 6500 words have valid clean British female packages", async () => {
  await validatePackages({ clips: CET6_GB, count: 3000, chunks: 120, directory: "pronunciation", firstId: "cet6-0001", lastId: "cet6-3000", resolveClip: cet6GbClip });
  await validatePackages({ clips: KAOYAN_GB, count: 3500, chunks: 140, directory: "pronunciation-kaoyan", firstId: "ky-0001", lastId: "ky-3500", resolveClip: kaoyanGbClip });
});

test("all 6500 words have valid clean American female packages", async () => {
  await validatePackages({ clips: CET6_US, count: 3000, chunks: 120, directory: "pronunciation-us", firstId: "cet6-0001", lastId: "cet6-3000", resolveClip: cet6UsClip });
  await validatePackages({ clips: KAOYAN_US, count: 3500, chunks: 140, directory: "pronunciation-kaoyan-us", firstId: "ky-0001", lastId: "ky-3500", resolveClip: kaoyanUsClip });
});

test("ocean no longer starts with the previous word's trailing vowel", async () => {
  const [chunk, start] = KAOYAN_GB[1074];
  const wav = await readFile(`src/assets/pronunciation-kaoyan/chunk-${String(chunk).padStart(3, "0")}.wav`);
  const sampleCount = Math.round(16000 * 0.035);
  let energy = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = wav.readInt16LE(44 + (start + index) * 2) / 32768;
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / sampleCount);
  assert.ok(rms < 0.05, `ocean has unexpected preroll energy: ${rms}`);
});
