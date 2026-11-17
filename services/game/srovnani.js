// =============================================================================
// Laundromat Tycoon — srovnání jmění: hra proti serveru
// =============================================================================
// Podklad k jedinému rozhodnutí před přepnutím žebříčku a hodností na
// serverové počítání: o kolik posunout prahy, aby po přechodu nikdo nespadl
// o stupeň dolů.
//
// Dnešní číslo (cisteJmeni) sčítá prádlomaty, stroje skladem, zboží na cestě,
// pozemky, přípravy ploch, pobočky a četu — všechno z uloženého stavu hry,
// tedy z toho, co poslal prohlížeč. Serverové číslo sčítá jen to, co server
// ví sám: postavené prádlomaty z evidence míst. Hotovost a dluh zatím bere
// obojí ze stavu, ty se oddělí až dalším krokem.
//
// Nic se tu nemění, jen se čte a počítá. Bydlí to ve službě, ne v nástroji,
// protože na produkční databázi je vidět jen z běžícího serveru — z vývojového
// prostředí se na ni nedá připojit.

'use strict';

const { prisma } = require('../../config/database');
const { HODNOSTI } = require('./hodnosti');

// Musí sedět s CENY_STROJU v routes/game-account.routes.js.
const CENY_STROJU = {
  mini: Math.round(35000 * 24.35 * 1.25),
  flex: Math.round(52000 * 24.35 * 1.25),
  max: Math.round(67000 * 24.35 * 1.25),
};

function stupen(jmeni) {
  let out = HODNOSTI[0];
  HODNOSTI.forEach((h) => { if (jmeni >= h.od) out = h; });
  return out.id;
}
function poradi(id) {
  return HODNOSTI.findIndex((h) => h.id === id);
}

async function srovnani() {
  // cisteJmeni si bereme až tady: routes/game-account.routes.js načítá spoustu
  // dalšího a na startu služby by to zbytečně proplétalo závislosti.
  const acct = require('../../routes/game-account.routes');

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
      id: h.id, nick: h.nick, dnes, server,
      pomer: dnes > 0 ? server / dnes : 1,
      stroju: a.stroju, pozemku: a.pozemku,
      unitu: Array.isArray(st.units) ? st.units.length : 0,
      hodnostDnes: stupen(dnes), hodnostServer: stupen(server),
    });
  });
  radky.sort((x, y) => y.dnes - x.dnes);

  const spadli = radky.filter((r) => poradi(r.hodnostServer) < poradi(r.hodnostDnes));
  const pomery = radky.filter((r) => r.dnes > 1e6).map((r) => r.pomer).sort((a, b) => a - b);
  const kvantil = (q) => (pomery.length ? pomery[Math.min(pomery.length - 1, Math.floor(pomery.length * q))] : 1);

  return {
    radky, spadli,
    hracu: radky.length,
    p10: kvantil(0.1), median: kvantil(0.5), p90: kvantil(0.9),
    bezEvidence: radky.filter((r) => r.unitu > 0 && r.stroju === 0),
    pozemkaru: radky.filter((r) => r.pozemku > 0).length,
  };
}

// ─── Výpis ───────────────────────────────────────────────────────────────────
const kc = (n) => Math.round(n).toLocaleString('cs-CZ');

function tisk(d, kolik) {
  const max = kolik || 40;
  const out = [];
  out.push('Hráčů s rozehranou hrou: ' + d.hracu);
  out.push('');
  out.push('nick                 jmění dnes        jmění server      poměr  stroje/units  hodnost');
  out.push('-'.repeat(100));
  d.radky.slice(0, max).forEach((r) => {
    const zmena = r.hodnostDnes === r.hodnostServer ? r.hodnostDnes
      : r.hodnostDnes + ' → ' + r.hodnostServer + '  ↓';
    out.push(String(r.nick || '').padEnd(20).slice(0, 20)
      + kc(r.dnes).padStart(16)
      + kc(r.server).padStart(18)
      + (Math.round(r.pomer * 100) + ' %').padStart(8)
      + (r.stroju + '/' + r.unitu).padStart(14)
      + '  ' + zmena);
  });
  if (d.radky.length > max) out.push('… a dalších ' + (d.radky.length - max));

  out.push('');
  out.push('Spadlo by o hodnost: ' + d.spadli.length + ' z ' + d.hracu);
  const poStupnich = {};
  d.spadli.forEach((r) => {
    const k = r.hodnostDnes + ' → ' + r.hodnostServer;
    poStupnich[k] = (poStupnich[k] || 0) + 1;
  });
  Object.keys(poStupnich).forEach((k) => out.push('  ' + k + ': ' + poStupnich[k]));

  out.push('');
  out.push('Poměr server/dnes u hráčů nad milion:');
  out.push('  nejnižší desetina: ' + Math.round(d.p10 * 100) + ' %');
  out.push('  medián:            ' + Math.round(d.median * 100) + ' %');
  out.push('  nejvyšší desetina: ' + Math.round(d.p90 * 100) + ' %');
  out.push('');
  out.push('Prahy hodností posunuté mediánem (návrh):');
  HODNOSTI.forEach((h) => {
    if (!h.od) return;
    out.push('  ' + h.id.padEnd(14) + kc(h.od).padStart(14) + '  →  '
      + kc(Math.round(h.od * d.median / 1e5) * 1e5).padStart(14));
  });
  out.push('');
  out.push('Rozptyl je důležitější než medián: čím dál od sebe desetiny leží,');
  out.push('tím hůř jeden posun sedne všem a tím spíš se hodnosti zmrazí natvrdo.');

  if (d.bezEvidence.length) {
    out.push('');
    out.push('Pozor: ' + d.bezEvidence.length + ' hráčů má prádlomaty ve stavu hry,');
    out.push('ale žádný v evidenci míst. U nich serverové číslo nesedí z jiného důvodu.');
    d.bezEvidence.slice(0, 10).forEach((r) => out.push('  ' + r.nick + ' — ' + r.unitu + ' units'));
  }
  out.push('');
  out.push('Hráčů s koupeným pozemkem: ' + d.pozemkaru
    + ' (pozemky se do serverového čísla zatím nepočítají)');
  return out.join('\n');
}

module.exports = { srovnani, tisk, CENY_STROJU, stupen };
