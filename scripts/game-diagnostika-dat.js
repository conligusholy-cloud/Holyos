// HolyOS / Laundromat Tycoon — diagnostika „zmizela data hráčů".
//
// Čte JEN data, nic nemění. Odpovídá na jedinou otázku: přišli hráči o uložený
// stav, nebo ho nikdy neměli?
//
// Rozhoduje `state_rev` — číslo se zvedá při KAŽDÉM uložení hry. Takže:
//   • state je prázdný a state_rev = 0  → hráč nikdy nic neuložil (jen se
//     zaregistroval a odešel). Žádná data nezmizela, nebyla.
//   • state je prázdný a state_rev > 0  → hráč stav MĚL a přišel o něj.
//     To umí jen dvě věci: „Začít znovu" (/account/reset) a „Smazat účet"
//     (/account/smazat) — obojí si pouští hráč sám s opsaným potvrzením.
//
// Spuštění (PowerShell, v adresáři projektu):
//   node scripts/game-diagnostika-dat.js
//
// POZOR na `railway run`: ten nastrčí vnitřní DATABASE_URL
// (postgres.railway.internal), na kterou se z PC nedá připojit. Skript si proto
// sám vezme DATABASE_PUBLIC_URL, pokud existuje (viz memory railway_public_db).
// Vynutit vnitřní adresu jde přepínačem --internal-db (běh přímo na serveru).

const fs = require('fs');
const path = require('path');

// .env fallback — když se skript nepouští přes railway run.
(function loadEnv() {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    t.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch (e) { /* .env nemusí existovat */ }
})();

if (process.env.DATABASE_PUBLIC_URL && !process.argv.includes('--internal-db')) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

// Srozumitelná rada místo „Can't reach database server".
try {
  const host = new URL(process.env.DATABASE_URL || '').hostname;
  if (/\.railway\.internal$/.test(host) && !process.argv.includes('--internal-db')) {
    console.error('Databáze je nastavená na vnitřní adresu ' + host + ', na tu se z PC nepřipojíš.');
    console.error('Pusť skript BEZ `railway run` (vezme si DATABASE_PUBLIC_URL z .env),');
    console.error('nebo si do .env doplň DATABASE_PUBLIC_URL z Railway → Postgres → Variables.');
    process.exit(1);
  }
} catch (e) { /* URL se nepodařilo přečíst — ať to zkusí Prisma sama */ }

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const kc = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
const den = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

