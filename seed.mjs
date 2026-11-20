// يعبّي قاعدة البيانات من seed/catalog.json
//   - المتاجر والأقسام والمنتجات: تنضاف أو تتحدث كل مرة (تعدّل الكتالوج من الملف وتشغّل seed)
//   - الأسعار: تنضاف بس للمنتج/المتجر اللي ما له سعر في القاعدة (ما يمسح سجل الأسعار)
// التشغيل: npm run seed

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERE, openDb, recordPrice } from './lib.mjs';

export async function seed(db) {
  const catalog = JSON.parse(readFileSync(join(HERE, 'seed', 'catalog.json'), 'utf8'));
  const count = { stores: 0, categories: 0, products: 0, prices: 0 };

  await db.tx(async (t) => {
    const setMeta = 'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
    await t.run(setMeta, ['currency', catalog.currency || 'ر.س']);
    await t.run(setMeta, ['note', catalog.note || '']);

    for (const [i, s] of catalog.stores.entries()) {
      await t.run(`INSERT INTO stores (id, name, color, website, branch, sort) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, website=excluded.website, branch=excluded.branch, sort=excluded.sort`,
        [s.id, s.name, s.color ?? null, s.website ?? null, s.branch ?? null, i]);
      count.stores++;
    }
    for (const [i, c] of catalog.categories.entries()) {
      await t.run(`INSERT INTO categories (id, name, emoji, shape, pack_type, sort) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, emoji=excluded.emoji, shape=excluded.shape, pack_type=excluded.pack_type, sort=excluded.sort`,
        [c.id, c.name, c.emoji ?? null, c.shape ?? null, c.packType ?? null, i]);
      count.categories++;
    }
    for (const [i, p] of catalog.products.entries()) {
      await t.run(`INSERT INTO products (id, name, category_id, pack_count, pack_size, pack_unit, pack_type, shape, color, tags, sort, active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, category_id=excluded.category_id, pack_count=excluded.pack_count,
          pack_size=excluded.pack_size, pack_unit=excluded.pack_unit, pack_type=excluded.pack_type, shape=excluded.shape,
          color=excluded.color, tags=excluded.tags, sort=excluded.sort, active=1`,
        [p.id, p.name, p.category, p.pack.count ?? 1, p.pack.size ?? null, p.pack.unit,
          p.packType ?? null, p.shape ?? null, p.color ?? null, p.tags ? JSON.stringify(p.tags) : null, i]);
      count.products++;
      for (const [storeId, o] of Object.entries(p.prices || {})) {
        if (await t.get('SELECT 1 AS x FROM prices WHERE product_id = $1 AND store_id = $2 LIMIT 1', [p.id, storeId])) continue;
        await recordPrice(t, { productId: p.id, storeId, price: o.price, old: o.old, inStock: o.inStock,
          checkedAt: o.checked || catalog.updatedAt, source: 'manual' });
        count.prices++;
      }
    }
  });
  console.log(`seeded (${db.kind}): ${count.stores} stores, ${count.categories} categories, ${count.products} products, ${count.prices} new prices`);
  return count;
}

// Run directly: npm run seed
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = await openDb();
  await seed(db);
  await db.close();
}
