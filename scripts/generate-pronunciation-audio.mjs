import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WORDS } from "../src/data/cet6-words.js";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "src", "assets", "pronunciation");
const indexPath = join(root, "src", "data", "pronunciation-index.js");
const executable = process.env.ESPEAK_NG;
const dataRoot = process.env.ESPEAK_DATA_ROOT;
const concurrency = Math.max(1, Math.min(12, Number(process.env.AUDIO_JOBS) || 8));
const sampleRate = 11025;
const wordsPerChunk = 100;
const gap = Buffer.alloc(Math.round(sampleRate * 0.04), 128);

if (!executable || !dataRoot) {
  throw new Error("Set ESPEAK_NG and ESPEAK_DATA_ROOT before generating pronunciation audio.");
}

function findChunk(buffer, wanted) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (name === wanted) return { offset: offset + 8, size };
    offset += 8 + size + (size % 2);
  }
  return null;
}

function compactPcm(buffer, outputRate = sampleRate) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("eSpeak returned an invalid WAV file");
  }
  const format = findChunk(buffer, "fmt ");
  const data = findChunk(buffer, "data");
  if (!format || !data) throw new Error("WAV file is missing format or data chunks");
  const audioFormat = buffer.readUInt16LE(format.offset);
  const channels = buffer.readUInt16LE(format.offset + 2);
  const inputRate = buffer.readUInt32LE(format.offset + 4);
  const bitsPerSample = buffer.readUInt16LE(format.offset + 14);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(`Unsupported eSpeak WAV format: ${audioFormat}/${channels}/${bitsPerSample}`);
  }

  const sampleCount = Math.floor(data.size / 2);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(data.offset + index * 2);
  }

  const threshold = 220;
  let first = 0;
  let last = samples.length - 1;
  while (first < last && Math.abs(samples[first]) <= threshold) first += 1;
  while (last > first && Math.abs(samples[last]) <= threshold) last -= 1;
  const padding = Math.round(inputRate * 0.035);
  first = Math.max(0, first - padding);
  last = Math.min(samples.length - 1, last + padding);

  let peak = 1;
  for (let index = first; index <= last; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
  const gain = Math.min(2, 28_000 / peak);
  const outputCount = Math.max(1, Math.round(((last - first + 1) * outputRate) / inputRate));
  const pcm = Buffer.alloc(outputCount);
  const fadeLength = Math.max(1, Math.round(outputRate * 0.008));
  for (let index = 0; index < outputCount; index += 1) {
    const sourcePosition = first + (index * inputRate) / outputRate;
    const left = Math.min(last, Math.floor(sourcePosition));
    const right = Math.min(last, left + 1);
    const fraction = sourcePosition - left;
    let value = (samples[left] * (1 - fraction) + samples[right] * fraction) * gain;
    const fade = Math.min(1, index / fadeLength, (outputCount - 1 - index) / fadeLength);
    value *= Math.max(0, fade);
    pcm[index] = Math.max(0, Math.min(255, Math.round(128 + value / 256)));
  }
  return pcm;
}

function wavFromPcm(pcm) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

async function generateClip(word, position) {
  const rawPath = join(tmpdir(), `word-garden-${process.pid}-${word.id}.raw.wav`);
  await execFileAsync(executable, [
    `--path=${dataRoot}`,
    "-v", "en-gb",
    "-s", "150",
    "-w", rawPath,
    word.word,
  ], { windowsHide: true });
  const pcm = compactPcm(await readFile(rawPath));
  await rm(rawPath, { force: true });
  if ((position + 1) % 100 === 0 || position + 1 === WORDS.length) {
    console.log(`Generated ${position + 1}/${WORDS.length}`);
  }
  return pcm;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const clips = new Array(WORDS.length);
let nextIndex = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (nextIndex < WORDS.length) {
    const index = nextIndex;
    nextIndex += 1;
    clips[index] = await generateClip(WORDS[index], index);
  }
}));

const indexRows = new Array(WORDS.length);
for (let chunkStart = 0; chunkStart < WORDS.length; chunkStart += wordsPerChunk) {
  const chunkNumber = Math.floor(chunkStart / wordsPerChunk) + 1;
  const parts = [];
  let cursor = 0;
  for (let wordIndex = chunkStart; wordIndex < Math.min(chunkStart + wordsPerChunk, WORDS.length); wordIndex += 1) {
    const pcm = clips[wordIndex];
    indexRows[wordIndex] = [chunkNumber, cursor, pcm.length];
    parts.push(pcm, gap);
    cursor += pcm.length + gap.length;
  }
  const filename = `chunk-${String(chunkNumber).padStart(3, "0")}.wav`;
  await writeFile(join(outputDirectory, filename), wavFromPcm(Buffer.concat(parts)));
}

const indexModule = `export const PRONUNCIATION_SAMPLE_RATE = ${sampleRate};\n`
  + `export const PRONUNCIATION_CLIPS = ${JSON.stringify(indexRows)};\n\n`
  + `export function pronunciationClip(wordId, baseUrl = "./src/assets/pronunciation") {\n`
  + `  const match = /^cet6-(\\d{3,4})$/u.exec(String(wordId ?? ""));\n`
  + `  if (!match) return null;\n`
  + `  const entry = PRONUNCIATION_CLIPS[Number(match[1]) - 1];\n`
  + `  if (!entry) return null;\n`
  + `  const [chunk, start, length] = entry;\n`
  + `  return { url: \`${"${baseUrl}"}/chunk-\${String(chunk).padStart(3, "0")}.wav\`, start, length };\n`
  + `}\n`;
await writeFile(indexPath, indexModule, "utf8");

console.log(`Created ${Math.ceil(WORDS.length / wordsPerChunk)} audio chunks and ${indexRows.length} index entries.`);
