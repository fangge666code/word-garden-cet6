import assert from "node:assert/strict";
import test from "node:test";
import { nativePronunciationPlugin, selectEnglishVoice, speakWord, speechSupported } from "../src/lib/pronunciation.js";

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.voice = null;
  }
}

test("British voices are preferred and the previous utterance is cancelled", async () => {
  const spoken = [];
  const engine = {
    getVoices: () => [{ lang: "en-US", name: "US" }, { lang: "en-GB", name: "UK" }],
    cancel: () => spoken.push("cancel"),
    speak: (utterance) => spoken.push(utterance),
  };
  const result = await speakWord("abandon", { nativePlugin: null, engine, Utterance: FakeUtterance });
  assert.equal(result.ok, true);
  assert.equal(result.source, "web");
  assert.equal(result.voice.lang, "en-GB");
  assert.equal(spoken[0], "cancel");
  assert.equal(spoken[1].text, "abandon");
  assert.equal(spoken[1].lang, "en-GB");
});

test("another English voice is used when en-GB is absent", () => {
  assert.equal(selectEnglishVoice([{ lang: "zh-CN" }, { lang: "en-US" }]).lang, "en-US");
});

test("Android native pronunciation is preferred over browser speech", async () => {
  const calls = [];
  const nativePlugin = { speak: async (value) => { calls.push(value); return { locale: "en-GB" }; } };
  const result = await speakWord("wooden", { nativePlugin, engine: null, Utterance: null });
  assert.deepEqual(calls, [{ text: "wooden" }]);
  assert.equal(result.ok, true);
  assert.equal(result.source, "native");
  assert.equal(result.detail.locale, "en-GB");
});

test("native pronunciation failures produce actionable reasons", async () => {
  const missingLanguage = { speak: async () => { const error = new Error("missing"); error.code = "TTS_MISSING_LANGUAGE"; throw error; } };
  const unavailable = { speak: async () => { const error = new Error("missing"); error.code = "TTS_UNAVAILABLE"; throw error; } };
  assert.equal((await speakWord("wooden", { nativePlugin: missingLanguage })).reason, "missing-language");
  assert.equal((await speakWord("wooden", { nativePlugin: unavailable })).reason, "native-unavailable");
});

test("unsupported speech returns a safe result", async () => {
  assert.deepEqual(await speakWord("abandon", { nativePlugin: null, engine: null, Utterance: null }), { ok: false, reason: "unsupported" });
  assert.equal(speechSupported({}), false);
});

test("native plugin discovery enables pronunciation without Web Speech", () => {
  const speak = async () => {};
  const scope = { Capacitor: { Plugins: { NativePronunciation: { speak } } } };
  assert.equal(nativePronunciationPlugin(scope).speak, speak);
  assert.equal(speechSupported(scope), true);
});
