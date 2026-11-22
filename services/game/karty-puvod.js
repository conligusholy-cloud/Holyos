// =============================================================================
// HolyOS — Laundromat Tycoon: odkud se vzaly karty
// =============================================================================
// Karta „Reklamní kampaň" zvedá návštěvnost natrvalo a návštěvností se násobí
// tržba CELÉ sítě. Jedna karta je tak násobně cennější než jakýkoli stroj —
// a protože se karty dají převádět mezi hráči, dá se tím obejít všechno
// ostatní: založím účty, posbírám na nich karty za hodnosti a odznaky,
// převedu je na hlavní účet a ten pak vydělává několikanásobek.
//
// Tenhle soubor dělá dvě věci a nic víc:
//   1. u každé karty dohledá, odkud přišla (nákup, odměna, obchod, dražba),
//   2. spočítá, kolik hráči jeho karty na návštěvnost měsíčně vydělávají.
//
// Rozhodovat, co je podvod, mu nepřísluší — to dělá podvod.js, který si sem
// pošle vlastní měřítko, kdo je pomocný účet. Tady se jen poctivě sčítá.
// =============================================================================
'use strict';

const EKO = require('./ekonomika');
const NAV = require('./navstevnost');

const SMAZANY = 'smazaný hráč';
const DEN = 86400e3;
const BOOST_ZA_KARTU = 0.15;       // musí sedět s navstevnost.js
const TRAFFIC = 'traffic';

// Odkud karta je. Pořadí má význam: nákup je nejsilnější doklad, odměna druhý.
// Co se nedá doložit ani jedním, zůstane „neznámo" — a právě to je zajímavé.
async function puvod(prisma) {
  const [karty, obchody, drazby, odmeny, hraci] = await Promise.all([
    prisma.gameCard.findMany({
      select: { id: true, player_id: true, kind: true, used_at: true, purchase_id: true, created_at: true } }),
    prisma.gameTrade.findMany({ where: { stav: 'prijato', predmet: 'karta' },
      select: { id: true, from_id: true, to_id: true, smer: true, card_kind: true, cena: true,
        resolved_at: true, created_at: true } }),
    prisma.gameDrazba.findMany({ where: { stav: 'hotovo', predmet: 'karta' },
      select: { id: true, prodavajici_id: true, vitez_id: true, card_kind: true, cena: true,
        updated_at: true } }).catch(() => []),
    prisma.gameOdmena.findMany({ where: { karta: { not: null } },
      select: { player_id: true, karta: true, druh: true, kod: true } }),
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, company: true, created_at: true,
      disabled: true, hra_s_celkem: true } }),
  ]);
  const P = new Map(hraci.map((h) => [h.id, h]));
  const prevody = [];
  obchody.forEach((t) => {
    const od = t.smer === 'koupim' ? t.to_id : t.from_id;
    const komu = t.smer === 'koupim' ? t.from_id : t.to_id;
    prevody.push({ jak: 'obchod', id: t.id, od, komu, kind: t.card_kind, cena: t.cena || 0,
      kdy: new Date(t.resolved_at || t.created_at).getTime() });
  });
  drazby.forEach((d) => {
    if (!d.vitez_id) return;
    prevody.push({ jak: 'dražba', id: d.id, od: d.prodavajici_id, komu: d.vitez_id,
      kind: d.card_kind, cena: d.cena || 0, kdy: new Date(d.updated_at).getTime() });
  });
  // Kolik karet kterého druhu má hráč doložených odměnou. Odměna se vyplácí
  // jednou za hodnost nebo odznak, takže víc než řádků v tabulce jich z odměn
  // mít nemůže.
  const zOdmen = new Map();
  odmeny.forEach((o) => {
    const k = o.player_id + '|' + o.karta;
    zOdmen.set(k, (zOdmen.get(k) || 0) + 1);
  });
  const doHrace = new Map();
  prevody.forEach((p) => {
    const k = p.komu + '|' + p.kind;
    if (!doHrace.has(k)) doHrace.set(k, []);
    doHrace.get(k).push(p);
  });

  // Rozpad po hráči a druhu karty.
  const podle = new Map();
  karty.forEach((c) => {
    const k = c.player_id + '|' + c.kind;
    const r = podle.get(k) || { player_id: c.player_id, kind: c.kind, celkem: 0, koupeno: 0,
      pouzito: 0, prevzato: [], zOdmen: zOdmen.get(k) || 0 };
    r.celkem++;
    if (c.purchase_id) r.koupeno++;
    if (c.used_at) r.pouzito++;
    podle.set(k, r);
  });
  podle.forEach((r, k) => { r.prevzato = doHrace.get(k) || []; });
  // Co nejde doložit ničím: ani nákupem, ani odměnou, ani převodem od někoho.
  podle.forEach((r) => {
    r.neznamo = Math.max(0, r.celkem - r.koupeno - r.zOdmen - r.prevzato.length);
  });
  return { podle, prevody, P, karty };
}

