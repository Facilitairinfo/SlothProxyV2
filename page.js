// page.js
import playwright from 'playwright';

export async function page(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'missing_url' });

  try {
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: process.env.WAIT_UNTIL || 'domcontentloaded',
      timeout: Number(process.env.NAV_TIMEOUT_MS) || 25000,
    });

    const text = await page.evaluate(() => document.body.innerText);
    await browser.close();

    res.json({ url, text });
  } catch (err) {
    res.status(500).json({ error: 'page_failed', detail: err.message });
  }
}
