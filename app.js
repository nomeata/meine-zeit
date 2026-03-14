// --- Configuration ---
export const ZEIT_BASE = "https://www.zeit.de";

const CORS_PROXIES = [
  url => `https://cors.nomeata.de/proxy/${url.replace('https://', '')}`,
];

const LS_READ   = "mz_read";
const LS_HIDDEN = "mz_hidden";
const SS_CACHE  = "mz_cache";
const SS_LAST   = "mz_last";
const CACHE_MAX_AGE = 20 * 60 * 1000; // 20 minutes

// --- Escape HTML ---
export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// --- Format time ---
export function formatTime(datetime, timeText) {
  if (timeText) return timeText;
  if (!datetime) return "";
  try {
    const date = new Date(datetime);
    const now = new Date();
    const diffMins = Math.floor((now - date) / 60000);
    if (diffMins < 1) return "gerade eben";
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "gestern";
    if (diffDays < 7) return `vor ${diffDays} Tagen`;
    return date.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  } catch { return ""; }
}

// --- Parse zeit.de HTML into article objects ---
export function parseZeitHTML(html) {
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

    return { id, link: href, kicker, title, summary, image, isZPlus, isLiveblog, type: isLead ? "lead" : "teaser" };
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

  // Walk cp-area sections in DOM order to preserve section headings
  doc.querySelectorAll(".cp-area").forEach(area => {
    // Extract section heading if present
    const headingEl = area.querySelector(".headed-meta__title");
    const heading = headingEl?.textContent?.trim().replace(/\s+/g, " ") || "";

    // Collect articles from this area
    const areaItems = [];
    area.querySelectorAll("article.zon-teaser").forEach(el => {
      const item = parseTeaser(el);
      if (item) areaItems.push(item);
    });
    area.querySelectorAll("article.zon-newsteaser").forEach(el => {
      const item = parseNewsteaser(el);
      if (item) areaItems.push(item);
    });

    // Only emit heading if this area produced articles
    if (areaItems.length > 0 && heading) {
      result.push({ type: "_label", text: heading });
    }
    result.push(...areaItems);
  });

  return result;
}

// --- Render articles to HTML string (pure function) ---
export function renderArticles(articles, readSet, hiddenSet) {
  let html = "";

  for (const a of articles) {
    if (a.type === "_label") {
      html += `<div class="section-label">${esc(a.text)}</div>`;
      continue;
    }

    const cls = [
      "article",
      a.type === "lead" ? "lead" : "",
      a.type === "news" ? "newsticker" : "",
      a.isLiveblog ? "liveblog" : "",
      (!a.isLiveblog && readSet.has(a.id)) ? "read" : "",
      hiddenSet.has(a.id) ? "hidden" : "",
    ].filter(Boolean).join(" ");

    const zplusBadge = a.isZPlus ? '<span class="badge-zplus">Z+</span>' : "";
    const liveblogBadge = a.isLiveblog ? '<span class="badge-liveblog">Live</span>' : "";
    const href = esc(a.link);
    const time = formatTime(a.datetime, a.timeText);

    const badges = liveblogBadge + zplusBadge;

    if (a.type === "lead" && a.image) {
      // Lead: big image on top
      html += `<div class="${cls}" data-id="${esc(a.id)}">
  <div class="swipe-bg">Ausblenden</div>
  <div class="swipe-bg-right">Öffnen</div>
  <a class="article-inner" href="${href}">
    <img class="article-img" src="${esc(a.image)}" alt="" loading="lazy">
    <div class="article-body">
      <div class="article-text">
        ${a.kicker ? `<div class="article-kicker">${badges}${esc(a.kicker)}</div>` : (badges ? `<div class="article-kicker">${badges}</div>` : "")}
        <div class="article-title">${esc(a.title)}</div>
        ${a.summary ? `<div class="article-desc">${esc(a.summary)}</div>` : ""}
        <div class="article-meta">
        </div>
      </div>
    </div>
  </a>
  <div class="collapsed-bar">${esc(a.title)}</div>
</div>`;
    } else if (a.type === "news") {
      // Newsticker: compact, no image
      html += `<div class="${cls}" data-id="${esc(a.id)}">
  <div class="swipe-bg">Ausblenden</div>
  <div class="swipe-bg-right">Öffnen</div>
  <a class="article-inner" href="${href}">
    <div class="article-body">
      <div class="article-text">
        ${a.kicker ? `<div class="article-kicker">${esc(a.kicker)}</div>` : ""}
        <div class="article-title">${esc(a.title)}</div>
        ${time ? `<div class="article-meta"><span>${esc(time)}</span></div>` : ""}
      </div>
    </div>
  </a>
  <div class="collapsed-bar">${esc(a.title)}</div>
</div>`;
    } else {
      // Standard teaser: text + optional thumbnail
      html += `<div class="${cls}" data-id="${esc(a.id)}">
  <div class="swipe-bg">Ausblenden</div>
  <div class="swipe-bg-right">Öffnen</div>
  <a class="article-inner" href="${href}">
    <div class="article-body">
      <div class="article-text">
        ${a.kicker ? `<div class="article-kicker">${badges}${esc(a.kicker)}</div>` : (badges ? `<div class="article-kicker">${badges}</div>` : "")}
        <div class="article-title">${esc(a.title)}</div>
        ${a.summary ? `<div class="article-desc">${esc(a.summary)}</div>` : ""}
        <div class="article-meta">
        </div>
      </div>
      ${a.image ? `<img class="article-thumb" src="${esc(a.image)}" alt="" loading="lazy">` : ""}
    </div>
  </a>
  <div class="collapsed-bar">${esc(a.title)}</div>
</div>`;
    }
  }

  return html;
}

