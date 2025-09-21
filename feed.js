// feed.js
import { snapshot } from './snapshot.js';
import { JSDOM } from 'jsdom';

/**
 * Genereer een feed van de laatste 5 nieuwsitems.
 * Vereist dat de site in Supabase of config bekend is.
 */
export async function feed(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'missing_url' });

  try {
    // Gebruik snapshot om HTML op te halen
    const fakeRes = {
      type: () => fakeRes,
      send: html => (fakeRes.html = html),
      status: () => fakeRes,
      json: obj => (fakeRes.html = JSON.stringify(obj)),
    };
    await snapshot({ query: { url } }, fakeRes);

    if (!fakeRes.html) throw new Error('no_html_returned');

    const dom = new JSDOM(fakeRes.html);
    const doc = dom.window.document;

    // Generieke selectors (pas aan per site in config)
    const articles = [...doc.querySelectorAll('article, .news-item, .post')].slice(0, 5);

    const items = articles.map(a => ({
      title: a.querySelector('h1,h2,h3')?.textContent?.trim() || '',
      date: a.querySelector('time')?.getAttribute('datetime') || a.querySelector('.date')?.textContent?.trim() || '',
      summary: a.querySelector('p')?.textContent?.trim() || '',
      image: a.querySelector('img')?.src || '',
      url: a.querySelector('a')?.href || url,
    }));

    res.json({ source: url, updated: new Date().toISOString(), items });
  } catch (err) {
    res.status(500).json({ error: 'feed_failed', detail: err.message });
  }
}
