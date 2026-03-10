# Meine ZEIT

Alternative mobile front-end for zeit.de — a single static HTML file (`index.html`), no build step required.

## Project structure

- `index.html` — the entire app: CSS + JS + HTML in one file (~25KB)
- Hosted on GitHub Pages or opened directly in a browser
- All state in browser `localStorage` (read articles, hidden articles, komplettansicht cache)

## How it works

- Fetches zeit.de section pages (e.g. `https://www.zeit.de/index`) via a self-hosted CORS proxy
- Parses the returned HTML with `DOMParser` to extract articles
- Hosted on GitHub Pages at `zeit.nomeata.de`

## CORS proxy

- Self-hosted Apache reverse proxy at `cors.nomeata.de` (configured in the server's NixOS config, not this repo)
- Path-based: `https://cors.nomeata.de/proxy/www.zeit.de/index` proxies to `https://www.zeit.de/index`
- JS constructs URL as `` `https://cors.nomeata.de/proxy/${url.replace('https://', '')}` ``
- Access restricted: only `*.nomeata.de` origins (checked via `Require expr` on `Origin` header) and localhost
- Destination whitelist: only `www.zeit.de`, `newsfeed.zeit.de`, `img.zeit.de` via RewriteRule pattern
- Strips upstream CORS headers and sets its own, reflecting the request `Origin`
- Apache needed `//` in path avoided by using `/proxy/` prefix instead of embedding full URL

## zeit.de HTML structure

Two types of article teasers on section pages:

### `zon-teaser` (main articles)
- `<article class="zon-teaser ...">` — container; `data-zplus="zplus"` if paywalled
- `a.zon-teaser__link` — article URL (may be relative, needs ZEIT_BASE prefix)
- `.zon-teaser__kicker-text` — kicker/category text
- `.zon-teaser__title` — headline
- `.zon-teaser__summary` — description paragraph
- `.zon-teaser__author` — author (sometimes contains JSON artifacts, not used)
- `img.zon-teaser__media-item` — thumbnail image (`src` is large; `<source media="(max-width: 360px)">` has smaller variant)
- `.zplus-logo` SVG — Z+ paywall indicator

### `zon-newsteaser` (news ticker)
- `<article class="zon-newsteaser">`
- `a.zon-newsteaser__link` — article URL
- `.zon-newsteaser__kicker` — kicker
- `.zon-newsteaser__title` — headline
- `.zon-newsteaser__time` — `<time>` element with `datetime` attribute and relative text

### /komplettansicht (single-page view)
- Some multi-page articles support `/komplettansicht` appended to the URL
- No reliable way to predict from the index page whether an article has it
- Articles with `pagination_total_pages > 1` in their own HTML have it, but that requires fetching the article
- The app does a HEAD request via CORS proxy on click and caches the result in localStorage
- URLs matching `liveblog|podcast|video|/news/` never have it and skip the check

### RSS feeds
- Available at `https://newsfeed.zeit.de/index` (and `/politik/index`, etc.)
- Standard RSS 2.0 with `<item>`, `<enclosure>` for images, `<category>`, `dc:creator`
- Less content than scraping the homepage (descriptions often empty, no summaries)
- Scraping the HTML is preferred

## localStorage keys
- `mz_read` — JSON array of read article IDs
- `mz_hidden` — JSON array of swiped-away article IDs
- `mz_feed` — last selected section tab ID
- `mz_komplett` — JSON object mapping URLs to boolean (has /komplettansicht)

## NixOS note
This is a NixOS machine. If tools like python3 or headless browsers are needed, use `nix shell nixpkgs#python3` etc.
