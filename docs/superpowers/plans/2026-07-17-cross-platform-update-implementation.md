# Cross-Platform Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-blocking, user-controlled updates for browser, installed PWA, and Android APK clients.

**Architecture:** A static `version.json` is the single public release description. A focused update library validates the manifest, determines the runtime, applies daily/snooze rules, and returns decisions; `src/app.js` renders the prompt and delegates platform actions. The Service Worker waits for explicit activation, while Android uses its packaged version constant and opens the stable APK URL.

**Tech Stack:** Vanilla ES modules, Service Worker API, localStorage, Capacitor 8 Android, Node.js test runner, GitHub Actions.

---

## File structure

- Create `version.json`: public release metadata shared by Web/PWA/Android.
- Create `src/lib/app-update.js`: manifest validation, version comparison, runtime detection, scheduling and snooze decisions.
- Create `tests/app-update.test.mjs`: unit tests for update decisions and failure cases.
- Modify `service-worker.js`: wait for an explicit `SKIP_WAITING` message and delete old caches on activation.
- Modify `src/app.js`: register the worker, check the manifest, render the update modal, expose manual checking on Home.
- Modify `src/styles.css`: update badge, modal actions and small-screen layout.
- Modify `scripts/build.mjs`: copy `version.json` and include the update library in hosted assets.
- Modify `tests/pwa.test.mjs`: integration assertions for the update lifecycle.
- Modify `tests/android.test.mjs`: assert Android version and APK behavior.
- Modify `android/app/build.gradle`: release version 1.2.0 / code 3.
- Modify `.github/workflows/android-release.yml`: verify tag, Gradle version and manifest version agree before publishing.

### Task 1: Version manifest and pure update decisions

**Files:**
- Create: `version.json`
- Create: `src/lib/app-update.js`
- Create: `tests/app-update.test.mjs`
- Modify: `scripts/build.mjs`

- [ ] **Step 1: Write failing manifest and decision tests**

Add tests that import `validateManifest`, `compareVersionCodes`, `shouldCheckForUpdate`, and `chooseUpdateAction` and assert:

```js
const manifest = validateManifest({
  versionName: "1.2.0",
  versionCode: 3,
  webBuild: "2026-07-17.1",
  apkUrl: "https://github.com/fangge666code/word-garden-cet6/releases/download/v1.2.0/word-garden-android.apk",
  releaseNotes: ["支持自主升级", "更新全部双语例句"],
  publishedAt: "2026-07-17T00:00:00Z",
});
assert.equal(manifest.versionCode, 3);
assert.equal(compareVersionCodes(3, 2), 1);
assert.equal(compareVersionCodes(2, 2), 0);
assert.equal(shouldCheckForUpdate({ now: 86_400_001, lastCheckedAt: 0, snoozedUntil: 0 }), true);
assert.equal(shouldCheckForUpdate({ now: 2_000, lastCheckedAt: 1_000, snoozedUntil: 0 }), false);
assert.equal(chooseUpdateAction({ runtime: "android", localVersionCode: 2, manifest }), "android-download");
assert.equal(chooseUpdateAction({ runtime: "web", localWebBuild: "old", manifest }), "web-refresh");
```

