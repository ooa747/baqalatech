-- بقالة تك — قاعدة بيانات الأسعار (SQLite)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  color   TEXT,
  website TEXT,
  branch  TEXT,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  emoji     TEXT,
  shape     TEXT,
  pack_type TEXT,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  pack_count  REAL NOT NULL DEFAULT 1,
  pack_size   REAL,
  pack_unit   TEXT NOT NULL,
  pack_type   TEXT,
  shape       TEXT,
  color       TEXT,
  tags        TEXT,               -- JSON array
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- One row per price *change*. While the price stays the same, checked_at moves forward,
-- so the table doubles as a price history.
CREATE TABLE IF NOT EXISTS prices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  TEXT NOT NULL REFERENCES products(id),
  store_id    TEXT NOT NULL REFERENCES stores(id),
  price       REAL NOT NULL,
  old_price   REAL,               -- price before the offer, if on offer
  in_stock    INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'manual',   -- 'crawler' | 'manual'
  first_seen  TEXT NOT NULL,
  checked_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prices_by_item ON prices(product_id, store_id, id DESC);

CREATE VIEW IF NOT EXISTS latest_prices AS
  SELECT p.* FROM prices p
  WHERE p.id = (SELECT MAX(q.id) FROM prices q WHERE q.product_id = p.product_id AND q.store_id = p.store_id);
