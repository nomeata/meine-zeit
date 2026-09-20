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

## CORS proxy deployment

The app fetches zeit.de through a small CORS reverse proxy (zeit.de sends no
`Access-Control-Allow-Origin` headers). Since September 2026 zeit.de also
fronts its pages with a JavaScript proof-of-work ("Centinel"): the app solves
it in the reader's browser and hands the validated session id to the proxy as
a `?_mz_centinel=<uuid>` query parameter, which the proxy must map to the
upstream `_centinel` cookie (a page cannot set the `Cookie` header itself).

This is the Apache vhost to deploy (`services.httpd.virtualHosts` in NixOS) —
it is the previous config plus the `_mz_centinel` block in the middle and a
localhost origin allowance for local development:

```nix
"cors.nomeata.de" = {
  forceSSL = true;
  enableACME = true;
  extraConfig = ''
    # Only allow requests from *.nomeata.de and localhost
    <Location "/">
      <RequireAny>
        Require ip 127.0.0.1 ::1
        Require expr "%{HTTP:Origin} =~ m#^https://[a-z0-9-]+\.nomeata\.de$#"
        # Local development (python -m http.server etc.)
        Require expr "%{HTTP:Origin} =~ m#^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$#"
      </RequireAny>
    </Location>

    ProxyRequests Off
    SSLProxyEngine On

    RewriteEngine On

    # Handle OPTIONS preflight
    RewriteCond %{REQUEST_METHOD} OPTIONS
    RewriteRule ^(.*)$ $1 [R=204,L]

    # Hand the app's validated Centinel session id to zeit.de as a cookie.
    # (Browsers cannot set the Cookie header, hence the query parameter.)
    # Must run before the proxying rule below. The parameter itself is
    # passed through to zeit.de, which ignores it — do NOT try to strip it
    # with a QSD rewrite, that loops (AH00124).
    RewriteCond %{QUERY_STRING} (?:^|&)_mz_centinel=([0-9a-f-]{36})(?:&|$)
    RewriteRule ^/proxy/www\.zeit\.de/ - [E=CENTINEL:%1]
    RequestHeader set Cookie "_centinel=%{CENTINEL}e" env=CENTINEL

    # Whitelist: only proxy to these hosts
    RewriteRule ^/proxy/(www|newsfeed|img)(\.zeit\.de/.*)$ https://$1$2 [P,QSA]

    # Block everything else
    RewriteRule ^/ - [F]

    # CORS headers
    Header unset Access-Control-Allow-Origin
    Header unset Access-Control-Allow-Methods
    Header unset Access-Control-Allow-Headers
    Header always unset Access-Control-Allow-Origin
    Header always unset Access-Control-Allow-Methods
    Header always unset Access-Control-Allow-Headers
    Header always set Access-Control-Allow-Origin "expr=%{HTTP:Origin}"
    Header always set Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
    Header always set Access-Control-Allow-Headers "Content-Type"
  '';
};
```

Without the `_mz_centinel` block the proxy still forwards the challenge page,
so the app can *solve* the proof-of-work, but zeit.de never sees the validated
session and the app gives up after five rounds with an error. Deploy both
together.

## License

Apache 2.0 — see [LICENSE](LICENSE).
