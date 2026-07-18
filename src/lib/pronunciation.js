export function selectEnglishVoice(voices = []) {
  return voices.find((voice) => voice.lang?.toLowerCase() === "en-gb")
    ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-"))
    ?? voices.find((voice) => voice.lang?.toLowerCase() === "en")
    ?? null;
}

export function speechSupported(scope = globalThis) {
  return Boolean(scope?.speechSynthesis && scope?.SpeechSynthesisUtterance);
}

export function speakWord(word, options = {}) {
  const engine = options.engine ?? globalThis.speechSynthesis;
  const Utterance = options.Utterance ?? globalThis.SpeechSynthesisUtterance;
  if (!engine || !Utterance) return { ok: false, reason: "unsupported" };

  const utterance = new Utterance(String(word));
  const voice = selectEnglishVoice(engine.getVoices());
  utterance.lang = voice?.lang || "en-GB";
  if (voice) utterance.voice = voice;
  engine.cancel();
  engine.speak(utterance);
  return { ok: true, voice };
}
