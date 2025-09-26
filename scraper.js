// scraper.js
import fs from 'fs';
import { chromium } from 'playwright';
import jsdom from 'jsdom';

export async function scrapeLatest() {
  const sites = JSON.parse(fs.readFileSync('./configs/sites.json', 'utf-8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];

  for (const [url, selectors] of Object.entries(sites)) {
    try {
      await page.goto(url, {
        waitUntil: process.env.WAIT_UNTIL || 'networkidle',
        timeout: Number(process.env.NAV_TIMEOUT_MS) || 25000,
      });

      const html = await page.content();
      const dom = new jsdom.JSDOM(html);

      const titleNodes = dom.window.document.querySelectorAll(selectors.title);
      const urlNodes = dom.window.document.querySelectorAll(selectors.url);

      for (let i = 0; i < Math.min(titleNodes.length, urlNodes.length); i++) {
        results.push({
          source: url,
          title: titleNodes[i].textContent.trim(),
          url: urlNodes[i].getAttribute('href'),
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error(`❌ Fout bij ${url}: ${err.message}`);
    }
  }

  await browser.close();
  return results;
}
