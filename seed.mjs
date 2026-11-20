// يعبّي قاعدة البيانات من seed/catalog.json
//   - المتاجر والأقسام والمنتجات: تنضاف أو تتحدث كل مرة (تعدّل الكتالوج من الملف وتشغّل seed)
//   - الأسعار: تنضاف بس للمنتج/المتجر اللي ما له سعر في القاعدة (ما يمسح سجل الأسعار)
// التشغيل: npm run seed

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, openDb, recordPrice, transaction } from './lib.mjs';

const catalog = JSON.parse(readFileSync(join(HERE, 'seed', 'catalog.json'), 'utf8'));
const db = openDb();
const count = { stores: 0, categories: 0, products: 0, prices: 0 };

transaction(db, () => {
  const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  setMeta.run('currency', catalog.currency || 'ر.س');
  setMeta.run('note', catalog.note || '');

  const st = db.prepare(`INSERT INTO stores (id, name, color, website, branch, sort) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, website=excluded.website, branch=excluded.branch, sort=excluded.sort`);
  catalog.stores.forEach((s, i) => { st.run(s.id, s.name, s.color ?? null, s.website ?? null, s.branch ?? null, i); count.stores++; });

  const ct = db.prepare(`INSERT INTO categories (id, name, emoji, shape, pack_type, sort) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, shape=excluded.shape, pack_type=excluded.pack_type, sort=excluded.sort`);
  catalog.categories.forEach((c, i) => { ct.run(c.id, c.name, c.emoji ?? null, c.shape ?? null, c.packType ?? null, i); count.categories++; });

  const pr = db.prepare(`INSERT INTO products (id, name, category_id, pack_count, pack_size, pack_unit, pack_type, shape, color, tags, sort, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, category_id=excluded.category_id, pack_count=excluded.pack_count,
      pack_size=excluded.pack_size, pack_unit=excluded.pack_unit, pack_type=excluded.pack_type, shape=excluded.shape,
      color=excluded.color, tags=excluded.tags, sort=excluded.sort, active=1`);
  const hasPrice = db.prepare('SELECT 1 FROM prices WHERE product_id = ? AND store_id = ? LIMIT 1');

  catalog.products.forEach((p, i) => {
    pr.run(p.id, p.name, p.category, p.pack.count ?? 1, p.pack.size ?? null, p.pack.unit,
      p.packType ?? null, p.shape ?? null, p.color ?? null, p.tags ? JSON.stringify(p.tags) : null, i);
    count.products++;
    for (const [storeId, o] of Object.entries(p.prices || {})) {
      if (hasPrice.get(p.id, storeId)) continue;
      recordPrice(db, { productId: p.id, storeId, price: o.price, old: o.old, inStock: o.inStock,
        checkedAt: o.checked || catalog.updatedAt, source: 'manual' });
      count.prices++;
    }
  });
});

console.log(`seeded: ${count.stores} stores, ${count.categories} categories, ${count.products} products, ${count.prices} new prices`);
