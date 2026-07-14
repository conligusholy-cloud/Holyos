// =============================================================================
// HolyOS — Hromadné nastavení nájmů u lokalit prádlomatů (Compounding)
// =============================================================================
// Zapíše měsíční nájem (rentMonthlyCzk) do per-lokalita configu uloženého
// v AppSetting 'compounding.kiosks' (mapa { [KOD]: { version, rentMonthlyCzk } }).
// Verze u existujících lokalit se zachová, přepíše se jen nájem.
//
// Zdroj dat: soubor prodej prádlomatu.xlsx, sloupec "nájem (bez DPH)".
//
// Spuštění (v kořeni projektu, .env s DATABASE_URL):
//   node scripts/set-compounding-rents.js            # DRY-RUN (nic nezapíše, jen vypíše)
//   node scripts/set-compounding-rents.js --apply    # zapíše do DB
// =============================================================================

'use strict';

const { prisma } = require('../config/database');
const { getSetting, setSetting } = require('../services/settings');

const KEY = 'compounding.kiosks';
const APPLY = process.argv.includes('--apply');

// KOD → měsíční nájem (bez DPH) v CZK
const RENTS = {
  '2SPP': 8000, '2TAP': 5000, '2TXT': 8000, '2CTV': 5000, '2CTX': 5000,
  '2SHV': 5000, '2TXK': 8000, '00020CZ': 5000, '92HN': 5000, '68HC': 5000,
  '00021FR': 8000, '2TXR': 8000, '2DOI': 6722, '2ZVC': 5000, '2DKK': 5000,
  '2TXP': 8000, '2SHU': 5000, '2TXL': 8000, '00013CZ': 8000, '00011CZ': 3148,
  '2TXI': 8000, '2TAO': 8000, '2SHT': 5000, '2SPL': 8000, '2XTM': 5000,
  '00010CZ': 8000, '2TXM': 8000, '2TZX': 8000, '2TXS': 8000, '2XTL': 5000,
  '2SPI': 8000, '2SPK': 8000, '2TXO': 8000, '00014CZ': 8000, '2DOJ': 5000,
  '2SPN': 8000, '2SPE': 8000, '2SPM': 6500, '00016CZ': 8000,
};

(async () => {
  const map = await getSetting(KEY, { type: 'json', defaultValue: {} });
  const next = (map && typeof map === 'object') ? { ...map } : {};

  let changed = 0, same = 0;
  for (const [code, rent] of Object.entries(RENTS)) {
    const cur = next[code] || {};
    const prevRent = (typeof cur.rentMonthlyCzk === 'number') ? cur.rentMonthlyCzk : null;
    if (prevRent === rent) { same++; continue; }
    next[code] = { ...cur, rentMonthlyCzk: rent };
    console.log(`${code.padEnd(9)} ${String(prevRent ?? '—').padStart(8)}  →  ${String(rent).padStart(8)} Kč${cur.version ? '  (verze ' + cur.version + ')' : ''}`);
    changed++;
  }

  console.log(`\nCelkem lokalit v souboru: ${Object.keys(RENTS).length}`);
  console.log(`Ke změně: ${changed}, beze změny: ${same}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — nic nezapsáno. Spusť s  --apply  pro uložení.');
    await prisma.$disconnect();
    return;
  }

  await setSetting(KEY, next, {
    type: 'json',
    scope: 'compounding',
    description: 'Compounding — per-lokalita: verze kiosku + měsíční nájem (CZK)',
  });
  console.log('\n✅ Uloženo do AppSetting ' + KEY);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('Chyba:', e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
