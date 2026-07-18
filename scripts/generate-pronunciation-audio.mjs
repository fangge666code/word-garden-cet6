import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WORDS } from "../src/data/cet6-words.js";
import { KAOYAN_WORDS } from "../src/data/kaoyan-words.js";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.KOKORO_PYTHON || "python";
const modules = [
  { prefix: "cet6", words: WORDS, asset: "pronunciation", index: "pronunciation-index.js", cache: "kokoro-bf-emma" },
  { prefix: "ky", words: KAOYAN_WORDS, asset: "pronunciation-kaoyan", index: "pronunciation-kaoyan-index.js", cache: "kokoro-bf-emma-kaoyan" },
];

for (const module of modules) {
  const inputPath = join(tmpdir(), `word-garden-kokoro-${module.prefix}-${process.pid}.json`);
  const cacheDirectory = join(root, ".audio-cache", module.cache);
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(inputPath, JSON.stringify(module.words.map(({ id, word }) => ({ id, word }))), "utf8");
  try {
    const child = execFileAsync(python, [
    join(root, "scripts", "generate-kokoro-pronunciation.py"),
    "--input", inputPath,
    "--output-dir", join(root, "src", "assets", module.asset),
    "--index", join(root, "src", "data", module.index),
    "--cache-dir", cacheDirectory,
    "--prefix", module.prefix,
    "--expected-count", String(module.words.length),
    "--default-base-url", `./src/assets/${module.asset}`,
  ], {
    cwd: root,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONWARNINGS: "ignore" },
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  child.child?.stdout?.pipe(process.stdout);
  child.child?.stderr?.pipe(process.stderr);
    await child;
  } finally {
    await rm(inputPath, { force: true });
  }
}
