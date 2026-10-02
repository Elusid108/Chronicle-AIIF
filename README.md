# Chronicle: Iterative Fiction Engine
> A serverless, AI-driven interactive fiction engine that generates cohesive narratives, dynamic scene illustrations, and fully voiced dialogue in real time.

**v3.3.0** — possession-aware inventory (the GM always knows what you carry and what is nearby, with a Scene card in the Codex and a player-correctable possession field), per-story recall (older pages are retrieved for each action via Gemini embeddings with a keyword fallback), and a long list of fixes: story media is keyed per slot (no more portraits bleeding between stories or images vanishing on load), loading a story no longer regenerates every missing image, rate-limit fallbacks work again, the narrative streams first, short character names are scrubbed from image prompts, player codex edits survive rewind, narration no longer restarts when the page image arrives, and the book export is HTML-escaped.

## Overview
Chronicle is a browser-based interactive storytelling app that generates branching choose-your-own-adventure experiences. It runs entirely client-side against the Google Gemini and Imagen APIs (with a Pollinations fallback for images and the browser's speech synthesis as an audio fallback). There is no build step: GitHub Pages serves the files as-is.

As the story unfolds, the engine maintains a persistent memory: a running log of beats, a compacted long-term summary, a structured codex of characters/places/items, the current scene, and a style card for voice continuity. This memory is injected back into each prompt so the narrative stays coherent over long playthroughs.

## Key Features
* **Persistent memory engine** — per-turn beats (every unfolded beat is shown), automatic compaction of older beats into a long-term summary (with a rewind-safe `foldedThrough` watermark), the most recent prose (or a style card) for voice continuity, a current-scene object that is always injected, and relevance-filtered + player-pinned codex entries.
* **Per-story recall (RAG)** — every page is indexed under its story (Gemini `gemini-embedding-001`, 768 dims, plus keyword tokens) in IndexedDB. Each action retrieves up to four older pages that look relevant and hands them to the GM as *Recalled earlier events*. Falls back to BM25 keyword matching when embeddings are unavailable; rewind-safe; toggle in Settings; the Log panel shows which pages were recalled.
* **Inventory** — items carry a structured possession (carried / nearby / stored / lost / unknown) and an optional holder. Carried items are always in the GM's context, the prompt has always-present INVENTORY and NEARBY sections, and the Codex opens with a Scene card (where you are, who is here, what you carry, what is nearby, goal, open threads). Fix a wrong possession from the item's modal; corrections survive rewind.
* **Structured output** — narrative turns are generated with a Gemini `responseSchema`, guaranteeing narrative, scene, codex updates, summary, and image prompt every turn. Choice buttons are only requested in choice mode.
* **Choice or text input** — **Choice** shows a 2×2 action grid and no text field. **Text** shows only the type-in box: leftover buttons from an earlier page are hidden immediately, and the next turn does not generate actions.
* **Streaming narrative** — text is revealed as it is written (toggle in Settings), with a non-streaming fallback if the stream is empty. Thought parts are skipped; JSON is taken from later parts. Runaway scene fields are cut short; a streamed narrative is salvaged instead of failover-regenerating a different page. A failed opening offers Retry.
* **Gameplay controls** — rewind a turn, regenerate the latest turn, or edit your last action and regenerate from there. Narrative turns abort in-flight text so they cannot race; a finished page's lore, portraits, image, narration and compaction keep running if you continue. Rewinding keeps an ending countdown and your codex edits.
* **Codex** — pin (always in context) or merge entries, and set an item's possession; discoveries land on the same turn. Each new entry gets a reference portrait before that page’s scene image is painted, and those portraits are attached as Gemini image references. A second "lore backfill" pass runs only when the page mentions names the codex does not know (toggle in Settings).
* **Optional stat HUD** — let the Game Master track stats (health, resources, etc.) shown as a HUD; off by default.
* **Multi-modal generation** — real-time generated imagery and text-to-speech narration accompany the text. Images are compressed on a web worker and stored in IndexedDB (not `localStorage`).
* **Auto-Play** — when off, Chronicle does **not** call the TTS API after a turn (saves tokens and time). The speaker button still narrates on demand.
* **Live story list** — every playthrough auto-saves (debounced) into its own IndexedDB slot; page images, portraits and the recall index are keyed by that slot, so stories never share media. The home page lists stories with page count, genre, and last played; you can rename, delete, or reorder them. New Simulation starts another slot and never wipes the others. JSON export/import remains. Existing v2 `localStorage` saves and the pre-3.3 shared `active` save are migrated on first load. Missing page images are not regenerated on load; use **Retry image** on a page.
* **Pacing** — **Standard** is the current literary voice. **Direct** asks for 2–4 short concrete sentences (applies on the next turn).
* **Mobile chrome** — Home and the page counter stay visible; Settings, Codex, the running log, and End live in a More menu on small screens. The play screen uses the visual viewport height so Chrome’s URL bar and the Android nav bar cannot clip the header. Settings and logs are full-width. Toasts are dismissible and stay up longer on errors.
* **Model selection** — discover models available to your key and pick text/image/audio models, each with an automatic fallback chain.

## Architecture
No build step. The app is plain ES modules loaded directly in the browser via an `importmap`, using [`htm`](https://github.com/developit/htm) (tagged-template markup) instead of JSX so no transpiler is needed. Tailwind is loaded from its CDN. On load the app unregisters any leftover service worker and clears old caches so a stale shell cannot pin you to an old build.

```
index.html              # shell: importmap, Tailwind CDN, fonts, mounts src/main.js
sw.js                   # leftover kill-switch: unregisters itself and clears caches
package.json            # only for `npm test` (node --test); nothing is built or bundled
test/                   # Node unit tests for the pure engine modules
src/
  main.js               # bootstrap; unregisters service workers on load
  html.js               # htm bound to React.createElement
  constants.js          # genre/style/voice tables, defaults, CHRONICLE_VERSION
  App.js                # React state, wiring, hydrate/save
  api/gemini.js         # text (stream + schema), image, TTS, model discovery, key header + backoff
  engine/
    prompt.js           # system-prompt assembly, inventory sections, buildTurnSchema
    memory.js           # codex merge/records, possession, overrides, compaction, relevance, image-name scrub
    recall.js           # per-story recall: BM25 + embedding ranking, IndexedDB index
    session.js          # processTurn, rebuildBase, abort/background jobs, compact, style card, continuity check
  utils/
    audio.js            # PCM -> WAV
    idb.js              # IndexedDB (saves + turn images + codex portraits + recall docs), keyed by story slot
    images.js           # web-worker image snapshot client
    storage.js          # save/load, story slots, import/export, normalizers, legacy migration
    text.js             # HTML escaping for the book export
  workers/
    compress-image.js   # OffscreenCanvas WebP/JPEG encode
  components/
    ui.js               # Button, Input, Toggle, Toast
    ApiKeyModal.js
    SetupView.js        # home, start options, story list
    SettingsPanel.js
    Panels.js           # Codex/Summary side panel + read-only codex modal with portrait
    GameView.js         # main play screen
```

### How the context loop works
Each turn sends the player's action plus a system prompt assembled from:
1. Genre, visual style, and the player's original premise.
2. A style card (extracted after turn 1) and/or the last narrative verbatim.
3. The current scene (location, time, present characters, goal, open threads) — never filtered.
4. INVENTORY (items with possession `carried`) and NEARBY (items marked `nearby`, or held by someone present) — always present.
5. A compressed long-term summary (older beats folded together once the log grows).
6. RECALLED EARLIER EVENTS — up to four older pages retrieved for this action from the per-story recall index (hybrid embedding + BM25 score; pages already quoted as previous prose are excluded).
7. Every unfolded running-log beat.
8. The most relevant codex entries (mentioned in the current action, the last prose or recent beats, recently cited, player-pinned, protagonist, current location, carried).

The model returns structured JSON (narrative and image prompt first, then lore, then scene). The new beat is appended, scene is replaced (arrays are authoritative, so characters can leave), and codex updates are merged the same turn. Once the page is folded, the turn's abort controller is released: lore backfill, portraits, the page image, narration, the recall index and compaction run as background jobs that a later turn cannot cancel (rewind, regenerate and Home still cancel them). Rewind/regenerate rebuild derived state by replaying the remaining turns plus the player's recorded codex edits, keeping `longTerm` unless the player rewound into the folded prefix.

The API key is sent as the `x-goog-api-key` header (not in the query string). 429s use exponential backoff; 401/403 do not cycle models.

## Setup & Deployment
1. Clone the repository.
2. Serve the folder with any static HTTP server (ES modules require `http://`, not `file://`):
   * `python -m http.server 8000` then open `http://localhost:8000`, or
   * `npx serve` from the repo root.
3. Open the app and enter a valid Google Gemini API key when prompted.
4. To host on GitHub Pages, push the repository and enable Pages from the **main branch root**. No build is required. Project pages (`https://user.github.io/Chronicle-AIIF/`) work because workers use relative URLs.

## Playing
On the home screen pick a genre and visual style, then **Input** (choice vs text), **Pacing**, and **Auto-Play**. Each New Simulation is a story in the list. Tap a row to continue it; use the pencil, trash, and arrows to rename, delete, or reorder.

In play, phones keep **Home** and the page number in the header. Open **More** for Settings, Codex, the running/performance log, and End story. On a wider screen those controls stay in the header.

## Model Configuration
Once a key is saved, Chronicle queries Google's model listing API. In Settings (gear icon) under **AI Models**:
* **Text Generation** — any Gemini model supporting `generateContent`.
* **Image Generation** — Imagen models (`predict`) or Gemini native image generation.
* **Audio / TTS** — TTS-capable models.

Each defaults to "Auto (recommended)", which uses the built-in fallback chain. If a selected model fails, the engine falls back automatically (including Pollinations for images and browser speech synthesis for audio).

Settings also expose a continuity-check toggle (extra API call, warnings only), a lore-backfill toggle, a story-recall toggle (shows whether Gemini embeddings or the keyword fallback is in use), a keep-last-N-images slider (0 = prompts only; lowering it prunes the current story at once), and a context-size readout (computed only while Settings is open).

Rate limits: when Gemini image generation returns 429 the session switches to the Pollinations fallback once and tells you (your scene prompt, not your key, is sent to pollinations.ai). TTS falls back to the browser's speech synthesis the same way.

## Tests
There is no build, but the pure engine modules have Node unit tests:

```
npm test        # node --test "test/**/*.test.mjs"
npm run check   # node --check every file under src/
```

## Privacy
Your API key is stored only in your browser's `localStorage` and is sent only to Google's API endpoints (image prompts go to pollinations.ai only in backup mode). Saved stories, scene images, Codex portraits and the recall index live in IndexedDB in this origin, keyed by story; use Export to back a story up as a `.json` file (images are not embedded; scene art can be regenerated per page with Retry image, portraits regenerate when an entry is opened, the recall index is rebuilt on load).

## License
Apache License 2.0.
