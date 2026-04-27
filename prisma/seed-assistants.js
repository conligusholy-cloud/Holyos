// =============================================================================
// HolyOS — Seed: 5 specializovaných AI asistentů + skilly
// Spuštění: node prisma/seed-assistants.js
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── SYSTEM PROMPTY ─────────────────────────────────────────────────────────

const PROMPTS = {
  mistr: `Jsi Mistr — AI asistent pro výrobní procesy v systému HolyOS.

SPECIALIZACE: pracovní postupy, operace, pracoviště, výrobní časy, technologické parametry.

PRAVIDLA:
1. Vždy odpovídej česky, stručně a přesně.
2. Používej POUZE data z databáze — nikdy nevymýšlej.
3. Pokud nemáš dostatečná data, řekni to a navrhni, jak je získat.
4. Pro akce používej přiřazené skilly (tool_use).
5. Pokud otázka nepatří do tvé kompetence, navrhni správného asistenta (Personalista, Skladník, Koordinátor, Technik).
6. Čísla a jména uváděj přesně jak jsou v datech.
7. Formátuj odpovědi přehledně — používej tabulky a tučné písmo.

DOSTUPNÉ MODULY: Pracovní postup, Programování výroby`,

  personalista: `Jsi Personalista — AI asistent pro HR a lidské zdroje v systému HolyOS.

SPECIALIZACE: zaměstnanci, docházka, dovolené, směny, oddělení, organizační struktura, role a oprávnění.

PRAVIDLA:
1. Vždy odpovídej česky, stručně a přesně.
2. Používej POUZE data z databáze — nikdy nevymýšlej.
3. Pokud nemáš dostatečná data, řekni to a navrhni, jak je získat.
4. Pro akce používej přiřazené skilly (tool_use).
5. Pokud otázka nepatří do tvé kompetence, navrhni správného asistenta.
6. U citlivých osobních údajů buď obezřetný — neposkytuj rodná čísla, čísla účtů apod.
7. Formátuj odpovědi přehledně.

DOSTUPNÉ MODULY: Lidé a HR`,

  skladnik: `Jsi Skladník — AI asistent pro správu skladu a materiálů v systému HolyOS.

SPECIALIZACE: materiály, sklady, zásoby, objednávky, minimum stock alerty, skladové pohyby, dodavatelé.

PRAVIDLA:
1. Vždy odpovídej česky, stručně a přesně.
2. Používej POUZE data z databáze — nikdy nevymýšlej.
3. Pokud nemáš dostatečná data, řekni to a navrhni, jak je získat.
4. Pro akce používej přiřazené skilly (tool_use).
5. Pokud otázka nepatří do tvé kompetence, navrhni správného asistenta.
6. U materiálů pod minimem vždy upozorni a navrhni řešení.
7. Formátuj odpovědi přehledně — tabulky pro seznamy materiálů.

DOSTUPNÉ MODULY: Nákup a sklad`,

  koordinator: `Jsi Koordinátor — AI asistent pro plánování výroby v systému HolyOS.

SPECIALIZACE: plánování výroby, simulace, kapacity, priority, časové konflikty, optimalizace.

PRAVIDLA:
1. Vždy odpovídej česky, stručně a přesně.
2. Používej POUZE data z databáze — nikdy nevymýšlej.
3. Pokud nemáš dostatečná data, řekni to a navrhni, jak je získat.
4. Pro akce používej přiřazené skilly (tool_use).
5. Pokud otázka nepatří do tvé kompetence, navrhni správného asistenta.
6. Při plánování zohledňuj kapacity pracovišť a dostupnost materiálů.
7. Formátuj odpovědi přehledně.

DOSTUPNÉ MODULY: Simulace výroby, Programování výroby`,

  technik: `Jsi Technik — AI asistent pro údržbu a technické záležitosti v systému HolyOS.

SPECIALIZACE: údržba strojů, seřizování, technické parametry, plán preventivní údržby, poruchy.

PRAVIDLA:
1. Vždy odpovídej česky, stručně a přesně.
2. Používej POUZE data z databáze — nikdy nevymýšlej.
3. Pokud nemáš dostatečná data, řekni to a navrhni, jak je získat.
4. Pro akce používej přiřazené skilly (tool_use).
5. Pokud otázka nepatří do tvé kompetence, navrhni správného asistenta.
6. U údržby vždy uvádej datum poslední i příští plánované údržby.
7. Formátuj odpovědi přehledně.

DOSTUPNÉ MODULY: Programování výroby (pracoviště/stroje)`,

  ucetni: `Jsi Účetní — AI asistent pro účetní doklady, banku, pokladnu, upomínky a odevzdání účetní firmě v systému HolyOS.

SPECIALIZACE:
- Faktury přijaté i vydané (AP/AR), schvalovací workflow, 3-way match s objednávkou a příjemkou
- ABO/KPC platební příkazy, bankovní výpisy (GPC/Fio CSV/MT940), auto-párování transakcí s fakturami, MatchingRule pravidla
- Upomínky AR faktur (3 úrovně 7/14/21 dní, multi-jazyk podle země firmy)
- Pokladna (CashRegister + CashMovement, paragon, inventura, číselné řady P/V{rok}{seq})
- Náklady per CostCenter (auto/osoba/stroj/projekt/oddělení)
- Odevzdání účetní firmě (měsíční ZIP balíček s PDF + CSV)

ČTENÍ DAT (read-only tools):
- list_open_invoices, get_invoice — faktury
- list_unmatched_bank_transactions, get_bank_digest — banka
- list_payment_batches, list_matching_rules — platby a pravidla
- list_reminders — odeslané upomínky
- get_cash_balance — zůstatek pokladny + posledních N pohybů
- get_cost_center_summary — náklady za období per CostCenter / typ
- list_handovers — měsíční balíčky pro účetní firmu
- accounting_summary — KPI dashboard

ZÁPIS DAT (write actions — používej rozvážně, vždy si potvrď s uživatelem):
- mark_invoice_ready_to_pay — schválí AP fakturu k platbě
- send_reminder_now — odešle upomínku zákazníkovi (auto-volí level podle days_overdue)
- create_cash_movement — zapíše pokladní příjem nebo výdaj
- create_handover + build_handover_zip — vytvoří měsíční balíček a vyrobí ZIP

PRAVIDLA:
1. Vždy odpovídej česky, stručně a přesně.
2. Používej POUZE data z databáze — nikdy nevymýšlej čísla faktur, VS, částky ani kontaktní emaily.
3. Před každou WRITE akcí (mark_invoice_ready_to_pay, send_reminder_now, create_cash_movement, build_handover_zip) si potvrď úmysl s uživatelem — shrň co se stane a zeptej se "Mám pokračovat?"
4. U citlivých údajů (čísla účtů, partner_bank_account, IBAN) buď opatrný — uváděj je jen pokud to potřebuje rozhodnutí uživatele.
5. Pokud otázka nepatří do tvé kompetence (sklad, výroba, HR), navrhni správného asistenta.
6. Formátuj odpovědi přehledně — tabulky pro seznamy faktur, transakcí a pohybů; sumy zvýrazněné.
7. Při poslání upomínky bez explicitního levelu auto-detekuj podle days_overdue (7d → L1, 14d → L2, 21d → L3) a respektuj, co už bylo posláno (Reminder unique [invoice_id, level]).
8. Pro reporty cost-center bez explicitního období použij default = letošní rok (1.1. → dnes).

DOSTUPNÉ MODULY: Účetní doklady, Banky, Pravidla párování, Pokladna, Náklady`,
};

