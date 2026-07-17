# Vocabulary, Pronunciation, and Home Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand 词间 to 3000 stable CET-6 entries, add click-to-play British pronunciation, and require account login from the home page before learning.

**Architecture:** Preserve the existing static JavaScript application and Supabase account/sync modules. Add one dependency-free pronunciation module, centralize the protected-route decision in `app.js`, reuse the existing authentication handlers on a logged-out home screen, and extend the checked-in ECDICT-derived vocabulary without changing the first 1500 IDs.

**Tech Stack:** Vanilla ES modules, Web Speech API, Node.js test runner, Python vocabulary generator, Supabase Auth/REST, Capacitor Android, GitHub Pages and GitHub Actions.

---

## File map

- `src/data/cet6-words.js`: checked-in 3000-entry vocabulary; first 1500 entries remain byte-for-byte equivalent at the field level.
- `scripts/generate-cet6-words.py`: deterministic ECDICT selection and append generator targeting 3000 entries.
- `tests/vocabulary.test.mjs`: vocabulary total, uniqueness, completeness, and legacy-ID compatibility.
- `src/lib/pronunciation.js`: Web Speech API support detection, British voice preference, cancellation, and playback.
- `tests/pronunciation.test.mjs`: pronunciation selection, fallback, cancellation, and unsupported-device behavior.
- `src/app.js`: logged-out home, protected-route redirect, authenticated dashboard, and pronunciation button wiring.
- `src/styles.css`: home authentication gateway and speaker-button responsive styles.
- `tests/pwa.test.mjs`: static integration assertions for route protection, home authentication, and pronunciation controls.
- `scripts/build.mjs`: include the new pronunciation module in the hosted worker bundle.
- `docs/WORDLIST.md`: document the 3000-entry licensed data source and compatibility policy.

### Task 1: Lock legacy vocabulary compatibility

**Files:**
- Modify: `tests/vocabulary.test.mjs`
- Create: `tests/fixtures/cet6-legacy-1500.json`

- [ ] **Step 1: Save the current 1500 ID/word mapping as a fixture**

Create a JSON array of the current records before regenerating the vocabulary:

```json
[
  { "id": "cet6-001", "word": "abandon" },
  { "id": "cet6-002", "word": "abrupt" }
]
```

The complete file is produced from the existing module and contains all 1500 mappings.

- [ ] **Step 2: Write failing 3000-entry and compatibility assertions**

Add:

```js
import { readFile } from "node:fs/promises";

const legacy = JSON.parse(await readFile(new URL("./fixtures/cet6-legacy-1500.json", import.meta.url), "utf8"));

test("the CET-6 vocabulary contains exactly 3000 entries", () => {
  assert.equal(WORDS.length, 3000);
});

test("the original 1500 ids still identify the same words", () => {
  assert.deepEqual(WORDS.slice(0, 1500).map(({ id, word }) => ({ id, word })), legacy);
});
```

- [ ] **Step 3: Run the vocabulary test and verify the new count fails**

Run: `node --test tests/vocabulary.test.mjs`

Expected: one failure showing `1500 !== 3000`; uniqueness, completeness, and legacy mapping pass.

- [ ] **Step 4: Commit the compatibility guard**

```bash
git add tests/vocabulary.test.mjs tests/fixtures/cet6-legacy-1500.json
git commit -m "test: protect legacy vocabulary ids"
```

### Task 2: Extend the licensed vocabulary to 3000 entries

**Files:**
- Modify: `scripts/generate-cet6-words.py`
- Modify: `src/data/cet6-words.js`
- Modify: `docs/WORDLIST.md`
- Test: `tests/vocabulary.test.mjs`

- [ ] **Step 1: Make generation preserve all checked-in entries and target 3000**

Change the generator constants and reader:

```python
TARGET_COUNT = 3000
LEGACY_COUNT = 1500

def read_existing() -> list[list[str]]:
    entries: list[list[str]] = []
    for line in OUTPUT.read_text(encoding="utf-8").splitlines():
        stripped = line.strip().removesuffix(",")
        if stripped.startswith("["):
            entries.append(json.loads(stripped))
    if len(entries) < LEGACY_COUNT:
        raise SystemExit(f"Expected at least {LEGACY_COUNT} existing entries, got {len(entries)}")
    return entries[:LEGACY_COUNT]
```

Update the module docstring to say 3000 entries.

- [ ] **Step 2: Download the MIT-licensed ECDICT CSV and regenerate**

Run the generator against ECDICT's checked source CSV:

```powershell
python scripts/generate-cet6-words.py work/ecdict.csv
```

Expected: `Generated 3000 entries in .../src/data/cet6-words.js`.

- [ ] **Step 3: Run vocabulary tests**

Run: `node --test tests/vocabulary.test.mjs`

Expected: all vocabulary tests pass, including exactly 3000 entries and unchanged first 1500 mappings.

- [ ] **Step 4: Update the word-list documentation**

State that the app contains 3000 entries, keeps the first 1500 IDs stable, derives additions from MIT-licensed ECDICT, and does not reproduce commercial book ordering, explanations, examples, or mnemonic content.

- [ ] **Step 5: Commit the vocabulary expansion**

```bash
git add scripts/generate-cet6-words.py src/data/cet6-words.js docs/WORDLIST.md
git commit -m "feat: expand CET-6 vocabulary to 3000 words"
```

### Task 3: Add British pronunciation as an isolated module

**Files:**
- Create: `src/lib/pronunciation.js`
- Create: `tests/pronunciation.test.mjs`
- Modify: `scripts/build.mjs`

- [ ] **Step 1: Write pronunciation unit tests**

Cover exact behaviors with a fake speech engine:

```js
test("British voices are preferred and the previous utterance is cancelled", () => {
  const spoken = [];
  const engine = {
    getVoices: () => [{ lang: "en-US", name: "US" }, { lang: "en-GB", name: "UK" }],
    cancel: () => spoken.push("cancel"),
    speak: (utterance) => spoken.push(utterance),
  };
  const result = speakWord("abandon", { engine, Utterance: FakeUtterance });
  assert.equal(result.voice.lang, "en-GB");
  assert.equal(spoken[0], "cancel");
  assert.equal(spoken[1].text, "abandon");
});

test("another English voice is used when en-GB is absent", () => {
  assert.equal(selectEnglishVoice([{ lang: "zh-CN" }, { lang: "en-US" }]).lang, "en-US");
});

test("unsupported speech returns a safe result", () => {
  assert.deepEqual(speakWord("abandon", { engine: null, Utterance: null }), { ok: false, reason: "unsupported" });
});
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `node --test tests/pronunciation.test.mjs`

Expected: failure because `src/lib/pronunciation.js` does not exist.

- [ ] **Step 3: Implement the dependency-free module**

Export these stable functions:

```js
export function selectEnglishVoice(voices = []) {
  return voices.find((voice) => voice.lang?.toLowerCase() === "en-gb")
    ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-"))
    ?? voices.find((voice) => voice.lang?.toLowerCase() === "en")
    ?? null;
}

