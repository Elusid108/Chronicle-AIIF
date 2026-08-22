# Chronicle: Iterative Fiction Engine
> A serverless, AI-driven interactive fiction engine that generates cohesive narratives, dynamic scene illustrations, and fully voiced dialogue in real time.

## Overview
Chronicle is a browser-based interactive storytelling app that generates branching choose-your-own-adventure experiences. It runs entirely client-side against the Google Gemini and Imagen APIs (with a Pollinations fallback for images and the browser's speech synthesis as an audio fallback). There is no build step: GitHub Pages serves the files as-is.

As the story unfolds, the engine maintains a persistent memory: a running log of beats, a compacted long-term summary, a structured codex of characters/places/items, the current scene, and a style card for voice continuity. This memory is injected back into each prompt so the narrative stays coherent over long playthroughs.

## Key Features
* **Persistent memory engine** — per-turn beats, automatic compaction of older beats into a long-term summary (with a rewind-safe `foldedThrough` watermark), the most recent prose (or a style card) for voice continuity, a current-scene object that is always injected, and relevance-filtered + player-pinned codex entries.
* **Structured output** — narrative turns are generated with a Gemini `responseSchema`, guaranteeing narrative, choices, scene, codex updates, summary, and image prompt every turn.
* **Streaming narrative** — text is revealed as it is written (toggle in Settings), with a non-streaming fallback.
* **Gameplay controls** — rewind a turn, regenerate the latest turn, or edit your last action and regenerate from there. In-flight generations are aborted so turns cannot race.
* **Editable bible** — pin, edit, or merge codex entries; player-authored facts are always injected.
* **Optional stat HUD** — let the Game Master track stats (health, resources, etc.) shown as a HUD; off by default.
* **Multi-modal generation** — real-time generated imagery and text-to-speech narration accompany the text. Images are compressed on a web worker and stored in IndexedDB (not `localStorage`).
* **Saves & portability** — automatic resume in IndexedDB, a multi-slot Library, and JSON export/import of a full story. Existing v2 `localStorage` saves are migrated on first load.
* **Model selection** — discover models available to your key and pick text/image/audio models, each with an automatic fallback chain.

## Architecture
No build step. The app is plain ES modules loaded directly in the browser via an `importmap`, using [`htm`](https://github.com/developit/htm) (tagged-template markup) instead of JSX so no transpiler is needed. Tailwind is loaded from its CDN. A service worker caches the app shell and CDNs so a CDN blip does not white-screen the UI (play still needs Gemini).

```
index.html              # shell: importmap, Tailwind CDN, fonts, mounts src/main.js
sw.js                   # app-shell cache (same-origin + CDNs); Gemini is network-only
src/
  main.js               # bootstrap + service worker registration
  html.js               # htm bound to React.createElement
  constants.js          # genre/style/voice tables, defaults
  App.js                # React state, wiring, hydrate/save
  api/gemini.js         # text (stream + schema), image, TTS, model discovery, key header + backoff
  engine/
    prompt.js           # system-prompt assembly + TURN_SCHEMA
    memory.js           # codex merge/records, summary beats, compaction, relevance, image-name scrub
    session.js          # processTurn, rebuildBase, abort, compact, style card, continuity check
  utils/
    audio.js            # PCM -> WAV
    idb.js              # IndexedDB (saves + image blobs)
    images.js           # web-worker image snapshot client
    storage.js          # save/load, v3 migration, slots, import/export
  workers/
    compress-image.js   # OffscreenCanvas WebP/JPEG encode
  components/
    ui.js               # Button, Input
    ApiKeyModal.js
    SetupView.js
    SettingsPanel.js
    Panels.js           # Codex/Summary side panel + editable codex modal
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

The model returns structured JSON; the new beat is appended, scene is replaced, and codex updates are merged (status/location replace; lore appends; aliases are kept). Rewind/regenerate abort any in-flight turn and rebuild derived state by replaying remaining turns, keeping `longTerm` unless the player rewound into the folded prefix.

The API key is sent as the `x-goog-api-key` header (not in the query string). 429s use exponential backoff; 401/403 do not cycle models.

## Setup & Deployment
1. Clone the repository.
2. Serve the folder with any static HTTP server (ES modules require `http://`, not `file://`):
   * `python -m http.server 8000` then open `http://localhost:8000`, or
   * `npx serve` from the repo root.
3. Open the app and enter a valid Google Gemini API key when prompted.
4. To host on GitHub Pages, push the repository and enable Pages from the **main branch root**. No build is required. Project pages (`https://user.github.io/Chronicle-AIIF/`) work because workers and the service worker use relative URLs.

## Model Configuration
Once a key is saved, Chronicle queries Google's model listing API. In Settings (gear icon) under **AI Models**:
* **Text Generation** — any Gemini model supporting `generateContent`.
* **Image Generation** — Imagen models (`predict`) or Gemini native image generation.
* **Audio / TTS** — TTS-capable models.

Each defaults to "Auto (recommended)", which uses the built-in fallback chain. If a selected model fails, the engine falls back automatically (including Pollinations for images and browser speech synthesis for audio).

Settings also expose a continuity-check toggle (extra API call, warnings only), a keep-last-N-images slider (0 = prompts only, regenerate on resume), and a live context-size readout.

## Privacy
Your API key is stored only in your browser's `localStorage` and is sent only to Google's API endpoints. Saved stories and image blobs live in IndexedDB in this origin; use Export to back a story up as a `.json` file (images are not embedded; they regenerate from `image_prompt`).

## License
Apache License 2.0.