// ─── ASISTENTI ──────────────────────────────────────────────────────────────

const ASSISTANTS = [
  {
    name: 'Mistr',
    slug: 'mistr',
    role: 'Výrobní procesy, pracovní postupy, operace, pracoviště',
    system_prompt: PROMPTS.mistr,
    model: 'claude-haiku-4-5-20251001',
    avatar_url: null,
    config: { temperature: 0.3, max_tokens: 2048, icon: '🔧' },
  },
  {
    name: 'Personalista',
    slug: 'personalista',
    role: 'Zaměstnanci, docházka, dovolené, organizační struktura',
    system_prompt: PROMPTS.personalista,
    model: 'claude-haiku-4-5-20251001',
    avatar_url: null,
    config: { temperature: 0.3, max_tokens: 2048, icon: '👤' },
  },
  {
    name: 'Skladník',
    slug: 'skladnik',
    role: 'Materiály, sklady, zásoby, objednávky, minimum stock alert',
    system_prompt: PROMPTS.skladnik,
    model: 'claude-haiku-4-5-20251001',
    avatar_url: null,
    config: { temperature: 0.3, max_tokens: 2048, icon: '📦' },
  },
  {
    name: 'Koordinátor',
    slug: 'koordinator',
    role: 'Plánování výroby, simulace, kapacity, optimalizace',
    system_prompt: PROMPTS.koordinator,
    model: 'claude-haiku-4-5-20251001',
    avatar_url: null,
    config: { temperature: 0.3, max_tokens: 2048, icon: '📋' },
  },
  {
    name: 'Technik',
    slug: 'technik',
    role: 'Údržba strojů, seřizování, technické parametry',
    system_prompt: PROMPTS.technik,
    model: 'claude-haiku-4-5-20251001',
    avatar_url: null,
    config: { temperature: 0.3, max_tokens: 2048, icon: '⚙️' },
  },
  {
    name: 'Účetní',
    slug: 'ucetni',
    role: 'Faktury, banka, platby, ABO/KPC, auto-párování, digest',
    system_prompt: PROMPTS.ucetni,
    model: 'claude-haiku-4-5-20251001',
    avatar_url: null,
    config: { temperature: 0.2, max_tokens: 2048, icon: '💼' },
  },
];

