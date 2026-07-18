import assert from "node:assert/strict";
import test from "node:test";
import { nativePronunciationPlugin, preloadPronunciation, selectEnglishVoice, speakWord, speechSupported, webAudioSupported } from "../src/lib/pronunciation.js";

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.voice = null;
  }
}

function fakeAudio(url = "chunk-test.wav") {
  const sources = [];
  const context = {
    state: "suspended",
    destination: {},
    resumed: 0,
    async resume() { this.resumed += 1; this.state = "running"; },
    async decodeAudioData() { return { decoded: true }; },
    createBufferSource() {
      const source = {
        stopped: false,
        connected: null,
        started: null,
        connect(destination) { this.connected = destination; },
        start(...args) { this.started = args; },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
  };
  return {
    context,
    sources,
    fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    clipResolver: () => ({ url, start: 16000, length: 8000 }),
  };
}

test("bundled audio resumes Web Audio and plays the indexed slice", async () => {
  const audio = fakeAudio("chunk-bundled.wav");
  const result = await speakWord("abandon", {
    wordId: "cet6-001",
    audioContext: audio.context,
    fetchFn: audio.fetchFn,
    clipResolver: audio.clipResolver,
    engine: null,
    Utterance: null,
    nativePlugin: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "bundled");
  assert.equal(audio.context.resumed, 1);
  assert.deepEqual(audio.sources[0].started, [0, 1, 0.5]);
  assert.equal(audio.sources[0].connected, audio.context.destination);
});

test("a byte-range response decodes and plays only the selected word", async () => {
  const requests = [];
  const decoded = [];
  const sources = [];
  const context = {
    state: "running",
    destination: {},
    async decodeAudioData(value) { decoded.push(value); return { decoded: true }; },
    createBufferSource() {
      const source = {
        connect() {},
        start(...args) { this.started = args; },
        stop() {},
      };
      sources.push(source);
      return source;
    },
  };
  const clip = { url: "chunk-range-unique.wav", start: 16000, length: 8000 };
  const result = await speakWord("abandon", {
    wordId: "cet6-001",
    audioContext: context,
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(16000) };
    },
    clipResolver: () => clip,
    engine: null,
    Utterance: null,
    nativePlugin: null,
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Range, "bytes=32044-48043");
  assert.equal(decoded[0].byteLength, 16044);
  assert.equal(new TextDecoder().decode(decoded[0].slice(0, 4)), "RIFF");
  assert.deepEqual(sources[0].started, [0, 0, 0.5]);
});

test("starting another word stops the previous bundled pronunciation", async () => {
  const first = fakeAudio("chunk-first.wav");
  await speakWord("abandon", { wordId: "cet6-001", audioContext: first.context, fetchFn: first.fetchFn, clipResolver: first.clipResolver });
  const second = fakeAudio("chunk-second.wav");
  await speakWord("ability", { wordId: "cet6-002", audioContext: second.context, fetchFn: second.fetchFn, clipResolver: second.clipResolver });
  assert.equal(first.sources[0].stopped, true);
  assert.equal(second.sources[0].stopped, false);
});

test("a failed audio package falls back to the proven browser voice", async () => {
  const spoken = [];
  const engine = {
    getVoices: () => [{ lang: "en-GB", name: "UK" }],
    cancel: () => spoken.push("cancel"),
    speak: (utterance) => spoken.push(utterance),
  };
  const context = { state: "running", decodeAudioData: async () => ({}), createBufferSource: () => ({}) };
  const result = await speakWord("wooden", {
    wordId: "cet6-001",
    audioContext: context,
    fetchFn: async () => ({ ok: false, status: 404 }),
    clipResolver: () => ({ url: "missing.wav", start: 0, length: 1 }),
    engine,
    Utterance: FakeUtterance,
    nativePlugin: null,
  });
  assert.equal(result.source, "web");
  assert.equal(spoken[1].text, "wooden");
});

test("native pronunciation remains the final fallback", async () => {
  const calls = [];
  const nativePlugin = { speak: async (value) => { calls.push(value); return { locale: "en-GB" }; } };
  const result = await speakWord("wooden", { nativePlugin, engine: null, Utterance: null });
  assert.equal(result.source, "native");
  assert.deepEqual(calls, [{ text: "wooden", locale: "en-GB" }]);
});

test("British voices are preferred", () => {
  assert.equal(selectEnglishVoice([{ lang: "en-US" }, { lang: "en-GB" }]).lang, "en-GB");
});

test("American voices are preferred for the US button", () => {
  assert.equal(selectEnglishVoice([{ lang: "en-GB" }, { lang: "en-US" }], "us").lang, "en-US");
});

test("mobile preloading decodes both accent packages before the click", async () => {
  const audio = fakeAudio("preload.wav");
  const accents = [];
  const loaded = await preloadPronunciation("cet6-001", {
    audioContext: audio.context,
    fetchFn: audio.fetchFn,
    accents: ["gb", "us"],
    clipResolver: (_wordId, _baseUrl, _scope, accent) => {
      accents.push(accent);
      return { url: `preload-${accent}.wav`, start: 0, length: 100 };
    },
  });
  assert.equal(loaded, true);
  assert.deepEqual(accents, ["gb", "us"]);
});

test("pointer preloading can resume a suspended mobile audio context", async () => {
  const audio = fakeAudio("preload-resume-unique.wav");
  await preloadPronunciation("cet6-001", {
    audioContext: audio.context,
    fetchFn: audio.fetchFn,
    accents: ["gb"],
    resume: true,
    clipResolver: audio.clipResolver,
  });
  assert.equal(audio.context.resumed, 1);
});

test("support detection covers Web Audio, browser speech and Android native speech", () => {
  assert.equal(webAudioSupported({ AudioContext: class {} }), true);
  assert.equal(speechSupported({ AudioContext: class {} }), true);
  assert.equal(speechSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} }), true);
  const speak = async () => {};
  const scope = { Capacitor: { Plugins: { NativePronunciation: { speak } } } };
  assert.equal(nativePronunciationPlugin(scope).speak, speak);
  assert.equal(speechSupported(scope), true);
  assert.equal(speechSupported({}), false);
});

test("unsupported speech returns a safe result", async () => {
  assert.deepEqual(await speakWord("abandon", { nativePlugin: null, engine: null, Utterance: null }), { ok: false, reason: "unsupported" });
});
