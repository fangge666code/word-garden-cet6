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

test("service worker caches the offline fallback and played pronunciation packages", async () => {
  const worker = await readText("service-worker.js");
  assert.match(worker, /offline\.html/u);
  assert.match(worker, /request\.mode === "navigate"/u);
  assert.match(worker, /caches\.match/u);
  assert.match(worker, /src\/assets\/pronunciation\/chunk-/u);
  assert.match(worker, /cache\.put/u);
  assert.doesNotMatch(worker, /cet6-words|src\/app|index\.html/u);
  assert.match(worker, /addEventListener\("message"/u);
  assert.match(worker, /event\.data\?\.type === "SKIP_WAITING"/u);
  const installHandler = worker.match(/addEventListener\("install"[\s\S]*?^\}\);/mu)?.[0] ?? "";
  assert.doesNotMatch(installHandler, /self\.skipWaiting\(\)/u);
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

test("Home offers user-controlled updates for Web, PWA and Android", async () => {
  const [app, css] = await Promise.all([readText("src/app.js"), readText("src/styles.css")]);
  assert.match(app, /from "\.\/lib\/app-update\.js"/u);
  assert.match(app, /检查更新/u);
  assert.match(app, /立即刷新/u);
  assert.match(app, /立即升级/u);
  assert.match(app, /立即更新/u);
  assert.match(app, /稍后提醒/u);
  assert.match(app, /controllerchange/u);
  assert.match(css, /\.update-notes/u);
  assert.match(css, /\.update-actions/u);
});

test("account activation keeps refresh credentials and offers safe reauthentication", async () => {
  const app = await readText("src/app.js");
  assert.match(app, /refreshToken: user\.refreshToken/u);
  assert.match(app, /expiresAt: user\.expiresAt/u);
  assert.match(app, /id="reauth-account">重新登录/u);
  assert.match(app, /本机记录已保留，请重新登录同一账号/u);
});

test("logged-out users authenticate on Home before opening learning routes", async () => {
  const app = await readText("src/app.js");
  assert.match(app, /const PROTECTED_ROUTES = new Set\(\["study", "library", "settings"\]\)/u);
  assert.match(app, /if \(!currentUser && PROTECTED_ROUTES\.has\(current\)\)/u);
  assert.match(app, /function renderSignedOutHome\(\)/u);
  assert.match(app, /登录后开始学习/u);
  assert.doesNotMatch(app, /<div class="settings-grid">\s*\$\{accountCard\(\)\}/u);
});

test("study cards and vocabulary rows expose click-to-play pronunciation", async () => {
  const app = await readText("src/app.js");
  assert.match(app, /from "\.\/lib\/pronunciation\.js\?v=5"/u);
  assert.match(app, /data-speak-id/u);
  assert.match(app, /data-speak-word/u);
  assert.match(app, /播放 \$\{escapeHtml\(word\.word\)\} 的英式发音/u);
  assert.match(app, /event\.stopPropagation\(\)/u);
  assert.match(app, /await speakWord\(button\.dataset\.speakWord, \{ wordId: button\.dataset\.speakId \}\)/u);
  assert.match(app, /发音资源暂时无法播放/u);
});

test("hosted worker embeds the reviewed bilingual example module", async () => {
  const buildScript = await readText("scripts/build.mjs");
  assert.match(buildScript, /\/src\/data\/cet6-examples\.js/u);
  assert.match(buildScript, /\/src\/data\/pronunciation-index\.js/u);
  assert.match(buildScript, /\/src\/data\/cet6-words\.js/u);
});

test("authentication and pronunciation controls have responsive accessible styles", async () => {
  const css = await readText("src/styles.css");
  assert.match(css, /\.auth-home\s*\{/u);
  assert.match(css, /\.home-account-bar\s*\{/u);
  assert.match(css, /\.speak-button\s*\{/u);
  assert.match(css, /\.speak-button:focus-visible/u);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.auth-home/u);
});
