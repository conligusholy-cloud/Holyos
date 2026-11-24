// =============================================================================
// Laundromat Tycoon — Unie prádlomatů: území, licence a servisní tok
// =============================================================================
// Pozdní hra. Když má hráč stovky prádlomatů, přestanou být peníze vzácné a
// hra se změní na hromadění čísel. Novou vzácností jsou území a ostatní hráči:
//
//   provozovatel   vlastní a provozuje prádlomaty (od začátku, všichni)
//   operátor       shání a připravuje místa, servisuje v území (od 10 strojů)
//   master partner drží území, nabírá operátory, určuje poplatek (od 60)
//
// Území = oblast (area_key), ne země. V Česku hraje většina hráčů; kdo by
// získal celou zemi, vyhrál by hru a ostatním by nezbylo o co hrát. Oblast
// navíc sedí na datový model — zábory už area_key nesou.
//
// Peníze: každý prádlomat dnes platí měsíční servis (13 % tržby) a ten mizí
// do prázdna. Nově z něj část opouští „výrobu" a rozdělí se mezi operátora
// a mastera toho území. Master si smí výši poplatku nastavit v pásmu
// 50–150 % základu: vysoko = víc peněz teď, ale roste nespokojenost a klesá
// práh, od kterého ho smí někdo vyzvat. Nad 100 % navíc doplácí sám majitel
// prádlomatu — to je ta daň z nováčků, kterou má nespokojenost držet na uzdě.
//
// Všechno je líné: nic neběží na pozadí. Když si kdokoli ze zúčastněných
// vyzvedne přehled, dopočítá se, co se za uplynulé herní měsíce mělo stát.
'use strict';

const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');
const EKO = require('./ekonomika');

const KEY = 'game.unie';
const MESIC_MS = 43200000;          // herní měsíc = 12 skutečných hodin
const ROK_MS = 12 * MESIC_MS;       // herní rok = 6 dnů

// Výchozí čísla. Všechna patří do nastavení, ne do kódu — populace hráčů
// poroste a hranice rolí se s ní budou posouvat.
const VYCHOZI = {
  master_min: 60,            // prádlomatů pro roli master partnera
  operator_min: 10,          // prádlomatů pro roli operátora
  poplatek_min: 50,          // pásmo poplatku v procentech základu
  poplatek_max: 150,
  odvod_pct: 30,             // kolik % servisu opustí výrobu a jde hráčům
  operator_pct: 60,          // z odvodu operátorovi, zbytek masterovi
  licence_za_misto: 1200,    // licence za herní měsíc = volná místa × tohle × skóre/100
  licence_min: 20000,
  zavazek_pct: 10,           // rozvojový závazek: % volných míst za herní rok
  vyzva_prah: 40,            // nespokojenost, od které smí vyzvat kdokoli
  vyzva_mesicu: 2,           // kolik herních měsíců běží výzva
  vyzva_priplatek_pct: 50,   // o kolik musí vyzyvatel přeplatit licenci
};

async function nastaveni() {
  const v = await getSetting(KEY, { type: 'json', defaultValue: {} }).catch(() => ({}));
  return Object.assign({}, VYCHOZI, v && typeof v === 'object' ? v : {});
}

async function ulozNastaveni(b) {
  const cur = await nastaveni();
  const out = Object.assign({}, cur);
  Object.keys(VYCHOZI).forEach((k) => {
    if (b && Object.prototype.hasOwnProperty.call(b, k)) {
      const n = Number(b[k]);
      if (Number.isFinite(n) && n >= 0) out[k] = Math.round(n);
    }
  });
  if (out.poplatek_max < out.poplatek_min) out.poplatek_max = out.poplatek_min;
  if (out.operator_pct > 100) out.operator_pct = 100;
  await setSetting(KEY, out, { type: 'json',
    description: 'Laundromat Tycoon — Unie prádlomatů (hranice rolí, poplatky, výzvy)',
    scope: 'game' });
  return out;
}

// ─── Role podle velikosti sítě ───────────────────────────────────────────────
// Počítají se jen místa, kde opravdu stojí stroj. Koupený pozemek bez
// prádlomatu roli nedělá — hráč tam zatím nic neprovozuje.
async function pocetStroju(playerId) {
  return prisma.gameSpotClaim.count({ where: { player_id: Number(playerId), model: { not: '' } } });
}

