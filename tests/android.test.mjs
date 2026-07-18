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

test("Android registers native English pronunciation with safe locale fallbacks", async () => {
  const [activity, plugin, manifest] = await Promise.all([
    readFile("android/app/src/main/java/com/wordgarden/cet6/MainActivity.java", "utf8"),
    readFile("android/app/src/main/java/com/wordgarden/cet6/NativePronunciationPlugin.java", "utf8"),
    readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
  ]);
  assert.match(activity, /registerPlugin\(NativePronunciationPlugin\.class\)/u);
  assert.match(plugin, /@CapacitorPlugin\(name = "NativePronunciation"\)/u);
  assert.match(plugin, /TextToSpeech\.QUEUE_FLUSH/u);
  assert.match(plugin, /Locale\.UK, Locale\.US, Locale\.ENGLISH/u);
  assert.match(plugin, /TTS_MISSING_LANGUAGE/u);
  assert.match(plugin, /engine\.shutdown\(\)/u);
  assert.match(manifest, /android\.intent\.action\.TTS_SERVICE/u);
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
  assert.equal(manifest.versionName, "1.3.0");
  assert.equal(manifest.versionCode, 9);
  assert.match(gradle, new RegExp(`versionCode ${manifest.versionCode}`, "u"));
  assert.match(gradle, new RegExp(`versionName "${manifest.versionName.replaceAll(".", "\\.")}"`, "u"));
  assert.match(manifest.apkUrl, new RegExp(`/v${manifest.versionName}/word-garden-android\\.apk$`, "u"));
});

test("Android build is a thin shell and does not bundle large pronunciation packs", async () => {
  const [pkg, build] = await Promise.all([readFile("package.json", "utf8"), readFile("scripts/build.mjs", "utf8")]);
  assert.match(pkg, /build\.mjs --android/u);
  assert.match(build, /pronunciation-kaoyan/u);
  assert.match(build, /androidBuild/u);
});
