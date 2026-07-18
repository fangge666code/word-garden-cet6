import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const androidBuild = process.argv.includes("--android");

async function contentFiles(directory, publicPrefix) {
  const files = [];
  for (const name of await readdir(directory).catch(() => [])) {
    const path = join(directory, name);
    const info = await stat(path);
    if (!info.isFile()) continue;
    const bytes = await readFile(path);
    files.push({
      path: `${publicPrefix}/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    });
  }
  return files;
}

const contentManifest = {
  schemaVersion: 1,
  resources: [
    ...(await contentFiles(join(root, "src", "assets", "pronunciation"), "src/assets/pronunciation")),
    ...(await contentFiles(join(root, "src", "assets", "pronunciation-kaoyan"), "src/assets/pronunciation-kaoyan")),
    ...(await contentFiles(join(root, "src", "assets", "pronunciation-us"), "src/assets/pronunciation-us")),
    ...(await contentFiles(join(root, "src", "assets", "pronunciation-kaoyan-us"), "src/assets/pronunciation-kaoyan-us")),
  ],
};
await writeFile(join(root, "src", "data", "content-manifest.json"), `${JSON.stringify(contentManifest, null, 2)}\n`);
if (!dist.startsWith(root)) throw new Error("Invalid build directory");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "index.html"), join(dist, "index.html"));
await cp(join(root, "src"), join(dist, "src"), { recursive: true });
await rm(join(dist, "src", "data", "kaoyan-examples-attribution.json"), { force: true });
if (androidBuild) {
  await rm(join(dist, "src", "assets", "pronunciation"), { recursive: true, force: true });
  await rm(join(dist, "src", "assets", "pronunciation-kaoyan"), { recursive: true, force: true });
  await rm(join(dist, "src", "assets", "pronunciation-us"), { recursive: true, force: true });
  await rm(join(dist, "src", "assets", "pronunciation-kaoyan-us"), { recursive: true, force: true });
}
await Promise.all(["manifest.webmanifest", "service-worker.js", "offline.html", "version.json"].map((filename) => (
  cp(join(root, filename), join(dist, filename))
)));
await mkdir(join(dist, "server"), { recursive: true });

const assetPaths = [
  "/index.html",
  "/manifest.webmanifest",
  "/service-worker.js",
  "/offline.html",
  "/version.json",
  "/src/app.js",
  "/src/cloud-config.js",
  "/src/styles.css",
  "/src/lib/account-sync.js",
  "/src/lib/cloud-sync.js",
  "/src/lib/content-updater.js",
  "/src/lib/core.js",
  "/src/lib/pronunciation.js",
  "/src/lib/app-update.js",
  "/src/lib/supabase-client.js",
  "/src/data/cet6-examples.js",
  "/src/data/pronunciation-index.js",
  "/src/data/cet6-words.js",
  "/src/data/kaoyan-words.js",
  "/src/data/books.js",
  "/src/data/pronunciation-kaoyan-index.js",
  "/src/data/pronunciation-us-index.js",
  "/src/data/pronunciation-kaoyan-us-index.js",
  "/src/data/content-manifest.json",
];
const assets = Object.fromEntries(await Promise.all(assetPaths.map(async (pathname) => [
  pathname,
  await readFile(join(root, pathname.slice(1)), "utf8"),
])));
const worker = `const ASSETS = ${JSON.stringify(assets)};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8" };
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const body = ASSETS[pathname];
    if (body == null) return new Response("Not found", { status: 404 });
    const extension = pathname.slice(pathname.lastIndexOf("."));
    return new Response(body, { headers: { "content-type": TYPES[extension] || "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
  }
};
`;
await writeFile(join(dist, "server", "index.js"), worker);
console.log(`Built ${androidBuild ? "thin Android shell" : "static site"} in dist/`);
