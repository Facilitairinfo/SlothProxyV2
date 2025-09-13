import express from "express";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { LRUCache } from "lru-cache";
import { chromium } from "playwright";
import pRetry from "p-retry";

const app = express();

// ----- Config -----
const PORT = process.env.PORT || 8080;
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "900000", 10); // 15 min
const CACHE_MAX = parseInt(process.env.CACHE_MAX || "500", 10);
const RENDER_TIMEOUT_MS = parseInt(process.env.RENDER_TIMEOUT_MS || "15000", 10);
const NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || "20000", 10);
const RATE_PER_MIN = parseInt(process.env.RATE_PER_MIN || "120", 10);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const WAIT_UNTIL = process.env.WAIT_UNTIL || "networkidle"; // 'load' | 'domcontentloaded' | 'networkidle'

// ----- Middleware -----
app.use(morgan("tiny"));
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(compression());
app.set("trust proxy", 1);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: RATE_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// ----- Cache -----
const cache = new LRUCache({
  max: CACHE_MAX,
  ttl: CACHE_TTL_MS
});

// ----- Helpers -----
function isValidUrl(u) {
  try {
    const x = new URL(u);
    return ["http:", "https:"].includes(x.protocol);
  } catch {
    return false;
  }
}

const defaultUA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function renderWithBrowser(targetUrl) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-features=Translate,BackForwardCache"]
  });
  try {
    const context = await browser.newContext({
      userAgent: defaultUA,
      viewport: { width: 1366, height: 900 },
      javaScriptEnabled: true,
      locale: "nl-NL",
      extraHTTPHeaders: {
        "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1"
      }
    });

    const page = await context.newPage();

    // Blokkeer zware assets voor snelheid
    await page.route("**/*", route => {
      const type = route.request().resourceType();
      if (["image", "font", "media"].includes(type)) return route.abort();
      return route.continue();
    });

    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    await page.goto(targetUrl, { waitUntil: WAIT_UNTIL });

    // Wacht een tik voor late JS
    await page.waitForTimeout(Math.min(2000, RENDER_TIMEOUT_MS));

    // Strip script tags → statische snapshot
    await page.addScriptTag({
      content: `
        (function(){
          const scripts = document.querySelectorAll('script');
          scripts.forEach(s => s.remove());
        })();
      `
    });

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

async function fetchRaw(targetUrl) {
  // Snel pad zonder JS-rendering
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ userAgent: defaultUA, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    const resp = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    if (!resp) throw new Error("No response");
    const body = await resp.text();
    return body;
  } finally {
    await browser.close();
  }
}

// ----- Endpoints -----
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    cache: { size: cache.size, ttlMs: CACHE_TTL_MS },
    rateLimitPerMin: RATE_PER_MIN,
    waitUntil: WAIT_UNTIL
  });
});

app.get("/raw", async (req, res) => {
  const url = String(req.query.url || "");
  if (!isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const key = `raw:${url}`;
  const cached = cache.get(key);
  if (cached) return res.type("text/html; charset=utf-8").send(cached);

  try {
    const html = await pRetry(() => fetchRaw(url), { retries: 1, minTimeout: 300 });
    cache.set(key, html);
    res.type("text/html; charset=utf-8").send(html);
  } catch (e) {
    res.status(502).json({ error: "Fetch failed", detail: e.message });
  }
});

app.get("/snapshot", async (req, res) => {
  const url = String(req.query.url || "");
  if (!isValidUrl(url)) return res.status(400).json({ error: "Invalid URL" });

  const key = `snap:${url}`;
  const cached = cache.get(key);
  if (cached) return res.type("text/html; charset=utf-8").send(cached);

  try {
    const html = await pRetry(() => renderWithBrowser(url), { retries: 1, minTimeout: 500 });
    cache.set(key, html);
    res.type("text/html; charset=utf-8").send(html);
  } catch (e) {
    res.status(502).json({ error: "Snapshot failed", detail: e.message });
  }
});

// ----- Start -----
app.listen(PORT, () => {
  console.log(`Sloth Proxy v2 listening on :${PORT}`);
});