Also assert malformed manifests throw `Invalid update manifest` and missing `apkUrl` suppresses the Android action.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/app-update.test.mjs`  
Expected: FAIL because `src/lib/app-update.js` does not exist.

- [ ] **Step 3: Add the static version manifest**

Create `version.json` with exactly:

```json
{
  "versionName": "1.2.0",
  "versionCode": 3,
  "webBuild": "2026-07-17.1",
  "apkUrl": "https://github.com/fangge666code/word-garden-cet6/releases/download/v1.2.0/word-garden-android.apk",
  "releaseNotes": ["支持网页、PWA 和安卓自主升级", "更新 3000 个单词的中英文例句"],
  "publishedAt": "2026-07-17T00:00:00Z"
}
```

- [ ] **Step 4: Implement pure update helpers**

Export constants `CURRENT_VERSION_NAME = "1.2.0"`, `CURRENT_VERSION_CODE = 3`, `CURRENT_WEB_BUILD = "2026-07-17.1"`, `CHECK_INTERVAL_MS = 86_400_000`, and functions with these signatures:

```js
export function validateManifest(value) {
  const required = ["versionName", "webBuild", "apkUrl", "publishedAt"];
  const validStrings = value && typeof value === "object"
    && required.every((key) => typeof value[key] === "string" && value[key].trim());
  const validNotes = Array.isArray(value?.releaseNotes)
    && value.releaseNotes.length > 0
    && value.releaseNotes.every((note) => typeof note === "string" && note.trim());
  let apkUrl;
  try { apkUrl = new URL(value?.apkUrl); } catch { apkUrl = null; }
  if (!validStrings || !Number.isInteger(value.versionCode) || value.versionCode < 1
      || !validNotes || apkUrl?.protocol !== "https:") {
    throw new Error("Invalid update manifest");
  }
  return Object.freeze({
    versionName: value.versionName.trim(),
    versionCode: value.versionCode,
    webBuild: value.webBuild.trim(),
    apkUrl: apkUrl.href,
    releaseNotes: Object.freeze(value.releaseNotes.map((note) => note.trim())),
    publishedAt: value.publishedAt.trim(),
  });
}
export function compareVersionCodes(remote, local) { return Math.sign(remote - local); }
export function shouldCheckForUpdate({ now, lastCheckedAt, snoozedUntil }) {
  return now >= snoozedUntil && now - lastCheckedAt >= CHECK_INTERVAL_MS;
}
export function detectRuntime(scope = globalThis) {
  if (scope.Capacitor?.isNativePlatform?.()) return "android";
  if (scope.matchMedia?.("(display-mode: standalone)")?.matches) return "pwa";
  return "web";
}
export function chooseUpdateAction({ runtime, localVersionCode, localWebBuild, manifest }) {
  if (runtime === "android") return manifest.apkUrl && manifest.versionCode > localVersionCode ? "android-download" : "none";
  return manifest.webBuild !== localWebBuild ? "web-refresh" : "none";
}
```

Validation must require positive integer `versionCode`, non-empty strings for version/build/date, an HTTPS APK URL, and an array of non-empty release-note strings.

- [ ] **Step 5: Copy the manifest and library in production builds**

Add `version.json` to the root-copy list and `/version.json` plus `/src/lib/app-update.js` to `assetPaths` in `scripts/build.mjs`.

- [ ] **Step 6: Run tests and build**

Run: `node --test tests/app-update.test.mjs && pnpm build`  
Expected: tests PASS and `dist/version.json` exists.

- [ ] **Step 7: Commit the pure update layer**

```bash
git add version.json src/lib/app-update.js tests/app-update.test.mjs scripts/build.mjs
git commit -m "feat: add version manifest and update decisions"
```

### Task 2: Explicit PWA update lifecycle

**Files:**
- Modify: `service-worker.js`
- Modify: `tests/pwa.test.mjs`

- [ ] **Step 1: Add failing Service Worker lifecycle assertions**

Replace the old skip-waiting expectation with assertions that the worker contains a `message` listener, checks `event.data?.type === "SKIP_WAITING"`, and only then calls `self.skipWaiting()`.

- [ ] **Step 2: Run the PWA test and verify failure**

Run: `node --test tests/pwa.test.mjs`  
Expected: FAIL because the worker currently calls `skipWaiting()` during installation.

- [ ] **Step 3: Make worker activation user-controlled**

Keep the offline fallback cache, remove `self.skipWaiting()` from `install`, and add:

```js
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

Retain old-cache deletion and `clients.claim()` in `activate`.

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/pwa.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit the worker lifecycle**

```bash
git add service-worker.js tests/pwa.test.mjs
git commit -m "feat: let users activate PWA updates"
```

### Task 3: Update coordinator and PWA refresh action

**Files:**
- Modify: `src/lib/app-update.js`
- Modify: `tests/app-update.test.mjs`

- [ ] **Step 1: Write failing coordinator tests**

Use injected `fetchFn`, `storage`, `clock`, and `registration` fakes to assert:

```js
const result = await checkForUpdate({ force: true, runtime: "pwa", fetchFn, storage, now: () => 10_000 });
assert.equal(result.action, "pwa-activate");
assert.equal(storage.getItem("word-garden-update-last-check-v1"), "10000");
```

