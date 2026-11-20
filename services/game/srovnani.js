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
    // Rozhoduje součet, ne přihrádky. Zásilka, která doletěla, je pro server
    // sklad, ale hra ji vede na cestě, dokud si pro ni hráč nepřijde —
    // a obojí je správně. Rozdíl v přihrádkách tedy není chyba, chybí-li
    // nebo přebývá-li stroj, to ano.
    const hraCelkem = hraSkladem + hraNaceste;
    const serverCelkem = a.skladem + a.naceste;
    out.push({ nick: h.nick, hraSkladem, hraNaceste,
      serverSkladem: a.skladem, serverNaceste: a.naceste,
      hraCelkem, serverCelkem, sedi: hraCelkem === serverCelkem,
      prihradky: hraSkladem !== a.skladem || hraNaceste !== a.naceste });
  });
  out.sort((x, y) => (x.sedi === y.sedi ? 0 : x.sedi ? 1 : -1));
  out.zapsano = zapsano;
  out.posledni = posledni;
  return out;
}

function tiskSklad(rows) {
  const nesedi = rows.filter((r) => !r.sedi);
  const jenPrihradky = rows.filter((r) => r.sedi && r.prihradky);
  const out = [];
  out.push('Hráčů se strojem na cestě nebo ve skladu: ' + rows.length);
  out.push('Z toho se serveru a hře rozchází počtem: ' + nesedi.length);
  out.push('Jen jinak zařazené (doletěná zásilka, kterou si hráč ještě '
    + 'nevyzvedl): ' + jenPrihradky.length);
  out.push('');
  out.push('nick                 hra skl/cesta   server skl/cesta   celkem');
  out.push('-'.repeat(68));
  rows.slice(0, 60).forEach((r) => {
    out.push(String(r.nick || '').padEnd(20).slice(0, 20)
      + (r.hraSkladem + '/' + r.hraNaceste).padStart(14)
      + (r.serverSkladem + '/' + r.serverNaceste).padStart(19)
      + (r.hraCelkem + ' : ' + r.serverCelkem).padStart(10)
      + (r.sedi ? (r.prihradky ? '   \u00b7 jen zařazení' : '') : '   \u2190 NESEDÍ'));
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

// ─── Vidí server stejnou síť jako hra? ──────────────────────────────────────
// Evidence výš porovnává, na kterých MÍSTECH kdo stojí. Pro peníze je to
// ale málo: o tržbě rozhoduje model stroje a skóre místa. Dokud se tyhle
// dva údaje rozcházejí, nemá smysl porovnávat zisk — rozdíl by nebyl chybou
// výpočtu, ale tím, že se obě strany baví o jiné síti.
//
// Výsledkem je jediné číslo, na kterém pokladna stojí: kolik procent
// prádlomatů ve hře umí server ocenit přesně.
async function sit() {
  const EKO = require('./ekonomika');
  const POZEMKY = require('./pozemky');
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false },
    select: { id: true, nick: true, state: true, state_at: true } });
  const claims = await prisma.gameSpotClaim.findMany({
    select: { spot_id: true, player_id: true, model: true, rent: true,
      pozemek: true, score: true } });
  const podleMista = new Map(claims.map((c) => [c.spot_id, c]));

  const out = [];
  let presne = 0, odhadem = 0, nezname = 0, modelSpor = 0, skoreSpor = 0, cizich = 0;
  hraci.forEach((h) => {
    const st = h.state || null;
    if (!st || !Array.isArray(st.units)) return;
    const sporne = [];
    st.units.forEach((u) => {
      if (!u || !u.spotId) return;
      const c = podleMista.get(u.spotId);
      if (!c) { nezname++; return; }
      // Místo může mezitím patřit někomu jinému — hráč o něj přišel ve
      // výpovědi, ale jeho prohlížeč o tom ještě neví. Není to rozpor
      // v modelu a přepisovat tam nic nesmíme: cizí stroj to je po právu.
      if (c.player_id !== h.id) {
        cizich++;
        sporne.push({ spot: u.spotId, co: 'cizí místo', hra: (u.eco && u.eco.model) || '?',
          server: c.model || '—' });
        return;
      }
      const modelHra = (u.eco && u.eco.model) || null;
      if (modelHra && c.model && modelHra !== c.model) {
        modelSpor++;
        sporne.push({ spot: u.spotId, co: 'model', hra: modelHra, server: c.model });
      }
      if (c.score != null) {
        presne++;
        // Uložené skóre se smí lišit od toho, co hra tvrdí, jen o
        // zaokrouhlení. Větší rozdíl znamená, že se místo mezitím změnilo,
        // nebo že si ho hra přepisuje.
        const hra = Math.round(Number(u.score) || 0);
        if (Math.abs(hra - c.score) > 1) {
          skoreSpor++;
          // Rozhodčí je nájem: ten ze skóre kdysi vznikl, takže se dá
          // spočítat zpátky. Čí číslo mu sedí, ten má pravdu — bez toho
          // je to tvrzení proti tvrzení.
          const deal = 0.9 + POZEMKY.spotHash(u.spotId, 'r') * 0.3;
          const zNajmu = c.pozemek ? null : EKO.skoreZNajmu(c.rent, deal);
          sporne.push({ spot: u.spotId, co: 'skóre', hra, server: c.score,
            nakup: zNajmu == null ? 'vlastní pozemek' : 'z nájmu ' + Math.round(zNajmu) });
        }
      } else {
        const deal = 0.9 + POZEMKY.spotHash(u.spotId, 'r') * 0.3;
        const odhad = EKO.skoreZNajmu(c.rent, deal);
        if (c.pozemek || odhad == null) nezname++; else odhadem++;
      }
    });
    // Stáří uložené hry. U míst, která hráči mezitím někdo přebral, je to ta
    // podstatná informace: hra si je sama vyřadí, jakmile ji hráč otevře.
    // Starý zápis tedy není rozbitý mechanismus, jen hráč, který nehrál.
    if (sporne.length) out.push({ id: h.id, nick: h.nick, sporne, ulozeno: h.state_at || null });
  });

  // A teď obráceně: místa, na kterých server vidí stroj, ale hra toho hráče
  // o něm neví. Dokud se hotovost počítá v prohlížeči, je to jen nesoulad
  // v přehledech. Jakmile bude počítat server, platil by hráči za stroj,
  // který nemá — a právě proto se to musí vyčistit dřív než pokladna.
  const mista = new Set();
  hraci.forEach((h) => {
    const st = h.state || null;
    if (!st || !Array.isArray(st.units)) return;
    st.units.forEach((u) => { if (u && u.spotId) mista.add(h.id + '|' + u.spotId); });
  });
  const jmena = new Map(hraci.map((h) => [h.id, h.nick]));
  const maStav = new Set(hraci.filter((h) => h.state && Array.isArray(h.state.units))
    .map((h) => h.id));
  const duchove = [];
  claims.forEach((c) => {
    if (!c.model) return;                       // prázdný pozemek strojem není
    if (!maStav.has(c.player_id)) return;       // bez uloženého stavu se nedá nic tvrdit
    if (mista.has(c.player_id + '|' + c.spot_id)) return;
    duchove.push({ spot: c.spot_id, nick: jmena.get(c.player_id) || ('#' + c.player_id),
      model: c.model, rent: c.rent || 0 });
  });
  // Ke každému takovému místu dohledáme nákup stroje. Je to ten rozdíl, na
  // kterém záleží: stroj, za který hráč zaplatil a server ho eviduje jako
  // postavený, mu hra ztratila — a to je jeho škoda, ne jeho výhoda.
  if (duchove.length) {
    const objednavky = await prisma.gameOrder.findMany({
      where: { spot_id: { in: duchove.map((d) => d.spot) }, postaveno_at: { not: null } },
      select: { spot_id: true, model: true, doplneno: true, cena: true },
    }).catch(() => []);
    const podle = new Map(objednavky.map((o) => [o.spot_id, o]));
    duchove.forEach((d) => {
      const o = podle.get(d.spot);
      d.koupeno = o ? (o.doplneno ? 'dopočteno' : 'zaplaceno') : 'bez nákupu';
    });
  }

  // K rozporům v modelu dohledáme nákup stroje postaveného na tom místě.
  // Říká to, která strana se mýlí: když je zapsaný nákup na serverový model,
  // hra o výměnu přišla a hráč za ni zaplatil. Když není, server si model
  // zvedl sám — tahle cesta se na sklad dlouho neptala.
  const sporneSpoty = [];
  out.forEach((r) => r.sporne.forEach((x) => { if (x.co === 'model' && x.spot) sporneSpoty.push(x.spot); }));
  if (sporneSpoty.length) {
    const objednavky = await prisma.gameOrder.findMany({
      where: { spot_id: { in: sporneSpoty }, postaveno_at: { not: null } },
      select: { spot_id: true, model: true, doplneno: true },
    }).catch(() => []);
    const podle = new Map(objednavky.map((o) => [o.spot_id, o]));
    out.forEach((r) => r.sporne.forEach((x) => {
      if (x.co !== 'model' || !x.spot) return;
      const o = podle.get(x.spot);
      x.nakup = o ? (o.model + (o.doplneno ? ' (zpětně)' : ' (zaplaceno)')) : 'bez nákupu';
    }));
  }

  out.sort((a, b) => b.sporne.length - a.sporne.length);
  out.presne = presne; out.odhadem = odhadem; out.nezname = nezname;
  out.modelSpor = modelSpor; out.skoreSpor = skoreSpor; out.cizich = cizich;
  out.duchove = duchove;
  return out;
}

