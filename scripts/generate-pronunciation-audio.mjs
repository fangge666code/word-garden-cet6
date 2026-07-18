import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { WORDS } from "../src/data/cet6-words.js";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.KOKORO_PYTHON || "python";
const inputPath = join(tmpdir(), `word-garden-kokoro-${process.pid}.json`);
const outputDirectory = join(root, "src", "assets", "pronunciation");
const indexPath = join(root, "src", "data", "pronunciation-index.js");
const cacheDirectory = join(root, ".audio-cache", "kokoro-bf-emma");

await mkdir(cacheDirectory, { recursive: true });
await writeFile(inputPath, JSON.stringify(WORDS.map(({ id, word }) => ({ id, word }))), "utf8");

try {
  const child = execFileAsync(python, [
    join(root, "scripts", "generate-kokoro-pronunciation.py"),
    "--input", inputPath,
    "--output-dir", outputDirectory,
    "--index", indexPath,
    "--cache-dir", cacheDirectory,
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
