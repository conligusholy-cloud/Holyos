# Warehouse Developer (Nákup & Sklad)

## Tvůj modul
Správa skladů, zásob materiálů, objednávek a dodavatelských vztahů.
Kompletní řetězec: firmy (dodavatelé, odběratelé) → objednávky → materiály → sklady → inventury.

## Klíčové soubory

### Backend
- **routes/warehouse.routes.js** (20 KB) - API pro firmy, objednávky, materiály, sklady, inventury
- **mcp-servers/warehouse-server/index.js** (4 KB) - MCP tools pro AI (stock_check, list_orders, list_companies)
- **services/** - Podpůrné služby pro logiku skladů

### Frontend
- **modules/nakup-sklad/index.html** (90 KB) - Grafické UI pro správu zásob, objednávek, firem
- Integrované s Factorify API pro produkční data

### Konfigurace
- **config/database.js** - Prisma klient

## Datový model

### Klíčové modely Prisma

**Company** - Dodavatel, odběratel, partner
```
- id, name, ico, dic
- address, city, zip, country (default: CZ)
- type (supplier, customer, cooperation, both)
- contact_person, email, phone, web
- bank_account, payment_terms_days (14), notes
- active (bool)
- Indexy: ico, type
```

**Order** - Nákupní nebo prodejní objednávka
```
- id, order_number (unique), type (purchase|sale|cooperation)
- company_id (FK), status (new, confirmed, partial, delivered, cancelled)
- items_count, total_amount, currency (CZK)
- note, created_by, approved_by (FK na Person)
- expected_delivery, delivered_at (DateTime)
- Indexy: type, status, company_id
- Vztah: company, items[], creator, approver
```

**OrderItem** - Položka objednávky
```
- id, order_id, material_id (optional)
- name, quantity, unit (ks), unit_price, total_price
- expected_delivery, delivered_quantity (0 je pending)
- status (pending, partial, delivered, cancelled)
- note
```

**Material** - Materiál/součástka
```
- id, code (unique), name, external_id, status (active, obsolete, test)
- type (material, semi-product, service), unit (ks), barcode
- unit_price, weighted_avg_price
- current_stock, min_stock, max_stock (s _type: days, pieces)
- supplier_id (preferred), lead_time_days
- batch_size_min/max/default, reorder_quantity
- Classification: classification, family, material_group, norm
- Physical: weight, dimension, color, secondary_color
- Design: material_ref, semi_product_ref, route, revision_number, drawn_by, toolbox_name
- Stock flags: non_stock, distinguish_batches, no_availability_check, plan_orders
- factorify_id (integrace s Factorify)
- Indexy: code, barcode, supplier_id, factorify_id
```

**Warehouse** - Sklad/místo skladování
```
- id, name, code, address, type (main, secondary, external)
- manager_id (FK na Person), active
- Vztahy: locations[], movements[], stock_rules[], inventories[]
```

**WarehouseLocation** - Konkrétní místo v skladě (regál, pozice)
```
- id, warehouse_id, section, rack, position (např. A1-01-03)
- label, barcode, capacity, notes
- Indexy: warehouse_id, barcode
```

**InventoryMovement** - Pohyb v inventáři (příjem, výdej, transfer)
```
- id, material_id, warehouse_id, location_id (optional)
- type (receipt|issue|transfer|adjustment)
- quantity, unit_price (pro oceňování)
- reference_type (order, project, inventory, manual)
- reference_id, note, created_by (FK)
- Indexy: material_id, warehouse_id, created_at
```

**StockRule** - Pravidla pro automatickou objednávku
```
- id, material_id, warehouse_id (optional = globální)
- min_stock, max_stock, reorder_quantity
- auto_order (bool), preferred_supplier_id
```

**Inventory** - Fyzická inventura skladu
```
- id, warehouse_id, name, status (draft, in_progress, completed, cancelled)
- started_at, completed_at, created_by
- note
- Vztah: items[] (InventoryItem)
```

**InventoryItem** - Položka fyzické inventury
```
- id, inventory_id, material_id, location_id (optional)
- expected_qty, actual_qty, difference (actual - expected)
- unit_price, value_difference (quantity_diff * price)
- counted_by (FK), counted_at, note
```

## API endpointy

### Firmy (Companies)
- `GET /api/wh/companies` - Lista firem (search, type, active)
- `POST /api/wh/companies` - Vytvoř firmu
- `PUT /api/wh/companies/:id` - Uprav firmu
- `DELETE /api/wh/companies/:id` - Smaž firmu
- `GET /api/wh/companies/:id` - Detail firmy

### Objednávky (Orders)
- `GET /api/wh/orders` - Lista objednávek (type, status, company_id, search)
- `GET /api/wh/orders/:id` - Detail objednávky s položkami
- `POST /api/wh/orders` - Vytvoř objednávku
- `PUT /api/wh/orders/:id` - Uprav objednávku
- `DELETE /api/wh/orders/:id` - Smaž objednávku
- `POST /api/wh/orders/:id/approve` - Schvál objednávku
- `POST /api/wh/orders/:id/receive` - Zaregistruj příjezd objednávky

### Položky objednávky (OrderItems)
- `POST /api/wh/orders/:orderId/items` - Přidej položku do objednávky
- `PUT /api/wh/orders/:orderId/items/:itemId` - Uprav položku
- `DELETE /api/wh/orders/:orderId/items/:itemId` - Smaž položku

### Materiály (Materials)
- `GET /api/wh/materials` - Lista materiálů (search, type, status, below_min)
- `GET /api/wh/materials/:id` - Detail materiálu
- `POST /api/wh/materials` - Vytvoř materiál
- `PUT /api/wh/materials/:id` - Uprav materiál
- `DELETE /api/wh/materials/:id` - Smaž materiál
- `GET /api/wh/materials/:id/stock-history` - Historie zásob

### Sklady (Warehouses)
- `GET /api/wh/warehouses` - Lista skladů
- `GET /api/wh/warehouses/:id` - Detail skladu
- `POST /api/wh/warehouses` - Vytvoř sklad
- `PUT /api/wh/warehouses/:id` - Uprav sklad
- `GET /api/wh/warehouses/:id/locations` - Místa v skladě

### Pohyby inventáře (Movements)
- `GET /api/wh/movements` - Pohyby (material_id, warehouse_id, type)
- `POST /api/wh/movements` - Vytvoř pohyb (příjem, výdej, transfer)
- `GET /api/wh/movements/by-material/:materialId` - Všechny pohyby materiálu

### Stock Rules
- `GET /api/wh/stock-rules` - Pravidla (material_id, warehouse_id)
- `POST /api/wh/stock-rules` - Vytvoř pravidlo
- `PUT /api/wh/stock-rules/:id` - Uprav pravidlo

### Inventury (Physical Counts)
- `GET /api/wh/inventories` - Lista inventur
- `POST /api/wh/inventories` - Zahaj inventuru
- `GET /api/wh/inventories/:id` - Detail inventury
- `POST /api/wh/inventories/:id/items` - Přidej položku do inventury
- `PUT /api/wh/inventories/:id/items/:itemId` - Zaznamenej počet
- `POST /api/wh/inventories/:id/complete` - Uzavři inventuru

## MCP server

**mcp-servers/warehouse-server/index.js** exportuje:

```javascript
getWarehouseTools() -> [{name, description, input_schema}, ...]
executeWarehouseTool(toolName, params, prisma) -> result
```

### Dostupné MCP nástroje

1. **stock_check**
   - Filtr: material_name (string), below_minimum (bool), limit (30)
   - Vrátí: materials s code, name, current_stock, min_stock, status

2. **list_orders**
   - Filtr: type (purchase|sale), status, limit (20)
   - Vrátí: orders s order_number, company, status, items_count, total_amount

3. **list_companies**
   - Filtr: type (supplier|customer|both), search (string), limit (30)
   - Vrátí: companies s name, ico, type, contact, active

## Pravidla

- **Autentizace**: Vyžaduj `requireAuth` middleware
- **Validace**: Zod pro validation (input saitary)
- **Transakcionalita**: Objednávka a její items by měly být atomické
- **Čeština**: Komentáře, chyby, UI
- **Databáze**: Prisma, žádné raw SQL (mimo agregace)
- **Weighted avg price**: Počítej z historických pohybů
- **Barcode**: Slouží k identifikaci položek v sadě, index pro quick lookup
- **Lead time**: Používej k plánování nákupů (dnešek + lead_time_days)
- **Reorder point**: Když current_stock < min_stock a auto_order = true → vytvoř nákupní objednávku
- **Movement audit**: Všechny pohyby musí mít reference_type a reference_id (nebo manual)

## Nezasahuj do

- `routes/hr.routes.js` - HR data
- `routes/ai.routes.js` - AI asistenti
- `routes/production.routes.js` - Výroba
- `mcp-servers/hr-server/` - HR MCP
- `mcp-servers/production-server/` - Produkce
- `modules/lide-hr/` - HR modul
- `modules/ai-agenti/` - AI modul
- Databázová schéma (migrace přes `prisma migrate`)

## Dodatečné poznatky

- **Factorify integrace**: Material.factorify_id slouží k sync s externím systémem (viz modules/nakup-sklad/)
- **Oceňování**: unit_price se běžně mění, weighted_avg_price je pro účetnictví
- **Multi-warehouse**: StockRule může být per-warehouse nebo globální (warehouse_id = null)
- **Delivery tolerance**: Pokud delivered_qty > expected qty a tolerance je 5%, stále je OK
- **Non-stock items**: Služby atd., nemají physical storage
- **Barcode reader**: Z UI, text field s automatickým GET /api/wh/materials?barcode=...
