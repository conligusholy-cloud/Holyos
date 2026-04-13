# Production Developer (Pracovní postupy & Výroba)

## Tvůj modul
Správa výrobního procesu: pracovní postupy (receptury), programování výroby, simulace výroby a vytvoření areálu.
Propojení mezi designem produktu a fyzickou realizací v továrně.

## Klíčové soubory

### Backend
- **routes/production.routes.js** (9.7 KB) - API pro produkty, operace, workstations, simulace
- **mcp-servers/production-server/index.js** (4 KB) - MCP tools (list_products, check_operations, plan_production)
- **services/** - Podpůrné logiky

### Frontend - Pracovní postupy
- **modules/pracovni-postup/index.html** (2.9 KB) - Zobrazení receptury/postupu výroby
  - Importuje z dist/client (compiled)

### Frontend - Programování výroby
- **modules/programovani-vyroby/index.html** (8.1 KB) - Editor pro plánování výroby
  - Subdotazení: app.js, config.js, factorify-api.js, history.js, interactions.js, objects.js, properties.js, renderer.js, state.js, storage.js

### Frontend - Simulace
- **modules/simulace-vyroby/index.html** (6.7 KB) - Simulátor výroby (2D/3D vizualizace)
  - Subdotazení: app.js, simulation.js, factorify-sim.js, renderer.js, state.js

### Frontend - Vytvoření areálu
- **modules/vytvoreni-arealu/index.html** (6.6 KB) - Editor fyzického uspořádání skladu/výroby
  - Stejná struktura jako programování a simulace

## Datový model

### Klíčové modely Prisma

**Product** - Výrobek/součástka
```
- id, code (unique), name, status (active, obsolete, test)
- type (product, semi-product, component)
- description, notes
- unit, barcode
- Vztah: operations[] (ProductOperation)
```

**Workstation** - Pracovní stanice/stroj
```
- id, code, name, type (cnc, assembly, test, warehouse, ...)
- status (operational, maintenance, inactive)
- position_x, position_y (pro 2D layout)
- capacity_pcs_per_hour (výkon stanice)
- material_types (JSON: allowed types, e.g., ["aluminum", "plastic"])
- notes
```

**ProductOperation** - Výrobní operace v postupu
```
- id, product_id (FK), workstation_id (FK optional)
- step_number (1, 2, 3, ..., pořadí v postupu)
- name (operace: "Frézování", "Montáž", "Testování")
- phase (volnější kategorie, např. "Příprava", "Hlavní výroba")
- duration (čas), duration_unit (MINUTE, SECOND, HOUR)
- preparation_time (příprava stanice, 0 default)
- bom_count (počet BOM položek použitých v tomto kroku)
- Indexy: product_id
```

**Simulation** - Simulace výroby (datový model pro 2D/3D prostředí)
```
- id (uuid), name, version (int), created_at, updated_at
- objects (JSON array: {{type, id, x, y, width, height, rotation, props, ...}})
  - Typy objektů: workstation, storage, conveyor, robot, material_pile, inspection_point
- connections (JSON array: {{from_id, to_id, type, flow_rate, ...}})
  - Typy spojení: material_flow, control_signal, emergency_stop
- viewport (JSON: {{zoom, panX, panY}})
```

## API endpointy

### Produkty
- `GET /api/production/products` - Lista produktů (search, type)
- `GET /api/production/products/:id` - Detail produktu s operacemi
- `POST /api/production/products` - Vytvoř produkt
- `PUT /api/production/products/:id` - Uprav produkt
- `DELETE /api/production/products/:id` - Smaž produkt

### Operace
- `GET /api/production/products/:id/operations` - Operace pro produkt (seřazeno dle step_number)
- `POST /api/production/products/:id/operations` - Přidej operaci
- `PUT /api/production/operations/:opId` - Uprav operaci
- `DELETE /api/production/operations/:opId` - Smaž operaci
- `POST /api/production/operations/:opId/reorder` - Změň pořadí (step_number)

### Pracovní stanice
- `GET /api/production/workstations` - Lista stanic
- `GET /api/production/workstations/:id` - Detail stanice
- `POST /api/production/workstations` - Vytvoř stanici
- `PUT /api/production/workstations/:id` - Uprav stanici (včetně pozice pro layout)
- `DELETE /api/production/workstations/:id` - Smaž stanici

### Simulace
- `GET /api/production/simulations` - Lista všech simulací
- `GET /api/production/simulations/:id` - Detail simulace (objects, connections, viewport)
- `POST /api/production/simulations` - Vytvoř novou simulaci
- `PUT /api/production/simulations/:id` - Uprav simulaci (objects, connections, viewport)
- `DELETE /api/production/simulations/:id` - Smaž simulaci
- `POST /api/production/simulations/:id/clone` - Duplikuj simulaci (s novým jménem)
- `POST /api/production/simulations/:id/export` - Export do JSON (pro backup)
- `POST /api/production/simulations/import` - Import ze JSON

## MCP server

**mcp-servers/production-server/index.js** exportuje:

```javascript
getProductionTools() -> [{name, description, input_schema}, ...]
executeProductionTool(toolName, params, prisma) -> result
```

### Dostupné MCP nástroje

1. **list_products**
   - Filtr: search (name|code), type, limit (20)
   - Vrátí: id, code, name, type, status, operation_count

2. **check_operations**
   - Filtr: product_id, workstation_id
   - Vrátí: operations seřazené dle step_number (id, name, duration, duration_unit, preparation_time)

3. **plan_production**
   - Input: product_id, quantity, start_date
   - Vrátí: schedule {{operation, workstation, start, end, duration, dependencies}} 
   - Počítá dle operačních časů a kapacit stanic

## Pravidla

- **Autentizace**: requireAuth middleware (pokud je REST endpoint)
- **Čeština**: Komentáře, UI, error messages
- **Databáze**: Prisma, bez raw SQL
- **Step numbering**: Operace v produktu mají step_number 1, 2, 3... (musí být sekvenční)
- **Workstation assign**: ProductOperation.workstation_id může být null (operace bez specifické stanice)
- **Duration units**: MINUTE, SECOND, HOUR (case-sensitive)
- **Simulation objects**: Ukládej JSON s polem {{type, id, props: {{...}}}}
- **Simulation connections**: type = "material_flow" nebo "control_signal"
- **Viewport**: Default {{zoom: 1, panX: 0, panY: 0}}
- **Layout coordinates**: position_x, position_y jsou v pixelech (2D prostor)

## Nezasahuj do

- `routes/hr.routes.js` - HR data
- `routes/warehouse.routes.js` - Skladový modul
- `routes/ai.routes.js` - AI asistenti
- `mcp-servers/hr-server/` - HR MCP
- `mcp-servers/warehouse-server/` - Sklad MCP
- `modules/lide-hr/` - HR modul
- `modules/nakup-sklad/` - Sklad modul
- `modules/ai-agenti/` - AI modul
- Databázová schéma (prisma migrate)

## Dodatečné poznatky

### Pracovní postup (receptura)
- ProductOperation je jednotlivý krok v procesu
- Pořadí určuje step_number (počáteční index 1)
- Jestli duration_unit = HOUR a duration = 2, je operace 2 hodiny
- preparation_time se používá k výpočtu celkového času zahájení (setup cost)

### Programování výroby (modules/programovani-vyroby)
- Interaktivní editor s drag-and-drop pro vytváření postupů
- State se ukládá v localStorage (modules/programovani-vyroby/storage.js)
- Komunikuje s Factorify API (faktury na vnější data)
- Při změně čtete produkty z `/api/production/products`

### Simulace (modules/simulace-vyroby)
- 2D vizualizace výroby (nebo připravená na 3D)
- Objekty jsou vykresleny dle fields: type, x, y, width, height, rotation
- Connections ukazují tok materiálu mezi objekty
- Simulation model je JSON, vhodný pro export/import

### Vytvoření areálu (modules/vytvoreni-arealu)
- Podobná struktura jako simulace, ale fokus na fyzický layout
- Můžeš přidávat workstations, storage, koridory, bezpečnostní zóny
- Pozice workstations se ukládá do Workstation.position_x/position_y

### Factorify integrace
- `modules/pracovni-postup/factorify-api.js` komunikuje s vnějším API
- Synchronizuje produkty a operace s Factorify systémem (ve skutečnosti)
- HolyOS je v local režimu, Factorify je proxy v produkci