async function role(playerId) {
  const [n, nast] = await Promise.all([pocetStroju(playerId), nastaveni()]);
  return {
    pradlomatu: n,
    master: n >= nast.master_min,
    operator: n >= nast.operator_min,
    master_min: nast.master_min,
    operator_min: nast.operator_min,
  };
}

// ─── Potenciál oblasti ───────────────────────────────────────────────────────
// Z čeho se počítá cena licence: kolik je v oblasti volných míst a jak jsou
// dobrá. Prázdná oblast stojí minimum, Praha plná stovek míst znatelně víc.
async function potencial(areaKey) {
  const key = String(areaKey || '');
  const [area, zabory, nast] = await Promise.all([
    prisma.gameArea.findUnique({ where: { key }, select: { key: true, name: true, country: true, spots: true } }).catch(() => null),
    prisma.gameSpotClaim.findMany({ where: { area_key: key }, select: { spot_id: true, model: true, player_id: true } }),
    nastaveni(),
  ]);
  const spots = Array.isArray(area && area.spots) ? area.spots : [];
  const zabrano = new Set(zabory.map((z) => z.spot_id));
  const volna = spots.filter((sp) => sp && !zabrano.has(sp.id));
  const skore = volna.length
    ? volna.reduce((a, sp) => a + (Number(sp.score) || 0), 0) / volna.length
    : 0;
  const cena = Math.max(nast.licence_min,
    Math.round(volna.length * nast.licence_za_misto * (skore / 100)));
  return {
    area_key: key,
    nazev: (area && area.name) || key,
    zeme: (area && area.country) || null,
    mist: spots.length,
    volnych: volna.length,
    stroju: zabory.filter((z) => z.model).length,
    skore: Math.round(skore),
    licence: cena,
    // Rozvojový závazek, který se k ceně váže: kolik prádlomatů má v území
    // za herní rok přibýt. Z volných míst, ať malá oblast neslibuje nemožné.
    zavazek: Math.max(1, Math.round(volna.length * nast.zavazek_pct / 100)),
  };
}

// ─── Nespokojenost a práh pro výzvu ──────────────────────────────────────────
// Lineárně z poplatku: na dolní hranici pásma nula, na horní sto. Nic víc za
// tím není schválně — hráč to musí umět odhadnout z posuvníku.
function nespokojenostZ(poplatekPct, nast) {
  const n = nast || VYCHOZI;
  const rozpeti = Math.max(1, n.poplatek_max - n.poplatek_min);
  return Math.max(0, Math.min(100,
    Math.round((Math.max(n.poplatek_min, Math.min(n.poplatek_max, Number(poplatekPct) || 100)) - n.poplatek_min) / rozpeti * 100)));
}

// Smí někdo území vyzvat? Tři důvody, stačí jeden.
function duvodVyzvy(t, nast, pridano) {
  const ted = Date.now();
  const nesp = nespokojenostZ(t.poplatek_pct, nast);
  if (nesp >= nast.vyzva_prah) return 'nespokojenost';
  // Rozvojový závazek: po uplynutí herního roku se kouká, kolik přibylo.
  if (t.zavazek > 0 && ted - new Date(t.zavazek_od).getTime() >= ROK_MS
    && Number(pridano) < t.zavazek) return 'zavazek';
  // Nezaplacená licence: území krvácí, dokud se nedoplatí.
  if (new Date(t.licence_do).getTime() + MESIC_MS < ted) return 'licence';
  return null;
}

// ─── Servisní tok ────────────────────────────────────────────────────────────
// Kolik jeden prádlomat měsíčně odvede. Server nezná návštěvnost (ta žije ve
// stavu hry), takže počítá se základní jedničkou — čísla jsou tím pádem
// konzervativní a nikdy nevyjdou výš, než kolik hráč opravdu vydělal.
function servisMista(c) {
  const score = c.score != null ? c.score : EKO.skoreZNajmu(c.rent, 1);
  const e = EKO.jedenStroj({ model: c.model, score: score == null ? 50 : score,
    rent: c.rent, pozemek: c.pozemek }, 1);
  return Math.max(0, Math.round(e.servis));
}

// Rozpad jednoho odvodu na tři kapsy.
function rozpad(servis, poplatekPct, operatorPct, odvodPct) {
  const zaklad = Math.round(servis * (odvodPct / 100));
  const odvod = Math.round(zaklad * (Math.max(0, Number(poplatekPct) || 100) / 100));
  const operator = Math.round(odvod * (operatorPct / 100));
  const master = odvod - operator;
  // Nad sto procent si majitel prádlomatu připlácí nad rámec svého servisu.
  const priplatek = Math.max(0, odvod - zaklad);
  return { zaklad, odvod, master, operator, priplatek };
}

