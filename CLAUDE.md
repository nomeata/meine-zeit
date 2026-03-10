# Meine ZEIT

Alternative mobile front-end for zeit.de — a single static HTML file (`index.html`), no build step required.

## Project structure

- `index.html` — the entire app: CSS + JS + HTML in one file
- Hosted on GitHub Pages at `zeit.nomeata.de` (HTTPS enforced)
- Persistent state in `localStorage`, ephemeral state in `sessionStorage`

## How it works

- Fetches the zeit.de start page (`https://www.zeit.de/index`) via a self-hosted CORS proxy
- Parses the returned HTML with `DOMParser` to extract articles
- Articles open in the same tab (no `target="_blank"`) to avoid popup blocker issues
- Back-navigation relies on bfcache (browser preserves full page state + scroll position)
- sessionStorage cache (20min TTL) as fallback when bfcache is evicted

## Navigation and article states

- **Normal** — full article teaser visible
- **Read** — collapsed to a single line with ✓ prefix; click to mark unread again
- **Hidden** — collapsed muted line with ▶ prefix; click to unhide and mark unread
- **Liveblog** — red "Live" badge; never marked as read
- **Last-visited** — red bottom border that fades out after 3s, shown on back-navigation

## Gestures

- **Tap** — opens article (with komplettansicht check via HEAD request)
- **Swipe left** — hides article (slides out with red "Ausblenden" background)
- **Swipe right** — opens article (green "Öffnen" background stays held while loading)

## Filtered content

Articles are completely hidden if they match:
- `data-audio-type="podcast"` in the teaser HTML (podcast episodes with play button)
- `podcast` or `wochenmarkt` in the URL

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
- `.audio-player[data-audio-type="podcast"]` — podcast indicator (used to filter)

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

## Storage keys

### localStorage (persistent)
- `mz_read` — JSON array of read article IDs
- `mz_hidden` — JSON array of swiped-away article IDs
- `mz_komplett` — JSON object mapping URLs to boolean (has /komplettansicht)

### sessionStorage (per-tab, ephemeral)
- `mz_cache` — `{ ts, data }` cached parsed articles; TTL 20min from last navigation away
- `mz_last` — ID of last-opened article for the back-navigation highlight

## Design decisions

- **Same-tab navigation**: articles open via `window.location.href` instead of `window.open()` to avoid popup blocker dialogs, especially on mobile Firefox swipe gestures
- **Cache timestamp on navigate-away**: the sessionStorage cache TTL resets when the user clicks an article, not when the page was originally fetched — so reading a long article doesn't expire the cache
- **bfcache + sessionStorage**: bfcache provides instant back-navigation with scroll preservation; sessionStorage is the fallback when bfcache is evicted (common on mobile under memory pressure)
- **Swipe backgrounds use pointer-events: none**: the absolutely-positioned swipe overlay divs would otherwise intercept taps on collapsed bars
- **Liveblogs never marked read**: they're ongoing content that changes, so collapsing them would be counterproductive

## NixOS note
This is a NixOS machine. If tools like python3 or headless browsers are needed, use `nix shell nixpkgs#python3` etc.
