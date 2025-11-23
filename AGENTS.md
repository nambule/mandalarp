# Repository Guidelines

## Project Structure & Module Organization
This project is a lightweight Tone.js playground built from static files in the repo root. `index.html` wires the layout and CDN scripts, `style.css` defines the circular UI, and `main.js` mounts the 16 steps, positions them polar-style, and invokes Tone’s `PolySynth`. Create any new JS utilities under a `scripts/` folder (import them via `<script type="module">`) and keep future assets (icons, audio stems) under `assets/` to avoid cluttering the root.

## Build, Test, and Development Commands
- `npx http-server .` – quick local server with live reload support from your terminal; required because Tone.js blocks autoplay on `file://`.
- `python3 -m http.server 4173` – alternative zero-dependency static server if Node is not available.
Keep both commands pointed at the repo root so relative paths resolve correctly.

## Coding Style & Naming Conventions
Use modern ES modules (arrow functions, `const`/`let`, template strings). Two-space indentation is standard across HTML/CSS/JS. Name DOM hooks descriptively (`sequencerEl`, `clearBtn`) and prefix shared CSS blocks with `.sequencer__` to mirror BEM-style scoping already in `style.css`. When adding audio logic, keep Tone objects in dedicated modules (e.g., `scripts/audio-engine.js`) to separate UI from transport logic.

## Testing Guidelines
No automated tests yet; when adding them prefer Jest + jsdom for logic layers and Playwright for interaction snapshots. Name specs `<feature>.spec.js` and colocate under `tests/`. For manual QA, confirm that toggling any step both toggles the `.is-active` class and triggers a Tone preview without console warnings on Chrome/Safari.

## Commit & Pull Request Guidelines
Adopt Conventional Commits (`feat: add swing control`, `fix: prevent double trigger`) so changelog tooling remains easy later. Each PR should describe the UX change, reference any tracking issue, and attach a short screen capture when UI changes are visible. Ensure `npm run lint` (once added) passes before requesting review, and keep PRs focused: sequencing logic, UI polish, and audio design should land in separate branches where possible.
