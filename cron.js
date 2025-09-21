// cron.js
import { fetchSites } from './supabase.js';
import { scrapeLatest } from './scraper.js';

/**
 * Cron endpoint: haalt alle sites uit Supabase en ververst hun feeds.
 * Wordt elke uur aangeroepen door GitHub Actions (cron.yml).
 */
export async function cron(req, res) {
  const secret = req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const sites = await fetchSites();
    const results = [];

    for (const site of sites) {
      try {
        const items = await scrapeLatest({ url: site.url, limit: 5 });
        results.push({
          siteKey: site.siteKey,
          url: site.url,
          count: items.length,
          ok: true,
        });
      } catch (err) {
        results.push({
          siteKey: site.siteKey,
          url: site.url,
          ok: false,
          error: err.message,
        });
      }
    }

    res.json({
      updated: new Date().toISOString(),
      total: sites.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: 'cron_failed', detail: err.message });
  }
}
