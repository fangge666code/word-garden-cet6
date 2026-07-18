# Data sources and attribution

## Vocabulary metadata

The extended CET-6 word metadata is derived from [ECDICT](https://github.com/skywind3000/ECDICT), which is distributed under the MIT License. The application keeps a stable local ID for each word so user learning progress remains compatible across releases.

## Bilingual example candidates

Some English and Mandarin Chinese sentence pairs are selected from the [Tatoeba Project](https://tatoeba.org/) through the ManyThings English–Mandarin export dated 2026-02-13. These records are distributed under the Creative Commons Attribution 2.0 France license. Each retained record in `src/data/cet6-tatoeba-examples.json` includes its original Tatoeba sentence ID and attribution text.

The checked-in candidate file is reviewed and merged into the product dataset during development. The application does not contact Tatoeba at runtime.

## Pronunciation audio

English pronunciation audio is generated during development with [eSpeak NG](https://github.com/espeak-ng/espeak-ng) 1.51 using the `en-gb` voice. eSpeak NG is open-source software distributed under the GNU General Public License v3. The application ships only the generated PCM audio packages and does not bundle the eSpeak NG executable or voice database.
