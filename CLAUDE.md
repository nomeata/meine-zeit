# Meine ZEIT

Alternative mobile front-end for zeit.de — a single static HTML file (`index.html`), no build step required.

## Project structure

- `index.html` — HTML + CSS shell
- `app.js` — all JS as an ES module; exports `parseZeitHTML`, `renderArticles`, `formatTime`, `esc`, `ZEIT_BASE`
- `test/example-index.html` — snapshot of `https://www.zeit.de/index` for offline testing
- `test/test.mjs` — test runner (check / update / snapshot modes)
- `test/itest.mjs` — headless end-to-end test of the Centinel challenge flow (happy path); needs Chromium
- `test/itest-cert.pem` / `test/itest-key.pem` — throwaway self-signed cert for the itest's fake collector
- `test/expected-parsed.json` — expected parser output baseline
- `test/expected-rendered.html` — expected rendered HTML baseline
- Hosted on GitHub Pages at `zeit.nomeata.de` (HTTPS enforced)
- Persistent state in `localStorage`, ephemeral state in `sessionStorage`

## How it works

- Fetches the zeit.de start page (`https://www.zeit.de/index`) via a self-hosted CORS proxy
- zeit.de gates HTML behind a JavaScript proof-of-work ("Centinel"); the app solves it in the reader's browser (see "Bot challenge" below)
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
- Access restricted: only `*.nomeata.de` origins and localhost origins (checked via `Require expr` on `Origin` header)
- Destination whitelist: only `www.zeit.de`, `newsfeed.zeit.de`, `img.zeit.de` via RewriteRule pattern
- Strips upstream CORS headers and sets its own, reflecting the request `Origin`
- Apache needed `//` in path avoided by using `/proxy/` prefix instead of embedding full URL
- Forwards client `Cookie` headers upstream, but a page cannot set the `Cookie` header from `fetch`, so the app conveys the validated `_centinel` session id as a `?_mz_centinel=<uuid>` query parameter. The proxy must map it to the upstream cookie (add to the vhost, *before* the proxying rule):

  ```apache
  # Hand the app's validated Centinel session id to zeit.de as a cookie.
  # (Browsers cannot set the Cookie header, hence the query parameter.)
  # The parameter itself is passed through to zeit.de, which ignores it —
  # do NOT try to strip it with a QSD rewrite, that loops (AH00124).
  RewriteCond %{QUERY_STRING} (?:^|&)_mz_centinel=([0-9a-f-]{36})(?:&|$)
  RewriteRule ^/proxy/www\.zeit\.de/ - [E=CENTINEL:%1]
  RequestHeader set Cookie "_centinel=%{CENTINEL}e" env=CENTINEL
  ```

  The app works without this snippet up to the point of the first successful solve; then every content request keeps 403ing and the app gives up after 5 rounds. So deploy the snippet together with the app.

## Bot challenge (Centinel)

Since September 2026 zeit.de fronts `www.zeit.de` with an anti-bot system ("Centinel Analytica", behind their Fastly edge). Every HTML request without a valid clearance session gets **HTTP 403 with a ~1KB interstitial** containing `window.__centinel={sessionId,se}` and a `<script src="https://collector.…centinelanalytica.com/script.js?…">` (heavily obfuscated, ~1.4MB, WASM PoW + fingerprinting). A solved-but-rejected session instead gets a 403 block page titled "Da ist etwas schiefgelaufen". `robots.txt` and `newsfeed.zeit.de` are unaffected.

How the app clears it (all in `app.js`, no userscript):

1. `fetchPage` sees the 403 challenge → `parseChallenge` extracts `sessionId`, `se`, script URL.
2. `startChallenge` shows a splash ("Sicherheitsprüfung…") and runs zeit.de's own script in the app page with `window.__centinel` installed. The script fingerprints the browser, does the PoW, and POSTs one attestation to the collector (which answers `Access-Control-Allow-Origin: *`, so this works from any origin). Verified: the script runs fine from a foreign origin.
3. A `fetch` wrapper observes the attestation; ~2.5s later the app reloads (the script itself reloads too — on zeit.de that reload would fetch the now-unlocked page).
4. On boot, `resumeChallenge` (state in sessionStorage `mz_challenge`) test-fetches the index via the proxy with `_mz_centinel=<sessionId>`: 200 → session cached in `mz_centinel` (localStorage) and reused for all requests (incl. komplettansicht HEAD probes) until it stops working; still 403 challenge → next round with the fresh params from that response; 403 block page → verdict negative, drop the session and start over with a fresh one.
5. Gives up after 5 rounds / 3 minutes with an error message.

Not verified from a dev machine (headless Chromium is fingerprinted as a bot): whether a session validated by a *real* browser also clears when fetched from the proxy's IP. Cookie Max-Age=86400 suggests sessions are meant to survive network changes (mobile users), so it should work — but if zeit.de binds sessions to IP, the app will show the "not successful" error and the userscript approach (branch `userscript`) remains necessary.

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
- `mz_centinel` — `{ id, ts }` validated Centinel clearance session id

### sessionStorage (per-tab, ephemeral)
- `mz_cache` — `{ ts, data }` cached parsed articles; TTL 20min from last navigation away
- `mz_last` — ID of last-opened article for the back-navigation highlight
- `mz_challenge` — `{ sessionId, se, scriptUrl, round, since }` in-progress challenge solve (survives the script's reloads)

## Design decisions

- **Same-tab navigation**: articles open via `window.location.href` instead of `window.open()` to avoid popup blocker dialogs, especially on mobile Firefox swipe gestures
- **Cache timestamp on navigate-away**: the sessionStorage cache TTL resets when the user clicks an article, not when the page was originally fetched — so reading a long article doesn't expire the cache
- **bfcache + sessionStorage**: bfcache provides instant back-navigation with scroll preservation; sessionStorage is the fallback when bfcache is evicted (common on mobile under memory pressure)
- **Swipe backgrounds use pointer-events: none**: the absolutely-positioned swipe overlay divs would otherwise intercept taps on collapsed bars
- **Liveblogs never marked read**: they're ongoing content that changes, so collapsing them would be counterproductive

## Development

- `flake.nix` provides a dev shell with Node.js, curl and Chromium: `nix develop`
- Tests: `nix develop -c bash -c "npm install --no-save jsdom && node test/test.mjs"`
- Headless end-to-end test of the challenge flow: `nix develop -c node test/itest.mjs` — serves the app with a patched proxy URL plus a fake proxy/collector on loopback, runs headless Chromium through the whole challenge dance (403 → script → attestation → reload → content), and asserts the articles render. Chromium can be overridden with `CHROMIUM=/path/to/chromium`
- Update baselines: `node test/test.mjs --update` (regenerates expected output from current code + snapshot)
- Fresh snapshot: `node test/test.mjs --snapshot` no longer works (zeit.de answers with the 403 challenge). Save `https://www.zeit.de/index` from a browser as `test/example-index.html`, then run `--update`
- This is a NixOS machine; use `nix develop` or `nix shell nixpkgs#<pkg>` for tools
