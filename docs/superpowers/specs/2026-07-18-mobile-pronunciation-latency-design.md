# Mobile Pronunciation Latency Design

## Goal

Make the first pronunciation tap on a phone start promptly while preserving the reviewed British and American female recordings.

## Decision

Use HTTP byte-range requests to download only the PCM bytes for the selected word. Each pronunciation index already records the word's sample offset and length inside a standard 16 kHz mono WAV chunk, so the client can request that exact range, prepend a small WAV header, and decode a 10–30 KB word clip instead of a roughly 500–700 KB chunk.

Alternatives considered:

- Splitting packages into smaller chunks would add hundreds or thousands of repository files and still download unrelated words.
- Android/browser text-to-speech starts quickly but produces inconsistent voices and pronunciation across devices.
- Per-word range loading retains the existing reviewed recordings and provides the largest latency reduction without changing the vocabulary assets.

## Data Flow

1. Resolve the word, accent, chunk URL, sample start, and sample length from the existing index.
2. Check the in-memory decoded-word cache.
3. Request `bytes=44+start*2` through `44+(start+length)*2-1` from the WAV chunk.
4. For a `206 Partial Content` response, build a valid WAV containing only that word and decode it from offset zero.
5. If the host does not honor byte ranges and returns `200`, decode the full chunk and use the existing offset-based playback path.
6. Keep browser speech and Android native speech as the final fallback when recorded audio is unavailable.

## Mobile Prioritization

- Preload both accents for the current card first.
- Start preloading the next card only after the current card preload settles, so it cannot compete for bandwidth.
- On pointer-down, resume the audio context and prioritize the selected accent before the click event completes.

## Service Worker and Cache

Range requests bypass the existing full-chunk service-worker cache because partial `206` responses cannot be stored as ordinary full-resource entries. The current page keeps decoded word clips in memory. Existing full chunks remain valid offline cache entries and the full-response fallback remains supported.

## Error Handling and Tests

- Validate partial response length before constructing a WAV.
- Fall back safely when range requests are ignored, malformed, or unavailable.
- Test the exact Range header, zero-offset playback for partial clips, full-chunk compatibility, preload ordering, and existing voice fallbacks.
- Run the complete web, PWA, pronunciation, and Android test suite before publishing a patch release.
