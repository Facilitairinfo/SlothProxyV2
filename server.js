// server.js — SlothProxyV2
(async () => {
  const express = require('express');
  const compression = require('compression');
  const cors = require('cors');
  const morgan = require('morgan');
  const rateLimit = require('express-rate-limit');
  const { LRUCache } = require('lru-cache');

  if (process.env.NODE_ENV !== 'production') {
    try { require('dotenv').config(); } catch (_) {}
  }

  let chromium, stealth, pRetry;
  try {
    ({ chromium } = require('playwright-extra'));
    stealth = require('playwright-extra-plugin-stealth')();
    chromium.use(stealth);
    pRetry = await import('p-retry').then(mod => mod.default);
  } catch (e) {
    console.warn('[init] Playwright snapshot niet beschikbaar. /snapshot zal 503 geven.');
  }

  let createClient;
  try {
    ({ createClient } = await import('@supabase/supabase-js'));
  } catch (e) {
    console.error('[init] Supabase client ontbreekt. Installeer met: npm install @supabase/supabase-js');
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(morgan('tiny'));
  app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
  app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  let supabase = null;
  let supabaseAdmin = null;
  if (createClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  if (createClient && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }

  async function getActiveSites() {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('sites')
      .select('siteKey,label,url,active,lastUpdated')
      .eq('active', true);
    if (error) throw error;
    return data || [];
  }

  async function getSiteByKey(siteKey) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('sites')
      .select('siteKey,label,url,active,lastUpdated')
      .eq('siteKey', siteKey)
      .single();
    if (error) throw error;
    return data || null;
  }

  async function touchLastUpdated(siteKey) {
    if (!supabaseAdmin) return;
    const { error } = await supabaseAdmin
      .from('sites')
      .update({ lastUpdated: new Date().toISOString() })
      .eq('siteKey', siteKey);
    if (error) throw error;
  }

  app.get('/status', async (req, res) => {
    try {
      const sites = await getActiveSites();
      const statusList = sites.map(s => ({
        siteKey: s.siteKey,
        label: s.label || s.siteKey,
        url: s.url,
        active: s.active !== false,
        lastUpdated: s.lastUpdated || null
      }));
      res.status(200).json({
        ok: true,
        count: statusList.length,
        updated: new Date().toISOString(),
        sites: statusList
      });
    } catch (err) {
      console.error('[status:error]', err);
      res.status(500).json({ ok: false, error: 'status_failed', detail: String(err) });
    }
  });

  const cache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

  app.get('/snapshot', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'missing_url', hint: 'Gebruik /snapshot?url=https://...' });
    if (!chromium || !pRetry) {
      return res.status(503).json({ error: 'snapshot_unavailable', detail: 'Playwright dependencies ontbreken' });
    }

    const cached = cache.get(targetUrl);
    if (cached) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(cached);
    }

    try {
      const html = await pRetry(async () => {
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          locale: 'nl-NL',
        });
        const page = await context.newPage();
        await page.mouse.move(100, 100);
        await page.mouse.wheel({ deltaY: 300 });
        await page.waitForTimeout(400);
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('body', { timeout: 5000 });
        await page.waitForTimeout(800);
        const content = await page.content();
        await context.close();
        await browser.close();
        return content;
      }, { retries: 2, minTimeout: 500, maxTimeout: 1500 });

      cache.set(targetUrl, html);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    } catch (err) {
      console.error('[snapshot:error]', err?.message || err);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(502).json({ error: 'snapshot_failed', detail: String(err?.message || err) });
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
    res.status(500).json({ ok: false, error: 'internal_error', detail: String(err) });
  });

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`SlothProxyV2 listening on :${PORT}`);
  });
})();
