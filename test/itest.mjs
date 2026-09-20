// Headless end-to-end test of the Centinel challenge flow (happy path).
//
// Spins up three things on loopback:
//   - the app itself (index.html + app.js, with the proxy URL patched to a
//     local fake proxy)
//   - a fake CORS proxy that answers like zeit.de: 403 challenge page until
//     the app hands over the (attested) session id as ?_mz_centinel=<sid>,
//     then 200 with test/example-index.html
//   - a fake Centinel collector (HTTPS, self-signed test-only cert): serves a
//     trivial "challenge script" that POSTs one attestation and reloads the
//     page; POST /collector flips the attested flag
//
// Then runs headless Chromium against the app and asserts the full loop:
// 403 challenge → script injected → attestation → reload → resume → content.
//
// Usage:
//   nix shell nixpkgs#chromium -c node test/itest.mjs
// or with a specific binary:
//   CHROMIUM=/path/to/chromium node test/itest.mjs

import { createServer } from "http";
import { createServer as createSecureServer } from "https";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SID = "11111111-2222-4333-8444-555555555555";
const SE = "itest-se-token";
const COLL_HOST = "collector.nuremburg.public.centinelanalytica.com";
const APP_PORT = 8740;
const COLL_PORT = 8742;
const COLLECTOR = `${COLL_HOST}:${COLL_PORT}`;

const CHALLENGE = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>DIE ZEIT | Nachrichten, News, Hintergründe und Debatten</title>
<script nonce="itest">document.cookie="_centinel=${SID}; Path=/; Max-Age=86400; SameSite=Lax; Secure";window.__centinel={sessionId:"${SID}",se:"${SE}"}</script>
<script src="https://${COLLECTOR}/script.js?m=i&site_key=pk_live_itest&se=${SE}" defer></script>
</head>
<body>
</body>
</html>`;

// Stands in for the real (obfuscated, WASM) Centinel script: "attest", then
// reload — which is all the app needs to observe.
const FAKE_SCRIPT = `
fetch("https://${COLLECTOR}/collector", { method: "POST", body: "attestation:" + window.__centinel.sessionId })
  .then(function () { location.reload(); });
`;

const events = [];
let attested = false;

function send(res, code, body, ctype = "text/html") {
  res.writeHead(code, {
    "Content-Type": ctype,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
  res.end(body);
}

// --- app + fake proxy ---
const appServer = createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/" || u.pathname === "/index.html") {
    return send(res, 200, readFileSync(join(ROOT, "index.html"), "utf-8"));
  }
  if (u.pathname === "/app.js") {
    const patched = readFileSync(join(ROOT, "app.js"), "utf-8")
      .replaceAll("https://cors.nomeata.de/proxy/", `http://127.0.0.1:${APP_PORT}/proxy/`);
    if (!patched.includes(`${APP_PORT}/proxy/`)) {
      throw new Error("failed to patch proxy URL in app.js");
    }
    return send(res, 200, patched, "text/javascript");
  }
  if (u.pathname.startsWith("/proxy/www.zeit.de/")) {
    if (u.searchParams.get("_mz_centinel") === SID && attested) {
      events.push("proxy-200");
      return send(res, 200, readFileSync(join(__dirname, "example-index.html"), "utf-8"));
    }
    events.push("proxy-403");
    return send(res, 403, CHALLENGE);
  }
  return send(res, 404, "nope", "text/plain");
});

// --- fake collector ---
const collServer = createSecureServer({
  key: readFileSync(join(__dirname, "itest-key.pem")),
  cert: readFileSync(join(__dirname, "itest-cert.pem")),
}, (req, res) => {
  const u = new URL(req.url, "https://localhost");
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  if (u.pathname === "/script.js") {
    events.push("collector-script");
    return send(res, 200, FAKE_SCRIPT, "text/javascript");
  }
  if (u.pathname === "/collector" && req.method === "POST") {
    attested = true;
    events.push("collector-attest");
    return send(res, 200, "ok", "text/plain");
  }
  return send(res, 404, "nope", "text/plain");
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  console.error("event log:", events.join(" → ") || "(empty)");
  cleanup(1);
}

let chromium, tmpProfile;
function cleanup(code) {
  try { chromium?.kill("SIGKILL"); } catch {}
  try { appServer.close(); } catch {}
  try { collServer.close(); } catch {}
  try { if (tmpProfile) rmSync(tmpProfile, { recursive: true, force: true }); } catch {}
  process.exit(code);
}

const CHROMIUM = process.env.CHROMIUM || "chromium";

const ok = await Promise.all([
  listen(appServer, APP_PORT),
  listen(collServer, COLL_PORT),
]).then(() => true, (e) => { console.error(`Cannot bind test ports: ${e.message}`); process.exit(1); });

console.log(`servers up: app+proxy :${APP_PORT}, collector :${COLL_PORT}`);

tmpProfile = mkdtempSync(join(tmpdir(), "mz-itest-"));
chromium = spawn(CHROMIUM, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--user-data-dir=${tmpProfile}`,
  "--ignore-certificate-errors",
  `--host-resolver-rules=MAP ${COLL_HOST} 127.0.0.1`,
  "--virtual-time-budget=40000",
  "--dump-dom",
  `http://127.0.0.1:${APP_PORT}/`,
], { stdio: ["ignore", "pipe", "ignore"] });

let dom = "";
chromium.stdout.on("data", (d) => { dom += d; });
chromium.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error(`chromium not found ("${CHROMIUM}"). Install with 'nix shell nixpkgs#chromium' or set CHROMIUM=/path/to/chromium`);
    cleanup(1);
  }
  fail(`chromium spawn error: ${e.message}`);
});

const killer = setTimeout(() => fail("timeout waiting for chromium"), 75000);

chromium.on("close", () => {
  clearTimeout(killer);

  const articleCount = (dom.match(/article-title/g) || []).length;
  const statusHidden = /id="status"[^>]*display:\s*none/.test(dom);

  // Expected event order: 403 challenge → script served → attestation → 200 content
  const order = ["proxy-403", "collector-script", "collector-attest", "proxy-200"];
  const idx = order.map((e) => events.indexOf(e));
  const orderOk = idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]);

  if (dom.includes("nicht erfolgreich")) return fail("app gave up (error message shown)");
  if (dom.includes("Sicherheitsprüfung")) return fail("app stuck on the challenge splash");
  if (articleCount < 50) return fail(`only ${articleCount} articles rendered (expected ≥50)`);
  if (!statusHidden) return fail("status area not hidden after load");
  if (!orderOk) return fail(`unexpected event order: ${events.join(" → ")}`);

  console.log(`OK: ${articleCount} articles rendered after in-app challenge solve`);
  console.log(`events: ${events.join(" → ")}`);
  cleanup(0);
});