Also test network timeout returns `{ action: "none", reason: "network" }`, non-forced checks obey the 24-hour window, `snoozeUpdate()` writes `now + CHECK_INTERVAL_MS`, and a waiting worker takes priority over manifest build comparison.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/app-update.test.mjs`  
Expected: FAIL because coordinator functions are missing.

- [ ] **Step 3: Implement injected coordinator functions**

Add:

```js
export async function checkForUpdate({
  force = false,
  runtime = detectRuntime(),
  localVersionCode = CURRENT_VERSION_CODE,
  localWebBuild = CURRENT_WEB_BUILD,
  fetchFn = fetch,
  storage = localStorage,
  now = Date.now,
  registration = null,
  manifestUrl = "https://fangge666code.github.io/word-garden-cet6/version.json",
} = {}) {
  const timestamp = now();
  const lastCheckedAt = Number(storage.getItem(LAST_CHECK_KEY) || 0);
  const snoozedUntil = Number(storage.getItem(SNOOZE_KEY) || 0);
  if (!force && !shouldCheckForUpdate({ now: timestamp, lastCheckedAt, snoozedUntil })) {
    return { action: "none", reason: "scheduled" };
  }
  storage.setItem(LAST_CHECK_KEY, String(timestamp));
  if (registration?.waiting) return { action: "pwa-activate", manifest: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const separator = manifestUrl.includes("?") ? "&" : "?";
    const response = await fetchFn(`${manifestUrl}${separator}t=${timestamp}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = validateManifest(await response.json());
    return {
      action: chooseUpdateAction({ runtime, localVersionCode, localWebBuild, manifest }),
      manifest,
    };
  } catch {
    return { action: "none", reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}
export function snoozeUpdate(storage, now = Date.now()) {
  storage.setItem(SNOOZE_KEY, String(now + CHECK_INTERVAL_MS));
}
export function activateWaitingWorker(registration) {
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}
```

Fetch the absolute GitHub Pages manifest URL with `cache: "no-store"` and `?t=<now>`. Store check and snooze timestamps under namespaced keys. Never throw fetch errors to the UI.

- [ ] **Step 4: Run the coordinator tests**

Run: `node --test tests/app-update.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit the coordinator**

```bash
git add src/lib/app-update.js tests/app-update.test.mjs
git commit -m "feat: coordinate app update checks"
```

### Task 4: Home update UI and platform actions

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`
- Modify: `tests/pwa.test.mjs`

- [ ] **Step 1: Add failing UI integration assertions**

Assert `src/app.js` imports `checkForUpdate`, renders Chinese labels `检查更新`, `立即刷新`, `立即升级`, `立即更新`, and `稍后提醒`, and handles `controllerchange` with a one-refresh guard.

- [ ] **Step 2: Run PWA tests and verify failure**

Run: `node --test tests/pwa.test.mjs`  
Expected: FAIL because update controls do not exist.

- [ ] **Step 3: Render manual checking on signed-in and signed-out Home cards**

Add a `data-check-update` secondary button to `accountCard()` and `installAppCard()`. Bind it in the existing Home action binding without moving authentication back to Settings.

- [ ] **Step 4: Add a single reusable update modal**

Render release notes safely through `escapeHtml`. Use one action label selected from the decision: Web `立即刷新`, PWA `立即升级`, Android `立即更新`; always include `稍后提醒`.

- [ ] **Step 5: Wire update actions**

On Web, call `registration.update()` and reload after the new worker controls the page. On PWA, call `activateWaitingWorker(registration)`. On Android, open the HTTPS APK URL in a new external browsing context. Automatic checks run once after app initialization; manual checks pass `force: true` and show `当前已是最新版本` when no update exists.

- [ ] **Step 6: Add responsive styles**

Add focused selectors `.update-status`, `.update-notes`, and `.update-actions`; under the existing mobile media query stack both action buttons to full width.

- [ ] **Step 7: Run tests and manually exercise the modal**

Run: `node --test tests/pwa.test.mjs tests/app-update.test.mjs && pnpm build`  
Expected: PASS and build succeeds. In development, temporarily use an older local build constant, confirm the prompt, then restore `CURRENT_WEB_BUILD` before committing.

- [ ] **Step 8: Commit update UI**

```bash
git add src/app.js src/styles.css tests/pwa.test.mjs
git commit -m "feat: add user-controlled update prompts"
```

### Task 5: Android version and release consistency

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `.github/workflows/android-release.yml`
- Modify: `tests/android.test.mjs`

- [ ] **Step 1: Add failing release consistency tests**

Read `version.json`, Gradle, and the workflow. Assert Gradle contains `versionCode 3` and `versionName "1.2.0"`; assert the workflow contains a step named `Verify release versions` that compares the tag, JSON version and Gradle version.

- [ ] **Step 2: Run Android tests and verify failure**

Run: `node --test tests/android.test.mjs`  
Expected: FAIL because Gradle is still version 1.1.0 / code 2.

- [ ] **Step 3: Bump Android release version**

Change Gradle to:

```gradle
versionCode 3
versionName "1.2.0"
```

- [ ] **Step 4: Add workflow preflight validation**

Before the Android build, run a Node script in the workflow that reads `version.json`, verifies `GITHUB_REF_NAME === "v" + versionName` for tag builds, and regex-checks the Gradle name/code. Exit nonzero with a precise mismatch message.

- [ ] **Step 5: Run Android tests and sync**

Run: `node --test tests/android.test.mjs && pnpm run android:sync`  
Expected: PASS and Capacitor sync completes.

- [ ] **Step 6: Commit Android release consistency**

```bash
git add android/app/build.gradle .github/workflows/android-release.yml tests/android.test.mjs android/app/src/main/assets
git commit -m "release: prepare Android 1.2.0 updates"
```

### Task 6: Full update regression and deployment readiness

**Files:**
- Modify if required by failures: files already listed in Tasks 1-5

- [ ] **Step 1: Run the complete automated suite**

Run: `pnpm test`  
Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run production builds**

Run: `pnpm build && pnpm run android:sync`  
Expected: both commands exit 0; `dist/version.json` and Android web assets contain version 1.2.0 metadata.

- [ ] **Step 3: Perform four runtime checks**

Verify: desktop browser offers refresh for an older Web build; mobile browser behaves the same; installed PWA activates a waiting worker once; Android 1.1.0 offers the v1.2.0 APK without blocking learning when offline.

- [ ] **Step 4: Commit only if runtime fixes were needed**

```bash
git add src service-worker.js version.json scripts tests android .github/workflows
git commit -m "fix: complete cross-platform update verification"
```