// Odvod z jednoho prádlomatu v území. Servis platí zákazník, který do
// prádlomatu přišel — čí ten prádlomat je, je území jedno, a tak se počítá
// i ze strojů samotného mastera. Dřív se jeho síť vynechávala a území plné
// vlastních strojů nenslo nic, což nedávalo smysl ani tematicky.
//
// Sám sobě si ale nikdo nepřiplácí: u masterových strojů se poplatek zastropí
// na sto procentech, takže odvod nikdy nepřeroste základ a příplatek nemá
// z čeho vzniknout. Jinak by si master přehazoval peníze z kapsy do kapsy.
// Operátor svůj díl bere ze všeho — servisuje i masterovy stroje.
function odvodZMista(c, t, operatorPct, odvodPct) {
  const vlastni = Number(c.player_id) === Number(t.master_id);
  const pct = vlastni
    ? Math.min(100, Number(t.poplatek_pct) || 100)
    : t.poplatek_pct;
  return rozpad(servisMista(c), pct, operatorPct, odvodPct);
}

// ─── Vyúčtování území ────────────────────────────────────────────────────────
// Projde jedno území a za každý celý herní měsíc od posledního vyúčtování
// rozešle doručenky: masterovi a operátorovi příjem, majiteli prádlomatu
// případný příplatek. Je to idempotentní: servis_do se posouvá ve stejné
// transakci podmíněným zápisem, takže dvě souběžná vyzvednutí nezaplatí dvakrát.
async function vyuctujUzemi(t, nastIn) {
  const nast = nastIn || await nastaveni();
  const od = new Date(t.servis_do || t.created_at).getTime();
  const mesicu = Math.floor((Date.now() - od) / MESIC_MS);
  if (mesicu < 1) return { mesicu: 0, master: 0, operator: 0 };
  const [mista, licence] = await Promise.all([
    prisma.gameSpotClaim.findMany({
      where: { area_key: t.area_key, model: { not: '' } },
      select: { spot_id: true, player_id: true, nick: true, name: true, model: true, score: true, rent: true, pozemek: true },
    }),
    prisma.gameOperatorLicence.findMany({ where: { area_key: t.area_key, zrusena: false } }),
  ]);
  const operator = licence.find((l) => !l.do_kdy || new Date(l.do_kdy).getTime() > Date.now()) || null;
  const operatorPct = operator ? Math.max(0, Math.min(100, operator.podil_pct)) : 0;

  let proMastera = 0, proOperatora = 0;
  const priplatky = new Map();   // player_id → { castka, nick }
  mista.forEach((c) => {
    const r = odvodZMista(c, t, operatorPct, nast.odvod_pct);
    proMastera += r.master * mesicu;
    proOperatora += r.operator * mesicu;
    if (r.priplatek > 0) {
      const cur = priplatky.get(c.player_id) || { castka: 0, nick: c.nick };
      cur.castka += r.priplatek * mesicu;
      priplatky.set(c.player_id, cur);
    }
  });

  const klic = 'unie:' + t.area_key + ':' + Math.round(od / MESIC_MS);
  const nove = new Date(od + mesicu * MESIC_MS);
  await prisma.$transaction(async (tx) => {
    // Podmíněný posun: když mezitím vyúčtoval někdo jiný, neudělá se nic.
    const r = await tx.gameTerritory.updateMany({
      where: { id: t.id, servis_do: new Date(od) },
      data: { servis_do: nove, nespokojenost: nespokojenostZ(t.poplatek_pct, nast) },
    });
    if (!r.count) return;
    if (proMastera > 0) {
      await tx.gameDelivery.create({ data: {
        player_id: t.master_id, kind: 'cash', amount: proMastera, spot_id: klic + ':m',
        text_kod: 'dor.unie_master', text_data: { penize: proMastera, p1: t.area_key, p2: String(mista.length) },
        popis: 'Servisní poplatky z území ' + t.area_key + ' — ' + proMastera.toLocaleString('cs-CZ') + ' L$',
      } });
    }
    if (operator && proOperatora > 0) {
      await tx.gameDelivery.create({ data: {
        player_id: operator.player_id, kind: 'cash', amount: proOperatora, spot_id: klic + ':o',
        text_kod: 'dor.unie_operator', text_data: { penize: proOperatora, p1: t.area_key, p2: String(mista.length) },
        popis: 'Servis v území ' + t.area_key + ' — ' + proOperatora.toLocaleString('cs-CZ') + ' L$',
      } });
    }
    for (const [pid, v] of priplatky) {
      await tx.gameDelivery.create({ data: {
        player_id: pid, kind: 'cash', amount: -v.castka, spot_id: klic + ':p' + pid,
        text_kod: 'dor.unie_priplatek', text_data: { penize: v.castka, p1: t.area_key, p2: t.master_nick },
        popis: 'Zvýšený servisní poplatek v území ' + t.area_key + ' (' + t.master_nick + ') — '
          + v.castka.toLocaleString('cs-CZ') + ' L$',
      } });
    }
  });
  return { mesicu, master: proMastera, operator: proOperatora };
}

