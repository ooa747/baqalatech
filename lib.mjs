// Database layer: PostgreSQL when DATABASE_URL is set (hosting), SQLite otherwise (local dev).
// Queries are written once with $1, $2… placeholders; the SQLite driver rewrites them to ?1, ?2…

import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {Promise<{kind, all, get, run, tx, close}>} */
export async function openDb() {
  const db = process.env.DATABASE_URL ? await openPostgres(process.env.DATABASE_URL) : await openSqlite();
  await db.exec(readFileSync(join(HERE, db.kind === 'postgres' ? 'schema.pg.sql' : 'schema.sqlite.sql'), 'utf8'));
  return db;
}

async function openSqlite(path = process.env.DB_PATH || join(HERE, 'data', 'prices.db')) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = resolve(HERE, path);
  mkdirSync(dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  const prep = (sql) => conn.prepare(sql.replace(/\$(\d+)/g, '?$1'));
  const api = {
    kind: 'sqlite',
    async exec(sql) { conn.exec(sql); },
    async all(sql, params = []) { return prep(sql).all(...params); },
    async get(sql, params = []) { return prep(sql).get(...params); },
    async run(sql, params = []) { prep(sql).run(...params); },
    async tx(fn) {
      conn.exec('BEGIN');
      try { const r = await fn(api); conn.exec('COMMIT'); return r; }
      catch (e) { conn.exec('ROLLBACK'); throw e; }
    },
    async close() { conn.close(); },
  };
  return api;
}

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  // sslmode in the URL (or DB_SSL=true) turns on TLS; hosted Postgres often uses a self-signed cert
  const u = new URL(url);
  const sslmode = u.searchParams.get('sslmode');
  u.searchParams.delete('sslmode');
  const ssl = (sslmode && sslmode !== 'disable') || process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString: u.toString(), ssl, max: 5 });

  const wrap = (q) => ({
    kind: 'postgres',
    async exec(sql) { await q.query(sql); },
    async all(sql, params = []) { return (await q.query(sql, params)).rows; },
    async get(sql, params = []) { return (await q.query(sql, params)).rows[0]; },
    async run(sql, params = []) { await q.query(sql, params); },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(wrap(client));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}

/**
 * Save one observed price. Adds a history row only when something changed;
 * otherwise just moves checked_at forward. Returns 'new' | 'changed' | 'same' | 'unknown'.
 */
export async function recordPrice(db, { productId, storeId, price, old, inStock = true, checkedAt, source = 'manual' }) {
  if (!(price > 0)) throw new Error(`invalid price for ${productId}@${storeId}`);
  const known = await db.get('SELECT (SELECT 1 FROM products WHERE id = $1) AS p, (SELECT 1 FROM stores WHERE id = $2) AS s', [productId, storeId]);
  if (!known.p || !known.s) return 'unknown';

  const at = checkedAt || new Date().toISOString();
  const oldPrice = old > price ? old : null;
  const stock = inStock === false ? 0 : 1;
  const latest = await db.get('SELECT * FROM prices WHERE product_id = $1 AND store_id = $2 ORDER BY id DESC LIMIT 1', [productId, storeId]);

  if (latest && latest.price === price && (latest.old_price ?? null) === oldPrice && Number(latest.in_stock) === stock) {
    if (at > latest.checked_at) await db.run('UPDATE prices SET checked_at = $1, source = $2 WHERE id = $3', [at, source, latest.id]);
    return 'same';
  }
  await db.run(`INSERT INTO prices (product_id, store_id, price, old_price, in_stock, source, first_seen, checked_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [productId, storeId, price, oldPrice, stock, source, at, at]);
  return latest ? 'changed' : 'new';
}

export async function countProducts(db) {
  return Number((await db.get('SELECT COUNT(*) AS n FROM products')).n);
}

/** Everything the app needs, in the same shape the app already understands. */
export async function getCatalog(db) {
  const meta = Object.fromEntries((await db.all('SELECT key, value FROM meta')).map((r) => [r.key, r.value]));
  const stores = (await db.all('SELECT id, name, color, website, branch FROM stores ORDER BY sort, id')).map((s) => strip({ ...s }));
  const categories = (await db.all('SELECT id, name, emoji, shape, pack_type AS "packType" FROM categories ORDER BY sort, id'))
    .map((c) => strip({ ...c }));
  const byProduct = new Map();
  let updatedAt = '';
  for (const p of await db.all('SELECT * FROM latest_prices')) {
    if (!byProduct.has(p.product_id)) byProduct.set(p.product_id, {});
    byProduct.get(p.product_id)[p.store_id] = strip({
      price: p.price, old: p.old_price, inStock: Number(p.in_stock) ? undefined : false, checked: p.checked_at,
    });
    if (p.checked_at > updatedAt) updatedAt = p.checked_at;
  }
  const products = (await db.all('SELECT * FROM products WHERE active = 1 ORDER BY sort, id')).map((p) => strip({
    id: p.id, name: p.name, category: p.category_id,
    packType: p.pack_type, shape: p.shape, color: p.color,
    tags: p.tags ? JSON.parse(p.tags) : undefined,
    pack: strip({ count: p.pack_count, size: p.pack_size, unit: p.pack_unit }),
    prices: byProduct.get(p.id) || {},
  }));
  return { updatedAt: updatedAt || meta.updatedAt || null, currency: meta.currency || 'ر.س', note: meta.note || '', stores, categories, products };
}

export async function getHistory(db, productId) {
  const rows = await db.all(`SELECT store_id AS store, price, old_price AS old, in_stock AS "inStock", source,
                                    first_seen AS "firstSeen", checked_at AS "checkedAt"
                             FROM prices WHERE product_id = $1 ORDER BY store_id, id`, [productId]);
  return rows.map((r) => strip({ ...r, inStock: !!Number(r.inStock) }));
}

function strip(o) {
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined) delete o[k];
  return o;
}
