# Repository Guidelines

## Project Structure & Module Organization
- `server.js` hosts the Hono server, wires static routes, and delegates slide parsing to `lib/slides.js`, which reads the top-level `slides.yaml`.
- Year-specific directories such as `20150722esm/`, `20181124-vimconf/`, and `20191103-vimconf/` hold deck assets. Shared styling lives under `css/`, shared scripts in `js/`, and reusable templates in `deck/`.
- Binary artifacts and exports belong in `pdf/`, `zonuexe.png`, and the generated `slides/` HTML snapshots. Keep raw source files alongside their assets so automation can discover them.
- Python automation in `script/` orchestrates fetching static pages and updating metadata. Keep paths relative to repo root and do not hard-code user-specific locations.
- `slides.yaml` defines the list metadata displayed on the index, while each `pdf/${slug}.yaml` stores per-slide details used on individual pages; keep the YAML aligned with its companion `pdf/${slug}.pdf`, editing extracted fields manually when the automatic scraper needs correction.

## Branch Strategy
- `master` receives new slide PDFs, companion metadata updates in `slides.yaml`, and any supporting server or automation tweaks required to display them.
- `gh-pages` stores the static output from `make fetch-static`; commit the generated HTML and assets there so GitHub Pages can publish directly from that branch.

## Build, Test, and Development Commands
- `npm install` hydrates Node dependencies before any local run.
- `npm run dev` starts the watch-mode server at `http://localhost:3000`; use it while tweaking content or routes.
- `npm start` serves the same app without file watching, useful for quick smoke tests or deploying behind a process manager.
- `make fetch-static` runs `script/fetch_static_slides.py` to export the currently served slides into `slides/`.
- `UV_CACHE_DIR=.uv-cache uv run python script/add_new_slides.py` processes staged PDFs, generates thumbnails, and amends `slides.yaml`; append `--pdf pdf/new-talk.pdf` to target a specific file.
- `make script-format` and `make script-lint` invoke Ruff through `uvx` to keep Python helpers consistent.

## Coding Style & Naming Conventions
- JavaScript uses ES modules, 2-space indentation, camelCase identifiers, and double-quoted strings. Group imports external → internal to match existing files.
- Prefer pure helpers inside `lib/`; keep request handlers thin so they remain easy to test manually.
- Python scripts should pass `ruff format` and `ruff check`; keep functions small and favor pathlib APIs already in use.
- When adding a new slide, drop the original PDF (Japanese filenames are fine) into the repo root and assign it a concise slug in `slides.yaml`. Slugs start with a `YYYYMMDD_` prefix and continue with a descriptive kebab-case phrase (roughly 3–8 words, but add more if clarity demands). Ensure the slug reflects the talk’s topic succinctly rather than mirroring any English subtitle on the cover.

## Testing Guidelines
- There is no automated test suite; validate changes manually via `npm run dev`, refreshing slides that were touched.
- After modifying assets or YAML, rerun `make fetch-static` to confirm static generation still succeeds and compare diffs under `slides/`.
- To sanity-check YAML parsing without starting the server, run `node -e "import('./lib/slides.js').then(m => m.loadSlides())"`; it prints parse errors immediately.

## Commit & Pull Request Guidelines
- Match the existing history: short, imperative messages such as `Fix metadata` or `Add canonical`. Commit generated assets alongside their source changes.
- PRs should outline the affected slides, list any new automation commands used, and attach screenshots or PDFs when visual output changes.
- Link related issues or event pages where possible and call out large binary diffs so reviewers can prioritize source review.
