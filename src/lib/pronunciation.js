import { PRONUNCIATION_SAMPLE_RATE, pronunciationClip as cet6PronunciationClip } from "../data/pronunciation-index.js";
import { pronunciationClip as kaoyanPronunciationClip } from "../data/pronunciation-kaoyan-index.js";
import { pronunciationClip as cet6AmericanPronunciationClip } from "../data/pronunciation-us-index.js";
import { pronunciationClip as kaoyanAmericanPronunciationClip } from "../data/pronunciation-kaoyan-us-index.js";

const PUBLIC_ASSET_ROOT = "https://fangge666code.github.io/word-garden-cet6/src/assets";

export function pronunciationClip(wordId, baseUrl, scope = globalThis, accent = "gb") {
  const native = scope?.Capacitor?.isNativePlatform?.() === true;
  const american = accent === "us";
  if (String(wordId).startsWith("ky-")) {
    const resolve = american ? kaoyanAmericanPronunciationClip : kaoyanPronunciationClip;
    const directory = american ? "pronunciation-kaoyan-us" : "pronunciation-kaoyan";
    return resolve(wordId, baseUrl ?? (native ? `${PUBLIC_ASSET_ROOT}/${directory}` : `./src/assets/${directory}`));
  }
  const resolve = american ? cet6AmericanPronunciationClip : cet6PronunciationClip;
  const directory = american ? "pronunciation-us" : "pronunciation";
  return resolve(wordId, baseUrl ?? (native ? `${PUBLIC_ASSET_ROOT}/${directory}` : `./src/assets/${directory}`));
}

export function selectEnglishVoice(voices = [], accent = "gb") {
  const preferred = accent === "us" ? "en-us" : "en-gb";
  return voices.find((voice) => voice.lang?.toLowerCase() === preferred)
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
const decodedClips = new Map();
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

function pcmWave(pcm, sampleRate = PRONUNCIATION_SAMPLE_RATE) {
  const source = new Uint8Array(pcm);
  const output = new ArrayBuffer(44 + source.byteLength);
  const bytes = new Uint8Array(output);
  const view = new DataView(output);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + source.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, source.byteLength, true);
  bytes.set(source, 44);
  return output;
}

async function decodedClip(clip, context, fetchFn) {
  const key = `${clip.url}#${clip.start}:${clip.length}`;
  if (!decodedClips.has(key)) {
    const pending = (async () => {
      const firstByte = 44 + clip.start * 2;
      const lastByte = firstByte + clip.length * 2 - 1;
      let response;
      try {
        response = await fetchFn(clip.url, {
          cache: "no-store",
          headers: { Range: `bytes=${firstByte}-${lastByte}` },
        });
        if (response?.ok && response.status === 206) {
          const pcm = await response.arrayBuffer();
          if (pcm.byteLength === clip.length * 2) {
            return {
              buffer: await decodeAudioData(context, pcmWave(pcm)),
              offset: 0,
              duration: clip.length / PRONUNCIATION_SAMPLE_RATE,
              partial: true,
            };
          }
        } else if (response?.ok) {
          return {
            buffer: await decodeAudioData(context, await response.arrayBuffer()),
            offset: clip.start / PRONUNCIATION_SAMPLE_RATE,
            duration: clip.length / PRONUNCIATION_SAMPLE_RATE,
            partial: false,
          };
        }
      } catch {
        // A full-chunk request below preserves compatibility with hosts without Range support.
      }
      return {
        buffer: await decodedChunk(clip.url, context, fetchFn),
        offset: clip.start / PRONUNCIATION_SAMPLE_RATE,
        duration: clip.length / PRONUNCIATION_SAMPLE_RATE,
        partial: false,
      };
    })();
    decodedClips.set(key, pending);
    pending.catch(() => decodedClips.delete(key));
  }
  return decodedClips.get(key);
}

async function speakWithBundledAudio(wordId, options = {}) {
  const scope = options.scope ?? globalThis;
  const resolveClip = options.clipResolver ?? pronunciationClip;
  const clip = resolveClip(wordId, options.audioBaseUrl, scope, options.accent ?? "gb");
  const context = audioContext(scope, options.audioContext);
  const fetchFn = options.fetchFn ?? scope?.fetch?.bind(scope);
  if (!clip || !context || !fetchFn) return { ok: false, reason: "audio-unavailable" };

  try {
    if (context.state === "suspended" && typeof context.resume === "function") await context.resume();
    const loaded = await decodedClip(clip, context, fetchFn);
    if (activeSource) {
      try { activeSource.stop(); } catch {}
    }
    const source = context.createBufferSource();
    source.buffer = loaded.buffer;
    source.connect(context.destination);
    source.start(0, loaded.offset, loaded.duration);
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
  const accent = options.accent === "us" ? "us" : "gb";
  const voice = selectEnglishVoice(engine.getVoices(), accent);
  utterance.lang = voice?.lang || (accent === "us" ? "en-US" : "en-GB");
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
    const detail = await nativePlugin.speak({ text: String(word), locale: options.accent === "us" ? "en-US" : "en-GB" });
    return { ok: true, source: "native", detail };
  } catch (error) {
    return { ok: false, reason: nativeFailureReason(error), error };
  }
}

export async function preloadPronunciation(wordId, options = {}) {
  const scope = options.scope ?? globalThis;
  const resolveClip = options.clipResolver ?? pronunciationClip;
  const context = audioContext(scope, options.audioContext);
  const fetchFn = options.fetchFn ?? scope?.fetch?.bind(scope);
  if (!context || !fetchFn || !wordId) return false;
  if (options.resume && context.state === "suspended" && typeof context.resume === "function") {
    try { await context.resume(); } catch { /* Decoding can still continue before the next user gesture. */ }
  }
  const accents = options.accents ?? ["gb", "us"];
  const loaded = await Promise.allSettled(accents.map((accent) => {
    const clip = resolveClip(wordId, options.audioBaseUrl, scope, accent);
    return clip ? decodedClip(clip, context, fetchFn) : Promise.reject(new Error("Audio unavailable"));
  }));
  return loaded.some((result) => result.status === "fulfilled");
}
