import assert from "node:assert/strict";
import test from "node:test";
import { selectEnglishVoice, speakWord, speechSupported } from "../src/lib/pronunciation.js";

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.voice = null;
  }
}

test("British voices are preferred and the previous utterance is cancelled", () => {
  const spoken = [];
  const engine = {
    getVoices: () => [{ lang: "en-US", name: "US" }, { lang: "en-GB", name: "UK" }],
    cancel: () => spoken.push("cancel"),
    speak: (utterance) => spoken.push(utterance),
  };
  const result = speakWord("abandon", { engine, Utterance: FakeUtterance });
  assert.equal(result.ok, true);
  assert.equal(result.voice.lang, "en-GB");
  assert.equal(spoken[0], "cancel");
  assert.equal(spoken[1].text, "abandon");
  assert.equal(spoken[1].lang, "en-GB");
});

test("another English voice is used when en-GB is absent", () => {
  assert.equal(selectEnglishVoice([{ lang: "zh-CN" }, { lang: "en-US" }]).lang, "en-US");
});

test("unsupported speech returns a safe result", () => {
  assert.deepEqual(speakWord("abandon", { engine: null, Utterance: null }), { ok: false, reason: "unsupported" });
  assert.equal(speechSupported({}), false);
});