export function speechSupported(scope = globalThis) {
  return Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
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
```

- [ ] **Step 4: Include the module in hosted assets and run tests**

Add `/src/lib/pronunciation.js` to `assetPaths`, then run:

```powershell
node --test tests/pronunciation.test.mjs
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit the pronunciation module**

```bash
git add src/lib/pronunciation.js tests/pronunciation.test.mjs scripts/build.mjs
git commit -m "feat: add British word pronunciation"
```

### Task 4: Move authentication to Home and protect learning routes

**Files:**
- Modify: `src/app.js`
- Modify: `tests/pwa.test.mjs`

- [ ] **Step 1: Add failing static integration assertions**

Assert that `app.js` imports `speakWord`, guards protected routes, renders authentication on the home page, and no longer inserts `accountCard()` into settings:

```js
assert.match(app, /const PROTECTED_ROUTES = new Set\(\["study", "library", "settings"\]\)/u);
assert.match(app, /if \(!currentUser && PROTECTED_ROUTES\.has\(current\)\)/u);
assert.match(app, /function renderSignedOutHome\(\)/u);
assert.match(app, /data-speak-word/u);
assert.doesNotMatch(settingsBody, /accountCard\(\)/u);
```

- [ ] **Step 2: Run the PWA tests and verify failure**

Run: `node --test tests/pwa.test.mjs`

Expected: failures for missing route guard, signed-out home, and speaker controls.

- [ ] **Step 3: Add central route protection**

Use one guard in `render()`:

```js
const PROTECTED_ROUTES = new Set(["study", "library", "settings"]);

function render() {
  const requested = route();
  if (!currentUser && PROTECTED_ROUTES.has(requested)) {
    if (location.hash !== "#home") history.replaceState(null, "", "#home");
    renderHome();
    showToast("请先登录账号，再开始学习");
    return;
  }
  updateNav(requested);
  flipped = false;
  if (requested === "study") renderStudy();
  else if (requested === "library") renderLibrary();
  else if (requested === "settings") renderSettings();
  else renderHome();
  main.focus({ preventScroll: true });
}
```

Disable or mark protected navigation links while logged out and make the header status say “登录后开始学习”.

- [ ] **Step 4: Split the home page by authentication state**

At the start of `renderHome()` use:

```js
function renderHome() {
  if (!currentUser) {
    renderSignedOutHome();
    bindAuthForms();
    return;
  }
  renderDashboardHome();
}
```

`renderSignedOutHome()` contains the existing login/register form fields and keeps their IDs unchanged so existing `loginAccount`, `registerAccount`, validation, and migration behavior can be reused. `renderDashboardHome()` contains the existing daily dashboard plus username, sync state, sync button, logout button, and installation/download card.

- [ ] **Step 5: Remove account forms from Settings**

Remove `${accountCard()}` from `renderSettings()`. Keep learning preferences, data backup/import/export, record clearing, and installation content. Move sync/logout event binding to the authenticated home page.

- [ ] **Step 6: Add pronunciation controls**

Import `speakWord` and `speechSupported`. Add a button beside the study word and inside each library row:

```html
<button class="speak-button" type="button" data-speak-word="abandon" aria-label="播放 abandon 的英式发音">🔊</button>
```

Use delegated or explicit binding that stops propagation before calling `speakWord`, so a study-card speaker click never reveals the answer:

```js
function bindPronunciationButtons(root = document) {
  root.querySelectorAll("[data-speak-word]").forEach((button) => {
    button.disabled = !speechSupported(window);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const result = speakWord(button.dataset.speakWord);
      if (!result.ok) showToast("当前设备暂不支持单词发音");
    });
  });
}
```

- [ ] **Step 7: Run unit and integration tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit home authentication and pronunciation UI**

```bash
git add src/app.js tests/pwa.test.mjs
git commit -m "feat: require login from the home page"
```

### Task 5: Polish responsive UI and preserve app installation

**Files:**
- Modify: `src/styles.css`
- Modify: `tests/pwa.test.mjs`

- [ ] **Step 1: Add layout assertions**

Assert that the stylesheet contains `.auth-home`, `.home-account-bar`, `.speak-button`, focus-visible styling, and a single-column mobile rule.

- [ ] **Step 2: Add styles**

Implement accessible button sizing and responsive auth layout:

```css
.auth-home { display: grid; grid-template-columns: .9fr 1.1fr; gap: 28px; align-items: start; }
.auth-home .account-auth-card { grid-column: auto; }
.home-account-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.speak-button { display: inline-grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--line); border-radius: 50%; background: #fff; color: var(--green); cursor: pointer; }
.speak-button:focus-visible { outline: 3px solid rgba(31, 107, 79, .25); outline-offset: 2px; }
.speak-button:disabled { cursor: not-allowed; opacity: .45; }
@media (max-width: 760px) {
  .auth-home { grid-template-columns: 1fr; }
  .home-account-bar { align-items: flex-start; flex-direction: column; }
}
```

- [ ] **Step 3: Run tests and production build**

Run:

```powershell
npm test
npm run build
```

Expected: all tests pass and build prints `Built static site in dist/`.

- [ ] **Step 4: Commit responsive styling**

```bash
git add src/styles.css tests/pwa.test.mjs
git commit -m "style: polish account gateway and speaker controls"
```

### Task 6: Release validation and publishing

**Files:**
- Modify only if required by release versioning: Android build configuration and release metadata.

- [ ] **Step 1: Run the complete verification suite**

Run:

```powershell
npm test
npm run build
npm run android:sync
git diff --check
```

Expected: all tests pass, the static build completes, Capacitor sync succeeds, and no whitespace errors are reported.

- [ ] **Step 2: Verify repository hygiene**

Run `git status --short` and confirm signing secrets remain ignored and `netlify-word-garden.zip` remains untracked and untouched.

- [ ] **Step 3: Publish the web version**

Push the current commit series to remote `main`. Confirm the GitHub Pages workflow succeeds and the public site loads the 3000-word version.

- [ ] **Step 4: Publish the Android update**

Use the existing signed GitHub Actions release workflow, reusing the existing package name and signing key. Confirm the latest release exposes `word-garden-android.apk` and the site's download link resolves to it.

- [ ] **Step 5: Final smoke checks**

Verify logged-out protection, registration/login, local-record migration, word pronunciation, stable order, new-word priority, sync, logout, PWA installation, and APK download on the public build.

