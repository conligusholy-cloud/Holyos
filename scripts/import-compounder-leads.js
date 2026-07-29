// =============================================================================
// HolyOS — Import kontaktů do Compounder leadů + přiřazení obchodníka
// =============================================================================
// Načte připravená data (scripts/data/leady-automycky-compounder.json), pro každý
// kontakt zkontroluje duplicitu (e-mail / telefon / jméno) a blocklist stejně jako
// ostrý endpoint POST /api/compounder/leads, a založí nový CompounderLead s
// vyplněnou poznámkou. Přiřadí obchodníka „Alena Šídlová":
//   • pokud existuje jako interní Person → owner_person_id + created_by_person_id
//   • jinak jako externí obchodník z AppSetting external.sales_reps → external_rep_id
// Když obchodníka nenajde, NIC nezaloží a skončí s chybou (aby leady nezůstaly bez
// požadovaného vlastníka).
//
// Spuštění (lokálně proti Railway DB — DATABASE_URL v .env):
//   node scripts/import-compounder-leads.js            (DRY-RUN — jen vypíše, co by udělal)
//   node scripts/import-compounder-leads.js --apply    (opravdu zapíše do DB)
//   node scripts/import-compounder-leads.js --apply --owner "Jméno Příjmení"   (jiný obchodník)
//   node scripts/import-compounder-leads.js --file "cesta/data.json"           (jiný zdroj)
//
// Idempotentní: existující kontakt (shoda e-mail/telefon/jméno) se přeskočí, ne duplikuje.

'use strict';

const fs = require('fs');
const path = require('path');
// Když DATABASE_URL chybí/není platná v prostředí, načti ji z .env. MUSÍ být před
// require('../config/database').
if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = t.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  } catch (e) { /* .env nemusí existovat */ }
}
const { prisma } = require('../config/database');

// ─── Parametry příkazové řádky ──────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return (i !== -1 && args[i + 1]) ? args[i + 1] : def;
}
const OWNER_NAME = argVal('--owner', 'Alena Šídlová');
const DATA_FILE = argVal('--file', path.join(__dirname, 'data', 'leady-automycky-compounder.json'));
const ROLE = 'compounder';      // typ leadu v Compounderu
const SOURCE = 'import';        // odlišitelný zdroj (pro případný rollback)

// ─── Pomocné normalizace (shodné s routes/compounder.routes.js) ───────────────
const norm = (s) => String(s || '').trim();
const digits9 = (s) => String(s || '').replace(/\D/g, '').slice(-9);

// Je kontakt na blocklistu? (email lowercase + telefon posledních 9 číslic)
async function isBlocked(email, phone) {
  const em = norm(email).toLowerCase();
  const ph = digits9(phone);
  const or = [];
  if (em && /.+@.+\..+/.test(em)) or.push({ email: em });
  if (ph && ph.length >= 6) or.push({ phone: ph });
  if (!or.length) return false;
  const hit = await prisma.compounderBlocklist
    .findFirst({ where: { OR: or }, select: { id: true } })
    .catch(() => null);
  return !!hit;
}

// Najdi existující lead (shoda e-mail / telefon / jméno) — stejná logika jako endpoint.
async function findDuplicate({ name, email, phone }) {
  const or = [];
  if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
  if (phone) or.push({ phone });
  if (name) or.push({ name: { equals: name, mode: 'insensitive' } });
  if (!or.length) return null;
  return prisma.compounderLead.findFirst({
    where: { OR: or },
    select: { id: true, name: true, owner_person_id: true },
  });
}