// Srovnání modelu stroje podle hry.
//
// Rozhoduje hra, a to oběma směry — i když tím server o stroj přijde, i když
// mu naopak přibude. Důvod je stejný jako u úklidu duchů: hráč hraje to, co
// má v prohlížeči, a server má popisovat skutečnost, ne ji přepisovat.
//
// Výjimkou by byl zapsaný nákup na serverový model: to by znamenalo, že hra
// o výměnu přišla a hráč za ni zaplatil. Taková místa se přeskočí a vypíšou,
// ať se vyřeší jednotlivě — vzít hráči stroj, za který zaplatil, se nesmí.
async function modelSrovnat(opts) {
  const ostro = !!(opts && opts.ostro);
  const stav = await sit();
  const sporne = [];
  (stav || []).forEach((r) => (r.sporne || []).forEach((x) => {
    if (x.co === 'model' && x.spot) sporne.push({ nick: r.nick, id: r.id, spot: x.spot,
      hra: x.hra, server: x.server, nakup: x.nakup });
  }));
  const out = { ostro, naslo: sporne.length, srovnano: 0, preskoceno: [], radky: [] };
  if (!sporne.length) return out;

  for (const x of sporne) {
    if (x.nakup && /zaplaceno/.test(x.nakup)) {
      out.preskoceno.push({ spot: x.spot, proc: 'je na něj zaplacený nákup (' + x.nakup + ')' });
      continue;
    }
    // Ověření těsně před zápisem: mezi přehledem a úklidem mohl hráč model
    // vyměnit doopravdy.
    const c = await prisma.gameSpotClaim.findUnique({ where: { spot_id: x.spot },
      select: { model: true, player_id: true } });
    if (!c || c.player_id !== x.id) { out.preskoceno.push({ spot: x.spot, proc: 'místo už není jeho' }); continue; }
    if (c.model === x.hra) { out.preskoceno.push({ spot: x.spot, proc: 'mezitím se srovnalo' }); continue; }
    out.radky.push({ nick: x.nick, spot: x.spot, z: c.model, na: x.hra });
    if (ostro) {
      await prisma.gameSpotClaim.update({ where: { spot_id: x.spot }, data: { model: x.hra } });
      out.srovnano++;
    }
  }
  return out;
}

