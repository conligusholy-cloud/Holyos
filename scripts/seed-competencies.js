// HolyOS — Seed kompetencí pro výrobu prádlomatů
//
// Idempotentní upsert podle `code`. Bezpečně se dá pustit opakovaně —
// existující záznamy se aktualizují, chybějící doplní.
//
// Použití:
//   node scripts/seed-competencies.js
//
// Dataset pokrývá hlavní oblasti výroby prádlomatů:
//   svarovna, montáž, elektro, kontrola, lakovna, balení.

const { prisma } = require('../config/database');

const COMPETENCIES = [
  // --- SVAROVNA ---
  { code: 'SVAR_MIG', name: 'Svařování MIG/MAG', category: 'svarovna',
    description: 'Svařování ocelových konstrukcí metodou MIG/MAG (135/136), bez certifikace ČSN.',
    level_max: 3 },
  { code: 'SVAR_TIG', name: 'Svařování TIG', category: 'svarovna',
    description: 'Svařování nerezi metodou TIG (141), pohledové svary.',
    level_max: 3 },
  { code: 'SVAR_PILA', name: 'Pásová pila — řezání profilů', category: 'svarovna',
    description: 'Řezání ocelových a hliníkových profilů na pásové pile, dodržení tolerancí ±1 mm.',
    level_max: 2 },

  // --- MONTÁŽ ---
  { code: 'MONT_RAM', name: 'Montáž rámu prádlomatu', category: 'montaz',
    description: 'Předmontáž svařeného rámu — usazení čepů, vodicích lišt, kontrola geometrie.',
    level_max: 3 },
  { code: 'MONT_BUBEN', name: 'Montáž bubnu a hřídele', category: 'montaz',
    description: 'Vyvážení a montáž pracího bubnu, předepsané utahovací momenty.',
    level_max: 3 },
  { code: 'MONT_FINAL', name: 'Finální montáž prádlomatu', category: 'montaz',
    description: 'Kompletace celého prádlomatu na hlavní lince — opláštění, ovládací panel, dvířka.',
    level_max: 2 },

  // --- ELEKTRO ---
  { code: 'ELEKTRO_MONT', name: 'Elektromontáž (vyhláška 50 §6)', category: 'elektro',
    description: 'Pracovník znalý dle § 6 vyhl. 50/1978 — práce na elektrickém zařízení do 1 kV.',
    level_max: 3 },
  { code: 'KAB_KIT', name: 'Kitová kabeláž', category: 'elektro',
    description: 'Sestavení kabelového kitu dle výkresu, krimpování, popisování.',
    level_max: 2 },
  { code: 'PLC_PROG', name: 'Programování PLC', category: 'elektro',
    description: 'Nahrání FW, parametrizace ovladače prádlomatu, ladění komunikace s HMI.',
    level_max: 3 },

  // --- BONDY (CNC řezání) ---
  { code: 'BOND_CNC', name: 'CNC řezání bondových desek', category: 'bondy',
    description: 'Programování a obsluha CNC frézy/laseru pro bondové desky, nastavení nástrojů.',
    level_max: 3 },
  { code: 'BOND_PAJ', name: 'Pájení bondů', category: 'bondy',
    description: 'Ruční pájení komponent na bondových deskách (BGA, SMD, THT).',
    level_max: 3 },

  // --- LAKOVNA ---
  { code: 'LAK_PRASKOVA', name: 'Prášková lakovna', category: 'lakovna',
    description: 'Předúprava povrchu, nanášení prášku, vypalování v peci. Kontrola tloušťky vrstvy.',
    level_max: 2 },

  // --- KONTROLA & ZKOUŠKY ---
  { code: 'KONTR_VYK', name: 'Kontrola dle výkresu', category: 'kontrola',
    description: 'Vstupní/mezioperační kontrola rozměrů a tolerancí dle výrobní dokumentace.',
    level_max: 2 },
  { code: 'ZKO_TESN', name: 'Zkouška těsnosti', category: 'kontrola',
    description: 'Tlaková zkouška vodního okruhu prádlomatu, dokumentace výsledků.',
    level_max: 2 },

  // --- BALENÍ & EXPEDICE ---
  { code: 'BAL_EXP', name: 'Balení a expedice', category: 'expedice',
    description: 'Zabalení hotového prádlomatu do dřevěné palety, fólie, dokumentace dodacího listu.',
    level_max: 1 },
];

async function main() {
  console.log(`Seed: ${COMPETENCIES.length} kompetencí (idempotentní upsert)`);

  let created = 0;
  let updated = 0;
  for (const c of COMPETENCIES) {
    const existing = await prisma.competency.findUnique({ where: { code: c.code } });
    await prisma.competency.upsert({
      where: { code: c.code },
      create: c,
      update: {
        name: c.name,
        category: c.category,
        description: c.description,
        level_max: c.level_max,
      },
    });
    if (existing) {
      updated++;
      console.log(`  ↻ ${c.code.padEnd(14)} (${c.category})`);
    } else {
      created++;
      console.log(`  + ${c.code.padEnd(14)} (${c.category})`);
    }
  }

  console.log('');
  console.log(`Hotovo: ${created} nových, ${updated} aktualizovaných.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('CHYBA:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
