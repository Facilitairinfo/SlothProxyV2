// server.js
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { LRUCache } from 'lru-cache';
import { getActiveSites } from './supabase.js';

if (process.env.NODE_ENV !== 'production') {
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
  } catch {}
}

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(morgan('tiny'));
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'SlothProxyV2',
    endpoints: ['/health', '/status', '/snapshot?url=...'],
    t: Date.now()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, t: Date.now() });
});

app.get('/status', async (req, res) => {
  try {
    const sites = await getActiveSites();
    console.log('[status] Supabase returned:', JSON.stringify(sites, null, 2));

    const statusList = (sites || []).map(s => ({
      siteKey: s.siteKey,
      label: s.label || s.siteData?.meta?.label || s.siteKey,
      url: s.url || s.siteData?.meta?.link || null,
      active: true,
      lastUpdated: s.lastUpdated || null
    }));

    res.status(200).json({
      ok: true,
      count: statusList.length,
      updated: new Date().toISOString(),
      sites: statusList
    });
  } catch (err) {
    console.error('[status:error]', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    res.status(500).json({
      ok: false,
      error: 'status_failed',
      detail: JSON.stringify(err, Object.getOwnPropertyNames(err))
    });
  }
});

const cache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

app.get('/snapshot', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({
      error: 'missing_url',
      hint: 'Gebruik /snapshot?url=https://...'
    });
  }

  let chromium, stealthPlugin, pRetry;
  try {
    const { chromium: chr } = await import('playwright-extra');
    const stealth = await import('playwright-extra-plugin-stealth');
    const retry = await import('p-retry');
    chromium = chr;
    stealthPlugin = stealth.default();
    chromium.use(stealthPlugin);
    pRetry = retry.default;
  } catch {
    return res.status(503).json({
      error: 'snapshot_unavailable',
      detail: 'Playwright dependencies ontbreken'
    });
  }

  const cached = cache.get(targetUrl);
  if (cached) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(cached);
  }

  try {
    const html = await pRetry(async () => {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      try {
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          locale: 'nl-NL'
        });
        const page = await context.newPage();
        await page.waitForTimeout(200);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(600);
        const content = await page.content();
        await context.close();
        await browser.close();
        return content;
      } catch (err) {
        try { await browser.close(); } catch {}
        throw err;
      }
    }, { retries: 2, minTimeout: 500, maxTimeout: 1500 });

    cache.set(targetUrl, html);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[snapshot:error]', err?.message || err);
    return res.status(502).json({
      error: 'snapshot_failed',
      detail: String(err?.message || err)
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'not_found',
    path: req.path,
    hint: 'Probeer /health, /status of /snapshot?url=...'
  });
});

app.use((err, req, res, next) => {
  console.error('[global:error]', err);
  res.status(500).json({
    ok: false,
    error: 'internal_error',
    detail: String(err)
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ SlothProxyV2 is actief op poort ${PORT}`);
});