function tiskModelSrovnat(z) {
  const out = [];
  out.push(z.ostro ? 'OSTRO — zapsáno' : 'NANEČISTO — nic se nezměnilo');
  out.push('Rozporů v modelu: ' + z.naslo + ' · ke srovnání ' + z.radky.length
    + (z.ostro ? ' · srovnáno ' + z.srovnano : ''));
  if (z.radky.length) {
    out.push('');
    out.push('hráč                 místo                          server → hra');
    out.push('-'.repeat(72));
    z.radky.forEach((r) => out.push(String(r.nick || '').padEnd(20).slice(0, 20)
      + String(r.spot).padEnd(31).slice(0, 31) + r.z + ' → ' + r.na));
  }
  if (z.preskoceno.length) {
    out.push('');
    out.push('Přeskočeno:');
    z.preskoceno.forEach((r) => out.push('  ' + String(r.spot).padEnd(31).slice(0, 31) + r.proc));
  }
  out.push('');
  out.push('Rozhoduje hra, oběma směry. Místo se zaplaceným nákupem na model,');
  out.push('který má server, se nepřepisuje — tam hra o výměnu přišla.');
  if (!z.ostro) out.push('Ostrý běh: POST na stejnou adresu.');
  return out.join('\n');
}

// Úklid strojů, o kterých ví jen server.
//
// Vymaže se JEN model, zábor zůstává. Hráč o místo nepřijde — přijde o stroj,
// který ve své hře stejně nemá, takže nepozná vůbec nic. Server tím přestane
// počítat zisk, který nikomu nepatří, a to je přesně to, co musí být čisté
// dřív, než se hotovost přesune na server.
//
// Zrušit celý zábor by bylo čistší pro mapu, ale hráči, který ho ve své hře
// pořád vidí jako svůj, by zmizel — a to vypadá jako chyba hry.
//
// Před zápisem se každé místo ověří znovu: mezi přehledem a úklidem mohl
// hráč hru otevřít a stroj se mohl objevit.
// Výběr míst k úklidu. Bez seznamu projdou všechna nalezená; se seznamem jen
// ta vyjmenovaná. Co je v seznamu a mezi duchy není, se vrací zvlášť — překlep
// v id by jinak vypadal jako hotová práce a ten skutečný zábor by zůstal.
function vyberDuchy(vsichni, spoty) {
  const vse = Array.isArray(vsichni) ? vsichni : [];
  // Rozhoduje to, jestli seznam přišel, ne jestli v něm po očištění něco
  // zbylo. Seznam samých mezer znamená, že volající chtěl vybírat a vybral
  // nic — tak se uklidí nic. Kdyby se to bralo jako „žádný seznam", smazal
  // by překlep stroje na všech místech najednou.
  if (!Array.isArray(spoty)) return { duchove: vse, nenalezeno: [] };
  const chci = spoty.map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
  const vyber = new Set(chci);
  const duchove = vse.filter((d) => vyber.has(String(d && d.spot)));
  const nalezene = new Set(duchove.map((d) => String(d.spot)));
  const nenalezeno = [];
  vyber.forEach((id) => { if (!nalezene.has(id)) nenalezeno.push(id); });
  return { duchove, nenalezeno };
}

