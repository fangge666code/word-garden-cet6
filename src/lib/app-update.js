export const CURRENT_VERSION_NAME = "1.2.0";
export const CURRENT_VERSION_CODE = 3;
export const CURRENT_WEB_BUILD = "2026-07-17.1";
export const CHECK_INTERVAL_MS = 86_400_000;
export const UPDATE_MANIFEST_URL = "https://fangge666code.github.io/word-garden-cet6/version.json";

const LAST_CHECK_KEY = "word-garden-update-last-check-v1";
const SNOOZE_KEY = "word-garden-update-snooze-v1";

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

export function validateManifest(value) {
  const requiredStrings = ["versionName", "webBuild", "apkUrl", "publishedAt"];
  const stringsValid = value && typeof value === "object"
    && requiredStrings.every((key) => nonEmptyString(value[key]));
  const notesValid = Array.isArray(value?.releaseNotes)
    && value.releaseNotes.length > 0
    && value.releaseNotes.every(nonEmptyString);
  let apkUrl;
  try {
    apkUrl = new URL(value?.apkUrl);
  } catch {
    apkUrl = null;
  }
  if (!stringsValid
      || !Number.isInteger(value.versionCode)
      || value.versionCode < 1
      || !notesValid
      || apkUrl?.protocol !== "https:") {
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

export function compareVersionCodes(remote, local) {
  return Math.sign(remote - local);
}

export function shouldCheckForUpdate({ now, lastCheckedAt, snoozedUntil }) {
  return now >= snoozedUntil && now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

export function detectRuntime(scope = globalThis) {
  if (scope.Capacitor?.isNativePlatform?.()) return "android";
  if (scope.matchMedia?.("(display-mode: standalone)")?.matches) return "pwa";
  return "web";
}

export function chooseUpdateAction({ runtime, localVersionCode, localWebBuild, manifest }) {
  if (runtime === "android") {
    return manifest.apkUrl && compareVersionCodes(manifest.versionCode, localVersionCode) > 0
      ? "android-download"
      : "none";
  }
  return manifest.webBuild !== localWebBuild ? "web-refresh" : "none";
}

export async function checkForUpdate({
  force = false,
  runtime = detectRuntime(),
  localVersionCode = CURRENT_VERSION_CODE,
  localWebBuild = CURRENT_WEB_BUILD,
  fetchFn = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  now = Date.now,
  registration = null,
  manifestUrl = UPDATE_MANIFEST_URL,
  timeoutMs = 6_000,
} = {}) {
  const timestamp = now();
  const lastCheckedAt = Number(storage?.getItem(LAST_CHECK_KEY) || 0);
  const snoozedUntil = Number(storage?.getItem(SNOOZE_KEY) || 0);
  if (!force && !shouldCheckForUpdate({ now: timestamp, lastCheckedAt, snoozedUntil })) {
    return { action: "none", reason: "scheduled" };
  }
  storage?.setItem(LAST_CHECK_KEY, String(timestamp));
  if (runtime === "pwa" && registration?.waiting) return { action: "pwa-activate", manifest: null };
  if (!fetchFn) return { action: "none", reason: "network" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

export function snoozeUpdate(storage = globalThis.localStorage, now = Date.now()) {
  storage?.setItem(SNOOZE_KEY, String(now + CHECK_INTERVAL_MS));
}

export function activateWaitingWorker(registration) {
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}