// Je ten, od koho karta přišla, podezřelý? Měřítko si posílá volající —
// podvod.js ví o pomocných účtech víc než tenhle soubor.
function podezrelyZdroj(h, kdy, jeMule) {
  if (!h) return 'neznámý účet';
  if (h.nick === SMAZANY) return 'smazaný účet';
  if (jeMule && jeMule(h.id)) return 'pomocný účet';
  if (kdy && new Date(h.created_at).getTime() > kdy - 2 * DEN) return 'účet mladší 2 dnů';
  if ((h.hra_s_celkem || 0) < 1800) return 'účet, který skoro nehrál';
  return null;
}

// Karty, které hráč převzal od podezřelého účtu.
function sporneKarty(data, jeMule) {
  const out = new Map();
  data.prevody.forEach((p) => {
    const zdroj = podezrelyZdroj(data.P.get(p.od), p.kdy, jeMule);
    if (!zdroj) return;
    const l = out.get(p.komu) || [];
    l.push({ kind: p.kind, jak: p.jak, id: p.id, cena: p.cena, kdy: p.kdy,
      od: (data.P.get(p.od) || {}).nick || ('#' + p.od), duvod: zdroj });
    out.set(p.komu, l);
  });
  return out;
}

// ─── Co karty na návštěvnost vydělávají ─────────────────────────────────────
// Návštěvnost násobí tržbu každého stroje, takže se zisk z karet nedá vzít
// „na kus". Počítá se rozdíl: co síť nese teď a co by nesla, kdyby těch karet
// hráč neměl. Nájmy se nemění, takže rozdíl jde celý z tržby.
async function ziskZKaret(prisma, hrac, kolikKaret, opts) {
  const pocet = Math.max(0, Math.round(kolikKaret || 0));
  if (!pocet) return { mesicne: 0, bez: 0, ted: 0 };
  const mista = await prisma.gameSpotClaim.findMany({
    where: { player_id: hrac.id, model: { not: '' } },
    select: { spot_id: true, area_key: true, model: true, rent: true, pozemek: true, score: true },
  });
  if (!mista.length) return { mesicne: 0, bez: 0, ted: 0 };
  const st = hrac.state || {};
  const nav = await NAV.proHrace(hrac, st, (opts && opts.ted) || Date.now());
  // Táž návštěvnost bez boostu ze sporných karet. Strop se počítá stejným
  // vzorcem, jinak by se rozdíl schoval do stropu.
  const bezBoost = Math.max(0, (nav.boost || 0) - pocet * BOOST_ZA_KARTU);
  const navBez = NAV.spocti({ refs: nav.refs, boost: bezBoost, kampanAdd: nav.kampanAdd,
    povest: nav.povest }, (opts && opts.ted) || Date.now());
  const sit = (n) => EKO.site(mista.map((m) => ({ model: m.model, score: m.score || 0, rent: m.rent,
    pozemek: !!m.pozemek, area_key: m.area_key })), n).zisk;
  const ted = sit(nav.navstevnost);
  const bez = sit(navBez);
  return { mesicne: Math.max(0, Math.round(ted - bez)), ted: Math.round(ted), bez: Math.round(bez),
    navstevnost: nav.navstevnost, navstevnostBez: navBez };
}

