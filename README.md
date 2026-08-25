# Chronicle: Iterative Fiction Engine
> A serverless, AI-driven interactive fiction engine that generates cohesive narratives, dynamic scene illustrations, and fully voiced dialogue in real time.

**v3.2.1** — new Codex portraits generate before that page’s scene image so first appearances stay visually consistent. Text turns also read every non-thought Gemini part (and drop unsupported schema limits), so thinking models no longer fail every chain and leave page 1 on Waiting….

## Overview
Chronicle is a browser-based interactive storytelling app that generates branching choose-your-own-adventure experiences. It runs entirely client-side against the Google Gemini and Imagen APIs (with a Pollinations fallback for images and the browser's speech synthesis as an audio fallback). There is no build step: GitHub Pages serves the files as-is.

As the story unfolds, the engine maintains a persistent memory: a running log of beats, a compacted long-term summary, a structured codex of characters/places/items, the current scene, and a style card for voice continuity. This memory is injected back into each prompt so the narrative stays coherent over long playthroughs.

## Key Features
* **Persistent memory engine** — per-turn beats, automatic compaction of older beats into a long-term summary (with a rewind-safe `foldedThrough` watermark), the most recent prose (or a style card) for voice continuity, a current-scene object that is always injected, and relevance-filtered + player-pinned codex entries.
* **Structured output** — narrative turns are generated with a Gemini `responseSchema`, guaranteeing narrative, scene, codex updates, summary, and image prompt every turn. Choice buttons are only requested in choice mode.
* **Choice or text input** — **Choice** shows a 2×2 action grid and no text field. **Text** shows only the type-in box: leftover buttons from an earlier page are hidden immediately, and the next turn does not generate actions.
* **Streaming narrative** — text is revealed as it is written (toggle in Settings), with a non-streaming fallback if the stream is empty. Thought parts are skipped; JSON is taken from later parts. Runaway scene fields are cut short; a streamed narrative is salvaged instead of failover-regenerating a different page. A failed opening offers Retry.
* **Gameplay controls** — rewind a turn, regenerate the latest turn, or edit your last action and regenerate from there. Narrative turns abort in-flight text so they cannot race; page images keep generating if you continue.
* **Codex** — pin or merge entries; discoveries land on the same turn. Each new entry gets a reference portrait before that page’s scene image is painted, and those portraits are attached as Gemini image references. Fields are read-only.
* **Optional stat HUD** — let the Game Master track stats (health, resources, etc.) shown as a HUD; off by default.
* **Multi-modal generation** — real-time generated imagery and text-to-speech narration accompany the text. Images are compressed on a web worker and stored in IndexedDB (not `localStorage`).
* **Auto-Play** — when off, Chronicle does **not** call the TTS API after a turn (saves tokens and time). The speaker button still narrates on demand.
* **Live story list** — every playthrough auto-saves into its own IndexedDB slot. The home page lists stories with page count, genre, and last played; you can rename, delete, or reorder them. New Simulation starts another slot and never wipes the others. JSON export/import remains. Existing v2 `localStorage` saves and a leftover `active` save are migrated on first load.
* **Pacing** — **Standard** is the current literary voice. **Direct** asks for 2–4 short concrete sentences (applies on the next turn).
* **Mobile chrome** — Home and the page counter stay visible; Settings, Codex, the running log, and End live in a More menu on small screens. The play screen uses the visual viewport height so Chrome’s URL bar and the Android nav bar cannot clip the header. Settings and logs are full-width. Toasts are dismissible and stay up longer on errors.
* **Model selection** — discover models available to your key and pick text/image/audio models, each with an automatic fallback chain.

## Architecture
No build step. The app is plain ES modules loaded directly in the browser via an `importmap`, using [`htm`](https://github.com/developit/htm) (tagged-template markup) instead of JSX so no transpiler is needed. Tailwind is loaded from its CDN. On load the app unregisters any leftover service worker and clears old caches so a stale shell cannot pin you to an old build.

```
index.html              # shell: importmap, Tailwind CDN, fonts, mounts src/main.js
sw.js                   # leftover kill-switch: unregisters itself and clears caches
src/
  main.js               # bootstrap; unregisters service workers on load
  html.js               # htm bound to React.createElement
  constants.js          # genre/style/voice tables, defaults, CHRONICLE_VERSION
  App.js                # React state, wiring, hydrate/save
  api/gemini.js         # text (stream + schema), image, TTS, model discovery, key header + backoff
  engine/
    prompt.js           # system-prompt assembly + buildTurnSchema
    memory.js           # codex merge/records, summary beats, compaction, relevance, image-name scrub
    session.js          # processTurn, rebuildBase, abort, compact, style card, continuity check
  utils/
    audio.js            # PCM -> WAV
    idb.js              # IndexedDB (saves + turn images + codex portraits)
    images.js           # web-worker image snapshot client
    storage.js          # save/load, live slots, import/export, scene sanitizer
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
4. A compressed long-term summary (older beats folded together once the log grows).
5. The recent running-log beats.
6. The most relevant codex entries (mentioned recently, recently cited, player-pinned, protagonist, current location).

The model returns structured JSON (narrative and image prompt first, then lore, then scene). The new beat is appended, scene is replaced (and sanitized), and codex updates are merged the same turn, with a follow-up lore scan for anything the GM omitted. New Codex portraits are generated next; only then is the page image painted, with those portraits attached as visual references. Rewind/regenerate abort in-flight text and rebuild derived state by replaying remaining turns, keeping `longTerm` unless the player rewound into the folded prefix.

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

Settings also expose a continuity-check toggle (extra API call, warnings only), a keep-last-N-images slider (0 = prompts only, regenerate on resume), and a live context-size readout.

## Privacy
Your API key is stored only in your browser's `localStorage` and is sent only to Google's API endpoints. Saved stories, scene images, and Codex portraits live in IndexedDB in this origin; use Export to back a story up as a `.json` file (images are not embedded; scene art regenerates from `image_prompt`, portraits regenerate when an entry is opened).

## License
Apache License 2.0.
