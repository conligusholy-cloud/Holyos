# HR Developer (Lidé & Organizace)

## Tvůj modul
Správa lidských zdrojů: zaměstnanci, oddělení, pozice, směny, docházka, dovolená a dokumenty.
Poskytuje kompletní HR backend s frontendovým rozhraním pro řízení personálu v HolyOS.

## Klíčové soubory

### Backend
- **routes/hr.routes.js** (33 KB) - Všechny HR API endpointy (ludé, oddělení, role, směny, docházka, dovolená)
- **mcp-servers/hr-server/index.js** (4.4 KB) - MCP tools pro AI asistenty (list_employees, check_attendance, list_leave_requests)
- **services/** - Podpůrné služby pro HR logiku

### Frontend
- **modules/lide-hr/index.html** (152 KB) - Hlavní HR interface s kartami zaměstnanců, docházkou, dovolenou
- **modules/lide-hr/kiosk.html** (23 KB) - Kiosková aplikace pro registraci docházky (čtečka čipů)

### Konfigurace
- **config/database.js** - Připojení k Prisma klientovi

## Datový model

### Klíčové modely Prisma

**Person** - Zaměstnanec nebo externí osoba
```
- id, type (employee, contractor, ...), first_name, last_name
- email, phone, notes, active
- employee_number, hire_date, end_date, contract_type
- hourly_rate, monthly_salary, bank_account
- birth_date, birth_number, id_card_number, gender, address
- emergency_name, emergency_phone, emergency_relation
- photo_url, chip_number, chip_card_id (pro kiosk)
- leave_entitlement_days, leave_carryover
- FK: department_id, role_id, supervisor_id, shift_id, user_id
- Vztahy: department, role, supervisor, shift, user, subordinates
```

**Department** - Oddělení
```
- id, name, color (hex), parent_id (hierarchie)
- Vztahy: parent, children, roles, people
```

**Role** - Pozice/funkce
```
- id, name, description, department_id, parent_role_id
- Vztahy: department, parent_role, child_roles, people, permissions
```

**Shift** - Pracovní směna
```
- id, name, type (fixed, flexible), start_time, end_time (HH:MM)
- hours_fund (8.0), break_minutes (30)
- Vztahy: people
```

**Attendance** - Docházka (jeden záznam = jeden den pro jednu osobu)
```
- id, person_id, date (Date), clock_in, clock_out (HH:MM)
- break_minutes, type (work, sick, vacation, ...), note
- adjusted_clock_in, adjusted_clock_out, adjusted_break (opravy)
- Indexy: person_id+date, date
```

**LeaveRequest** - Žádost o dovolenou/volno
```
- id, person_id, type (vacation, sick, unpaid, ...), date_from, date_to
- note, status (pending, approved, rejected), approved_by (FK na Person)
- Indexy: person_id, status
```

**Document** - Dokumenty zaměstnance (smlouvy, certifikáty, atd.)
```
- id, person_id, title, type (contract, certificate, medical), category
- file_data, file_name, file_type, file_size
- valid_from, valid_to, status (active, expired, revoked), tags (JSON)
- Vztahy: person, notifications
```

**Permission** - Oprávnění role k modulům
```
- id, role_id, module_id, access_level (none, read, write)
```

**LeaveSettings** - Globální nastavení dovolené
```
- id, default_entitlement_days, year, carryover_allowed, carryover_max_days
```

**OvertimeSettings** - Nastavení přesčasů
```
- id, yearly_limit_hours, yearly_absolute_max, alert_threshold_percent
- compensation (surcharge, timeoff), surcharge_percent, allow_monthly_transfer
```

## API endpointy

### Zaměstnanci
- `GET /api/hr/people` - Seznam zaměstnanců s filtry (search, type, department_id, active)
- `GET /api/hr/people/:id` - Detail zaměstnance
- `POST /api/hr/people` - Vytvoření zaměstnance
- `PUT /api/hr/people/:id` - Úprava zaměstnance
- `DELETE /api/hr/people/:id` - Smazání zaměstnance

### Oddělení
- `GET /api/hr/departments` - Seznam oddělení
- `POST /api/hr/departments` - Vytvoření oddělení
- `PUT /api/hr/departments/:id` - Úprava oddělení

### Role a pozice
- `GET /api/hr/roles` - Seznam pozic
- `POST /api/hr/roles` - Vytvoření pozice
- `PUT /api/hr/roles/:id` - Úprava pozice

### Směny
- `GET /api/hr/shifts` - Seznam směn
- `POST /api/hr/shifts` - Vytvoření směny
- `PUT /api/hr/shifts/:id` - Úprava směny

### Docházka
- `GET /api/hr/attendance` - Docházka s filtry (person_id, date_from, date_to, type)
- `POST /api/hr/attendance` - Registrace docházky (manuální nebo z kisku)
- `PUT /api/hr/attendance/:id` - Úprava docházky (opravy času)
- `GET /api/hr/attendance/daily/:date` - Přehled docházky za den

### Dovolená
- `GET /api/hr/leave-requests` - Seznam žádostí o dovolenou (filtry: status, person_id)
- `POST /api/hr/leave-requests` - Vytvoření žádosti o dovolenou
- `PUT /api/hr/leave-requests/:id` - Úprava žádosti
- `PUT /api/hr/leave-requests/:id/approve` - Schválení žádosti
- `PUT /api/hr/leave-requests/:id/reject` - Zamítnutí žádosti
- `GET /api/hr/leave-balance/:person_id` - Zůstatek dovolené

### Dokumenty
- `GET /api/hr/documents` - Dokumenty zaměstnance (person_id)
- `POST /api/hr/documents` - Upload dokumentu
- `DELETE /api/hr/documents/:id` - Smazání dokumentu

### Statistiky
- `GET /api/hr/stats/overview` - Přehled: počet zaměstnanců, aktivní, neaktivní
- `GET /api/hr/stats/departments` - Rozdělení zaměstnanců po odděleních

## MCP server

**mcp-servers/hr-server/index.js** exportuje funkce pro Claude MCP:

```javascript
getHrTools() -> [{name, description, input_schema}, ...]
executeHrTool(toolName, params, prisma) -> result
```

### Dostupné MCP nástroje

1. **list_employees**
   - Filtr: department (string), role (string), active (bool), limit (50)
   - Vrátí: count, employees array s jménem, pozicí, oddělením, emailem, telefonem, stavem

2. **check_attendance**
   - Filtr: date (YYYY-MM-DD, default: dnes)
   - Vrátí: date, total_active, present, missing, records (person, position, check_in, check_out, status)

3. **list_leave_requests**
   - Filtr: status (pending|approved|rejected), limit (20)
   - Vrátí: count, requests (id, person, type, status, from, to, note)

## Pravidla

- **Autentizace**: Všechny routy (mimo /auth) vyžadují `requireAuth` middleware
- **Validace**: Používej Zod pro validaci vstupů (viz auth.routes.js jako příklad)
- **Datová integrita**: Zachovávej referenční integritu (FK constraints v Prisma)
- **Čeština**: Komentáře, chyby, UI texty jsou v češtině
- **Databáze**: Vždy používej `prisma.person.findMany()` místo raw SQL
- **Docházka**: Časy se uchovávají jako string HH:MM v UTC
- **Kiosk**: Čtečka čipů zapisuje do attendance s typem "work", automaticky detekuje check-in/out
- **Dovolená**: Kontroluj carryover a entitlement_days z LeaveSettings
- **Indexy**: person_id a date jsou indexovány pro rychlé vyhledávání docházky

## Nezasahuj do

- `routes/ai.routes.js` - AI asistenti
- `routes/chat.routes.js` - Chat rozhraní
- `routes/auth.routes.js` - Autentizace (není HR)
- `mcp-servers/production-server/` - Výroba
- `mcp-servers/warehouse-server/` - Sklad
- `modules/ai-agenti/` - AI modul
- `modules/nakup-sklad/` - Skladový modul
- Databázová schéma (`.prisma/schema.prisma` se mění jen s migrací)

## Dodatečné poznatky

- **Kiosk** se spouští na `modules/lide-hr/kiosk.html`, komunia s klientem GET `/api/hr/attendance`
- **Foto zaměstnance**: Ukládá se v `person.photo_url` (odkaz na storage)
- **Bezpečnost**: Birth_number, ID číslo a bank account jsou citlivé údaje
- **Sčítání docházky**: Jdi od `date` a porovnánej s `shift.hours_fund`
