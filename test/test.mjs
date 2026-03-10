// Test runner for parseZeitHTML and renderArticles
// Usage:
//   node test/test.mjs            — check mode (compare against expected baselines)
//   node test/test.mjs --update   — update expected baselines from current code
//   node test/test.mjs --snapshot — fetch fresh zeit.de HTML, then update baselines

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = join(__dirname, "example-index.html");
const EXPECTED_PARSED_PATH = join(__dirname, "expected-parsed.json");
const EXPECTED_RENDERED_PATH = join(__dirname, "expected-rendered.html");

// Set up jsdom globals before importing app.js
const dom = new JSDOM("", { url: "https://zeit.nomeata.de" });
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const { parseZeitHTML, renderArticles, esc, ZEIT_BASE } = await import("../app.js");

const mode = process.argv[2] || "--check";

if (mode === "--snapshot") {
  console.log("Fetching fresh snapshot from zeit.de...");
  const proxyUrl = `https://cors.nomeata.de/proxy/www.zeit.de/index`;
  const resp = await fetch(proxyUrl, {
    headers: { "Origin": "https://zeit.nomeata.de" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    console.error(`Fetch failed: HTTP ${resp.status}`);
    process.exit(1);
  }
  const html = await resp.text();
  writeFileSync(EXAMPLE_PATH, html);
  console.log(`Saved snapshot to ${EXAMPLE_PATH}`);
  // Fall through to update mode
}

if (mode === "--update" || mode === "--snapshot") {
  const html = readFileSync(EXAMPLE_PATH, "utf-8");
  const articles = parseZeitHTML(html);
  const rendered = renderArticles(articles, new Set(), new Set());

  writeFileSync(EXPECTED_PARSED_PATH, JSON.stringify(articles, null, 2) + "\n");
  writeFileSync(EXPECTED_RENDERED_PATH, rendered);

  const articleCount = articles.filter(a => a.type !== "_label").length;
  const sectionCount = articles.filter(a => a.type === "_label").length;
  console.log(`Updated baselines: ${articleCount} articles, ${sectionCount} sections`);
  process.exit(0);
}

if (mode === "--check") {
  const html = readFileSync(EXAMPLE_PATH, "utf-8");
  const articles = parseZeitHTML(html);
  const rendered = renderArticles(articles, new Set(), new Set());

  let expectedParsed, expectedRendered;
  try {
    expectedParsed = readFileSync(EXPECTED_PARSED_PATH, "utf-8");
    expectedRendered = readFileSync(EXPECTED_RENDERED_PATH, "utf-8");
  } catch {
    console.error("Expected baselines not found. Run with --update first.");
    process.exit(1);
  }

  const actualParsed = JSON.stringify(articles, null, 2) + "\n";
  let failed = false;

  if (actualParsed !== expectedParsed) {
    console.error("FAIL: parsed output differs from expected-parsed.json");
    // Show first differing line
    const actualLines = actualParsed.split("\n");
    const expectedLines = expectedParsed.split("\n");
    for (let i = 0; i < Math.max(actualLines.length, expectedLines.length); i++) {
      if (actualLines[i] !== expectedLines[i]) {
        console.error(`  First diff at line ${i + 1}:`);
        console.error(`    expected: ${(expectedLines[i] || "(missing)").slice(0, 120)}`);
        console.error(`    actual:   ${(actualLines[i] || "(missing)").slice(0, 120)}`);
        break;
      }
    }
    failed = true;
  } else {
    console.log("OK: parsed output matches");
  }

  if (rendered !== expectedRendered) {
    console.error("FAIL: rendered output differs from expected-rendered.html");
    const actualLines = rendered.split("\n");
    const expectedLines = expectedRendered.split("\n");
    for (let i = 0; i < Math.max(actualLines.length, expectedLines.length); i++) {
      if (actualLines[i] !== expectedLines[i]) {
        console.error(`  First diff at line ${i + 1}:`);
        console.error(`    expected: ${(expectedLines[i] || "(missing)").slice(0, 120)}`);
        console.error(`    actual:   ${(actualLines[i] || "(missing)").slice(0, 120)}`);
        break;
      }
    }
    failed = true;
  } else {
    console.log("OK: rendered output matches");
  }

  process.exit(failed ? 1 : 0);
}

console.error(`Unknown mode: ${mode}`);
console.error("Usage: node test/test.mjs [--check | --update | --snapshot]");
process.exit(1);
