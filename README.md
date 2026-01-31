# Chronicle: Iterative Fiction Engine

AI-powered interactive fiction that generates narrative, images, and audio in real time. A single-page app built to run on GitHub Pages.

## Features

- **Genre selection** – High Fantasy, Cyberpunk, Noir Detective, Space Opera, Eldritch Horror, Wasteland, Steampunk, Weird West, or custom
- **Visual style** – Cinematic, Pixel Art, Watercolor, Graphic Novel, Oil Painting, Blueprint, Ukiyo-e Print, Synthwave, or custom
- **Initial context** – Optional premise or setup to shape your story
- **AI-generated narrative** – Choice-based or free-form text progression
- **Scene images** – Imagen, Gemini, or Pollinations fallback
- **TTS narration** – Gemini TTS or browser fallback
- **Codex** – Tracks characters, places, and items across the story
- **Export** – Print or save as a book-style document

## Requirements

- A [Google Gemini API key](https://aistudio.google.com/app/apikey)
- A modern browser with JavaScript enabled

Your API key is stored locally in your browser and is only sent to Google’s APIs.

## Run Locally

Serve `index.html` with any static server, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

Or use VS Code Live Server or similar.

## Deploy to GitHub Pages

1. Push this repo to GitHub
2. Open **Settings** → **Pages**
3. Set **Source** to your main branch (e.g. `main`)
4. Use root or `/docs` as the folder
5. Save; the site will be available at `https://<username>.github.io/<repo>/`

## Tech Stack

- React (esm.sh)
- Tailwind CSS (CDN)
- Babel Standalone (in-browser JSX)
- Google Gemini API (narrative, images, TTS)

## Version

v1.0.1
