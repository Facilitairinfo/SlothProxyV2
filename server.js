(async () => {
  const express = require("express");
  const cors = require("cors");
  const compression = require("compression");
  const morgan = require("morgan");
  const rateLimit = require("express-rate-limit");
  const { LRUCache } = require("lru-cache");
  const { chromium } = require("playwright-extra");
  const pRetry = await import("p-retry").then(mod => mod.default);

  // ⛑️ Stealth plugin optioneel laden
  try {
    const stealth = require("playwright-extra-plugin-stealth")();
    chromium.use(stealth);
  } catch (err) {
    console.warn("⚠️ Stealth plugin not available, continuing without it.");
  }

  const app = express();

  // 🌐 Middleware
  app.use(compression());
  app.use(morgan("tiny"));
  app.use(cors({ origin: "*", methods: ["GET", "OPTIONS"] }));

  // 🩺 Healthcheck
  app.get("/health", (req, res) => {
    res.status(200).json({ ok: true, t: Date.now() });
  });

  // 🚦 Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // 🧠 Caching
  const cache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

  // 📸 Snapshot endpoint
  app.get("/snapshot", async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing ?url=" });

    const cached = cache.get(targetUrl);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(cached);
    }

    try {
      const html = await pRetry(async () => {
        const browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        try {
          const context = await browser.newContext({
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            locale: "nl-NL",
          });

          const page = await context.newPage();

          // 🕵️ Simuleer menselijk gedrag
          await page.mouse.move(100, 100);
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(500);

          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

          // 🍪 Cookiebot wegklikken
          await page.waitForSelector('button:has-text("Accepteren")', { timeout: 5000 }).catch(() => {});
          const acceptButton = await page.$('button:has-text("Accepteren")');
          if (acceptButton) {
            await acceptButton.click();
            await page.waitForTimeout(1000);
          }

          await page.waitForSelector("body", { timeout: 5000 });
          await page.waitForTimeout(1000);

          const content = await page.content();
          await context.close();
          await browser.close();
          return content;
        } catch (err) {
          await browser.close().catch(() => {});
          throw err;
        }
      }, { retries: 2, minTimeout: 500, maxTimeout: 1500 });

      cache.set(targetUrl, html);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    } catch (err) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      console.error("[snapshot:error]", err.message);
      return res.status(502).json({ error: "Snapshot failed", detail: err.message });
    }
  });

  // 🚀 Start server
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`SlothProxyV2 listening on :${PORT}`);
  });
})();