async function duchoveUklid(opts) {
  const ostro = !!(opts && opts.ostro);
  // Výběr míst. Bez něj se uklízí všechno, co se našlo — a to je hrubý
  // nástroj: mezi duchy sedí i místa s běžící výpovědí nebo s nákupem, za
  // který hráč zaplatil, a tam by se smazal stroj, který mu doopravdy chybí.
  // Se seznamem se uklidí jen to, co někdo přečetl a rozhodl o tom.
  const stav = await sit();
  const vsichni = stav.duchove || [];
  const v = vyberDuchy(vsichni, opts && opts.spoty);
  const duchove = v.duchove;
  const out = { ostro, naslo: vsichni.length, vybrano: duchove.length,
    uklizeno: 0, preskoceno: [], radky: [], nenalezeno: v.nenalezeno };
  if (!duchove.length) return out;

  const spoty = duchove.map((d) => d.spot);
  const claims = await prisma.gameSpotClaim.findMany({
    where: { spot_id: { in: spoty } },
    select: { spot_id: true, player_id: true, model: true },
  });
  const hraci = await prisma.gamePlayer.findMany({
    where: { id: { in: Array.from(new Set(claims.map((c) => c.player_id))) } },
    select: { id: true, nick: true, state: true },
  });
  const stavy = new Map(hraci.map((h) => [h.id, h.state]));

  for (const c of claims) {
    const st = stavy.get(c.player_id);
    const units = (st && Array.isArray(st.units)) ? st.units : null;
    if (!units) { out.preskoceno.push({ spot: c.spot_id, proc: 'hráč nemá uložený stav' }); continue; }
    if (units.some((u) => u && u.spotId === c.spot_id)) {
      out.preskoceno.push({ spot: c.spot_id, proc: 'hra ten stroj mezitím má' });
      continue;
    }
    if (!c.model) { out.preskoceno.push({ spot: c.spot_id, proc: 'stroj už tam není' }); continue; }
    out.radky.push({ spot: c.spot_id, model: c.model });
    if (ostro) {
      await prisma.gameSpotClaim.update({ where: { spot_id: c.spot_id }, data: { model: '' } });
      out.uklizeno++;
    }
  }
  return out;
}

