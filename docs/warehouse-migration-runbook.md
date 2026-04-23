# HolyOS — Sklad 2.0 | Migration Runbook

Spuštění Prisma migrace `sklad-2-pwa-tisk` nad produkční (nebo staging) PostgreSQL databází HolyOS.

Připraveno 2026-04-23 na základě úprav `prisma/schema.prisma` a `docs/warehouse-openapi.yaml`.

---

## Souhrn změn

**Upravené tabulky** (stávající):

| Tabulka | Změna |
|---------|-------|
| `materials` | `barcode` → `UNIQUE` (bylo jen `@@index`), nový sloupec `sector VARCHAR(20) NULL`, index `(sector)` |
| `warehouse_locations` | `barcode` → `UNIQUE`, nový `type VARCHAR(30) NOT NULL DEFAULT 'position'`, `locked_for_inventory BOOLEAN NOT NULL DEFAULT false`, index `(type)` |
| `inventory_movements` | nové sloupce: `from_location_id INT NULL`, `to_location_id INT NULL`, `document_id INT NULL`, `client_uuid UUID NULL UNIQUE`, `device_id VARCHAR(100) NULL`; indexy na `document_id`, `from_location_id`, `to_location_id` |

**Nové tabulky:**

- `stock` — zásoby po lokacích, unique `(material_id, location_id)`
- `warehouse_documents` — zastřešení pohybů (DL, výdejka, přesunka, picking list, inventura)
- `batches` + `batch_items` — pickovací dávky
- `printers` — registr tiskáren (TSC_TC200, ZPL, LAN)
- `label_templates` — ZPL šablony s placeholdery
- `print_jobs` — auditní stopa tisku

---

## Krok 1 — Pre-flight kontroly (spustit PŘED migrací)

Migrace přidává `UNIQUE` na `materials.barcode` a `warehouse_locations.barcode`. Pokud v DB existují duplikáty, Prisma selže. Spustit:

```sql
-- 1. Duplikátní barcode v materiálech
SELECT barcode, COUNT(*) AS pocet
FROM materials
WHERE barcode IS NOT NULL AND barcode <> ''
GROUP BY barcode
HAVING COUNT(*) > 1;

-- 2. Duplikátní barcode v lokacích
SELECT barcode, COUNT(*) AS pocet
FROM warehouse_locations
WHERE barcode IS NOT NULL AND barcode <> ''
GROUP BY barcode
HAVING COUNT(*) > 1;

-- 3. Prázdný string '' v barcode (měl by být NULL)
SELECT COUNT(*) AS prazdnych_barcode_materials FROM materials WHERE barcode = '';
SELECT COUNT(*) AS prazdnych_barcode_locations FROM warehouse_locations WHERE barcode = '';

-- 4. Inventarizační stav (pro kontext, ať víš, co se bude migrovat)
SELECT 'materials' AS tabulka, COUNT(*) AS zaznamu FROM materials
UNION ALL SELECT 'warehouse_locations', COUNT(*) FROM warehouse_locations
UNION ALL SELECT 'inventory_movements', COUNT(*) FROM inventory_movements;
```

**Pokud Q1/Q2 vrátí řádky:** vyčistit duplicity dřív, než spustíš migraci. Typicky:

```sql
-- Nastavit duplikátní barcode na NULL u všech kromě prvního záznamu (podle id)
UPDATE materials m
SET barcode = NULL
WHERE m.barcode IS NOT NULL
  AND m.id NOT IN (
    SELECT MIN(id) FROM materials
    WHERE barcode IS NOT NULL
    GROUP BY barcode
  );

-- Totéž pro lokace
UPDATE warehouse_locations l
SET barcode = NULL
WHERE l.barcode IS NOT NULL
  AND l.id NOT IN (
    SELECT MIN(id) FROM warehouse_locations
    WHERE barcode IS NOT NULL
    GROUP BY barcode
  );
```

**Pokud Q3 vrátí > 0:** prázdné stringy převést na NULL:

```sql
UPDATE materials          SET barcode = NULL WHERE barcode = '';
UPDATE warehouse_locations SET barcode = NULL WHERE barcode = '';
```

---

## Krok 2 — Záloha

```bash
# Railway / produkce
railway run pg_dump --format=custom --no-owner --no-acl \
  --file=/tmp/holyos-pre-sklad2-$(date +%Y%m%d-%H%M).dump

# Lokálně
pg_dump -Fc -f holyos-pre-sklad2-$(date +%Y%m%d-%H%M).dump $DATABASE_URL
```

---

## Krok 3 — Spuštění migrace

```bash
cd C:\Users\Tomáš\Projekty\Výroba\Výroba
npx prisma migrate dev --name sklad-2-pwa-tisk
```

Pro produkci (Railway):

```bash
npx prisma migrate deploy
```

**Očekávaný výstup:** Prisma vygeneruje soubor `prisma/migrations/<timestamp>_sklad_2_pwa_tisk/migration.sql` obsahující:

- `ALTER TABLE materials ADD COLUMN sector VARCHAR(20)`
- `DROP INDEX materials_barcode_idx` a `CREATE UNIQUE INDEX materials_barcode_key ON materials(barcode)`
- `CREATE INDEX materials_sector_idx ON materials(sector)`
- `ALTER TABLE warehouse_locations ADD COLUMN type VARCHAR(30) NOT NULL DEFAULT 'position'`
- `ALTER TABLE warehouse_locations ADD COLUMN locked_for_inventory BOOLEAN NOT NULL DEFAULT false`
- `DROP INDEX warehouse_locations_barcode_idx` a `CREATE UNIQUE INDEX warehouse_locations_barcode_key`
- `CREATE INDEX warehouse_locations_type_idx ON warehouse_locations(type)`
- `ALTER TABLE inventory_movements ADD COLUMN from_location_id INT, to_location_id INT, document_id INT, client_uuid UUID, device_id VARCHAR(100)`
- `CREATE UNIQUE INDEX inventory_movements_client_uuid_key`
- 3 nové FK constrainty na `inventory_movements`
- `CREATE TABLE stock (...)` s unique `(material_id, location_id)`
- `CREATE TABLE warehouse_documents (...)`
- `CREATE TABLE batches (...)`
- `CREATE TABLE batch_items (...)`
- `CREATE TABLE printers (...)`
- `CREATE TABLE label_templates (...)`
- `CREATE TABLE print_jobs (...)`

Migrace by měla proběhnout do ~10 vteřin (většina změn jsou ADD COLUMN NULLABLE nebo CREATE TABLE, žádný rewrite dat).

---

## Krok 4 — Post-migration seed (default šablony + 2 tiskárny z Factorify)

Stačí jednou po první migraci. Přes `npx prisma studio` nebo SQL níže.

### 4.1 Default ZPL šablony

```sql
INSERT INTO label_templates (code, name, language, width_mm, height_mm, body, description, is_active, created_at, updated_at) VALUES
('item_label',
 'Etiketa položky (QR + název + SKU)',
 'ZPL', 60, 20,
 E'^XA\n^FO20,20^BQN,2,3^FDMA,{{barcode}}^FS\n^FO160,25^ADN,18,10^FD{{name}}^FS\n^FO160,65^ADN,12,6^FDSKU: {{code}}^FS\n^FO160,95^ADN,12,6^FD{{unit}}^FS\n^XZ',
 'Standardní etiketa pro materiál: QR kód vlevo, název + SKU + jednotka vpravo.',
 true, NOW(), NOW()),

('location_label',
 'Etiketa lokace (QR + kód + sklad)',
 'ZPL', 60, 20,
 E'^XA\n^FO20,20^BQN,2,3^FDMA,{{barcode}}^FS\n^FO160,25^ADN,24,14^FD{{label}}^FS\n^FO160,70^ADN,12,6^FD{{warehouse_name}}^FS\n^XZ',
 'Etiketa pro regál/pozici: QR kód vlevo, label + název skladu vpravo.',
 true, NOW(), NOW()),

('document_summary',
 'Souhrn skladového dokumentu',
 'ZPL', 60, 20,
 E'^XA\n^FO20,15^ADN,16,8^FD{{type_label}}^FS\n^FO20,45^ADN,24,12^FD{{number}}^FS\n^FO20,85^ADN,12,6^FDPartner: {{partner_name}}^FS\n^FO20,115^ADN,12,6^FDDatum: {{date}}^FS\n^XZ',
 'Hlavička dodacího listu / výdejky — typ, číslo, partner, datum.',
 true, NOW(), NOW());
```

