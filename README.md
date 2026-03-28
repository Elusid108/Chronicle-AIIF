# Chronicle: Iterative Fiction Engine
> A serverless, AI-driven interactive fiction engine that generates cohesive narratives, dynamic scene illustrations, and fully voiced dialogue in real time.

## Overview
Chronicle is a single-page interactive storytelling application that dynamically generates immersive choose-your-own-adventure experiences. Operating entirely within the browser, it leverages advanced generative AI models to construct branching narratives based on user input, genre selections, and visual style preferences. As the story unfolds, the engine automatically extracts lore to build a dynamic codex, generates corresponding scene artwork, and synthesizes character voices, ensuring a persistent and highly personalized narrative journey.

## Key Features
* **Multi-Modal Generation:** Delivers endless, responsive text-based adventures accompanied by real-time generated imagery and text-to-speech narration.
* **Dynamic Story Workflow:** Users begin in a setup interface to define the genre and premise, then navigate through a dynamic story view equipped with a live codex, performance summary, and branching narrative choices, culminating in a printable book export.
* **Zero-Backend Architecture:** Utilizes a serverless design that orchestrates multi-modal AI generation—narrative text, image synthesis, and audio TTS—directly from the client using the Google Gemini and Imagen APIs.

## Technical Architecture
* **Frontend/UI:** React 18, Tailwind CSS, Lucide Icons
* **Backend/Logic:** In-browser JavaScript, Google Gemini API, Google Imagen API, Pollinations API
* **Infrastructure/Hardware:** Static HTML Hosting, Browser LocalStorage API

## Setup & Deployment
1. Clone the repository to your local machine.
2. Serve the `index.html` file using any static HTTP server (e.g., `python -m http.server 8000`).
3. Open the application in a modern web browser and input a valid Google Gemini API key when prompted to authorize the simulation.
4. Alternatively, deploy directly to GitHub Pages by pushing the repository and enabling static hosting from the main branch.