// --- Browser-only code ---
if (typeof window !== "undefined" && document.getElementById("articles")) {
  let articles = [];

  // --- LocalStorage helpers ---
  function getSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
    catch { return new Set(); }
  }

  function saveSet(key, set) {
    const arr = [...set];
    if (arr.length > 3000) arr.splice(0, arr.length - 3000);
    localStorage.setItem(key, JSON.stringify(arr));
  }

  function markRead(id) {
    const s = getSet(LS_READ); s.add(id); saveSet(LS_READ, s);
  }

  function markUnread(id) {
    const s = getSet(LS_READ); s.delete(id); saveSet(LS_READ, s);
  }

  function toggleHidden(id) {
    const s = getSet(LS_HIDDEN);
    if (s.has(id)) s.delete(id); else s.add(id);
    saveSet(LS_HIDDEN, s);
    return s.has(id);
  }

  function unhideAll() {
    localStorage.setItem(LS_HIDDEN, "[]");
  }

  // --- Fetch via CORS proxy ---
  async function fetchPage(url) {
    let lastError;
    for (const mkProxy of CORS_PROXIES) {
      try {
        const resp = await fetch(mkProxy(url), { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (text.startsWith('{"error"')) throw new Error(text);
        return text;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  // --- Komplettansicht check ---
  const LS_KOMPLETT = "mz_komplett";

  function getKomplettCache() {
    try { return JSON.parse(localStorage.getItem(LS_KOMPLETT) || "{}"); }
    catch { return {}; }
  }

  function setKomplettCache(url, hasIt) {
    const cache = getKomplettCache();
    cache[url] = hasIt;
    const keys = Object.keys(cache);
    if (keys.length > 1000) {
      for (const k of keys.slice(0, keys.length - 1000)) delete cache[k];
    }
    localStorage.setItem(LS_KOMPLETT, JSON.stringify(cache));
  }

  function skipKomplettCheck(url) {
    return /liveblog|podcast|video|\/news\//.test(url);
  }

  async function resolveArticleURL(url) {
    const clean = url.replace(/\/+$/, "");
    if (skipKomplettCheck(clean)) return clean;

    const cache = getKomplettCache();
    if (clean in cache) {
      return cache[clean] ? clean + "/komplettansicht" : clean;
    }

    const komplettUrl = clean + "/komplettansicht";
    for (const mkProxy of CORS_PROXIES) {
      try {
        const resp = await fetch(mkProxy(komplettUrl), {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
        });
        const hasIt = resp.ok;
        setKomplettCache(clean, hasIt);
        return hasIt ? komplettUrl : clean;
      } catch {
        // proxy might not support HEAD, try next
      }
    }

    setKomplettCache(clean, false);
    return clean;
  }

  // --- Render ---
  function render() {
    const container = document.getElementById("articles");
    const readSet = getSet(LS_READ);
    const hiddenSet = getSet(LS_HIDDEN);
    container.innerHTML = renderArticles(articles, readSet, hiddenSet);
    attachListeners();
  }

  // --- Open article ---
  async function openArticle(el) {
    const baseURL = el.querySelector(".article-inner")?.getAttribute("href");
    if (!baseURL) return;

    const isLiveblog = el.classList.contains("liveblog");

    if (!isLiveblog) markRead(el.dataset.id);
    sessionStorage.setItem(SS_LAST, el.dataset.id);
    setCachedArticles(articles);

    el.classList.add("checking");
    let finalURL;
    try {
      finalURL = await resolveArticleURL(baseURL);
    } catch {
      finalURL = baseURL;
    }
    el.classList.remove("checking");

    window.location.href = finalURL;
  }

  function attachListeners() {
    document.querySelectorAll("#articles .article").forEach(el => {
      setupSwipe(el);

      el.querySelector(".article-inner")?.addEventListener("click", (e) => {
        e.preventDefault();
        if (el.classList.contains("checking")) return;
        openArticle(el);
      });

      el.querySelector(".collapsed-bar")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (el.classList.contains("hidden")) {
          toggleHidden(el.dataset.id);
          markUnread(el.dataset.id);
        } else if (el.classList.contains("read")) {
          markUnread(el.dataset.id);
        }
        render();
      });
    });
  }

  // --- Swipe handling ---
  function setupSwipe(el) {
    let startX, currentX, isDragging = false;
    const inner = el.querySelector(".article-inner");
    if (!inner) return;
    const DEAD_ZONE = 50;

    inner.addEventListener("touchstart", (e) => {
      if (el.classList.contains("hidden") || (el.classList.contains("read") && !el.classList.contains("expanded"))) return;
      startX = e.touches[0].clientX;
      currentX = startX;
      isDragging = true;
    }, { passive: true });

    inner.addEventListener("touchmove", (e) => {
      if (!isDragging) return;
      currentX = e.touches[0].clientX;
      const diffX = startX - currentX;

      if (Math.abs(diffX) < DEAD_ZONE) {
        if (el.classList.contains("swiping")) {
          el.classList.remove("swiping", "swiping-left", "swiping-right");
          inner.style.transform = "";
        }
        return;
      }

      // Subtract dead zone so movement starts from 0
      const offset = diffX > 0 ? diffX - DEAD_ZONE : diffX + DEAD_ZONE;
      el.classList.add("swiping");
      if (diffX > 0) {
        el.classList.add("swiping-left");
        el.classList.remove("swiping-right");
      } else {
        el.classList.add("swiping-right");
        el.classList.remove("swiping-left");
      }
      inner.style.transform = `translateX(${-offset}px)`;
    }, { passive: true });

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      el.classList.remove("swiping");
      const diffX = startX - currentX;

      if (diffX > 100) {
        el.classList.remove("swiping-left", "swiping-right");
        el.classList.add("sliding-out");
        inner.style.transform = "";
        setTimeout(() => {
          toggleHidden(el.dataset.id);
          el.classList.remove("sliding-out");
          el.classList.add("hidden");
        }, 300);
      } else if (diffX < -100) {
        el.classList.remove("swiping-left");
        el.classList.add("swiping-right");
        inner.style.transform = `translateX(${-diffX}px)`;
        openArticle(el);
      } else {
        el.classList.remove("swiping-left", "swiping-right");
        inner.style.transform = "";
      }
    };

    inner.addEventListener("touchend", onEnd, { passive: true });
    inner.addEventListener("touchcancel", onEnd, { passive: true });
  }

  // --- Session cache ---
  function getCachedArticles() {
    try {
      const { ts, data } = JSON.parse(sessionStorage.getItem(SS_CACHE));
      return (Date.now() - ts < CACHE_MAX_AGE) ? data : null;
    } catch { return null; }
  }

  function setCachedArticles(data) {
    try { sessionStorage.setItem(SS_CACHE, JSON.stringify({ ts: Date.now(), data })); }
    catch { /* quota */ }
  }

  // --- Load articles ---
  async function loadSection(forceRefresh) {
    const statusEl = document.getElementById("status");
    const articlesEl = document.getElementById("articles");

    if (!forceRefresh) {
      const cached = getCachedArticles();
      if (cached) {
        articles = cached;
        statusEl.style.display = "none";
        render();
        highlightLast();
        return;
      }
    }

    statusEl.innerHTML = '<div class="loading-spinner"></div><br>Lade Artikel&hellip;';
    statusEl.style.display = "block";
    articlesEl.innerHTML = "";

    const url = ZEIT_BASE + "/index";

    try {
      const html = await fetchPage(url);
      articles = parseZeitHTML(html);
      setCachedArticles(articles);
      statusEl.style.display = "none";

      if (articles.length === 0) {
        statusEl.innerHTML = "Keine Artikel gefunden.";
        statusEl.style.display = "block";
      } else {
        render();
        highlightLast();
      }
    } catch (e) {
      statusEl.innerHTML = `<div class="error-msg">
          Artikel konnten nicht geladen werden.<br>
          <small style="color: var(--zeit-grey)">${esc(e.message || String(e))}</small><br><br>
          <button class="header-btn" onclick="loadSection()">Erneut versuchen</button>
        </div>`;
      statusEl.style.display = "block";
      console.error("Fetch failed:", e);
    }
  }

  // --- Highlight last-visited article ---
  function highlightLast() {
    const lastId = sessionStorage.getItem(SS_LAST);
    if (!lastId) return;
    const el = document.querySelector(`.article[data-id="${CSS.escape(lastId)}"]`);
    if (el) el.classList.add("last-visited");
    sessionStorage.removeItem(SS_LAST);
  }

  // --- Button handlers ---
  document.getElementById("btn-refresh").addEventListener("click", () => loadSection(true));
  document.getElementById("btn-unhide-all").addEventListener("click", () => {
    unhideAll();
    document.querySelectorAll(".article.hidden").forEach(el => el.classList.remove("hidden"));
  });

  // --- Init ---
  window.loadSection = loadSection; // exposed for onclick in error message
  loadSection();

  // Re-render on back navigation (bfcache) to reflect read state
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && articles.length > 0) {
      render();
      highlightLast();
    }
  });
}
