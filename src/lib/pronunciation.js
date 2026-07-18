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

export function speechSupported(scope = globalThis) {
  return Boolean(nativePronunciationPlugin(scope) || (scope?.speechSynthesis && scope?.SpeechSynthesisUtterance));
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
  const scope = options.scope ?? globalThis;
  const nativePlugin = Object.hasOwn(options, "nativePlugin")
    ? options.nativePlugin
    : nativePronunciationPlugin(scope);
  if (nativePlugin) {
    try {
      const detail = await nativePlugin.speak({ text: String(word) });
      return { ok: true, source: "native", detail };
    } catch (error) {
      return { ok: false, reason: nativeFailureReason(error), error };
    }
  }
  return speakWithWebVoice(word, options);
}
