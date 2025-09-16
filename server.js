import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { LRUCache } from 'lru-cache';
import { chromium } from 'playwright-extra';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { getActiveSites, getSiteByKey, touchLastUpdated } from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(compression());
app.use(morgan('tiny'));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));
app.use('/admin', express.static(path.join(__dirname, 'public')));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.get('/status', async (req, res) => {
  try {
    const sites = await getActiveSites();
    res.json({ ok: true, activeSites: sites.map(s => s.siteKey), count: sites.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function loadLocalSites() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'configs', 'sites.json'), 'utf-8');
    return JSON.parse(raw).sites || [];
  } catch {
    return [];
  }
}

async function resolveSiteConfig(siteKey) {
  try {
    const site = await getSiteByKey(siteKey);
    if (site?.active) return site;
  } catch {}
  return loadLocalSites().find(s => s.siteKey === siteKey && s.active !== false) || null;
}

async function resolveActiveSites() {
  try {
    const list = await getActiveSites();
    if (list.length) return list;
  } catch {}
  return loadLocalSites().filter(s => s.active !== false);
}

const snapshotCache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

app.get('/snapshot', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing ?url=' });

  const cached = snapshotCache.get(targetUrl);
  if (cached) return res.status(200).send(cached);

  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0', locale: 'nl-NL' });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('body', { timeout: 10000 }).catch(() => {});
    const html = await page.content();
    await browser.close();
    snapshotCache.set(targetUrl, html);
    res.status(200).send(html);
  } catch (err) {
    console.error('[snapshot:error]', err);
    res.status(502).json({ error: 'Snapshot failed', detail: String(err) });
  }
});

const extractCache = new LRUCache({ max: 200, ttl: 2 * 60 * 1000 });

app.post('/extract', async (req, res) => {
  const { url, selectors } = req.body || {};
  if (!url || !selectors?.list) return res.status(400).json({ error: 'url and selectors.list required' });

  const cacheKey = JSON.stringify({ url, selectors });
  const cached = extractCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const snapRes = await fetch(`${req.protocol}://${req.get('host')}/snapshot?url=${encodeURIComponent(url)}`);
    if (!snapRes.ok) return res.status(502).json({ error: 'snapshot_failed', status: snapRes.status });

    const html = await snapRes.text();
    const $ = cheerio.load(html);
    const items = [];

    $(selectors.list).each((_, el) => {
      const $el = $(el);
      const title = $el.find(selectors.title).text().trim();
      const link = new URL($el.find(selectors.link).attr('href') || '', url).toString();
      const dateRaw = $el.find(selectors.date).text().trim();
      const date = new Date(dateRaw).toISOString();
      const summary = $el.find(selectors.summary).text().trim();
      const image = new URL($el.find(selectors.image).attr('src') || '', url).toString();
      if (title && link) items.push({ title, link, date, summary, image });
    });

    const payload = { url, count: items.length, items };
    extractCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('[extract:error]', err);
    res.status(500).json({ error: 'extract_failed', detail: String(err) });
  }
});

app.get('/rss', async (req, res) => {
  const siteKey = req.query.site;
  if (!siteKey) return res.status(400).send('Missing ?site=');

  const cfg = await resolveSiteConfig(siteKey);
  if (!cfg) return res.status(404).send('Unknown site');

  try {
    const extractRes = await fetch(`${req.protocol}://${req.get('host')}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cfg.url, selectors: cfg.selectors }),
    });

    const data = await extractRes.json();
    if (!extractRes.ok) return res.status(502).send(`extract_failed: ${JSON.stringify(data)}`);

    const now = new Date().toUTCString();
    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const itemsXml = (data.items || []).map(it => {
      const pubDate = it.date ? new Date(it.date).toUTCString() : now;
      const enclosure = it.image ? `<enclosure url="${esc(it.image)}" type="image/jpeg" />` : '';
      return `<item><title>${esc(it.title)}</title><link>${esc(it.link)}</link><guid>${esc(it.link)}</guid><pubDate>${pubDate}</pubDate><description>${esc(it.summary)}</description>${enclosure}</item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${cfg.label || siteKey}</title><link>${cfg.url}</link><description>Auto-generated feed</description><lastBuildDate>${now}</lastBuildDate>${itemsXml}</channel></rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.status(200).send(xml);
    await touchLastUpdated(siteKey);
  } catch (err) {
    console.error('[rss:error]', err);
    res.status(500).send('rss_failed');
  }
});

app.get('/sites', async (req, res) => {
  try {
    const sites = await resolveActiveSites();
    res.json({ count: sites.length, sites });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/cron', async (req, res) => {
  const secret = req.query.secret || req.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const sites = await resolveActiveSites();
    await Promise.all(sites.map(site => touchLastUpdated(site.siteKey)));
    res.json({ status: 'ok', processed: sites.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`SlothProxyV2 listening on :${PORT}`));
