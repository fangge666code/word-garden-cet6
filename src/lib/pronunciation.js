import { PRONUNCIATION_SAMPLE_RATE, pronunciationClip as cet6PronunciationClip } from "../data/pronunciation-index.js";
import { pronunciationClip as kaoyanPronunciationClip } from "../data/pronunciation-kaoyan-index.js";

const PUBLIC_ASSET_ROOT = "https://fangge666code.github.io/word-garden-cet6/src/assets";

export function pronunciationClip(wordId, baseUrl, scope = globalThis) {
  const native = scope?.Capacitor?.isNativePlatform?.() === true;
  if (String(wordId).startsWith("ky-")) {
    return kaoyanPronunciationClip(wordId, baseUrl ?? (native ? `${PUBLIC_ASSET_ROOT}/pronunciation-kaoyan` : "./src/assets/pronunciation-kaoyan"));
  }
  return cet6PronunciationClip(wordId, baseUrl ?? (native ? `${PUBLIC_ASSET_ROOT}/pronunciation` : "./src/assets/pronunciation"));
}

export function selectEnglishVoice(voices = []) {
  return voices.find((voice) => voice.lang?.toLowerCase() === "en-gb")
    ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-"))
    ?? voices.find((voice) => voice.lang?.toLowerCase() === "en")
    ?? null;
}

export function nativePronunciationPlugin(scope = globalThis) {
  const plugin = scope?.Capacitor?.Plugins?.NativePronunciation;
  return typeof plugin?.speak === "function" ? plugin : null;
}

export function webAudioSupported(scope = globalThis) {
  return Boolean(scope?.AudioContext || scope?.webkitAudioContext);
}

export function speechSupported(scope = globalThis) {
  return Boolean(webAudioSupported(scope) || nativePronunciationPlugin(scope)
    || (scope?.speechSynthesis && scope?.SpeechSynthesisUtterance));
}

const decodedChunks = new Map();
let sharedContext = null;
let activeSource = null;

function audioContext(scope, supplied) {
  if (supplied) return supplied;
  if (sharedContext) return sharedContext;
  const Constructor = scope?.AudioContext || scope?.webkitAudioContext;
  if (!Constructor) return null;
  sharedContext = new Constructor();
  return sharedContext;
}

function decodeAudioData(context, arrayBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const pending = context.decodeAudioData(arrayBuffer, resolve, reject);
      if (pending?.then) pending.then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function decodedChunk(url, context, fetchFn) {
  if (!decodedChunks.has(url)) {
    const pending = (async () => {
      let response;
      const cacheStorage = globalThis.caches;
      if (cacheStorage?.open) {
        const cache = await cacheStorage.open("word-garden-content-v1");
        response = await cache.match(url);
        if (!response) {
          response = await fetchFn(url);
          if (response?.ok) await cache.put(url, response.clone());
        }
      } else {
        response = await fetchFn(url);
      }
      if (!response?.ok) throw new Error(`Audio request failed: ${response?.status ?? "unknown"}`);
      return decodeAudioData(context, await response.arrayBuffer());
    })();
    decodedChunks.set(url, pending);
    pending.catch(() => decodedChunks.delete(url));
  }
  return decodedChunks.get(url);
}

async function speakWithBundledAudio(wordId, options = {}) {
  const scope = options.scope ?? globalThis;
  const resolveClip = options.clipResolver ?? pronunciationClip;
  const clip = resolveClip(wordId, options.audioBaseUrl, scope);
  const context = audioContext(scope, options.audioContext);
  const fetchFn = options.fetchFn ?? scope?.fetch?.bind(scope);
  if (!clip || !context || !fetchFn) return { ok: false, reason: "audio-unavailable" };

  try {
    if (context.state === "suspended" && typeof context.resume === "function") await context.resume();
    const buffer = await decodedChunk(clip.url, context, fetchFn);
    if (activeSource) {
      try { activeSource.stop(); } catch {}
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0, clip.start / PRONUNCIATION_SAMPLE_RATE, clip.length / PRONUNCIATION_SAMPLE_RATE);
    activeSource = source;
    source.onended = () => { if (activeSource === source) activeSource = null; };
    return { ok: true, source: "bundled", clip, node: source };
  } catch (error) {
    return { ok: false, reason: "audio-failed", error };
  }
}

function speakWithWebVoice(word, options = {}) {
  const engine = options.engine ?? globalThis.speechSynthesis;
  const Utterance = options.Utterance ?? globalThis.SpeechSynthesisUtterance;
  if (!engine || !Utterance) return { ok: false, reason: "unsupported" };

  const utterance = new Utterance(String(word));
  const voice = selectEnglishVoice(engine.getVoices());
  utterance.lang = voice?.lang || "en-GB";
  if (voice) utterance.voice = voice;
  engine.cancel();
  engine.speak(utterance);
  return { ok: true, source: "web", voice };
}

function nativeFailureReason(error) {
  if (error?.code === "TTS_MISSING_LANGUAGE") return "missing-language";
  if (error?.code === "TTS_UNAVAILABLE") return "native-unavailable";
  return "playback-failed";
}

export async function speakWord(word, options = {}) {
  const bundled = await speakWithBundledAudio(options.wordId, options);
  if (bundled.ok) return bundled;

  const web = speakWithWebVoice(word, options);
  if (web.ok) return web;

  const scope = options.scope ?? globalThis;
  const nativePlugin = Object.hasOwn(options, "nativePlugin")
    ? options.nativePlugin
    : nativePronunciationPlugin(scope);
  if (!nativePlugin) return bundled.reason === "audio-failed" ? bundled : web;
  try {
    const detail = await nativePlugin.speak({ text: String(word) });
    return { ok: true, source: "native", detail };
  } catch (error) {
    return { ok: false, reason: nativeFailureReason(error), error };
  }
}
