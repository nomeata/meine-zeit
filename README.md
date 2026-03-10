# Meine ZEIT

A minimal, mobile-friendly alternative front-end for [zeit.de](https://www.zeit.de) — a single static HTML file with no dependencies or build step.

## Features

- Scrapes zeit.de section pages via CORS proxy, parses article teasers client-side
- Section tabs (Start, Politik, Wirtschaft, Wissen, Digital, Kultur, Sport, …)
- Opens articles in single-page `/komplettansicht` when available (checked via HEAD request, cached)
- Swipe left to hide articles; tap the collapsed bar to restore
- Read articles collapse automatically; tap to expand again
- All state stored in browser localStorage

## Usage

Open `index.html` in a browser. That's it.

For hosting, push to a GitHub repo and enable GitHub Pages — no build pipeline needed.

## License

Apache 2.0 — see [LICENSE](LICENSE).
