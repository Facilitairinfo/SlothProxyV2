// server.js
import express from 'express';
import cors from 'cors';
import { snapshot } from './snapshot.js';
import { search } from './search.js';
import { page } from './page.js';
import { feed } from './feed.js';
import { cron } from './cron.js';
import { fetchSites } from './supabase.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Health/status check
app.get('/status', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Core endpoints
app.get('/snapshot', snapshot);
app.get('/search', search);
app.get('/page', page);
app.get('/feed', feed);

// Supabase: lijst van sites
app.get('/feeds', async (_, res) => {
  try {
    const sites = await fetchSites();
    res.json({ count: sites.length, sites });
  } catch (err) {
    res.status(500).json({ error: 'supabase_error', detail: err.message });
  }
});

// Cron endpoint (aangeroepen door GitHub Actions)
app.post('/cron', cron);

app.listen(PORT, () => {
  console.log(`✅ SlothProxyV2 listening on :${PORT}`);
});