### 4.2 Přenos 2 tiskáren z Factorify

```sql
INSERT INTO printers (name, model, connection_type, ip_address, port, language, label_width_mm, label_height_mm, dpi, priority, is_active, encoding, created_at, updated_at) VALUES
('Tiskárna Rychnov',  'TSC_TC200', 'lan', '90.183.16.242', 55985, 'ZPL', 60, 20, 203, 100, true, 'UTF-8', NOW(), NOW()),
('Tiskárna RK CNC',   'TSC_TC200', 'lan', '90.183.16.242', 55986, 'ZPL', 60, 20, 203,  90, true, 'UTF-8', NOW(), NOW());
```

Po seedu ještě přes web UI doplníš `location_id` (aby se autoselect tiskárny trefila do správného pracoviště).

---

## Krok 5 — Smoke test po migraci

```sql
-- Struktura se vytvořila
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('stock','warehouse_documents','batches','batch_items','printers','label_templates','print_jobs')
ORDER BY table_name;

-- Unique constrainty na barcode fungují
\d materials
\d warehouse_locations

-- Nové sloupce na inventory_movements
\d inventory_movements

-- Seed vložen
SELECT code, name FROM label_templates ORDER BY code;
SELECT name, ip_address, port FROM printers;
```

Všechno by mělo vrátit očekávaný výstup. Pokud ano, migrace je OK a můžeme do Fáze 2 (implementace backendu).

---

## Rollback

Pokud něco dopadne špatně:

```bash
# Vrátit se před migraci
pg_restore -c -d $DATABASE_URL holyos-pre-sklad2-YYYYMMDD-HHMM.dump

# Smazat vygenerovanou Prisma migraci (ať se znovu negeneruje)
rm -rf prisma/migrations/<timestamp>_sklad_2_pwa_tisk
```

---

## Známé rizikové body

1. **Existující duplikátní barcode** — pokud Q1/Q2 vrátí řádky a nevyčistíš je dopředu, migrace selže uprostřed a nechá DB v half-migrated stavu. Proto jsou kontroly v Kroku 1.

2. **`warehouse_locations.type` default `'position'`** — všechny existující lokace dostanou `type = 'position'`. Pokud máš ve skutečnosti i workstation lokace (`workstations_input` / `workstations_output` vazby), bylo by dobré je po migraci překlasifikovat:

   ```sql
   UPDATE warehouse_locations wl
   SET type = 'workstation_in'
   WHERE id IN (SELECT input_location_id FROM workstations WHERE input_location_id IS NOT NULL);

   UPDATE warehouse_locations wl
   SET type = 'workstation_out'
   WHERE id IN (SELECT output_location_id FROM workstations WHERE output_location_id IS NOT NULL);
   ```

3. **`Stock` tabulka startuje prázdná** — rychlý lookup „co je na lokaci" bude zpočátku prázdný. První fáze backendu bude obsahovat jednorázový backfill z `inventory_movements` (agregát per `(material_id, location_id)`). To není součást migrace samotné.

4. **Inventory v HolyOS × PWA flow** — stávající `Inventory` + `InventoryItem` zůstávají. PWA bude volat rozšířené endpointy `/start` (zamkne lokace) a `/finish` (vytvoří `inventory_adjust` pohyby pro rozdíly). To vyžaduje úpravu `routes/warehouse.routes.js` — ve Fázi 2.