// Doběhlá výzva: buď master dorovnal (to řeší jeho vlastní tah), nebo území
// mění majitele. Vyhodnocuje se líně, až se na území někdo podívá.
async function vyhodnotVyzvu(t) {
  if (!t.vyzyvatel_id || !t.vyzva_do || new Date(t.vyzva_do).getTime() > Date.now()) return t;
  const stary = { id: t.master_id, nick: t.master_nick };
  const upd = await prisma.gameTerritory.update({
    where: { id: t.id },
    data: {
      master_id: t.vyzyvatel_id, master_nick: t.vyzyvatel_nick || '',
      licence: Math.max(t.licence, t.vyzyvatel_cena || 0),
      licence_do: new Date(Date.now() + MESIC_MS),
      zavazek_od: new Date(), zavazek_start: await prisma.gameSpotClaim.count({
        where: { area_key: t.area_key, model: { not: '' } } }),
      vyzyvatel_id: null, vyzyvatel_nick: null, vyzyvatel_cena: null, vyzva_do: null,
    },
  });
  await prisma.gameDelivery.createMany({ data: [
    { player_id: stary.id, kind: 'zprava', spot_id: 'unie:vyzva:' + t.id,
      text_kod: 'dor.unie_uzemi_ztraceno', text_data: { p1: t.area_key, p2: upd.master_nick },
      popis: 'Přišel jsi o území ' + t.area_key + ' — přeplatil tě ' + upd.master_nick },
    { player_id: upd.master_id, kind: 'zprava', spot_id: 'unie:vyzva:' + t.id + ':v',
      text_kod: 'dor.unie_uzemi_ziskano', text_data: { p1: t.area_key },
      popis: 'Získal jsi území ' + t.area_key },
  ] }).catch(() => {});
  console.log('[game] unie — území', t.area_key, 'přechází na', upd.master_nick);
  return upd;
}

// Kolik prádlomatů v území přibylo od převzetí — proti tomu se měří závazek.
async function pridanoOdPrevzeti(t) {
  const ted = await prisma.gameSpotClaim.count({ where: { area_key: t.area_key, model: { not: '' } } });
  return Math.max(0, ted - (t.zavazek_start || 0));
}