// ─── Dohledání obchodníka (interní Person nebo externí rep z AppSetting) ──────
async function resolveOwner(fullName) {
  const parts = norm(fullName).split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';

  // 1) Interní obchodník (Person). Nejdřív přesná shoda jméno+příjmení, pak jen příjmení.
  let person = await prisma.person.findFirst({
    where: {
      first_name: { equals: first, mode: 'insensitive' },
      last_name: { equals: last, mode: 'insensitive' },
    },
    select: { id: true, first_name: true, last_name: true, active: true, is_salesperson: true, is_sales_lead: true },
  });
  if (!person && last) {
    person = await prisma.person.findFirst({
      where: { last_name: { equals: last, mode: 'insensitive' } },
      select: { id: true, first_name: true, last_name: true, active: true, is_salesperson: true, is_sales_lead: true },
    });
  }
  if (person) {
    return {
      kind: 'internal',
      id: person.id,
      label: `${person.first_name || ''} ${person.last_name || ''}`.trim() +
        ` (Person #${person.id}${person.is_salesperson || person.is_sales_lead ? ', obchodník' : ', BEZ role obchodníka'}${person.active ? '' : ', NEAKTIVNÍ'})`,
      warn: (!person.is_salesperson && !person.is_sales_lead) || !person.active,
    };
  }

  // 2) Externí obchodník z AppSetting external.sales_reps (JSON pole).
  const setting = await prisma.appSetting.findUnique({ where: { key: 'external.sales_reps' } }).catch(() => null);
  if (setting && setting.value) {
    let reps = [];
    try { reps = JSON.parse(setting.value); } catch (e) { reps = []; }
    if (Array.isArray(reps)) {
      const target = norm(fullName).toLowerCase();
      const rep = reps.find((r) => norm(r && r.jmeno).toLowerCase() === target) ||
                  reps.find((r) => last && norm(r && r.jmeno).toLowerCase().includes(last.toLowerCase()));
      if (rep && rep.id != null) {
        return { kind: 'external', id: rep.id, label: `${rep.jmeno} (externí rep #${rep.id})`, warn: false };
      }
    }
  }
  return null;
}

// ─── Hlavní běh ───────────────────────────────────────────────────────────────
(async function main() {
  console.log(`\n=== Import Compounder leadů ===`);
  console.log(`Režim: ${APPLY ? 'APPLY (zápis do DB)' : 'DRY-RUN (nic se nezapíše)'}`);
  console.log(`Obchodník: ${OWNER_NAME}`);
  console.log(`Zdroj dat: ${DATA_FILE}\n`);

  const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`Načteno kontaktů: ${leads.length}`);

  const owner = await resolveOwner(OWNER_NAME);
  if (!owner) {
    console.error(`\n✗ Obchodník „${OWNER_NAME}" nenalezen ani mezi interními (Person), ani mezi externími (AppSetting external.sales_reps).`);
    console.error(`  Zkontroluj jméno, nebo obchodníka nejdřív založ. Nic nebylo importováno.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`Přiřadím: ${owner.label} [${owner.kind}]`);
  if (owner.warn) console.log(`  ⚠ Pozor: osoba nemá roli obchodníka nebo je neaktivní — přiřazení proběhne, ale ověř to.`);
  console.log('');

  const nowStr = new Date().toLocaleString('cs-CZ');
  let created = 0, skippedDup = 0, skippedBlock = 0, skippedInvalid = 0;

  for (const lead of leads) {
    const name = norm(lead.name).slice(0, 255);
    const email = norm(lead.email).toLowerCase().slice(0, 255) || null;
    const phone = norm(lead.phone).slice(0, 40) || null;
    const notes = lead.notes || null;

    if (!email && !phone) { console.log(`  – přeskočeno (bez kontaktu): ${name}`); skippedInvalid++; continue; }

    const dup = await findDuplicate({ name, email, phone });
    if (dup) { console.log(`  – DUPLICITA, přeskočeno: ${name} → existující lead #${dup.id} (${dup.name})`); skippedDup++; continue; }

    if (await isBlocked(email, phone)) { console.log(`  – BLOCKLIST, přeskočeno: ${name}`); skippedBlock++; continue; }

    const data = {
      name: name || email || phone,
      email, phone, role: ROLE, status: 'new', source: SOURCE,
      notes,
      activity_log: `${nowStr} — Import (dávkový) + přiřazen obchodník ${OWNER_NAME}`,
    };
    if (owner.kind === 'internal') {
      data.owner_person_id = owner.id;
      data.created_by_person_id = owner.id;
    } else {
      data.external_rep_id = owner.id;
    }

    if (APPLY) {
      const c = await prisma.compounderLead.create({ data, select: { id: true } });
      console.log(`  ✓ vytvořen lead #${c.id}: ${data.name}`);
    } else {
      console.log(`  + [dry-run] založil bych: ${data.name} | ${email || '—'} | ${phone || '—'}`);
    }
    created++;
  }

  console.log(`\n=== Souhrn ===`);
  console.log(`${APPLY ? 'Vytvořeno' : 'K vytvoření'}: ${created}`);
  console.log(`Přeskočeno (duplicita): ${skippedDup}`);
  console.log(`Přeskočeno (blocklist): ${skippedBlock}`);
  console.log(`Přeskočeno (bez kontaktu): ${skippedInvalid}`);
  if (!APPLY) console.log(`\nToto byl DRY-RUN. Pro skutečný zápis spusť znovu s příznakem --apply.`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('Chyba importu:', e);
  await prisma.$disconnect();
  process.exit(1);
});
