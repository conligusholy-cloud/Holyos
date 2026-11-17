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
const POZEMKY = require('./pozemky');

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
    select: { player_id: true, spot_id: true, model: true, pozemek: true, cena: true },
  });

  const podleHrace = new Map();
  claims.forEach((c) => {
    const a = podleHrace.get(c.player_id) || { stroju: 0, pozemku: 0, hodnota: 0, zeme: 0 };
    if (c.model && CENY_STROJU[c.model]) { a.stroju++; a.hodnota += CENY_STROJU[c.model]; }
    // Koupená zem je nemovitost a patří do majetku i prázdná. U pozemků
    // koupených dřív, než se cena ukládala, bereme střed cenového pásma.
    if (c.pozemek) {
      a.pozemku++;
      a.zeme += (c.cena != null ? c.cena : POZEMKY.odhad(c.spot_id));
    }
    podleHrace.set(c.player_id, a);
  });

  const radky = [];
  hraci.forEach((h) => {
    const st = h.state || null;
    if (!st) return;
    const dnes = Math.round(acct._cisteJmeni(st) || 0);
    const a = podleHrace.get(h.id) || { stroju: 0, pozemku: 0, hodnota: 0, zeme: 0 };
    const hotovost = Math.round(Number(st.cash) || 0);
    const dluh = Math.round(Number(st.loan) || 0);
    const server = Math.round(a.hodnota + a.zeme + hotovost - dluh);
    radky.push({
      id: h.id, nick: h.nick, dnes, server,
      pomer: dnes > 0 ? server / dnes : 1,
      stroju: a.stroju, pozemku: a.pozemku, zeme: a.zeme,
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

// ─── Rozdíly mezi evidencí míst a stavem hry ─────────────────────────────────
// Srovnání jmění ukázalo, že obojí nesedí, a to v obou směrech: někdo má
// v evidenci víc míst než ve hře, jiný naopak. Dokud se nevysvětlí proč,
// nejde na evidenci postavit jmění — jedněm by přibylo, druhým ubylo.
//
// Tohle to rozepíše po hráčích i po konkrétních místech, aby bylo vidět,
// jestli za tím je pronájem jinému hráči, koupený pozemek bez stroje,
// běžící výpověď, nebo něco, co se prostě rozešlo.
async function evidence() {
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false },
    select: { id: true, nick: true, state: true },
  });
  const claims = await prisma.gameSpotClaim.findMany({
    select: { spot_id: true, player_id: true, model: true, pozemek: true,
      najemce_id: true, vypoved_do: true, name: true },
  });
  const podleHrace = new Map();
  claims.forEach((c) => {
    const a = podleHrace.get(c.player_id) || [];
    a.push(c);
    podleHrace.set(c.player_id, a);
  });

  const out = [];
  hraci.forEach((h) => {
    const st = h.state || null;
    if (!st) return;
    const units = Array.isArray(st.units) ? st.units : [];
    const mych = podleHrace.get(h.id) || [];
    const idUnitu = new Set(units.map((u) => u && u.spotId).filter(Boolean));
    const idClaimu = new Set(mych.map((c) => c.spot_id));

    // Claim bez stroje ve hře. Může to být poctivé: koupený pozemek bez
    // stavby, nebo místo pronajaté jinému hráči.
    const navic = mych.filter((c) => !idUnitu.has(c.spot_id));
    // Stroj ve hře bez claimu. Tohle poctivé být nemůže: hra tvrdí, že tam
    // prádlomat stojí, a server o tom místě neví.
    const chybi = units.filter((u) => u && u.spotId && !idClaimu.has(u.spotId));

    if (!navic.length && !chybi.length) return;
    out.push({
      id: h.id, nick: h.nick,
      unitu: units.length, claimu: mych.length,
      navic: navic.map((c) => ({
        spot: c.spot_id, nazev: c.name, model: c.model || null,
        pozemek: !!c.pozemek, pronajato: !!c.najemce_id,
        vypoved: c.vypoved_do ? new Date(c.vypoved_do).toISOString().slice(0, 10) : null,
      })),
      chybi: chybi.map((u) => ({ spot: u.spotId, nazev: u.name || null, model: u.model || null })),
    });
  });
  out.sort((a, b) => (b.navic.length + b.chybi.length) - (a.navic.length + a.chybi.length));
  return out;
}

function tiskEvidence(rows) {
  const out = [];
  const sChybejicim = rows.filter((r) => r.chybi.length);
  out.push('Hráčů, kde evidence a hra nesedí: ' + rows.length);
  out.push('Z toho takových, kde hra tvrdí prádlomat a server o místě neví: '
    + sChybejicim.length);
  out.push('');
  // Proč je claim navíc — rozpad podle pravděpodobné příčiny.
  const duvody = { pozemek: 0, pronajato: 0, vypoved: 0, nevysvetleno: 0 };
  rows.forEach((r) => r.navic.forEach((c) => {
    if (c.pronajato) duvody.pronajato++;
    else if (c.pozemek && !c.model) duvody.pozemek++;
    else if (c.vypoved) duvody.vypoved++;
    else duvody.nevysvetleno++;
  }));
  out.push('Místa v evidenci bez stroje ve hře, podle příčiny:');
  out.push('  pronajaté jinému hráči:      ' + duvody.pronajato);
  out.push('  koupený pozemek bez stavby:  ' + duvody.pozemek);
  out.push('  běžící výpověď:              ' + duvody.vypoved);
  out.push('  nevysvětlené:                ' + duvody.nevysvetleno + '  \u2190 tohle je ten problém');
  out.push('');
  rows.slice(0, 30).forEach((r) => {
    out.push(r.nick + '  (hra ' + r.unitu + ' prádlomatů, evidence ' + r.claimu + ' míst)');
    r.navic.forEach((c) => {
      const proc = c.pronajato ? 'pronajato jinému' : (c.pozemek && !c.model) ? 'pozemek bez stavby'
        : c.vypoved ? ('výpověď do ' + c.vypoved) : 'NEVYSVĚTLENO';
      out.push('    v evidenci navíc: ' + String(c.spot).padEnd(24).slice(0, 24)
        + ' ' + String(c.model || '\u2014').padEnd(6) + ' ' + proc);
    });
    r.chybi.forEach((u) => {
      out.push('    hra tvrdí prádlomat, server místo nezná: '
        + String(u.spot).padEnd(24).slice(0, 24) + ' ' + (u.model || '\u2014'));
    });
  });
  if (rows.length > 30) out.push('\u2026 a dalších ' + (rows.length - 30));
  return out.join('\n');
}

// ─── Sklad: co o něm ví server proti tomu, co má hra ─────────────────────────
// Nákup stroje se teď zapisuje i na server. Než na tom může stát jmění nebo
// než se ze skladu stane podmínka stavby, musí být vidět, že se obojí trefuje
// do stejných čísel. Rozdíly se dají čekat u hráčů, kteří kupovali dřív, než
// se tohle zapínalo — ti budou mít serverový sklad prázdný.
async function sklad() {
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false }, select: { id: true, nick: true, state: true },
  });
  const rows = await prisma.gameOrder.findMany({
    where: { postaveno_at: null, zruseno_at: null },
    select: { player_id: true, model: true, dorazi_at: true },
  });
  // Bez tohohle nejde rozeznat „ještě nikdo nekoupil" od „zapisování
  // nefunguje". Obojí vypadá v tabulce stejně: samé nuly.
  const [zapsano, posledni] = await Promise.all([
    prisma.gameOrder.count(),
    prisma.gameOrder.findFirst({ orderBy: { id: 'desc' },
      select: { created_at: true, model: true, player_id: true } }),
  ]);
  const ted = Date.now();
  const podleHrace = new Map();
  rows.forEach((r) => {
    const a = podleHrace.get(r.player_id) || { skladem: 0, naceste: 0 };
    if (new Date(r.dorazi_at).getTime() <= ted) a.skladem++; else a.naceste++;
    podleHrace.set(r.player_id, a);
  });

  const out = [];
  hraci.forEach((h) => {
    const st = h.state || null;
    if (!st) return;
    const sk = st.stock && typeof st.stock === 'object' ? st.stock : {};
    const hraSkladem = Object.keys(sk).reduce((a, k) => a + Math.max(0, Math.round(Number(sk[k]) || 0)), 0);
    const hraNaceste = Array.isArray(st.orders) ? st.orders.length : 0;
    const a = podleHrace.get(h.id) || { skladem: 0, naceste: 0 };
    if (!hraSkladem && !hraNaceste && !a.skladem && !a.naceste) return;
    out.push({ nick: h.nick, hraSkladem, hraNaceste,
      serverSkladem: a.skladem, serverNaceste: a.naceste,
      sedi: hraSkladem === a.skladem && hraNaceste === a.naceste });
  });
  out.sort((x, y) => (x.sedi === y.sedi ? 0 : x.sedi ? 1 : -1));
  out.zapsano = zapsano;
  out.posledni = posledni;
  return out;
}

