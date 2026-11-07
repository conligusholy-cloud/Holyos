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
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS totp_secret TEXT;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS totp_backup JSONB;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS pw_changed_at TIMESTAMPTZ;
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

    -- Discount Credit: kreditní účet uživatele (kladné = připsáno, záporné = čerpáno); zadává admin
    CREATE TABLE IF NOT EXISTS credits (
      id           SERIAL PRIMARY KEY,
      supporter_id INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      amount_czk   NUMERIC(14,2) NOT NULL,
      note         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS credits_supporter_idx ON credits (supporter_id);
    ALTER TABLE credits ADD COLUMN IF NOT EXISTS purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE;
    -- Discount Credit v %: kolik % z ceny s DPH získá prodejce, když prodá tento typ stroje
    -- Minimální prodejní cena bez DPH (nejnižší, za kterou lze stroj prodat); DC sleva pod ni nejde
    ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS min_price_czk NUMERIC(14,2);
    ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS min_price_eur NUMERIC(14,2);
    -- Kolik % z ceny s DPH lze uhradit pomocí DC (NULL = bez omezení, jen minimální cena)
    ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS dc_use_pct NUMERIC(5,2);
    ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS credit_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

    -- Zobrazovací měna uživatele (CZK / EUR) na stránkách Prádlomaty a Discount Credit
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CZK';
    -- Tester: vidí funkce ve vývoji (např. záložku Výběry)
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS vybery_tester BOOLEAN NOT NULL DEFAULT false;
    -- Výběry: žádosti o výběr (status: requested = čeká na výplatu, paid = vyplaceno, rejected = zamítnuto)
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id            SERIAL PRIMARY KEY,
      supporter_id  INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      currency      TEXT NOT NULL DEFAULT 'CZK',
      note          TEXT,
      status        TEXT NOT NULL DEFAULT 'requested',
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at       TIMESTAMPTZ,
      paid_by       TEXT,
      paid_amount   NUMERIC(14,2),
      pay_method    TEXT,
      pay_note      TEXT,
      reject_reason TEXT,
      decided_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx ON withdrawal_requests (status, requested_at);
    CREATE INDEX IF NOT EXISTS withdrawal_requests_supporter_idx ON withdrawal_requests (supporter_id);
    -- Ruční hodnoty ST/EX podpory (ov_ex, ov_st, ov_cur, ov_rate v partner_support): trigger je po každém uložení promítne do std_* polí,
    -- takže je nepřepíše žádné další načtení ze starého portálu a všechny součty/exporty je používají.
    CREATE OR REPLACE FUNCTION bs2_apply_support_override() RETURNS trigger AS $$
    DECLARE p jsonb := NEW.partner_support; cur text; rate numeric; ex numeric; st numeric;
    BEGIN
      IF p IS NULL OR (p->>'ov_ex' IS NULL AND p->>'ov_st' IS NULL AND p->>'ov_pos' IS NULL) THEN RETURN NEW; END IF;
      IF p->>'ov_pos' IS NOT NULL THEN p := p || jsonb_build_object('position', p->>'ov_pos'); END IF;
      IF p->>'ov_ex' IS NULL AND p->>'ov_st' IS NULL THEN NEW.partner_support := p; RETURN NEW; END IF;
      cur := coalesce(p->>'ov_cur', p->>'std_currency', 'CZK');
      rate := CASE WHEN cur = 'EUR' THEN coalesce(NULLIF(p->>'ov_rate','')::numeric, NULLIF(p->>'std_eur_rate','')::numeric, 1) ELSE 1 END;
      p := p || jsonb_build_object('std_currency', cur, 'std_mixed', false);
      IF p->>'ov_ex' IS NOT NULL THEN ex := (p->>'ov_ex')::numeric; p := p || jsonb_build_object('std_expanze_all', ex, 'std_expanze_czk', round(ex * rate, 2)); END IF;
      IF p->>'ov_st' IS NOT NULL THEN st := (p->>'ov_st')::numeric; p := p || jsonb_build_object('std_total', st, 'std_total_czk', round(st * rate, 2)); END IF;
      NEW.partner_support := p;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS bs2_support_override_trg ON supporters;
    CREATE TRIGGER bs2_support_override_trg BEFORE INSERT OR UPDATE OF partner_support ON supporters FOR EACH ROW EXECUTE FUNCTION bs2_apply_support_override();

    -- Výplata za měsíc: ručně zadané údaje za období (period = měsíc, za který se vyplácí, např. 2026-10 se vyplácí 7. 11. 2026)
    CREATE TABLE IF NOT EXISTS vybery_periods (
      period      TEXT PRIMARY KEY,
      avg_visits  NUMERIC(8,2),
      note        TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by  TEXT
    );
    -- (Standardní podpora = palety + opakovačky + balíčky se počítá při načtení ze starého portálu; zpětný přepočet v DB už není)

    -- Objednávky z Prádlomatů (Koupit): admin potvrdí → vznikne nákup + provize; zrušením se vrátí uplatněné DC
    CREATE TABLE IF NOT EXISTS orders (
      id             SERIAL PRIMARY KEY,
      supporter_id   INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      holyos_item_id INTEGER,
      product_name   TEXT NOT NULL,
      currency       TEXT NOT NULL DEFAULT 'CZK',
      price_net      NUMERIC(14,2) NOT NULL,
      dc_used        NUMERIC(14,2) NOT NULL DEFAULT 0,
      final_net      NUMERIC(14,2) NOT NULL,
      status         TEXT NOT NULL DEFAULT 'new',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at     TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS orders_supporter_idx ON orders (supporter_id);
    ALTER TABLE credits ADD COLUMN IF NOT EXISTS order_id INTEGER;
    -- Převody podpory ze starého systému: žádost uživatele → admin ručně ověří a zpracuje (schválí = připíše DC)
    CREATE TABLE IF NOT EXISTS support_transfers (
      id            SERIAL PRIMARY KEY,
      supporter_id  INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      amount        NUMERIC(14,2) NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'CZK',
      rate          NUMERIC(12,4) NOT NULL DEFAULT 1,
      dc_amount     NUMERIC(14,2) NOT NULL,
      note          TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      admin_note    TEXT,
      credit_id     INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at  TIMESTAMPTZ,
      processed_by  TEXT
    );
    ALTER TABLE support_transfers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'dc'; -- dc = převod na Discount Credit, payout = výběr (vyplacení)
    -- Evidence všech pohybů žádosti (vytvoření, úprava částky, schválení / vyplacení, zamítnutí)
    CREATE TABLE IF NOT EXISTS support_transfer_events (
      id          SERIAL PRIMARY KEY,
      transfer_id INTEGER NOT NULL REFERENCES support_transfers(id) ON DELETE CASCADE,
      event       TEXT NOT NULL,
      actor       TEXT,
      detail      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS support_transfer_events_tid_idx ON support_transfer_events (transfer_id);
    CREATE INDEX IF NOT EXISTS support_transfers_supporter_idx ON support_transfers (supporter_id);
    CREATE INDEX IF NOT EXISTS support_transfers_status_idx ON support_transfers (status);
    -- Služby (Najít místo, Přípojky): kind='service', service_key; cena 0 = čeká na individuální nacenění
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'machine';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_key TEXT;

    -- Statistiky chování uživatelů (přihlášení, zobrazení stránek, kliknutí, čas, scroll, čtené sekce, interakce)
    CREATE TABLE IF NOT EXISTS user_events (
      id BIGSERIAL PRIMARY KEY, supporter_id INT REFERENCES supporters(id) ON DELETE CASCADE, sid TEXT, type TEXT NOT NULL,
      path TEXT, label TEXT, meta JSONB, ip TEXT, ua TEXT, device TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS user_events_created_idx ON user_events (created_at);
    CREATE INDEX IF NOT EXISTS user_events_sup_idx ON user_events (supporter_id, created_at);
    CREATE INDEX IF NOT EXISTS user_events_type_idx ON user_events (type, created_at);
    -- Doklady (faktury z HolyOS), které už uživatel v aplikaci viděl — pro zelenou tečku „nové"
    CREATE TABLE IF NOT EXISTS doc_seen (supporter_id INT NOT NULL REFERENCES supporters(id) ON DELETE CASCADE, invoice_id INT NOT NULL, seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (supporter_id, invoice_id));
    -- Evidence odeslaných e-mailů ze systému (součást časové osy aktivity uživatele)
    CREATE TABLE IF NOT EXISTS mail_log (
      id SERIAL PRIMARY KEY, supporter_id INT REFERENCES supporters(id) ON DELETE SET NULL, to_email TEXT NOT NULL, subject TEXT,
      status TEXT NOT NULL DEFAULT 'sent', error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mail_log_sup_idx ON mail_log (supporter_id, created_at);
    CREATE INDEX IF NOT EXISTS mail_log_email_idx ON mail_log (lower(to_email));
    -- Podněty uživatelů na vylepšení aplikace
    CREATE TABLE IF NOT EXISTS suggestions (
      id SERIAL PRIMARY KEY, supporter_id INT REFERENCES supporters(id) ON DELETE SET NULL, body TEXT NOT NULL, page TEXT, device TEXT,
      status TEXT NOT NULL DEFAULT 'new', admin_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), handled_at TIMESTAMPTZ, handled_by TEXT
    );
    CREATE INDEX IF NOT EXISTS suggestions_status_idx ON suggestions (status, created_at);
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY, supporter_id INT NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS password_resets_sup_idx ON password_resets(supporter_id, created_at);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS vop_consent_at TIMESTAMPTZ; -- kdy uživatel odsouhlasil VOP
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS gdpr_consent_at TIMESTAMPTZ;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0; -- zamykání účtu po opakovaných neúspěších
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS totp_secret TEXT; -- (nepoužito pro uživatele; 2FA správců je v app_settings) -- kdy uživatel odsouhlasil zpracování osobních údajů
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    -- Živá podpora: jeden vláknový chat na užívatele (supporter_id), zprávy od uživatele / od podpory
    CREATE TABLE IF NOT EXISTS support_messages (
      id           SERIAL PRIMARY KEY,
      supporter_id INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      sender       TEXT NOT NULL,              -- 'user' | 'agent'
      agent_name   TEXT,
      body         TEXT NOT NULL,
      read_by_agent BOOLEAN NOT NULL DEFAULT false,
      read_by_user  BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS support_messages_sup_idx ON support_messages (supporter_id, created_at);
    -- Přílohy ke zprávám podpory (screenshot / soubor), uložené přímo v DB (max 10 MB)
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_name TEXT;
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_type TEXT;
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_size INTEGER;
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS file_data BYTEA;
    -- Zpráva z administrace vázaná na objednávku (tlačítko Chat v Objednávkách)
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS order_id INTEGER;
    -- Prověření lokality (/location): objednávky balíčků placené přes Stripe
    CREATE TABLE IF NOT EXISTS location_orders (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL,
      phone         TEXT,
      company       TEXT,
      package       TEXT NOT NULL,              -- basic | plus | premium
      amount_czk    INTEGER NOT NULL,           -- s DPH
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | request | paid | granted | canceled | refunded
      consent       BOOLEAN NOT NULL DEFAULT false,
      marketing     BOOLEAN NOT NULL DEFAULT false,
      stripe_session        TEXT,
      stripe_payment_intent TEXT,
      paid_at       TIMESTAMPTZ,
      access_granted_at TIMESTAMPTZ,
      note          TEXT,
      ip            TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS location_orders_status_idx ON location_orders (status, created_at);
    -- Aréna (/arena): výsledky kvízu – jméno/přezdívka, skóre, virtuální kapitál, odpovědi
    CREATE TABLE IF NOT EXISTS arena_runs (
      id          SERIAL PRIMARY KEY,
      sid         TEXT,
      name        TEXT NOT NULL,
      score       INT NOT NULL DEFAULT 0,
      bank        INT NOT NULL DEFAULT 0,
      answers     JSONB,
      ms          INT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS arena_runs_created_idx ON arena_runs (created_at);
    -- Aréna: vyhrané slevové kupony (po vyplnění kontaktu)
    CREATE TABLE IF NOT EXISTS arena_coupons (
      id          SERIAL PRIMARY KEY,
      sid         TEXT,
      round       BIGINT,
      name        TEXT NOT NULL,
      pct         INT NOT NULL,
      code        TEXT NOT NULL UNIQUE,
      email       TEXT,
      phone       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS arena_coupons_created_idx ON arena_coupons (created_at);
    -- Chování návštěvníků na veřejných záchytných stránkách (anonymní sid): scroll, sekce, čas na sekci, kliky, pohyb myši, odchod
    CREATE TABLE IF NOT EXISTS page_events (
      id          BIGSERIAL PRIMARY KEY,
      sid         TEXT NOT NULL,
      path        TEXT NOT NULL,
      kind        TEXT NOT NULL,             -- view | scroll | section | dwell | click | mouse | time | exit | custom
      label       TEXT,
      meta        JSONB,
      t_ms        INTEGER,                   -- čas od načtení stránky
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS page_events_path_created_idx ON page_events (path, created_at);
    CREATE INDEX IF NOT EXISTS page_events_sid_idx ON page_events (sid);
    -- Leady z veřejných stránek (schůzka z /cesta, online objednávka…): kdo, odkud přišel (první dotyk) a všechny jeho návštěvy (sid → page_events)
    CREATE TABLE IF NOT EXISTS leads (
      id           SERIAL PRIMARY KEY,
      kind         TEXT NOT NULL,               -- meeting | order | interest
      ref_id       INTEGER,                     -- id rezervace (HolyOS) / objednávky (location_orders)
      supporter_id INTEGER REFERENCES supporters(id) ON DELETE SET NULL,
      name         TEXT,
      email        TEXT,
      phone        TEXT,
      source       JSONB,                       -- utm_*, fbclid/gclid, ref, landing, ft
      landing      TEXT,
      sids         TEXT[] NOT NULL DEFAULT '{}',
      detail       JSONB,                       -- termín, forma, balíček…
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at);
    CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (lower(email));
    CREATE INDEX IF NOT EXISTS leads_sids_idx ON leads USING GIN (sids);
    CREATE UNIQUE INDEX IF NOT EXISTS location_orders_session_idx ON location_orders (stripe_session) WHERE stripe_session IS NOT NULL;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS supporter_id INTEGER REFERENCES supporters(id) ON DELETE SET NULL;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS sid TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS product TEXT; -- z které záchytné stránky přišla objednávka: 'finder' = /findlocation, jinak /location
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS utm_source TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS utm_medium TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS utm_content TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS utm_term TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS ad_id TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS click_id TEXT; -- fbclid / gclid (první dotyk)
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS terms_version TEXT; -- verze obchodních podmínek odsouhlasená před platbou
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS survey_date TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS survey_tech TEXT;
    ALTER TABLE location_orders ADD COLUMN IF NOT EXISTS survey_report TEXT;
    -- Účet zákazníka aplikace Prověření lokality (user_type='location'): balíček + platnost
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS location_package TEXT;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS partner_support JSONB; -- podpora ze starého partnerského portálu (celkem, rok, palety, expanze, NeuraWash, opakovačky, obrat sítě)
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS location_expires_at TIMESTAMPTZ;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS location_extra_evals INTEGER NOT NULL DEFAULT 0; -- dokoupená vyhodnocení navíc
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS location_extra_searches INTEGER NOT NULL DEFAULT 0; -- dokoupená vyhledání (Vyhledávač míst)
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS location_finder_only BOOLEAN NOT NULL DEFAULT false; -- balíček jen z /findlocation: bez vyhodnocení adres v ceně (jen dokoupená)
    -- Vyhledávač míst: každé nové město odečte 1 vyhledání; opakované hledání stejného města je zdarma
    CREATE TABLE IF NOT EXISTS location_searches (
      id           SERIAL PRIMARY KEY,
      supporter_id INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      area_norm    TEXT NOT NULL,
      area         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (supporter_id, area_norm)
    );
    ALTER TABLE location_searches ADD COLUMN IF NOT EXISTS result JSONB;     -- uložená analýza spádové oblasti
    ALTER TABLE location_searches ADD COLUMN IF NOT EXISTS candidates JSONB; -- uložená místa, kde by prádlomat mohl stát
    ALTER TABLE location_searches ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '{}'::jsonb; -- dohledané kontakty (klíč = GPS)
    ALTER TABLE location_searches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE location_searches ADD COLUMN IF NOT EXISTS label TEXT; -- čitelný název (u špendlíku v mapě = reverzně geokódovaná adresa)
    -- Návštěvy veřejných stránek (anonymní): unikátní prohlížeč (sid) za den a cestu – pro Centrum reklamy v HolyOS
    CREATE TABLE IF NOT EXISTS page_hits (d DATE NOT NULL, path TEXT NOT NULL, sid TEXT NOT NULL, PRIMARY KEY (d, path, sid));
    -- Záchytné stránky zveřejněné z HolyOS (AI ředitel → „Zveřejnit na odkaz“), servírované na /lp/<slug>
    CREATE TABLE IF NOT EXISTS landing_pages (slug TEXT PRIMARY KEY, title TEXT, html TEXT NOT NULL, published BOOLEAN NOT NULL DEFAULT true, source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS page_hits_path_idx ON page_hits (path, d);
    -- Lokality zákazníka (vstupy formuláře + poslední výpočet a vyhodnocení)
    CREATE TABLE IF NOT EXISTS location_sites (
      id           SERIAL PRIMARY KEY,
      supporter_id INTEGER NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      address      TEXT,
      city         TEXT,
      data         JSONB NOT NULL DEFAULT '{}'::jsonb,
      calc         JSONB,
      result       JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS location_sites_sup_idx ON location_sites (supporter_id, created_at);
    ALTER TABLE location_sites ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;
    ALTER TABLE location_sites ADD COLUMN IF NOT EXISTS study JSONB; -- AI studie lokality
    ALTER TABLE location_sites ADD COLUMN IF NOT EXISTS study_at TIMESTAMPTZ; -- první vyhodnocení = odečet lokality z balíčku
    ALTER TABLE location_sites ADD COLUMN IF NOT EXISTS study_status TEXT; -- running | done | error (studie běží na pozadí)
    ALTER TABLE location_sites ADD COLUMN IF NOT EXISTS study_error TEXT;
    -- Screenshot Přehledu podpory ze starého portálu (vizuální důkaz, nezávisle na partner_support textovém syncu)
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS support_snapshot BYTEA;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS support_snapshot_at TIMESTAMPTZ;
    -- Přenos všech dat ze starého portálu: poslední stav každé stránky (oblasti) u uživatele
    CREATE TABLE IF NOT EXISTS legacy_snapshots (
      supporter_id INT NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      section      TEXT NOT NULL,
      data         JSONB NOT NULL,
      fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (supporter_id, section)
    );
    -- Hromadné e-maily (Rozesílky): vyřazení uživatele + kampaně + fronta příjemců
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mail_optout BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mail_optout_at TIMESTAMPTZ;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mail_optout_by TEXT; -- 'user' (odkaz v e-mailu) | jméno správce
    -- Bankovní účet pro výplaty (uložený u uživatele): CZK = číslo účtu/kód banky, EUR = IBAN
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS payout_account TEXT;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS payout_iban TEXT;
    -- Žádost o výběr: účet, na který se platí, a variabilní symbol (identifikátor platby v databázi výplat)
    ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS account TEXT;
    ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS vs TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_vs_uq ON withdrawal_requests (vs) WHERE vs IS NOT NULL;
    -- Krizový režim výplat: podíl k výplatě v % (NULL = výchozí 30 %), zbytek jde na vyrovnávací účet
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS payout_pct NUMERIC(5,2);
    -- Vyrovnávací účet: pohyby (připsání 70 %, zhodnocení 5,68 % p.a., ruční vklad/výběr)
    CREATE TABLE IF NOT EXISTS balance_entries (
      id SERIAL PRIMARY KEY,
      supporter_id INT NOT NULL REFERENCES supporters(id) ON DELETE CASCADE,
      period TEXT,                       -- 'RRRR-MM' (za jaký měsíc), u ručních pohybů může být NULL
      kind TEXT NOT NULL,                -- credit | interest | deposit | withdraw
      amount NUMERIC(14,2) NOT NULL,     -- + připsáno, − vybráno
      currency TEXT NOT NULL DEFAULT 'CZK',
      note TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS balance_entries_sup_idx ON balance_entries (supporter_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS balance_entries_auto_uq ON balance_entries (supporter_id, period, kind) WHERE kind IN ('credit','interest');
    CREATE TABLE IF NOT EXISTS mail_campaigns (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      link TEXT, link_label TEXT, filter JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft', -- draft | sending | paused | done | canceled
      total INT NOT NULL DEFAULT 0, sent INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0,
      created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS mail_campaign_recipients (
      id SERIAL PRIMARY KEY, campaign_id INT NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,
      supporter_id INT REFERENCES supporters(id) ON DELETE SET NULL, email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed | skipped
      error TEXT, sent_at TIMESTAMPTZ, UNIQUE (campaign_id, email)
    );
    CREATE INDEX IF NOT EXISTS mail_rcpt_queue_idx ON mail_campaign_recipients (campaign_id, status, id);
    ALTER TABLE mail_campaigns ADD COLUMN IF NOT EXISTS sender TEXT; -- odesílací adresa (Amazon SES)
    CREATE TABLE IF NOT EXISTS mail_campaign_files (
      id SERIAL PRIMARY KEY, campaign_id INT NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, content_type TEXT, size INT NOT NULL DEFAULT 0, data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mail_campaign_files_c_idx ON mail_campaign_files (campaign_id);
    -- Kontrola údajů před prvním výběrem: co uživatel opsal ze starého portálu + výsledek porovnání
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_palety_czk NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_palety_eur NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_expanze_czk NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_expanze_eur NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_balicky_czk NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_balicky_eur NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_opakovacky_czk NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_opakovacky_eur NUMERIC(14,2);
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_position TEXT;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_at TIMESTAMPTZ;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_status TEXT; -- ok | mismatch | reviewed (NULL = nevyplněno)
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_diff JSONB;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_reviewed_by TEXT;
    ALTER TABLE supporters ADD COLUMN IF NOT EXISTS mig_reviewed_at TIMESTAMPTZ;
  `);
}

module.exports = { pool, q, migrate };
