// server.js
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { LRUCache } from 'lru-cache';
import { getActiveSites } from './supabase.js';

if (process.env.NODE_ENV !== 'production') {
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
  } catch {}
}

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(morgan('tiny'));
app.use(cors({ origin: '*', methods: ['GET', 'OPTIONS'] }));
app.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'SlothProxyV2',
    endpoints: ['/health', '/status', '/snapshot?url=...'],
    t: Date.now()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, t: Date.now() });
});

app.get('/status', async (req, res) => {
  try {
    const sites = await getActiveSites();
    console.log('[status] Supabase returned:', JSON.stringify(sites, null, 2));

    const statusList = (sites || []).map(s => ({
      siteKey: s.siteKey,
      label: s.label || s.siteData?.meta?.label || s.siteKey,
      url: s.url,
      active: true,
      lastUpdated: s.lastUpdated || null
    }));

    res.status(200).json({
      ok: true,
      count: statusList.length,
      updated: new Date().toISOString(),
      sites: statusList
    });
  } catch (err) {
    console.error('[status:error]', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    res.status(500).json({
      ok: false,
      error: 'status_failed',
      detail: JSON.stringify(err, Object.getOwnPropertyNames(err))
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'not_found',
    path: req.path,
    hint: 'Probeer /health, /status of /snapshot?url=...'
  });
});

app.use((err, req, res, next) => {
  console.error('[global:error]', err);
  res.status(500).json({
    ok: false,
    error: 'internal_error',
    detail: String(err)
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ SlothProxyV2 is actief op poort ${PORT}`);
});
