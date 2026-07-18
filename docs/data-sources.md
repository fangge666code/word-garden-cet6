# Data sources and attribution

## Vocabulary metadata

The extended CET-6 word metadata is derived from [ECDICT](https://github.com/skywind3000/ECDICT), which is distributed under the MIT License. The application keeps a stable local ID for each word so user learning progress remains compatible across releases.

## Bilingual example candidates

Some English and Mandarin Chinese sentence pairs are selected from the [Tatoeba Project](https://tatoeba.org/) through the ManyThings English–Mandarin export dated 2026-02-13. These records are distributed under the Creative Commons Attribution 2.0 France license. Each retained record in `src/data/cet6-tatoeba-examples.json` includes its original Tatoeba sentence ID and attribution text.

The checked-in candidate file is reviewed and merged into the product dataset during development. The application does not contact Tatoeba at runtime.

## Pronunciation audio

English pronunciation audio is generated during development with the Apache-2.0-licensed [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) model and its British English `bf_emma` voice. The application ships only the generated 16 kHz PCM audio packages; it does not bundle the model, Python runtime, or generation dependencies.
