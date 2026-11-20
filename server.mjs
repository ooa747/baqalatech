// خدمة قاعدة بيانات الأسعار — SQLite + HTTP API بدون أي مكتبات خارجية
//
//   GET  /api/health                    فحص الخدمة
//   GET  /api/catalog                   المتاجر والأقسام والمنتجات مع آخر سعر (للتطبيق)
//   GET  /api/products/:id/history      سجل تغيّر أسعار منتج
//   POST /api/prices                    إضافة أسعار (للـ crawler) — يحتاج  Authorization: Bearer <API_TOKEN>
//
// الإعدادات (من db/.env): PORT, API_TOKEN, CORS_ORIGIN, DB_PATH

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { openDb, getCatalog, getHistory, recordPrice, transaction } from './lib.mjs';

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.API_TOKEN || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY = 1024 * 1024;

const db = openDb();

// First start on a fresh disk (e.g. a new hosting volume): fill it from seed/catalog.json
if (!db.prepare('SELECT COUNT(*) AS n FROM products').get().n) {
  console.log('empty database — seeding from seed/catalog.json');
  await import('./seed.mjs');
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function authorized(req) {
  if (!TOKEN) return false; // writing is disabled until a token is configured
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (req.method === 'OPTIONS') return send(res, 204);

    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true });

    if (req.method === 'GET' && path === '/api/catalog') return send(res, 200, getCatalog(db));

    const hist = path.match(/^\/api\/products\/([\w.-]+)\/history$/);
    if (req.method === 'GET' && hist) return send(res, 200, getHistory(db, hist[1]));

    if (req.method === 'POST' && path === '/api/prices') {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      const body = await readJson(req);
      const list = Array.isArray(body.prices) ? body.prices : [];
      const source = body.source === 'crawler' ? 'crawler' : 'manual';
      const result = { new: 0, changed: 0, same: 0, unknown: [] };
      transaction(db, () => {
        for (const p of list) {
          const r = recordPrice(db, { ...p, source });
          if (r === 'unknown') result.unknown.push(`${p.productId}@${p.storeId}`); else result[r]++;
        }
      });
      return send(res, 200, result);
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, err.status || 500, { error: err.status ? err.message : 'server error' });
    if (!err.status) console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`prices API on http://localhost:${PORT}  (writes ${TOKEN ? 'enabled' : 'DISABLED — set API_TOKEN'})`);
});
