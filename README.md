# Chronicle: Iterative Fiction Engine

AI-powered interactive fiction that generates narrative, images, and audio in real time. A single-page app built to run on GitHub Pages.

## Features

- **Genre selection** – 18 genres (High Fantasy, Cyberpunk, Noir, Space Opera, Eldritch Horror, Wasteland, Steampunk, Weird West, Grimdark, Solarpunk, Gothic Horror, Urban Fantasy, Regency Romance, Xianxia/Cultivation, Space Western, LitRPG, Cold War Spy, Zombie Outbreak), or custom
- **Visual style** – 18 styles (Oil Painting, Watercolor, Pixel Art, Cinematic, Comic Book, Blueprint, Ukiyo-e, Synthwave, 90s Anime, Low Poly 3D, Claymation, Ink Wash, Art Nouveau, Papercraft, Concept Art, VHS Horror, Risograph, Liminal Space), or custom
- **Initial context** – Optional premise or setup to shape your story
- **AI-generated narrative** – Choice-based or free-form text progression; always four options in choice mode
- **Scene images** – Imagen, Gemini, or Pollinations fallback
- **TTS narration** – Gemini TTS or browser fallback
- **Codex** – Tracks characters, places, and items across the story
- **Export** – Print or save as a book-style document
- **Story persistence** – Resume your story after closing the browser or returning later
- **Home navigation** – Home button returns to setup without losing progress; page count shown for saved games
- **Auto-play** – Narration only auto-plays when viewing the story (not on setup); audio continues loading in the background

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

v1.0.3

## License & Attribution

This project is licensed under the **Apache License 2.0**.

### Giving Credit

I put a lot of work into my open-source projects! If you use this code in your own project, please provide attribution by:

1. Keeping the `NOTICE` file intact in your repository.
2. Linking back to [chrismooredesigns.com](https://chrismooredesigns.com) or my [GitHub profile](https://github.com/Elusid108) if the project is displayed publicly.
