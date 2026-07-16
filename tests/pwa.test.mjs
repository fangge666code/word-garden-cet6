import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("web app manifest describes an installable standalone app", async () => {
  const manifest = JSON.parse(await readText("manifest.webmanifest"));
  assert.equal(manifest.name, "词间 · CET-6 学习");
  assert.equal(manifest.short_name, "词间");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./#home");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.theme_color, "#1f6b4f");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose.includes("any")));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("any")));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")));
});

test("PWA icons are valid PNG files with the declared sizes", async () => {
  const expected = new Map([
    ["src/assets/icons/icon-192.png", [192, 192]],
    ["src/assets/icons/icon-512.png", [512, 512]],
    ["src/assets/icons/icon-maskable-512.png", [512, 512]],
    ["src/assets/icons/apple-touch-icon.png", [180, 180]],
  ]);
  for (const [path, [width, height]] of expected) {
    const png = await readFile(new URL(`../${path}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});

test("page metadata connects the manifest and Apple icon", async () => {
  const html = await readText("index.html");
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/u);
  assert.match(html, /rel="apple-touch-icon" href="\.\/src\/assets\/icons\/apple-touch-icon\.png"/u);
  assert.match(html, /apple-mobile-web-app-capable/u);
});

test("service worker only caches the offline fallback", async () => {
  const worker = await readText("service-worker.js");
  assert.match(worker, /offline\.html/u);
  assert.match(worker, /request\.mode === "navigate"/u);
  assert.match(worker, /caches\.match/u);
  assert.doesNotMatch(worker, /cet6-words|src\/app|index\.html/u);
  const offline = await readText("offline.html");
  assert.match(offline, /请连接网络后继续学习/u);
  assert.match(offline, /重新加载/u);
});

test("application registers the service worker and provides install UI", async () => {
  const app = await readText("src/app.js");
  assert.match(app, /beforeinstallprompt/u);
  assert.match(app, /serviceWorker\.register/u);
  assert.match(app, /安装词间 App/u);
  assert.match(app, /添加到主屏幕/u);
});
