// BS2 — vlastní databáze (Postgres v projektu BS2, DATABASE_URL). Nezávislá na HolyOS.
// Schéma se zakládá/doplňuje při startu (idempotentní SQL) — malá app, bez ORM.

const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) console.warn('[bs2] POZOR: DATABASE_URL není nastaven — přidej Postgres službu do projektu BS2.');

const pool = new Pool({
  connectionString: url,
  // SSL jen pro veřejný proxy / explicitní sslmode; interní síť Railway (*.railway.internal) SSL nepodporuje
  ssl: url && /proxy\.rlwy\.net|sslmode=require/.test(url) && !/\.railway\.internal|localhost|127\.0\.0\.1/.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

async function q(text, params) { return pool.query(text, params); }

async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS supporters (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,                 -- vždy lowercase, klíč pro první přihlášení
      first_name    TEXT,
      last_name     TEXT,
      nick          TEXT UNIQUE,                         -- zvolí si při aktivaci (case-insensitive unikát přes index níž)
      password_hash TEXT,                                -- NULL = účet ještě neaktivován
      status        TEXT NOT NULL DEFAULT 'invited',     -- invited | active | blocked
      extra         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- libovolné další sloupce z importu
      source        TEXT,                                -- název souboru importu
      imported_at   TIMESTAMPTZ,
      activated_at  TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS supporters_nick_lower_idx ON supporters (lower(nick)) WHERE nick IS NOT NULL;
    CREATE INDEX IF NOT EXISTS supporters_status_idx ON supporters (status);
    CREATE INDEX IF NOT EXISTS supporters_last_name_idx ON supporters (lower(last_name));

    CREATE TABLE IF NOT EXISTS admin_log (
      id         SERIAL PRIMARY KEY,
      admin_pid  INTEGER,
      admin_name TEXT,
      action     TEXT NOT NULL,
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS products (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      price       NUMERIC(14,2),
      currency    TEXT NOT NULL DEFAULT 'CZK',
      sort        INTEGER NOT NULL DEFAULT 0,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Referenční program: prodejce (user_type=seller) má unikátní ref_code, nově registrovaní přes /join/<code> mají referred_by
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS ref_code TEXT UNIQUE;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES supporters(id) ON DELETE SET NULL;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS phone TEXT;
    CREATE INDEX IF NOT EXISTS supporters_referred_by_idx ON supporters (referred_by);

    -- Typ uživatele: standard = stávající, owner = koupil prádlomat, seller = může prodávat
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'standard';
    CREATE INDEX IF NOT EXISTS supporters_user_type_idx ON supporters (user_type);

    -- Které stroje z ceníku HolyOS nabízíme uživatelům BS2 (přepínač v adminu → záložka Produkty)
    CREATE TABLE IF NOT EXISTS product_offers (
      holyos_item_id INTEGER PRIMARY KEY,
      offered        BOOLEAN NOT NULL DEFAULT false,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Nákupy prádlomatů uživatelů (zadává admin v detailu uživatele); základ záložky Partnerská síť
    CREATE TABLE IF NOT EXISTS purchases (
      id             SERIAL PRIMARY KEY,
      supporter_id   INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      holyos_item_id INTEGER,
      product_name   TEXT NOT NULL,
      price_czk      NUMERIC(14,2),
      purchased_at   DATE NOT NULL DEFAULT CURRENT_DATE,
      note           TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS purchases_supporter_idx ON purchases (supporter_id);
    ALTER TABLE purchases ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ordered';
    ALTER TABLE purchases ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE purchases ADD COLUMN IF NOT EXISTS serial_no TEXT;

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

module.exports = { pool, q, migrate };
