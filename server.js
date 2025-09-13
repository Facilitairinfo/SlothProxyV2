(async () => {
  const express = require("express");
  const cors = require("cors");
  const compression = require("compression");
  const morgan = require("morgan");
  const rateLimit = require("express-rate-limit");
  const LRU = require("lru-cache");
  const { chromium } = require("playwright");
  const pRetry = await import("p-retry").then(mod => mod.default);

  const app = express();

  // --- Basis middleware
  app.use(compression());
  app.use(morgan("tiny"));

  // --- CORS: sta alles toe
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Accept"],
      maxAge: 600,
    })
  );

  // --- Healthcheck
  app.get("/health", (req, res) => {
    res.status(200).json({ ok: true, t: Date.now() });
  });

  // --- Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // --- Cache
  const cache = new LRU({
    max: 200,
    ttl: 5 * 60 * 1000,
  });

  // --- Snapshot endpoint
  app.get("/snapshot", async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing ?url=" });
    }

    const cached = cache.get(targetUrl);
    if (cached) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(200).send(cached);
    }

    try {
      const html = await pRetry(
        async () => {
          const browser = await chromium.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: true,
          });

          try {
            const context = await browser.newContext({
              userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
              locale: "nl-NL",
              extraHTTPHeaders: {
                "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
              },
            });

            const page = await context.newPage();
            await page.goto(targetUrl, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });

            await page.waitForTimeout(1000);
            const content = await page.content();

            await context.close();
            await browser.close();
            return content;
          } catch (err) {
            await browser.close().catch(() => {});
            throw err;
          }
        },
        {
          retries: 2,
          minTimeout: 500,
          maxTimeout: 1500,
        }
      );

      cache.set(targetUrl, html);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(200).send(html);
    } catch (err) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      console.error("[snapshot:error]", err.message);
      return res.status(502).json({ error: "Snapshot failed", detail: err.message });
    }
  });

  // --- Start server
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`SlothProxyV2 listening on :${PORT}`);
  });
})();
