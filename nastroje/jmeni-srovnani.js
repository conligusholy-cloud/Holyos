// Srovnání jmění: co hra hlásí dnes proti tomu, co si server spočítá sám.
//
// Nic nemění, jen čte a tiskne. Je to podklad k jedinému rozhodnutí: o kolik
// posunout prahy hodností, aby po přechodu na serverové počítání nikdo
// nespadl o stupeň dolů.
//
// Dnešní číslo (cisteJmeni) sčítá prádlomaty, stroje skladem, zboží na cestě,
// pozemky, přípravy ploch, pobočky a četu — všechno z uloženého stavu hry,
// tedy z toho, co poslal prohlížeč. Serverové číslo sčítá jen to, co server
// ví sám: postavené prádlomaty z evidence míst. Hotovost a dluh zatím bere
// obojí ze stavu, ty se oddělí až dalším krokem.
//
// Spustit: node nastroje/jmeni-srovnani.js
'use strict';

const { prisma } = require('../config/database');
const acct = require('../routes/game-account.routes');
const { HODNOSTI } = require('../services/game/hodnosti');

// Musí sedět s CENY_STROJU v routes/game-account.routes.js.
const CENY_STROJU = {
  mini: Math.round(35000 * 24.35 * 1.25),
  flex: Math.round(52000 * 24.35 * 1.25),
  max: Math.round(67000 * 24.35 * 1.25),
};

function kc(n) {
  return Math.round(n).toLocaleString('cs-CZ');
}
function stupen(jmeni) {
  let out = HODNOSTI[0];
  HODNOSTI.forEach((h) => { if (jmeni >= h.od) out = h; });
  return out.id;
}
function poradi(id) {
  return HODNOSTI.findIndex((h) => h.id === id);
}

(async () => {
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false },
    select: { id: true, nick: true, company: true, state: true, state_at: true },
  });
  const claims = await prisma.gameSpotClaim.findMany({
    select: { player_id: true, model: true, pozemek: true },
  });

  const podleHrace = new Map();
  claims.forEach((c) => {
    const a = podleHrace.get(c.player_id) || { stroju: 0, pozemku: 0, hodnota: 0 };
    if (c.model && CENY_STROJU[c.model]) { a.stroju++; a.hodnota += CENY_STROJU[c.model]; }
    else if (c.pozemek) a.pozemku++;
    podleHrace.set(c.player_id, a);
  });

  const radky = [];
  hraci.forEach((h) => {
    const st = h.state || null;
    if (!st) return;
    const dnes = Math.round(acct._cisteJmeni(st) || 0);
    const a = podleHrace.get(h.id) || { stroju: 0, pozemku: 0, hodnota: 0 };
    const hotovost = Math.round(Number(st.cash) || 0);
    const dluh = Math.round(Number(st.loan) || 0);
    const server = Math.round(a.hodnota + hotovost - dluh);
    radky.push({
      nick: h.nick, firma: h.company, dnes, server,
      pomer: dnes > 0 ? server / dnes : 1,
      stroju: a.stroju, pozemku: a.pozemku,
      unitu: Array.isArray(st.units) ? st.units.length : 0,
      hodnostDnes: stupen(dnes), hodnostServer: stupen(server),
    });
  });

  radky.sort((x, y) => y.dnes - x.dnes);

  console.log('Hráčů s rozehranou hrou: ' + radky.length + '\n');
  console.log('nick                 jmění dnes        jmění server      poměr  stroje/units  hodnost');
  console.log('-'.repeat(100));
  radky.slice(0, 40).forEach((r) => {
    const zmena = r.hodnostDnes === r.hodnostServer ? r.hodnostDnes
      : r.hodnostDnes + ' → ' + r.hodnostServer + '  ↓';
    console.log(
      r.nick.padEnd(20).slice(0, 20)
      + kc(r.dnes).padStart(16)
      + kc(r.server).padStart(18)
      + (Math.round(r.pomer * 100) + ' %').padStart(8)
      + (r.stroju + '/' + r.unitu).padStart(14)
      + '  ' + zmena);
  });
  if (radky.length > 40) console.log('… a dalších ' + (radky.length - 40));

  // ── Co by se stalo s hodnostmi ───────────────────────────────────────────
  const spadli = radky.filter((r) => poradi(r.hodnostServer) < poradi(r.hodnostDnes));
  console.log('\nSpadlo by o hodnost: ' + spadli.length + ' z ' + radky.length);
  const poStupnich = {};
  spadli.forEach((r) => {
    const k = r.hodnostDnes + ' → ' + r.hodnostServer;
    poStupnich[k] = (poStupnich[k] || 0) + 1;
  });
  Object.keys(poStupnich).forEach((k) => console.log('  ' + k + ': ' + poStupnich[k]));

  // ── Poměr, podle kterého se dají posunout prahy ──────────────────────────
  const pomery = radky.filter((r) => r.dnes > 1e6).map((r) => r.pomer).sort((a, b) => a - b);
  if (pomery.length) {
    const median = pomery[Math.floor(pomery.length / 2)];
    const p10 = pomery[Math.floor(pomery.length * 0.1)];
    const p90 = pomery[Math.floor(pomery.length * 0.9)];
    console.log('\nPoměr server/dnes u hráčů nad milion:');
    console.log('  nejnižší desetina: ' + Math.round(p10 * 100) + ' %');
    console.log('  medián:            ' + Math.round(median * 100) + ' %');
    console.log('  nejvyšší desetina: ' + Math.round(p90 * 100) + ' %');
    console.log('\nPrahy hodností posunuté mediánem (návrh):');
    HODNOSTI.forEach((h) => {
      if (!h.od) return;
      console.log('  ' + h.id.padEnd(14) + kc(h.od).padStart(14) + '  →  '
        + kc(Math.round(h.od * median / 1e5) * 1e5).padStart(14));
    });
    console.log('\nRozptyl je důležitější než medián: čím dál od sebe desetiny leží,');
    console.log('tím hůř jeden posun sedne všem a tím spíš se hodnosti zmrazí natvrdo.');
  }

  // ── Z čeho se rozdíl skládá ──────────────────────────────────────────────
  const bezStroju = radky.filter((r) => r.unitu > 0 && r.stroju === 0);
  if (bezStroju.length) {
    console.log('\nPozor: ' + bezStroju.length + ' hráčů má prádlomaty ve stavu hry,');
    console.log('ale žádný v evidenci míst. U nich serverové číslo nesedí z jiného důvodu.');
    bezStroju.slice(0, 10).forEach((r) => console.log('  ' + r.nick + ' — ' + r.unitu + ' units'));
  }
  const pozemkaru = radky.filter((r) => r.pozemku > 0).length;
  console.log('\nHráčů s koupeným pozemkem: ' + pozemkaru
    + ' (pozemky se do serverového čísla zatím nepočítají)');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e && e.message);
  try { await prisma.$disconnect(); } catch (x) { /* nevadí */ }
  process.exit(1);
});
