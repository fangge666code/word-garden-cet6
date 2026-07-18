"""Generate compact, indexed CET-6 pronunciation packages with Kokoro."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import wave
from pathlib import Path

import numpy as np
from kokoro import KPipeline

SOURCE_RATE = 24_000
OUTPUT_RATE = 16_000
VOICE = "bf_emma"
SPEED = 0.92
BATCH_SIZE = 20
WORDS_PER_CHUNK = 100
PADDING_BEFORE = 0.045
PADDING_AFTER = 0.085
GAP_SECONDS = 0.05


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--expected-count", required=True, type=int)
    parser.add_argument("--default-base-url", required=True)
    return parser.parse_args()


def read_pcm(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, OUTPUT_RATE):
            raise ValueError(f"Invalid cached audio format: {path}")
        data = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").copy()
    if len(data) < OUTPUT_RATE * 0.12 or not np.any(data):
        raise ValueError(f"Invalid cached audio data: {path}")
    return data


def write_pcm(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(OUTPUT_RATE)
        wav.writeframes(np.asarray(samples, dtype="<i2").tobytes())


def compact(audio: np.ndarray, start: float, end: float) -> np.ndarray:
    first = max(0, math.floor((start - PADDING_BEFORE) * SOURCE_RATE))
    last = min(len(audio), math.ceil((end + PADDING_AFTER) * SOURCE_RATE))
    clip = np.asarray(audio[first:last], dtype=np.float32)
    if len(clip) < SOURCE_RATE * 0.12 or float(np.max(np.abs(clip), initial=0)) < 0.01:
        raise ValueError("Kokoro returned an empty or silent clip")

    target_size = max(1, round(len(clip) * OUTPUT_RATE / SOURCE_RATE))
    positions = np.linspace(0, len(clip) - 1, target_size)
    clip = np.interp(positions, np.arange(len(clip)), clip).astype(np.float32)
    peak = float(np.max(np.abs(clip), initial=1e-6))
    clip *= min(1.8, 0.78 / peak)

    fade = min(round(OUTPUT_RATE * 0.008), len(clip) // 2)
    if fade:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        clip[:fade] *= ramp
        clip[-fade:] *= ramp[::-1]
    return np.clip(np.round(clip * 32767), -32768, 32767).astype("<i2")


def split_result(result, expected: int) -> list[np.ndarray]:
    tokens = result.tokens or []
    word_ranges: list[tuple[float, float]] = []
    start = None
    end = None
    for token in tokens:
        attached_delimiter = token.text != "." and token.text.endswith(".")
        if token.text != "." and token.start_ts is not None and token.end_ts is not None:
            start = token.start_ts if start is None else min(start, token.start_ts)
            end = token.end_ts if end is None else max(end, token.end_ts)
        if token.text == "." or attached_delimiter:
            if start is None or end is None:
                raise ValueError("Pronunciation delimiter appeared before a word")
            word_ranges.append((start, end))
            start = None
            end = None
            continue
    if len(word_ranges) != expected:
        raise ValueError(f"Expected {expected} timed words, got {len(word_ranges)}")
    return [compact(result.audio, start, end) for start, end in word_ranges]


def generate_missing(words: list[dict], cache_dir: Path) -> None:
    missing = []
    for word in words:
        path = cache_dir / f"{word['id']}.wav"
        try:
            read_pcm(path)
        except (FileNotFoundError, ValueError, wave.Error):
            missing.append(word)
    if not missing:
        print("All pronunciation clips are already cached.", flush=True)
        return

    pipeline = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M")
    for offset in range(0, len(missing), BATCH_SIZE):
        batch = missing[offset:offset + BATCH_SIZE]
        text = ". ".join(word["word"] for word in batch) + "."
        results = list(pipeline(text, voice=VOICE, speed=SPEED, split_pattern=None))
        if len(results) != 1:
            raise ValueError(f"Kokoro unexpectedly split a {len(batch)}-word batch into {len(results)} pieces")
        clips = split_result(results[0], len(batch))
        for word, clip in zip(batch, clips, strict=True):
            write_pcm(cache_dir / f"{word['id']}.wav", clip)
        completed = min(offset + len(batch), len(missing))
        print(f"Generated {completed}/{len(missing)} missing female clips", flush=True)


def write_packages(words: list[dict], output_dir: Path, index_path: Path, cache_dir: Path, prefix: str, default_base_url: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for old in output_dir.glob("chunk-*.wav"):
        old.unlink()

    gap = np.zeros(round(OUTPUT_RATE * GAP_SECONDS), dtype="<i2")
    rows = []
    hashes = []
    for chunk_start in range(0, len(words), WORDS_PER_CHUNK):
        chunk_words = words[chunk_start:chunk_start + WORDS_PER_CHUNK]
        parts = []
        cursor = 0
        chunk_number = chunk_start // WORDS_PER_CHUNK + 1
        for word in chunk_words:
            clip = read_pcm(cache_dir / f"{word['id']}.wav")
            rows.append([chunk_number, cursor, len(clip)])
            parts.extend((clip, gap))
            cursor += len(clip) + len(gap)
        chunk_path = output_dir / f"chunk-{chunk_number:03d}.wav"
        write_pcm(chunk_path, np.concatenate(parts))
        hashes.append(hashlib.sha256(chunk_path.read_bytes()).hexdigest()[:16])

    module = (
        f"export const PRONUNCIATION_SAMPLE_RATE = {OUTPUT_RATE};\n"
        f"export const PRONUNCIATION_CLIPS = {json.dumps(rows, separators=(',', ':'))};\n\n"
        f"export const PRONUNCIATION_CHUNK_HASHES = {json.dumps(hashes, separators=(',', ':'))};\n\n"
        f"export function pronunciationClip(wordId, baseUrl = {json.dumps(default_base_url)}) {{\n"
        f"  const match = /^{prefix}-(\\d{{3,4}})$/u.exec(String(wordId ?? \"\"));\n"
        "  if (!match) return null;\n"
        "  const entry = PRONUNCIATION_CLIPS[Number(match[1]) - 1];\n"
        "  if (!entry) return null;\n"
        "  const [chunk, start, length] = entry;\n"
        "  const version = PRONUNCIATION_CHUNK_HASHES[chunk - 1];\n"
        "  return { url: `${baseUrl}/chunk-${String(chunk).padStart(3, \"0\")}.wav?v=${version}`, start, length };\n"
        "}\n"
    )
    index_path.write_text(module, encoding="utf-8")
    print(f"Created {math.ceil(len(words) / WORDS_PER_CHUNK)} female audio chunks and {len(rows)} index entries.", flush=True)


def main() -> None:
    args = arguments()
    words = json.loads(args.input.read_text(encoding="utf-8"))
    if len(words) != args.expected_count:
        raise ValueError(f"Expected {args.expected_count} words, got {len(words)}")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    generate_missing(words, args.cache_dir)
    write_packages(words, args.output_dir, args.index, args.cache_dir, args.prefix, args.default_base_url)


if __name__ == "__main__":
    main()
