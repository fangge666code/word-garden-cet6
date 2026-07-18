"""Generate clean, compact American female pronunciation packages with Edge TTS."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import wave
from pathlib import Path

import edge_tts
import miniaudio
import numpy as np

SAMPLE_RATE = 16_000
VOICE = "en-US-AriaNeural"
RATE = "-8%"
CONCURRENCY = 20
WORDS_PER_CHUNK = 25
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


def write_pcm(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(np.asarray(samples, dtype="<i2").tobytes())


def read_pcm(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError(f"Invalid cached audio format: {path}")
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").copy()


def clean_pcm(samples: np.ndarray) -> np.ndarray:
    audio = np.asarray(samples, dtype=np.float32) / 32768
    frame_size = round(SAMPLE_RATE * 0.01)
    frame_count = len(audio) // frame_size
    if frame_count < 12:
        raise ValueError("Generated clip is too short")
    frames = audio[:frame_count * frame_size].reshape(frame_count, frame_size)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    threshold = max(0.002, float(np.max(rms, initial=0)) * 0.025)
    active = np.flatnonzero(rms >= threshold)
    if not len(active):
        raise ValueError("Generated clip is silent")
    first = max(0, int(active[0] * frame_size - SAMPLE_RATE * 0.04))
    last = min(len(audio), int((active[-1] + 1) * frame_size + SAMPLE_RATE * 0.07))
    clip = audio[first:last].copy()
    if not SAMPLE_RATE * 0.12 <= len(clip) <= SAMPLE_RATE * 3.0:
        raise ValueError(f"Generated clip has an invalid duration: {len(clip) / SAMPLE_RATE:.3f}s")
    peak = float(np.max(np.abs(clip), initial=1e-6))
    clip *= min(1.8, 0.78 / peak)
    fade = min(round(SAMPLE_RATE * 0.008), len(clip) // 2)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)
    clip[:fade] *= ramp
    clip[-fade:] *= ramp[::-1]
    return np.clip(np.round(clip * 32767), -32768, 32767).astype("<i2")


async def synthesize(word: dict, cache_dir: Path, semaphore: asyncio.Semaphore) -> None:
    destination = cache_dir / f"{word['id']}.wav"
    try:
        cached = read_pcm(destination)
        if SAMPLE_RATE * 0.12 <= len(cached) <= SAMPLE_RATE * 3.0 and np.any(cached):
            return
    except (FileNotFoundError, ValueError, wave.Error):
        pass
    async with semaphore:
        for attempt in range(3):
            try:
                encoded = bytearray()
                communicate = edge_tts.Communicate(word["word"], voice=VOICE, rate=RATE)
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        encoded.extend(chunk["data"])
                decoded = miniaudio.decode(bytes(encoded), output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1, sample_rate=SAMPLE_RATE)
                samples = np.frombuffer(decoded.samples, dtype="<i2").copy()
                write_pcm(destination, clean_pcm(samples))
                return
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(0.5 * (attempt + 1))


async def generate_missing(words: list[dict], cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(CONCURRENCY)
    completed = 0
    lock = asyncio.Lock()

    async def tracked(word: dict) -> None:
        nonlocal completed
        await synthesize(word, cache_dir, semaphore)
        async with lock:
            completed += 1
            if completed % 100 == 0 or completed == len(words):
                print(f"{VOICE}: checked {completed}/{len(words)} clean clips", flush=True)

    await asyncio.gather(*(tracked(word) for word in words))


def write_packages(words: list[dict], output_dir: Path, index_path: Path, cache_dir: Path, prefix: str, default_base_url: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for old in output_dir.glob("chunk-*.wav"):
        old.unlink()
    gap = np.zeros(round(SAMPLE_RATE * GAP_SECONDS), dtype="<i2")
    rows = []
    hashes = []
    for chunk_start in range(0, len(words), WORDS_PER_CHUNK):
        parts = []
        cursor = 0
        chunk_number = chunk_start // WORDS_PER_CHUNK + 1
        for word in words[chunk_start:chunk_start + WORDS_PER_CHUNK]:
            clip = read_pcm(cache_dir / f"{word['id']}.wav")
            rows.append([chunk_number, cursor, len(clip)])
            parts.extend((clip, gap))
            cursor += len(clip) + len(gap)
        chunk_path = output_dir / f"chunk-{chunk_number:03d}.wav"
        write_pcm(chunk_path, np.concatenate(parts))
        hashes.append(hashlib.sha256(chunk_path.read_bytes()).hexdigest()[:16])
    module = (
        f"export const PRONUNCIATION_SAMPLE_RATE = {SAMPLE_RATE};\n"
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
    print(f"Created {math.ceil(len(words) / WORDS_PER_CHUNK)} American female audio chunks and {len(rows)} index entries.", flush=True)


def main() -> None:
    args = arguments()
    words = json.loads(args.input.read_text(encoding="utf-8"))
    if len(words) != args.expected_count:
        raise ValueError(f"Expected {args.expected_count} words, got {len(words)}")
    asyncio.run(generate_missing(words, args.cache_dir))
    write_packages(words, args.output_dir, args.index, args.cache_dir, args.prefix, args.default_base_url)


if __name__ == "__main__":
    main()
