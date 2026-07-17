import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_INTERVAL_MS,
  activateWaitingWorker,
  checkForUpdate,
  chooseUpdateAction,
  compareVersionCodes,
  detectRuntime,
  shouldCheckForUpdate,
  snoozeUpdate,
  validateManifest,
} from "../src/lib/app-update.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

const validManifest = () => ({
  versionName: "1.2.0",
  versionCode: 3,
  webBuild: "2026-07-17.1",
  apkUrl: "https://github.com/fangge666code/word-garden-cet6/releases/download/v1.2.0/word-garden-android.apk",
  releaseNotes: ["支持自主升级", "更新全部双语例句"],
  publishedAt: "2026-07-17T00:00:00Z",
});

test("update manifests are normalized and validated", () => {
  const manifest = validateManifest(validManifest());
  assert.equal(manifest.versionCode, 3);
  assert.equal(manifest.releaseNotes.length, 2);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.releaseNotes));
  for (const invalid of [
    null,
    { ...validManifest(), versionCode: 0 },
    { ...validManifest(), apkUrl: "http://example.com/app.apk" },
    { ...validManifest(), releaseNotes: [] },
  ]) {
    assert.throws(() => validateManifest(invalid), /Invalid update manifest/u);
  }
});

test("integer version codes compare without semantic-version ambiguity", () => {
  assert.equal(compareVersionCodes(3, 2), 1);
  assert.equal(compareVersionCodes(2, 2), 0);
  assert.equal(compareVersionCodes(1, 2), -1);
});

test("automatic checks respect both the daily interval and snooze deadline", () => {
  assert.equal(shouldCheckForUpdate({ now: CHECK_INTERVAL_MS + 1, lastCheckedAt: 0, snoozedUntil: 0 }), true);
  assert.equal(shouldCheckForUpdate({ now: 2_000, lastCheckedAt: 1_000, snoozedUntil: 0 }), false);
  assert.equal(shouldCheckForUpdate({ now: CHECK_INTERVAL_MS + 1, lastCheckedAt: 0, snoozedUntil: CHECK_INTERVAL_MS + 2 }), false);
});

test("runtime detection separates Android, installed PWA and ordinary Web", () => {
  assert.equal(detectRuntime({ Capacitor: { isNativePlatform: () => true } }), "android");
  assert.equal(detectRuntime({ matchMedia: () => ({ matches: true }) }), "pwa");
  assert.equal(detectRuntime({ matchMedia: () => ({ matches: false }) }), "web");
});

test("the selected update action is appropriate for each runtime", () => {
  const manifest = validateManifest(validManifest());
  assert.equal(chooseUpdateAction({ runtime: "android", localVersionCode: 2, localWebBuild: "old", manifest }), "android-download");
  assert.equal(chooseUpdateAction({ runtime: "android", localVersionCode: 3, localWebBuild: "old", manifest }), "none");
  assert.equal(chooseUpdateAction({ runtime: "web", localVersionCode: 3, localWebBuild: "old", manifest }), "web-refresh");
  assert.equal(chooseUpdateAction({ runtime: "pwa", localVersionCode: 3, localWebBuild: manifest.webBuild, manifest }), "none");
});

test("forced checks fetch and persist the latest successful attempt time", async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(validManifest()), { status: 200 });
  };
  const result = await checkForUpdate({
    force: true,
    runtime: "android",
    localVersionCode: 2,
    fetchFn,
    storage,
    now: () => 10_000,
  });
  assert.equal(result.action, "android-download");
  assert.equal(storage.getItem("word-garden-update-last-check-v1"), "10000");
  assert.match(calls[0].url, /version\.json\?t=10000/u);
  assert.equal(calls[0].options.cache, "no-store");
});

test("scheduled checks and snoozed checks avoid the network", async () => {
  const storage = memoryStorage({ "word-garden-update-last-check-v1": "1000" });
  let calls = 0;
  const result = await checkForUpdate({
    runtime: "web",
    fetchFn: async () => { calls += 1; },
    storage,
    now: () => 2_000,
  });
  assert.deepEqual(result, { action: "none", reason: "scheduled" });
  assert.equal(calls, 0);
  snoozeUpdate(storage, 5_000);
  assert.equal(storage.getItem("word-garden-update-snooze-v1"), String(5_000 + CHECK_INTERVAL_MS));
});

test("a waiting service worker takes priority and can be activated", async () => {
  const messages = [];
  const registration = { waiting: { postMessage: (message) => messages.push(message) } };
  const result = await checkForUpdate({
    force: true,
    runtime: "pwa",
    registration,
    storage: memoryStorage(),
    now: () => 20_000,
    fetchFn: async () => { throw new Error("must not fetch"); },
  });
  assert.equal(result.action, "pwa-activate");
  activateWaitingWorker(registration);
  assert.deepEqual(messages, [{ type: "SKIP_WAITING" }]);
});

test("network and malformed-manifest failures are safe decisions", async () => {
  for (const fetchFn of [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("{}", { status: 200 }),
    async () => new Response("server error", { status: 503 }),
  ]) {
    const result = await checkForUpdate({
      force: true,
      runtime: "web",
      fetchFn,
      storage: memoryStorage(),
      now: () => 30_000,
    });
    assert.deepEqual(result, { action: "none", reason: "network" });
  }
});
