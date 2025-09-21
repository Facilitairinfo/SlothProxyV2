// snapshot.js
import playwright from 'playwright';

export async function snapshot(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'missing_url' });

  try {
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    });

    await page.goto(url, {
      waitUntil: process.env.WAIT_UNTIL || 'networkidle',
      timeout: Number(process.env.NAV_TIMEOUT_MS) || 25000,
    });

    const html = await page.content();
    await browser.close();

    res.type('html').send(html);
  } catch (err) {
    res.status(500).json({ error: 'snapshot_failed', detail: err.message });
  }
}