async function main() {
  const hraci = await prisma.gamePlayer.findMany({
    select: {
      id: true, nick: true, email: true, zdroj: true, disabled: true,
      state_at: true, state_rev: true, created_at: true, last_login_at: true,
    },
    orderBy: { created_at: 'desc' },
  });
  // `state` je velký JSON — stáhneme si jen informaci, jestli vůbec je.
  const maStav = new Map();
  const rows = await prisma.$queryRaw`select id, (state is not null) as ma from game_players`;
  rows.forEach((r) => maStav.set(Number(r.id), !!r.ma));

  const sStavem = [];
  const nikdyNehrali = [];
  const prisliOStav = [];
  const smazani = [];

  for (const h of hraci) {
    if (h.nick === 'smazaný hráč') { smazani.push(h); continue; }
    if (maStav.get(h.id)) { sStavem.push(h); continue; }
    if ((h.state_rev || 0) > 0) prisliOStav.push(h);
    else nikdyNehrali.push(h);
  }

  console.log('═══ HRÁČI CELKEM: ' + hraci.length + ' ═══\n');
  console.log('  ✅ s uloženou rozehranou hrou : ' + sStavem.length);
  console.log('  ⚪ nikdy nic neuložili        : ' + nikdyNehrali.length + '  (registrace bez hraní — nic nezmizelo)');
  console.log('  ⚠️  stav MĚLI a přišli o něj  : ' + prisliOStav.length);
  console.log('  🗑️  smazané účty              : ' + smazani.length + '  (hráč si účet smazal sám)\n');

  if (prisliOStav.length) {
    console.log('── Hráči, kteří o uložený stav PŘIŠLI ──');
    console.log('(state_rev > 0 = hra se jim dřív ukládala; pak ji vynuloval reset nebo smazání účtu)\n');
    console.log('  id     nick                 uložení  registrace        poslední přihlášení  zdroj');
    prisliOStav.forEach((h) => {
      console.log('  ' + String(h.id).padEnd(6)
        + String(h.nick || '').slice(0, 20).padEnd(21)
        + String(h.state_rev).padStart(7) + '  '
        + den(h.created_at).padEnd(18)
        + den(h.last_login_at).padEnd(21)
        + (h.zdroj || '—'));
    });
    console.log('');
  }

  // Smazané účty: co po nich zbylo. Jméno ani e-mail už v DB nejsou (to je
  // smysl výmazu), ale datum registrace, poslední přihlášení a počet uložení
  // zůstávají — z toho se pozná, jestli šlo o skutečného hráče, nebo o účet,
  // co vznikl a hned zmizel. Původní nick najdeš v logu Railway na řádku
  // „[game] konec hry <nick>" — ten se zapisuje PŘED anonymizací.
  if (smazani.length) {
    const idsSmaz = smazani.map((h) => h.id);
    const [nakupy, obchody, pujckyL, pujckyB] = await Promise.all([
      prisma.gamePurchase.groupBy({ by: ['player_id'], where: { player_id: { in: idsSmaz }, status: 'paid' }, _count: { _all: true }, _sum: { amount_cents: true } }),
      prisma.gameTrade.groupBy({ by: ['from_id'], where: { from_id: { in: idsSmaz } }, _count: { _all: true } }),
      prisma.gameLoan.groupBy({ by: ['lender_id'], where: { lender_id: { in: idsSmaz } }, _count: { _all: true } }),
      prisma.gameLoan.groupBy({ by: ['borrower_id'], where: { borrower_id: { in: idsSmaz } }, _count: { _all: true } }),
    ]);
    const mapa = (arr, klic) => { const m = {}; arr.forEach((x) => { m[x[klic]] = x; }); return m; };
    const N = mapa(nakupy, 'player_id'), O = mapa(obchody, 'from_id');
    const PL = mapa(pujckyL, 'lender_id'), PB = mapa(pujckyB, 'borrower_id');

    console.log('── Smazané účty: co po nich zbylo ──');
    console.log('  id     registrace        poslední přihlášení  uložení  zaplatil      obchodů  půjček');
    smazani.forEach((h) => {
      const n = N[h.id];
      console.log('  ' + String(h.id).padEnd(6)
        + den(h.created_at).padEnd(18)
        + den(h.last_login_at).padEnd(21)
        + String(h.state_rev).padStart(7) + '  '
        + (n ? (kc((n._sum.amount_cents || 0) / 100) + ' Kč').padStart(12) : '—'.padStart(12))
        + String((O[h.id] && O[h.id]._count._all) || 0).padStart(9)
        + String(((PL[h.id] && PL[h.id]._count._all) || 0) + ((PB[h.id] && PB[h.id]._count._all) || 0)).padStart(8));
    });
    console.log('');
    console.log('  „uložení" = kolikrát se hra uložila, než hráč účet smazal.');
    console.log('  0–1 → účet vznikl a hned zmizel · vyšší číslo → opravdu hrál.');
    console.log('');
  }

  // Platili a nemají stav? To je to jediné, co opravdu pálí.
  const platici = await prisma.gamePurchase.groupBy({
    by: ['player_id'], where: { status: 'paid' }, _count: { _all: true }, _sum: { amount_cents: true },
  });
  const problem = platici.filter((x) => !maStav.get(x.player_id));
  console.log('── Zaplatili, ale nemají rozehranou hru: ' + problem.length + ' ──');
  for (const x of problem) {
    const h = hraci.find((y) => y.id === x.player_id);
    console.log('  #' + x.player_id + ' ' + (h ? h.nick : '?')
      + ' · nákupů ' + x._count._all
      + ' · ' + kc((x._sum.amount_cents || 0) / 100) + ' Kč'
      + ' · state_rev ' + (h ? h.state_rev : '?'));
  }
  console.log('');

  // Kdy se naposledy ukládalo — když se ukládání rozbilo, bude tu díra.
  const posledni = sStavem.map((h) => h.state_at).filter(Boolean).sort((a, b) => b - a);
  console.log('── Poslední uložení hry ──');
  console.log('  nejnovější: ' + den(posledni[0]));
  console.log('  nejstarší : ' + den(posledni[posledni.length - 1]));
  const den1 = Date.now() - 86400000;
  console.log('  uloženo za posledních 24 h: ' + posledni.filter((d) => new Date(d).getTime() > den1).length + ' hráčů');
}

main()
  .catch((e) => { console.error('CHYBA:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
