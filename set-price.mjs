// إدخال سعر يدوي (للمتاجر اللي ما يقدر الـ crawler يقرأها: كارفور، الدانوب، لولو)
//
//   npm run set-price -- <productId> <storeId> <price> [--old <price>] [--out]
//   مثال:  npm run set-price -- nova-40x330 carrefour 20.99 --old 22.75

import { openDb, recordPrice } from './lib.mjs';

const args = process.argv.slice(2);
const [productId, storeId, priceArg] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--old'));
const oldIdx = args.indexOf('--old');
const price = parseFloat(priceArg);

if (!productId || !storeId || !(price > 0)) {
  console.log('الاستخدام: npm run set-price -- <productId> <storeId> <price> [--old <price>] [--out]');
  process.exit(1);
}

const db = openDb();
const result = recordPrice(db, {
  productId, storeId, price,
  old: oldIdx >= 0 ? parseFloat(args[oldIdx + 1]) : undefined,
  inStock: !args.includes('--out'),
  source: 'manual',
});
if (result === 'unknown') { console.log(`✗ المنتج أو المتجر غير موجود: ${productId} @ ${storeId}`); process.exit(1); }
console.log(`✓ ${productId} @ ${storeId} = ${price} (${result})`);