module.exports = { puvod, sporneKarty, podezrelyZdroj, ziskZKaret, BOOST_ZA_KARTU, TRAFFIC };

// ─── Zpráva pro administraci ────────────────────────────────────────────────
// Prostý text, stejně jako rozbor zisku: dá se zkopírovat do zprávy hráči.
async function zprava(prisma, kdoJeMule) {
  const data = await puvod(prisma);
  const sporne = sporneKarty(data, kdoJeMule);
  const kc = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
  const out = [];
  out.push('PŮVOD KARET');
  out.push('');
  // Nejdřív celek: kolik karet kterého druhu ve hře je a kolik z nich někdo
  // doopravdy zaplatil. Bez tohohle řádku se nepozná, jestli je nález výjimka,
  // nebo pravidlo.
  const druhy = new Map();
  data.podle.forEach((r) => {
    const d = druhy.get(r.kind) || { celkem: 0, koupeno: 0, odmena: 0, prevod: 0, neznamo: 0, pouzito: 0 };
    d.celkem += r.celkem; d.koupeno += r.koupeno; d.odmena += Math.min(r.zOdmen, r.celkem);
    d.prevod += r.prevzato.length; d.neznamo += r.neznamo; d.pouzito += r.pouzito;
    druhy.set(r.kind, d);
  });
  out.push('druh        celkem  koupeno  odměna  převodem  nedoloženo  použito');
  out.push('-'.repeat(70));
  [...druhy.entries()].sort((a, b) => b[1].celkem - a[1].celkem).forEach(([kind, d]) => {
    out.push(String(kind).padEnd(12) + String(d.celkem).padStart(6) + String(d.koupeno).padStart(9)
      + String(d.odmena).padStart(8) + String(d.prevod).padStart(10)
      + String(d.neznamo).padStart(12) + String(d.pouzito).padStart(9));
  });
  out.push('');
  if (!sporne.size) {
    out.push('Žádná karta nepřišla od pomocného, smazaného ani čerstvého účtu.');
    return out.join('\n');
  }
  out.push('KARTY OD PODEZŘELÝCH ÚČTŮ');
  out.push('');
  const poradi = [...sporne.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [playerId, l] of poradi) {
    const h = data.P.get(playerId);
    out.push((h ? (h.company || h.nick) + ' (' + h.nick + ' #' + playerId + ')' : '#' + playerId)
      + ' — ' + l.length + ' karet');
    l.slice(0, 20).forEach((x) => {
      out.push('   ' + String(x.kind).padEnd(10) + String(x.jak).padEnd(8)
        + 'od ' + String(x.od).padEnd(18) + ('za ' + kc(x.cena) + ' L$').padStart(16)
        + '   ' + x.duvod + '   ' + new Date(x.kdy).toISOString().slice(0, 10));
    });
    // Co mu z toho kape. Dopočítává se jen u karet na návštěvnost — ostatní
    // karty jsou jednorázové a jejich cena je vidět v obchodu.
    const traffic = l.filter((x) => x.kind === TRAFFIC).length;
    if (traffic) {
      const hrac = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
      const z = await ziskZKaret(prisma, hrac, traffic).catch(() => null);
      if (z && z.mesicne > 0) {
        out.push('   → z toho ' + traffic + '× karta na návštěvnost: síť nese ' + kc(z.ted)
          + ' L$/měs, bez nich by nesla ' + kc(z.bez) + ' L$/měs');
        out.push('   → neoprávněný profit ' + kc(z.mesicne) + ' L$ za herní měsíc'
          + ' (návštěvnost ' + z.navstevnost.toFixed(2) + ' místo ' + z.navstevnostBez.toFixed(2) + ')');
      }
    }
    out.push('');
  }
  out.push('Podezřelý zdroj = pomocný účet podle podvod.js, smazaný účet, účet');
  out.push('mladší dvou dnů nebo účet s odehranou necelou půlhodinou. Samo o sobě');
  out.push('to nic nedokazuje — rozhoduje člověk, stejně jako u skóre podvodu.');
  return out.join('\n');
}

module.exports.zprava = zprava;
