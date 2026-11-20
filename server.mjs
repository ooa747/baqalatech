// خدمة قاعدة بيانات الأسعار — PostgreSQL (أو SQLite محلياً) + HTTP API
//
//   GET  /api/health                    فحص الخدمة
//   GET  /api/catalog                   المتاجر والأقسام والمنتجات مع آخر سعر (للتطبيق)
//   GET  /api/products/:id/history      سجل تغيّر أسعار منتج
//   POST /api/prices                    إضافة أسعار (للـ crawler) — يحتاج  Authorization: Bearer <API_TOKEN>
//
// الإعدادات (من db/.env): PORT, API_TOKEN, CORS_ORIGIN
//   DATABASE_URL موجود → PostgreSQL (الاستضافة).  غير موجود → SQLite في DB_PATH (للتطوير على الجهاز)

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { openDb, getCatalog, getHistory, recordPrice, setImage, getImage, deleteImage } from './lib.mjs';
import { seed } from './seed.mjs';

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.API_TOKEN || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY = 1024 * 1024;

const db = await openDb();

// Sync stores/categories/products from seed/catalog.json on every start, so a deploy with an edited
// catalog adds the new products. Safe to repeat: existing prices, history and images are left alone.
await seed(db);

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

    if (req.method === 'GET' && path === '/api/catalog') return send(res, 200, await getCatalog(db));

    const hist = path.match(/^\/api\/products\/([\w.-]+)\/history$/);
    if (req.method === 'GET' && hist) return send(res, 200, await getHistory(db, hist[1]));

    const img = path.match(/^\/api\/products\/([\w.-]+)\/image$/);
    if (img && req.method === 'GET') {
      const image = await getImage(db, img[1]);
      if (!image) return send(res, 404, { error: 'no image' });
      res.writeHead(200, {
        'Content-Type': image.type,
        'Content-Length': image.body.length,
        'Cache-Control': 'public, max-age=31536000, immutable', // URL carries ?v=<version>
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      });
      return res.end(image.body);
    }
    if (img && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'DELETE') { await deleteImage(db, img[1]); return send(res, 200, { ok: true }); }
      const r = await setImage(db, img[1], (await readJson(req)).image);
      if (!r.ok) return send(res, 400, { error: r.error });
      return send(res, 200, { ok: true, image: `/api/products/${encodeURIComponent(img[1])}/image?v=${r.ver}` });
    }

    if (req.method === 'POST' && path === '/api/prices') {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      const body = await readJson(req);
      const list = Array.isArray(body.prices) ? body.prices : [];
      const source = body.source === 'crawler' ? 'crawler' : 'manual';
      const result = { new: 0, changed: 0, same: 0, unknown: [] };
      await db.tx(async (t) => {
        for (const p of list) {
          const r = await recordPrice(t, { ...p, source });
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
  console.log(`prices API on http://localhost:${PORT}  (${db.kind}, writes ${TOKEN ? 'enabled' : 'DISABLED — set API_TOKEN'})`);
});
