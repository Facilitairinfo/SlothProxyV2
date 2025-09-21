// search.js
import playwright from 'playwright';

export async function search(req, res) {
  const url = req.query.url;
  const q = req.query.q;
  if (!url || !q) return res.status(400).json({ error: 'missing_url_or_query' });

  try {
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: process.env.WAIT_UNTIL || 'domcontentloaded',
      timeout: Number(process.env.NAV_TIMEOUT_MS) || 25000,
    });

    const matches = await page.evaluate(query => {
      const bodyText = document.body.innerText;
      const regex = new RegExp(query, 'gi');
      const found = [];
      let match;
      while ((match = regex.exec(bodyText)) !== null) {
        found.push({ index: match.index, match: match[0] });
      }
      return found;
    }, q);

    await browser.close();
    res.json({ url, query: q, matches });
  } catch (err) {
    res.status(500).json({ error: 'search_failed', detail: err.message });
  }
}
