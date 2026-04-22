# API: Výrobní sloty — kalendář obsazenosti

Sanitizované REST API pro integraci kalendáře výrobních slotů do libovolné stránky. Kolega může slot vidět, zobrazit jeho naplněnost a případně blokovat termíny — **bez přístupu k detailům zakázek** (zákazník, produkt, množství).

## Autentizace

Endpointy `/api/slots/calendar*` akceptují dvě metody autentizace:

1. **`X-API-Key` header** — pro externí integrace (jiná doména, server-to-server). Klíč je statický, konfigurovaný v env proměnné `SLOT_CALENDAR_API_KEY` na serveru HolyOS.
2. **JWT cookie** — pro interní HolyOS moduly (stejný origin, uživatel přihlášen).

Externí konzument používá vždy metodu 1:

```
GET /api/slots/calendar HTTP/1.1
Host: holyos.cz
X-API-Key: <tvůj-klíč>
```

Ostatní endpointy (`/api/slots/`, `/api/slots/:id`, assignments, blocks, stats) vyžadují **pouze** cookie — externí integrace k nim nemají přístup.

### CORS

Server reflektuje origin volajícího a povoluje `credentials: true`. Pokud chceš omezit povolený origin, Tomáš nastaví env proměnnou `CORS_ORIGIN=https://tvoje-aplikace.cz`.

---

## Přehled endpointů

| Metoda | URL | Co dělá |
|--------|-----|---------|
| `GET`  | `/api/slots/calendar` | Seznam slotů s vypočtenou naplněností, bez detailů zakázek. |
| `GET`  | `/api/slots/calendar/next-free?hours=X` | Najde první slot s volnou kapacitou ≥ X hodin. |
| `POST` | `/api/slots/calendar/block` | Zablokovat období (dovolená, údržba, …). |
| `DELETE` | `/api/slots/calendar/block/:slotId` | Zrušit blokaci. |

Interní endpointy (detail zakázek) zůstávají v `/api/slots/*` a pro externí integrace **nejsou přístupné**.

---

## `GET /api/slots/calendar`

Vrátí sloty v zadaném rozsahu, každý s vypočtenou naplněností v procentech a odvozeným statusem. **Žádné názvy zákazníků ani produktů**, jen počty a hodiny.

### Query parametry

| Parametr | Typ | Popis |
|----------|-----|-------|
| `from` | ISO date (YYYY-MM-DD) | Volitelné. Filtr: `start_date >= from`. |
| `to` | ISO date | Volitelné. Filtr: `end_date <= to`. |
| `workstation_id` | number | Volitelné. Filtr na konkrétní pracoviště. |

### Response (200 OK)

```json
{
  "range": { "from": "2026-04-01", "to": "2026-06-30" },
  "count": 12,
  "slots": [
    {
      "id": 42,
      "name": "Týden 17 — Linka A",
      "start_date": "2026-04-20T00:00:00.000Z",
      "end_date": "2026-04-24T00:00:00.000Z",
      "workstation": { "id": 1, "name": "Montáž", "code": "MON-01" },
      "status": "occupied",
      "label": "Obsazeno 75 %",
      "occupancy_pct": 75,
      "assignment_count": 2,
      "used_hours": 30,
      "capacity_hours_per_day": 8,
      "capacity_total_hours": 40,
      "color": "#f97316",
      "is_blocked": false,
      "blocks": []
    }
  ]
}
```

### Hodnoty `status`

| Status | Kdy nastane | Doporučená barva |
|--------|-------------|------------------|
| `free` | Žádné přiřazení, termín v budoucnu. | zelená `#10b981` |
| `occupied` | Alespoň 1 přiřazení, kapacita ještě není plná. | oranžová `#f97316` |
| `full` | Naplněnost ≥ 100 %. | tmavě oranžová `#ea580c` |
| `blocked` | Slot má status `blocked` nebo aspoň jednu aktivní blokaci. | červená `#dc2626` |
| `expired` | `end_date` je v minulosti. | šedá `#6b7280` |

### Výpočet naplněnosti

```
workDays             = počet pracovních dní (Po–Pá) mezi start_date a end_date
capacity_total_hours = capacity_hours_per_day × workDays
used_hours           = součet assignments[].estimated_hours
occupancy_pct        = min(100, round(used_hours / capacity_total_hours × 100))
```