function tiskDuchoveUklid(z) {
  const out = [];
  out.push(z.ostro ? 'OSTRO — zapsáno' : 'NANEČISTO — nic se nezměnilo');
  out.push('Strojů, o kterých ví jen server: ' + z.naslo
    + (z.vybrano != null && z.vybrano !== z.naslo ? ' · vybráno ' + z.vybrano : '')
    + ' · k vymazání ' + z.radky.length + (z.ostro ? ' · vymazáno ' + z.uklizeno : ''));
  if (z.nenalezeno && z.nenalezeno.length) {
    out.push('');
    out.push('NENAŠEL JSEM mezi duchy: ' + z.nenalezeno.join(', '));
    out.push('(překlep v id, nebo se to místo mezitím spravilo samo)');
  }
  if (z.radky.length) {
    out.push('');
    z.radky.forEach((r) => out.push('  ' + String(r.spot).padEnd(28).slice(0, 28) + r.model));
  }
  if (z.preskoceno.length) {
    out.push('');
    out.push('Přeskočeno:');
    z.preskoceno.forEach((r) => out.push('  ' + String(r.spot).padEnd(28).slice(0, 28) + r.proc));
  }
  out.push('');
  out.push('Maže se jen stroj, zábor místa zůstává hráči.');
  if (!z.ostro) out.push('Ostrý běh: POST na stejnou adresu.');
  return out.join('\n');
}

// Doplnění skóre k místům zabraným dřív, než se začalo ukládat.
//
// Skóre se bere ze stavu hry toho hráče — tedy odtud, odkud ho server
// dostává i u nově zabraných míst. Není to tedy nový ústupek klientovi,
// jen dohnání minulosti.
//
// Kde to jde, kontroluje se proti nájmu: ten ze skóre kdysi vznikl, takže
// se musí potkat na pár bodů. Co se nepotká, se nedoplní a vypíše se —
// radši díra, o které se ví, než číslo, kterému se nedá věřit. U míst na
// vlastním pozemku se nájem neplatí a kontrolovat není proti čemu; ta se
// doplní s tím, že je to z klienta.
async function sitDoplnit(opts) {
  const EKO = require('./ekonomika');
  const POZEMKY = require('./pozemky');
  const ostro = !!(opts && opts.ostro);
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false }, select: { id: true, nick: true, state: true } });
  const chybi = await prisma.gameSpotClaim.findMany({
    where: { score: null, model: { not: '' } },
    select: { spot_id: true, player_id: true, rent: true, pozemek: true } });
  const podleMista = new Map(chybi.map((c) => [c.spot_id, c]));

  const out = { doplneno: 0, nesedi: [], bezKontroly: 0, bezSkore: 0, ostro };
  for (const h of hraci) {
    const st = h.state || null;
    if (!st || !Array.isArray(st.units)) continue;
    for (const u of st.units) {
      if (!u || !u.spotId) continue;
      const c = podleMista.get(u.spotId);
      if (!c || c.player_id !== h.id) continue;
      const sc = Math.max(0, Math.min(100, Math.round(Number(u.score) || 0)));
      if (!sc) { out.bezSkore++; continue; }
      if (c.pozemek || !c.rent) {
        out.bezKontroly++;
      } else {
        const deal = 0.9 + POZEMKY.spotHash(u.spotId, 'r') * 0.3;
        const zNajmu = EKO.skoreZNajmu(c.rent, deal);
        // Kontrola je schválně jednostranná. Nájem se o místa přihazuje:
        // kdo přeplatil souseda, platí víc, než by odpovídalo skóre, a
        // dopočet mu vyjde vysoko — to není podezřelé, to je vyhraná
        // dražba. Podezřelý je jen opačný směr: tvrdit, že je místo
        // špičkové, a platit za něj jako za podprůměrné. Oboustranná
        // kontrola zamítla 232 ze 645 míst, skoro všechna kvůli přihozenému
        // nájmu.
        if (zNajmu == null || zNajmu < sc - 3) {
          out.nesedi.push({ nick: h.nick, spot: u.spotId, hra: sc, zNajmu });
          continue;
        }
      }
      if (ostro) {
        await prisma.gameSpotClaim.update({ where: { spot_id: u.spotId }, data: { score: sc } });
      }
      out.doplneno++;
    }
  }
  return out;
}

function tiskSitDoplnit(v) {
  const out = [];
  out.push((v.ostro ? 'DOPLNĚNO' : 'NANEČISTO') + ' · skóre k místům: ' + v.doplneno);
  out.push('  z toho bez kontroly proti nájmu (vlastní pozemek): ' + v.bezKontroly);
  out.push('  místa bez skóre ve stavu hry: ' + v.bezSkore);
  out.push('  nesedí proti nájmu, nedoplněno: ' + v.nesedi.length);
  if (v.nesedi.length) {
    out.push('');
    out.push('nick                 místo                      hra   z nájmu');
    out.push('-'.repeat(62));
    v.nesedi.slice(0, 40).forEach((x) => {
      out.push(String(x.nick || '').padEnd(20).slice(0, 20)
        + String(x.spot || '').padEnd(27).slice(0, 27)
        + String(x.hra).padStart(5) + String(x.zNajmu == null ? '—' : x.zNajmu).padStart(10));
    });
    out.push('');
    out.push('Tyhle se nedoplnily schválně: hra tvrdí lepší místo, než za jaké');
    out.push('se platí nájem. Radši díra, o které se ví, než číslo, kterému se');
    out.push('nedá věřit.');
  }
  if (!v.ostro) {
    out.push('');
    out.push('Nic se nezapsalo. Ostře: POST /api/game-admin/sit-doplnit');
  }
  return out.join('\n');
}

