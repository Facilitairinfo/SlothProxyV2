(async () => {
  const path = require("path");
  const fs = require("fs");
  const express = require("express");
  const cors = require("cors");
  const compression = require("compression");
  const morgan = require("morgan");
  const rateLimit = require("express-rate-limit");
  const { LRUCache } = require("lru-cache");
  const { chromium } = require("playwright-extra");
  const cheerio = require("cheerio");
  const pRetry = await import("p-retry").then(mod => mod.default);

  // Stealth optioneel
  try {
    const stealth = require("playwright-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch {
    console.warn("⚠️ Stealth plugin not available, continuing without it.");
  }

  // Config store
  const CONFIG_PATH = path.join(__dirname, "configs", "sites.json");
  function loadSitesConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }
  let sitesConfig = loadSitesConfig();

  // Helpers
  function toAbs(href, base) {
    if (!href) return "";
    try { return new URL(href, base).toString(); } catch { return href; }
  }
  function parseDate(txt) {
    if (!txt) return null;
    const d = new Date(txt);
    if (!isNaN(d)) return d.toISOString();
    return null;
  }

  const app = express();
  app.use(compression());
  app.use(morgan("tiny"));
  app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));

  // Static admin (optioneel)
  app.use("/admin", express.static(path.join(__dirname, "public")));

  // Health
  app.get("/health", (req, res) => {
    res.status(200).json({ ok: true, t: Date.now() });
  });

  // Rate limit
  app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  }));

  // Cache
  const snapshotCache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });
  const extractCache = new LRUCache({ max: 200, ttl: 2 * 60 * 1000 });

  // Snapshot
  app.get("/snapshot", async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing ?url=" });

    const cached = snapshotCache.get(targetUrl);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(cached);
    }

    try {
      const html = await pRetry(async () => {
        const browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
        try {
          const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            locale: "nl-NL"
          });
          const page = await context.newPage();

          // Simulated human
          await page.mouse.move(100, 100);
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(300);

          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

          // Generic cookie-banner handling (best-effort)
          const cookieSelectors = [
            'button:has-text("Accepteren")',
            'button:has-text("Ik ga akkoord")',
            'button:has-text("Akkoord")',
            'button:has-text("Accept")',
            '#onetrust-accept-btn-handler',
            '[data-testid="cookie-accept"]'
          ];
          for (const sel of cookieSelectors) {
            const btn = await page.$(sel).catch(() => null);
            if (btn) {
              try { await btn.click({ delay: 50 }); await page.waitForTimeout(500); break; } catch {}
            }
          }

          // Wait for content
          await page.waitForSelector("body", { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(500);

          const content = await page.content();
          await context.close();
          await browser.close();
          return content;
        } catch (err) {
          await browser.close().catch(() => {});
          throw err;
        }
      }, { retries: 2, minTimeout: 500, maxTimeout: 1500 });

      snapshotCache.set(targetUrl, html);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch (err) {
      console.error("[snapshot:error]", err.message || err);
      return res.status(502).json({ error: "Snapshot failed", detail: String(err.message || err) });
    }
  });

  // Extract
  app.use(express.json({ limit: "1mb" }));
  app.post("/extract", async (req, res) => {
    const { url, selectors } = req.body || {};
    if (!url || !selectors?.list) return res.status(400).json({ error: "url and selectors.list required" });

    const cacheKey = JSON.stringify({ url, selectors });
    const cached = extractCache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      // Fetch snapshot HTML from same host (keeps CORS simple)
      const base = `${req.protocol}://${req.get("host")}`;
      const snapRes = await fetch(`${base}/snapshot?url=${encodeURIComponent(url)}`);
      if (!snapRes.ok) {
        return res.status(502).json({ error: "snapshot_failed", status: snapRes.status });
      }
      const html = await snapRes.text();
      const $ = cheerio.load(html);

      const items = [];
      $(selectors.list).each((_, el) => {
        const $el = $(el);
        const titleEl = selectors.title ? $el.find(selectors.title).first() : $el;
        const linkEl = selectors.link ? $el.find(selectors.link).first() : titleEl;
        const dateEl = selectors.date ? $el.find(selectors.date).first() : null;
        const summaryEl = selectors.summary ? $el.find(selectors.summary).first() : null;
        const imageEl = selectors.image ? $el.find(selectors.image).first() : null;

        const title = (titleEl.text() || "").trim();
        const link = toAbs((linkEl.attr("href") || "").trim(), url);
        const dateRaw = dateEl ? (dateEl.attr("datetime") || dateEl.text() || "").trim() : "";
        const date = parseDate(dateRaw);
        const summary = (summaryEl ? summaryEl.text() : "").trim();
        const image = toAbs(imageEl ? (imageEl.attr("src") || "").trim() : "", url);

        if (title && link) items.push({ title, link, date, summary, image });
      });

      const payload = { url, count: items.length, items };
      extractCache.set(cacheKey, payload);
      return res.json(payload);
    } catch (err) {
      console.error("[extract:error]", err);
      return res.status(500).json({ error: "extract_failed", detail: String(err) });
    }
  });

  // RSS
  app.get("/rss", async (req, res) => {
    const siteKey = req.query.site;
    if (!siteKey) return res.status(400).send("Missing ?site=");
    const cfg = sitesConfig[siteKey];
    if (!cfg) return res.status(404).send("Unknown site");

    try {
      const base = `${req.protocol}://${req.get("host")}`;
      const extractRes = await fetch(`${base}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cfg.startUrl, selectors: cfg.selectors })
      });
      const data = await extractRes.json();
      if (!extractRes.ok) {
        return res.status(502).send(`extract_failed: ${JSON.stringify(data)}`);
      }

      const now = new Date().toUTCString();
      const channelTitle = cfg.label || `Newsfeed: ${siteKey}`;
      const channelLink = cfg.startUrl;
      const channelDesc = `Auto-generated feed for ${siteKey}`;

      const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

      const itemsXml = (data.items || []).map(it => {
        const guid = it.link;
        const pubDate = it.date ? new Date(it.date).toUTCString() : now;
        const enclosure = it.image ? `<enclosure url="${esc(it.image)}" type="image/jpeg" />` : "";
        return `
  <item>
    <title>${esc(it.title)}</title>
    <link>${esc(it.link)}</link>
    <guid isPermaLink="true">${esc(guid)}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${esc(it.summary)}</description>
    ${enclosure}
  </item>`;
      }).join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(channelTitle)}</title>
  <link>${esc(channelLink)}</link>
  <description>${esc(channelDesc)}</description>
  <lastBuildDate>${now}</lastBuildDate>
${itemsXml}
</channel>
</rss>`;

      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      return res.status(200).send(xml);
    } catch (err) {
      console.error("[rss:error]", err);
      return res.status(500).send("rss_failed");
    }
  });

  // List sites
  app.get("/sites", (req, res) => {
    const keys = Object.keys(sitesConfig);
    res.json({
      count: keys.length,
      sites: keys.map(k => ({ key: k, label: sitesConfig[k].label, startUrl: sitesConfig[k].startUrl }))
    });
  });

  // Hot-reload configs (simple endpoint)
  app.post("/sites/reload", (req, res) => {
    try {
      sitesConfig = loadSitesConfig();
      res.json({ ok: true, count: Object.keys(sitesConfig).length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Start
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`SlothProxyV2 listening on :${PORT}`);
  });
})();
