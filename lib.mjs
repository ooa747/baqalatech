import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));

export function openDb(path = process.env.DB_PATH || join(HERE, 'data', 'prices.db')) {
  const file = resolve(HERE, path);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * Save one observed price. Adds a history row only when something changed;
 * otherwise just moves checked_at forward. Returns 'new' | 'changed' | 'same' | 'unknown'.
 */
export function recordPrice(db, { productId, storeId, price, old, inStock = true, checkedAt, source = 'manual' }) {
  if (!(price > 0)) throw new Error(`invalid price for ${productId}@${storeId}`);
  const known = db.prepare('SELECT (SELECT 1 FROM products WHERE id = ?) AS p, (SELECT 1 FROM stores WHERE id = ?) AS s').get(productId, storeId);
  if (!known.p || !known.s) return 'unknown';

  const at = checkedAt || new Date().toISOString();
  const oldPrice = old > price ? old : null;
  const stock = inStock === false ? 0 : 1;
  const latest = db.prepare('SELECT * FROM prices WHERE product_id = ? AND store_id = ? ORDER BY id DESC LIMIT 1').get(productId, storeId);

  if (latest && latest.price === price && (latest.old_price ?? null) === oldPrice && latest.in_stock === stock) {
    if (at > latest.checked_at) db.prepare('UPDATE prices SET checked_at = ?, source = ? WHERE id = ?').run(at, source, latest.id);
    return 'same';
  }
  db.prepare(`INSERT INTO prices (product_id, store_id, price, old_price, in_stock, source, first_seen, checked_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(productId, storeId, price, oldPrice, stock, source, at, at);
  return latest ? 'changed' : 'new';
}

/** Everything the app needs, in the same shape the app already understands. */
export function getCatalog(db) {
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  const stores = db.prepare('SELECT id, name, color, website, branch FROM stores ORDER BY sort, id').all()
    .map((s) => strip({ ...s }));
  const categories = db.prepare('SELECT id, name, emoji, shape, pack_type AS packType FROM categories ORDER BY sort, id').all()
    .map((c) => strip({ ...c }));
  const latest = db.prepare('SELECT * FROM latest_prices').all();
  const byProduct = new Map();
  let updatedAt = '';
  for (const p of latest) {
    if (!byProduct.has(p.product_id)) byProduct.set(p.product_id, {});
    byProduct.get(p.product_id)[p.store_id] = strip({
      price: p.price, old: p.old_price, inStock: p.in_stock ? undefined : false, checked: p.checked_at,
    });
    if (p.checked_at > updatedAt) updatedAt = p.checked_at;
  }
  const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort, id').all().map((p) => strip({
    id: p.id, name: p.name, category: p.category_id,
    packType: p.pack_type, shape: p.shape, color: p.color,
    tags: p.tags ? JSON.parse(p.tags) : undefined,
    pack: strip({ count: p.pack_count, size: p.pack_size, unit: p.pack_unit }),
    prices: byProduct.get(p.id) || {},
  }));
  return { updatedAt: updatedAt || meta.updatedAt || null, currency: meta.currency || 'ر.س', note: meta.note || '', stores, categories, products };
}

export function getHistory(db, productId) {
  return db.prepare(`SELECT store_id AS store, price, old_price AS old, in_stock AS inStock, source, first_seen AS firstSeen, checked_at AS checkedAt
                     FROM prices WHERE product_id = ? ORDER BY store_id, id`).all(productId)
    .map((r) => strip({ ...r, inStock: !!r.inStock }));
}

function strip(o) {
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined) delete o[k];
  return o;
}