function tiskSit(rows) {
  const celkem = (rows.presne || 0) + (rows.odhadem || 0) + (rows.nezname || 0);
  const pct = (n) => (celkem ? Math.round((n / celkem) * 100) : 0) + ' %';
  const out = [];
  out.push('VIDÍ SERVER STEJNOU SÍŤ · prádlomatů ve hře ' + celkem);
  out.push('  ocení přesně (skóre uložené): ' + (rows.presne || 0) + ' \u00b7 ' + pct(rows.presne || 0));
  out.push('  ocení přibližně (z nájmu):    ' + (rows.odhadem || 0) + ' \u00b7 ' + pct(rows.odhadem || 0));
  out.push('  neocení vůbec:                ' + (rows.nezname || 0) + ' \u00b7 ' + pct(rows.nezname || 0));
  out.push('');
  out.push('Rozpory: model ' + (rows.modelSpor || 0) + ' \u00b7 skóre ' + (rows.skoreSpor || 0));
  out.push('Místa, která hra vede jako svá, ale patří už někomu jinému: '
    + (rows.cizich || 0) + ' (hráč o ně přišel ve výpovědi a jeho hra to ještě neví)');
  const duchove = rows.duchove || [];
  out.push('Stroje, které vidí jen server (hra o nich neví): ' + duchove.length);
  if (duchove.length) {
    out.push('');
    out.push('  Tyhle je potřeba vyčistit dřív, než bude hotovost na serveru —');
    out.push('  jinak by hráči platil za stroj, který nemá. Poslední sloupec');
    out.push('  říká, jestli k tomu místu existuje zaplacený nákup stroje:');
    out.push('  „zaplaceno" znamená, že stroj hře nejspíš chybí, ne přebývá.');
    duchove.slice(0, 20).forEach((d) => {
      out.push('  ' + String(d.spot).padEnd(26).slice(0, 26)
        + String(d.nick).padEnd(18).slice(0, 18)
        + String(d.model).padEnd(6) + ('nájem ' + Math.round(d.rent)).padEnd(14)
        + (d.koupeno || '?'));
    });
  }
  if (!rows.length) {
    out.push('');
    out.push('Žádný rozpor. Server i hra se baví o stejných strojích na stejných');
    out.push('místech — na tom se dá stavět porovnání zisku.');
    return out.join('\n');
  }
  out.push('');
  out.push('nick                 co           hra        server     nákup              místo'
    + '                      naposledy hrál');
  out.push('-'.repeat(126));
  rows.slice(0, 40).forEach((r) => {
    r.sporne.slice(0, 5).forEach((x, i) => {
      out.push((i ? '' : String(r.nick || '').padEnd(20).slice(0, 20))
        .padEnd(20) + x.co.padEnd(13)
        + String(x.hra).padEnd(11).slice(0, 11)
        + String(x.server).padEnd(11).slice(0, 11)
        + String(x.nakup || '').padEnd(19).slice(0, 19)
        + String(x.spot || '').padEnd(27).slice(0, 27)
        + (i ? '' : (r.ulozeno ? 'uloženo ' + String(new Date(r.ulozeno).toISOString()).slice(0, 16).replace('T', ' ') : '')));
    });
  });
  out.push('');
  out.push('Skóre se ukládá teprve od 19. 11. 2026, takže u starších míst');
  out.push('chybí a počítá se odhadem z nájmu. Procento vlevo poroste samo,');
  out.push('jak budou hráči zabírat nová místa.');
  return out.join('\n');
}

module.exports = { srovnani, tisk, evidence, tiskEvidence, sklad, tiskSklad, sit, tiskSit,
  sitDoplnit, tiskSitDoplnit, duchoveUklid, tiskDuchoveUklid, vyberDuchy,
  modelSrovnat, tiskModelSrovnat,
  CENY_STROJU, stupen };