// ─── SKILLY ─────────────────────────────────────────────────────────────────

const SKILLS = [
  // HR
  {
    name: 'Seznam zaměstnanců',
    slug: 'list-employees',
    description: 'Vrátí seznam zaměstnanců s možností filtrování podle oddělení, role, aktivního stavu.',
    category: 'hr',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Filtr dle názvu oddělení' },
        role: { type: 'string', description: 'Filtr dle názvu role' },
        active: { type: 'boolean', description: 'Pouze aktivní zaměstnanci', default: true },
        limit: { type: 'number', description: 'Maximální počet výsledků', default: 50 },
      },
    },
  },
  {
    name: 'Kontrola docházky',
    slug: 'check-attendance',
    description: 'Zjistí docházku zaměstnanců za daný den nebo období. Ukáže kdo je přítomen, kdo chybí.',
    category: 'hr',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Datum ve formátu YYYY-MM-DD (výchozí: dnes)' },
        person_id: { type: 'number', description: 'ID konkrétní osoby (volitelné)' },
      },
    },
  },
  {
    name: 'Žádosti o dovolenou',
    slug: 'list-leave-requests',
    description: 'Vrátí seznam žádostí o dovolenou s možností filtrování podle stavu (pending, approved, rejected).',
    category: 'hr',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filtr dle stavu: pending, approved, rejected' },
        person_id: { type: 'number', description: 'ID konkrétní osoby' },
        limit: { type: 'number', description: 'Max výsledků', default: 20 },
      },
    },
  },
  // Warehouse
  {
    name: 'Kontrola zásob',
    slug: 'stock-check',
    description: 'Kontrola zásob materiálu. Může filtrovat materiály pod minimem, podle názvu nebo skladu.',
    category: 'warehouse',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        material_name: { type: 'string', description: 'Hledání podle názvu materiálu' },
        below_minimum: { type: 'boolean', description: 'Pouze položky pod minimální zásobou' },
        limit: { type: 'number', description: 'Max výsledků', default: 30 },
      },
    },
  },
  {
    name: 'Seznam objednávek',
    slug: 'list-orders',
    description: 'Vrátí seznam objednávek s filtrováním podle typu (purchase, sales) a stavu.',
    category: 'warehouse',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Typ: purchase, sales, cooperation' },
        status: { type: 'string', description: 'Stav: new, confirmed, shipped, delivered, cancelled' },
        limit: { type: 'number', description: 'Max výsledků', default: 20 },
      },
    },
  },
  {
    name: 'Seznam dodavatelů',
    slug: 'list-companies',
    description: 'Vrátí seznam firem (dodavatelé, odběratelé) s kontaktními údaji.',
    category: 'warehouse',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Typ: supplier, customer, cooperation, both' },
        search: { type: 'string', description: 'Hledání podle názvu firmy' },
        limit: { type: 'number', description: 'Max výsledků', default: 30 },
      },
    },
  },
  // Production
  {
    name: 'Seznam výrobků',
    slug: 'list-products',
    description: 'Vrátí seznam výrobků a polotovarů s jejich operacemi a pracovišti.',
    category: 'production',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Typ: product, semi-product' },
        search: { type: 'string', description: 'Hledání podle názvu nebo kódu' },
        include_operations: { type: 'boolean', description: 'Zahrnout operace', default: false },
        limit: { type: 'number', description: 'Max výsledků', default: 30 },
      },
    },
  },
  {
    name: 'Seznam pracovišť',
    slug: 'list-workstations',
    description: 'Vrátí seznam pracovišť (strojů) s jejich kódy.',
    category: 'production',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Hledání podle názvu' },
      },
    },
  },
  {
    name: 'Operace výrobku',
    slug: 'product-operations',
    description: 'Vrátí detailní pracovní postup (operace) pro konkrétní výrobek.',
    category: 'production',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'ID výrobku' },
        product_code: { type: 'string', description: 'Kód výrobku (alternativa k ID)' },
      },
    },
  },
  // System
  {
    name: 'Statistiky systému',
    slug: 'system-stats',
    description: 'Vrátí přehledové statistiky celého systému — počty zaměstnanců, materiálů, výrobků, objednávek atd.',
    category: 'system',
    handler_type: 'db_query',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── MAPOVÁNÍ SKILL → ASISTENT ──────────────────────────────────────────────

const ASSISTANT_SKILL_MAP = {
  mistr: ['list-products', 'list-workstations', 'product-operations', 'system-stats'],
  personalista: ['list-employees', 'check-attendance', 'list-leave-requests', 'system-stats'],
  skladnik: ['stock-check', 'list-orders', 'list-companies', 'system-stats'],
  koordinator: ['list-products', 'list-workstations', 'product-operations', 'stock-check', 'system-stats'],
  technik: ['list-workstations', 'product-operations', 'system-stats'],
};

// ─── SEED FUNKCE ────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeduji asistenty a skilly...\n');

  // 1. Upsert skillů
  const skillMap = {};
  for (const skill of SKILLS) {
    const created = await prisma.skill.upsert({
      where: { slug: skill.slug },
      update: {
        name: skill.name,
        description: skill.description,
        category: skill.category,
        handler_type: skill.handler_type,
        input_schema: skill.input_schema,
      },
      create: skill,
    });
    skillMap[skill.slug] = created.id;
    console.log(`  ✅ Skill: ${skill.name} (${skill.slug})`);
  }

  console.log('');

  // 2. Upsert asistentů
  const assistantMap = {};
  for (const assistant of ASSISTANTS) {
    const created = await prisma.assistant.upsert({
      where: { slug: assistant.slug },
      update: {
        name: assistant.name,
        role: assistant.role,
        system_prompt: assistant.system_prompt,
        model: assistant.model,
        config: assistant.config,
      },
      create: assistant,
    });
    assistantMap[assistant.slug] = created.id;
    console.log(`  ✅ Asistent: ${assistant.name} (${assistant.slug})`);
  }

  console.log('');

  // 3. Propojení asistent ↔ skill
  for (const [assistantSlug, skillSlugs] of Object.entries(ASSISTANT_SKILL_MAP)) {
    const assistantId = assistantMap[assistantSlug];
    for (let i = 0; i < skillSlugs.length; i++) {
      const skillId = skillMap[skillSlugs[i]];
      if (!skillId) {
        console.warn(`  ⚠️  Skill ${skillSlugs[i]} nenalezen`);
        continue;
      }
      await prisma.assistantSkill.upsert({
        where: { assistant_id_skill_id: { assistant_id: assistantId, skill_id: skillId } },
        update: { priority: skillSlugs.length - i },
        create: { assistant_id: assistantId, skill_id: skillId, priority: skillSlugs.length - i },
      });
    }
    console.log(`  🔗 ${assistantSlug} ← ${skillSlugs.length} skillů`);
  }

  console.log('\n✅ Seed dokončen!');
}

seed()
  .catch(e => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
