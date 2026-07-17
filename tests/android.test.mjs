import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Capacitor config bundles the site as the 词间 Android app", async () => {
  const config = JSON.parse(await readFile("capacitor.config.json", "utf8"));
  assert.equal(config.appId, "com.wordgarden.cet6");
  assert.equal(config.appName, "词间");
  assert.equal(config.webDir, "dist");
  assert.equal(config.server.androidScheme, "https");
});

test("Android package has internet access and release signing support", async () => {
  const [manifest, gradle] = await Promise.all([
    readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
    readFile("android/app/build.gradle", "utf8"),
  ]);
  assert.match(manifest, /android\.permission\.INTERNET/u);
  assert.match(gradle, /applicationId "com\.wordgarden\.cet6"/u);
  assert.match(gradle, /ANDROID_KEYSTORE_PATH/u);
  assert.match(gradle, /signingConfig signingConfigs\.release/u);
});

test("GitHub workflow publishes a stable signed APK download", async () => {
  const [workflow, app] = await Promise.all([
    readFile(".github/workflows/android-release.yml", "utf8"),
    readFile("src/app.js", "utf8"),
  ]);
  assert.match(workflow, /assembleRelease/u);
  assert.match(workflow, /ANDROID_KEYSTORE_BASE64/u);
  assert.match(workflow, /word-garden-android\.apk/u);
  assert.match(app, /releases\/latest\/download\/word-garden-android\.apk/u);
  assert.match(app, /下载安卓版 APK/u);
});

test("Android and the public update manifest share one release version", async () => {
  const [gradle, manifestText] = await Promise.all([
    readFile("android/app/build.gradle", "utf8"),
    readFile("version.json", "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.versionName, "1.2.1");
  assert.equal(manifest.versionCode, 4);
  assert.match(gradle, new RegExp(`versionCode ${manifest.versionCode}`, "u"));
  assert.match(gradle, new RegExp(`versionName "${manifest.versionName.replaceAll(".", "\\.")}"`, "u"));
  assert.match(manifest.apkUrl, new RegExp(`/v${manifest.versionName}/word-garden-android\\.apk$`, "u"));
});