// Veřejný tvar území pro hru. Nespokojenost a práh vidí každý — je to tlak,
// který má být vidět zvenčí, jinak by se o území nikdo neucházel.
async function uzemiPub(t, meId, nast) {
  const n = nast || await nastaveni();
  const pridano = await pridanoOdPrevzeti(t);
  // Co území dělá: kolik v něm stojí cizích prádlomatů, co z nich masterovi
  // za herní měsíc plyne a jestli tu někdo servisuje. Bez těchhle tří čísel
  // drží hráč území a neví, proč ho drží.
  const [vsechny, licence, area] = await Promise.all([
    prisma.gameSpotClaim.findMany({
      where: { area_key: t.area_key, model: { not: '' } },
      select: { player_id: true, model: true, score: true, rent: true, pozemek: true, nick: true },
    }),
    prisma.gameOperatorLicence.findFirst({ where: { area_key: t.area_key, zrusena: false } }),
    prisma.gameArea.findUnique({ where: { key: t.area_key }, select: { name: true, spots: true } }).catch(() => null),
  ]);
  const operatorPct = licence ? Math.max(0, Math.min(100, licence.podil_pct)) : 0;
  let proMastera = 0, proOperatora = 0, odvedou = 0;
  vsechny.forEach((c) => {
    const r = odvodZMista(c, t, operatorPct, n.odvod_pct);
    proMastera += r.master; proOperatora += r.operator; odvedou += r.odvod;
  });
  const spots = Array.isArray(area && area.spots) ? area.spots : [];
  return {
    nazev: (area && area.name) || t.area_key,
    stroju: vsechny.length,
    cizich: vsechny.filter((c) => Number(c.player_id) !== Number(t.master_id)).length,
    mist: spots.length,
    prijem_mesic: proMastera,
    operator_prijem: proOperatora,
    odvod_mesic: odvedou,
    operator_nick: licence ? licence.nick : null,
    operator_podil: licence ? licence.podil_pct : null,
    operator_cena: t.operator_cena || null,
    area_key: t.area_key,
    master_id: t.master_id,
    master_nick: t.master_nick,
    moje: Number(meId) === t.master_id,
    poplatek_pct: t.poplatek_pct,
    poplatek_min: n.poplatek_min,
    poplatek_max: n.poplatek_max,
    nespokojenost: nespokojenostZ(t.poplatek_pct, n),
    vyzva_prah: n.vyzva_prah,
    zavazek: t.zavazek,
    zavazek_pridano: pridano,
    zavazek_do: new Date(new Date(t.zavazek_od).getTime() + ROK_MS),
    licence: t.licence,
    licence_do: t.licence_do,
    vyzyvatel_nick: t.vyzyvatel_nick || null,
    vyzyvatel_cena: t.vyzyvatel_cena || null,
    vyzva_do: t.vyzva_do || null,
    duvod_vyzvy: duvodVyzvy(t, n, pridano),
  };
}

// ─── Žebříček území ──────────────────────────────────────────────────────────
// Měřítko pozdní hry. Počet prádlomatů říká, jak velkou máš síť; tenhle
// žebříček říká, kolik ti nese cizí práce — tedy jestli jsi opravdu master
// partner, nebo jen velký provozovatel. Řadí se podle měsíčního příjmu ze
// servisu, ne podle počtu území: deset prázdných oblastí nic neznamená.
async function zebricekUzemi() {
  const [uzemi, nast] = await Promise.all([prisma.gameTerritory.findMany(), nastaveni()]);
  if (!uzemi.length) return [];
  const klice = uzemi.map((t) => t.area_key);
  const [mista, licence] = await Promise.all([
    prisma.gameSpotClaim.findMany({
      where: { area_key: { in: klice }, model: { not: '' } },
      select: { area_key: true, player_id: true, model: true, score: true, rent: true, pozemek: true },
    }),
    prisma.gameOperatorLicence.findMany({ where: { area_key: { in: klice }, zrusena: false } }),
  ]);
  const operatorVOblasti = {};
  licence.forEach((l) => { if (!operatorVOblasti[l.area_key]) operatorVOblasti[l.area_key] = l; });
  const podleOblasti = {};
  mista.forEach((c) => { (podleOblasti[c.area_key] = podleOblasti[c.area_key] || []).push(c); });

  const masteri = {};
  const operatori = {};
  uzemi.forEach((t) => {
    const m = masteri[t.master_id] = masteri[t.master_id]
      || { id: t.master_id, nick: t.master_nick, uzemi: 0, stroju: 0, prijem: 0 };
    m.uzemi++;
    const lic = operatorVOblasti[t.area_key] || null;
    const opPct = lic ? Math.max(0, Math.min(100, lic.podil_pct)) : 0;
    (podleOblasti[t.area_key] || []).forEach((c) => {
      const r = odvodZMista(c, t, opPct, nast.odvod_pct);
      m.stroju++; m.prijem += r.master;
      if (lic) {
        const o = operatori[lic.player_id] = operatori[lic.player_id]
          || { id: lic.player_id, nick: lic.nick, uzemi: 0, stroju: 0, prijem: 0, operator: true };
        o.prijem += r.operator; o.stroju++;
      }
    });
  });
  Object.values(operatori).forEach((o) => { o.uzemi = licence.filter((l) => l.player_id === o.id).length; });
  const vse = Object.values(masteri).concat(Object.values(operatori));
  return vse.sort((a, b) => b.prijem - a.prijem || b.stroju - a.stroju);
}

module.exports = {
  KEY, MESIC_MS, ROK_MS, VYCHOZI,
  nastaveni, ulozNastaveni, role, pocetStroju, potencial,
  nespokojenostZ, duvodVyzvy, servisMista, rozpad, odvodZMista,
  vyuctujUzemi, vyhodnotVyzvu, pridanoOdPrevzeti, uzemiPub, zebricekUzemi,
};
