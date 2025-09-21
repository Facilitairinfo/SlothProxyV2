// cron.js
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import { fetchSites } from './supabase.js';

export async function cron(req, res) {
  const secret = req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const sites = await fetchSites();
    const configPath = path.resolve('./configs/sites.json');
    const configRaw = await fs.readFile(configPath, 'utf-8');
    const selectors = JSON.parse(configRaw);

    const browser = await chromium.launch();
    const results = [];

    for (const site of sites) {
      const url = site.url;
      const selectorSet = selectors[url];
      if (!selectorSet) {
        results.push({ siteKey: site.siteKey, url, ok: false, error: 'No selectors found' });
        continue;
      }

      try {
        const page = await browser.newPage();
        await page.goto(url, { timeout: 25000, waitUntil: 'networkidle' });

        const items = await page.evaluate((selectors) => {
          const extract = (sel) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim());
          const links = Array.from(document.querySelectorAll(selectors.url)).map(el => el.href || el.getAttribute('href'));
          const titles = extract(selectors.title);
          return titles.map((title, i) => ({ title, url: links[i] }));
        }, selectorSet);

        results.push({ siteKey: site.siteKey, url, count: items.length, ok: true });
        await page.close();
      } catch (err) {
        results.push({ siteKey: site.siteKey, url, ok: false, error: err.message });
      }
    }

    await browser.close();
    res.json({ updated: new Date().toISOString(), total: sites.length, results });
  } catch (err) {
    res.status(500).json({ error: 'cron_failed', detail: err.message });
  }
}
