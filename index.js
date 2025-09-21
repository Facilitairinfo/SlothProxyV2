import express from 'express';
import scraper from './scraper.js';
import feed from './feed.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/status', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now() });
});

app.get('/scrape', async (req, res) => {
  try {
    const result = await scraper();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/feed', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const result = await feed(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server draait op http://localhost:${PORT}`);
});
