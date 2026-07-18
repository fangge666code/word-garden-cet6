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
  { prefix: "cet6", words: WORDS, accent: "gb", lang: "b", voice: "bf_emma", asset: "pronunciation", index: "pronunciation-index.js", legacyCache: "kokoro-bf-emma" },
  { prefix: "ky", words: KAOYAN_WORDS, accent: "gb", lang: "b", voice: "bf_emma", asset: "pronunciation-kaoyan", index: "pronunciation-kaoyan-index.js", legacyCache: "kokoro-bf-emma-kaoyan" },
  { prefix: "cet6", words: WORDS, accent: "us", engine: "edge", voice: "en-US-AriaNeural", asset: "pronunciation-us", index: "pronunciation-us-index.js" },
  { prefix: "ky", words: KAOYAN_WORDS, accent: "us", engine: "edge", voice: "en-US-AriaNeural", asset: "pronunciation-kaoyan-us", index: "pronunciation-kaoyan-us-index.js" },
];

async function generateModule(module) {
  const inputPath = join(tmpdir(), `word-garden-kokoro-${module.prefix}-${module.accent}-${process.pid}.json`);
  const cacheDirectory = join(root, ".audio-cache", `${module.engine ?? "kokoro"}-${module.voice}-${module.prefix}-clean-v2`);
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(inputPath, JSON.stringify(module.words.map(({ id, word }) => ({ id, word }))), "utf8");
  try {
    const child = execFileAsync(python, [
    join(root, "scripts", module.engine === "edge" ? "generate-edge-pronunciation.py" : "generate-kokoro-pronunciation.py"),
    "--input", inputPath,
    "--output-dir", join(root, "src", "assets", module.asset),
    "--index", join(root, "src", "data", module.index),
    "--cache-dir", cacheDirectory,
    "--prefix", module.prefix,
    ...(module.engine === "edge" ? [] : ["--lang-code", module.lang, "--voice", module.voice]),
    ...(module.legacyCache ? ["--legacy-cache-dir", join(root, ".audio-cache", module.legacyCache)] : []),
    "--expected-count", String(module.words.length),
    "--default-base-url", `./src/assets/${module.asset}`,
  ], {
    cwd: root,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONWARNINGS: "ignore", KOKORO_PARALLEL_JOBS: "2" },
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

await Promise.all(modules.filter(({ accent }) => accent === "gb").map(generateModule));
for (const module of modules.filter(({ accent }) => accent === "us")) await generateModule(module);
