// Offline test: run the parser against example-index.html
// Usage: node test-parser.mjs

import { readFileSync } from "fs";
import { JSDOM } from "jsdom";

const exampleHTML = readFileSync("example-index.html", "utf-8");
const indexHTML = readFileSync("index.html", "utf-8");

// Extract the parseZeitHTML function and its dependencies from index.html
const dom = new JSDOM("", { url: "https://zeit.nomeata.de" });
const { DOMParser } = dom.window;

const ZEIT_BASE = "https://www.zeit.de";

// Run the parser using jsdom's DOMParser
function parseZeitHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const result = [];
  const seen = new Set();
  let teaserCount = 0;

  function parseTeaser(el) {
    const linkEl = el.querySelector("a.zon-teaser__link");
    if (!linkEl) return null;

    let href = linkEl.getAttribute("href") || "";
    if (href.startsWith("/")) href = ZEIT_BASE + href;
    if (!href.includes("zeit.de")) return null;

    if (el.querySelector('.audio-player[data-audio-type="podcast"]')) return null;
    if (el.querySelector('.zon-teaser__kicker--ad')) return null;
    if (/podcast|wochenmarkt/i.test(href)) return null;

    const id = href.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "_");
    if (seen.has(id)) return null;
    seen.add(id);

    const kicker = el.querySelector(".zon-teaser__kicker-text")?.textContent?.trim() || "";
    const title = el.querySelector(".zon-teaser__title")?.textContent?.trim() || "";
    const summary = el.querySelector(".zon-teaser__summary")?.textContent?.trim() || "";
    const isZPlus = el.hasAttribute("data-zplus") || !!el.querySelector(".zplus-logo");
    const isLiveblog = /liveblog/i.test(href) || /liveblog/i.test(kicker);

    let image = "";
    const img = el.querySelector("img.zon-teaser__media-item");
    if (img) {
      image = img.getAttribute("src") || "";
      const source = el.querySelector("picture source[media='(max-width: 360px)']");
      if (source) {
        const srcset = source.getAttribute("srcset") || "";
        image = srcset.split(",")[0].trim().split(" ")[0] || image;
      }
    }

    const isLead = teaserCount === 0;
    teaserCount++;

    return { id, link: href, kicker, title, summary: summary.slice(0, 60) + (summary.length > 60 ? "…" : ""), image: image ? "yes" : "", isZPlus, isLiveblog, type: isLead ? "lead" : "teaser" };
  }

  function parseNewsteaser(el) {
    const linkEl = el.querySelector("a.zon-newsteaser__link");
    if (!linkEl) return null;

    let href = linkEl.getAttribute("href") || "";
    if (href.startsWith("/")) href = ZEIT_BASE + href;
    if (!href.includes("zeit.de")) return null;
    if (/podcast|wochenmarkt/i.test(href)) return null;

    const id = href.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "_");
    if (seen.has(id)) return null;
    seen.add(id);

    const kicker = el.querySelector(".zon-newsteaser__kicker")?.textContent?.trim() || "";
    const title = el.querySelector(".zon-newsteaser__title")?.textContent?.trim() || "";
    const timeEl = el.querySelector(".zon-newsteaser__time");
    const timeText = timeEl?.textContent?.trim() || "";
    const datetime = timeEl?.getAttribute("datetime") || "";
    const isLiveblog = /liveblog/i.test(href) || /liveblog/i.test(kicker);

    return { id, link: href, kicker, title, summary: "", image: "", isZPlus: false, isLiveblog, type: "news", timeText, datetime };
  }

  doc.querySelectorAll(".cp-area").forEach(area => {
    const headingEl = area.querySelector(".headed-meta__title");
    const heading = headingEl?.textContent?.trim().replace(/\s+/g, " ") || "";

    const areaItems = [];
    area.querySelectorAll("article.zon-teaser").forEach(el => {
      const item = parseTeaser(el);
      if (item) areaItems.push(item);
    });
    area.querySelectorAll("article.zon-newsteaser").forEach(el => {
      const item = parseNewsteaser(el);
      if (item) areaItems.push(item);
    });

    if (areaItems.length > 0 && heading) {
      result.push({ type: "_label", text: heading });
    }
    result.push(...areaItems);
  });

  return result;
}

const articles = parseZeitHTML(exampleHTML);

console.log(`\nParsed ${articles.filter(a => a.type !== "_label").length} articles in ${articles.filter(a => a.type === "_label").length} sections\n`);

for (const a of articles) {
  if (a.type === "_label") {
    console.log(`\n--- ${a.text} ---`);
    continue;
  }
  const flags = [
    a.type === "lead" ? "LEAD" : "",
    a.type === "news" ? "NEWS" : "",
    a.isZPlus ? "Z+" : "",
    a.isLiveblog ? "LIVE" : "",
    a.image ? "IMG" : "",
  ].filter(Boolean).join(",");
  console.log(`  [${flags || a.type}] ${a.kicker ? a.kicker + ": " : ""}${a.title}`);
}