function tiskSklad(rows) {
  const nesedi = rows.filter((r) => !r.sedi);
  const out = [];
  out.push('Hráčů se strojem na cestě nebo ve skladu: ' + rows.length);
  out.push('Z toho se serveru a hře rozchází: ' + nesedi.length);
  out.push('');
  out.push('nick                 hra skl/cesta   server skl/cesta');
  out.push('-'.repeat(56));
  rows.slice(0, 60).forEach((r) => {
    out.push(String(r.nick || '').padEnd(20).slice(0, 20)
      + (r.hraSkladem + '/' + r.hraNaceste).padStart(14)
      + (r.serverSkladem + '/' + r.serverNaceste).padStart(19)
      + (r.sedi ? '' : '   \u2190 nesedí'));
  });
  if (rows.length > 60) out.push('\u2026 a dalších ' + (rows.length - 60));
  out.push('');
  out.push('Hráči, kteří kupovali dřív, než se nákup začal zapisovat, budou mít');
  out.push('serverový sklad prázdný. Zajímavé jsou až ty, co koupili potom.');
  out.push('');
  out.push('Objednávek zapsaných na serveru celkem: ' + (rows.zapsano || 0));
  if (rows.posledni) {
    out.push('Poslední zápis: ' + new Date(rows.posledni.created_at).toISOString().slice(0, 19).replace('T', ' ')
      + '  (' + rows.posledni.model + ', hráč #' + rows.posledni.player_id + ')');
  } else {
    out.push('Zatím ani jeden. Buď od nasazení nikdo nekoupil stroj, nebo se');
    out.push('zápis nedaří — pozná se tak, že jeden stroj koupíš a číslo výš');
    out.push('se zvedne na jedničku.');
  }
  return out.join('\n');
}

module.exports = { srovnani, tisk, evidence, tiskEvidence, sklad, tiskSklad,
  CENY_STROJU, stupen };