### Příklad curl

```bash
curl -H "X-API-Key: $HOLYOS_API_KEY" \
  "https://holyos.cz/api/slots/calendar?from=2026-04-01&to=2026-06-30"
```

---

## `GET /api/slots/calendar/next-free?hours=X`

Najde první nadcházející slot (od dneška), ve kterém je ≥ X volných hodin. Pro obchodníky potvrzující dodací termín.

### Response (200 OK)

```json
{
  "id": 43,
  "name": "Týden 19 — Linka A",
  "start_date": "2026-05-04T00:00:00.000Z",
  "end_date": "2026-05-08T00:00:00.000Z",
  "free_hours": 24,
  "needed_hours": 16
}
```

### Response (404 Not Found)

```json
{ "error": "Žádný volný slot s dostatečnou kapacitou" }
```

---

## `POST /api/slots/calendar/block`

Vytvoří nový slot se statusem `blocked` a k němu záznam blokace.

### Request body

```json
{
  "start_date": "2026-07-01",
  "end_date":   "2026-07-15",
  "reason":     "Celozávodní dovolená",
  "block_type": "holiday",
  "capacity_hours": 8
}
```

| Pole | Povinné | Výchozí | Popis |
|------|---------|---------|-------|
| `start_date` | ano | — | ISO date. |
| `end_date` | ano | — | ISO date. |
| `reason` | ano | — | Krátký text. |
| `block_type` | ne | `"holiday"` | `holiday` / `maintenance` / `other`. |
| `capacity_hours` | ne | `8` | Hodin/den. |

### Response (201 Created)

```json
{
  "id": 57,
  "block_id": 23,
  "start_date": "2026-07-01T00:00:00.000Z",
  "end_date": "2026-07-15T00:00:00.000Z",
  "reason": "Celozávodní dovolená",
  "status": "blocked"
}
```

---

## `DELETE /api/slots/calendar/block/:slotId`

Smaže slot vytvořený jako blokace. Jen pokud `slot.status === 'blocked'` — nelze tímhle smazat slot, který drží zakázky.

### Response (200 OK)

```json
{ "ok": true }
```

### Response (400 Bad Request)

```json
{ "error": "Tento slot není blokace, smazání přes tento endpoint nelze" }
```

---

## Integrace na vlastní stránku

**Server-to-server (doporučené):**

```javascript
// Na tvém backendu (Node.js / Python / cokoliv):
app.get('/muj-kalendar', async (req, res) => {
  const r = await fetch('https://holyos.cz/api/slots/calendar?from=2026-04-01&to=2026-06-30', {
    headers: { 'X-API-Key': process.env.HOLYOS_API_KEY },
  });
  const data = await r.json();
  res.json(data); // předej frontendu bez klíče
});
```

**Frontend přímo v prohlížeči** (jen pokud je aplikace interní a klíč může unést):

Viz přiložený `slot-kalendar.js` — reusable modul s funkcemi `configure`, `mount`, `block`, `unblock`, `nextFree`.

```html
<link rel="stylesheet" href="slot-kalendar.css">
<div id="slot-kalendar"></div>
<script src="slot-kalendar.js"></script>
<script>
  SlotKalendar.configure({ apiBase: 'https://holyos.cz', apiKey: 'tvuj-klic' });
  SlotKalendar.mount('#slot-kalendar', { from: '2026-04-01', to: '2026-06-30' });
</script>
```

---

## Co endpoint **neposkytuje**

Z bezpečnostních/privátních důvodů sanitizovaný kalendář **nikdy** nevrací:

- `customer_name`, `product_name` — detail přiřazení.
- `order_id`, `order_item_id` — napojení na prodejní objednávku.
- `priority`, `note` — interní poznámky.
- Jména autorů blokace.

Potřebuješ-li tato data, musíš použít interní `/api/slots/*` endpointy s JWT cookie — ty jsou dostupné jen uvnitř HolyOS.

---

## Synchronizace

Všechna data leží v jedné PostgreSQL databázi. Jakmile zavoláš `POST /api/slots/calendar/block`, záznam se okamžitě objeví i v modulu *Výrobní sloty* na HolyOS — není tam žádná cache.
