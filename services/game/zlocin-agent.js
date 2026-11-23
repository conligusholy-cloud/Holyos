// =============================================================================
// Laundromat Tycoon — agent nad zločinem
// =============================================================================
// Pravidla zločinu uměla dva vzorce: zvoucího, který inkasuje provize od
// vlastních mrtvých účtů, a kupce, který od nich levně skupuje stroje.
// Finty hráčů tím nekončí — a nikdo je nestíhá hledat ručně.
//
// Agent projde hru, pustí na ni detektory, dopočítá škodu a nálezy předá
// řízení, které je zná: kontrola → soud → odvolání. Nic nerozhoduje natvrdo:
// majetek se zmrazí, hráč se může odvolat a admin má u každého případu
// Potvrdit / Upravit / Zrušit.
//
// Společný základ všech detektorů je spojeni.js — kdo s kým je jeden člověk.
// Samotné spojení není podvod: rodina na jednom počítači je běžná věc.
// Podvod je, když se mezi takovými účty přelévá hodnota, kterou do hry
// nikdo nevložil.
'use strict';

const SPOJENI = require('./spojeni');

// Ceník strojů — stejná čísla jako v pravidlech zločinu, ať se soudí podle
// jednoho metru.
const LIST = { mini: Math.round(35000 * 24.35 * 1.25), flex: Math.round(52000 * 24.35 * 1.25), max: Math.round(67000 * 24.35 * 1.25) };
const cenik = (m) => LIST[String(m || '').toLowerCase()] || LIST.mini;
const L = (n) => Math.round(n).toLocaleString('cs-CZ') + ' L$';
const cislo = (x) => Math.max(0, Math.round(Number(x) || 0));

// Výchozí nastavení agenta. Ukládá se spolu s pravidly zločinu.
const VYCHOZI = {
  agent_zapnuto: false,          // sám zahajuje řízení
  agent_min_skoda: 500000,       // menší nález se nevede, jen zapíše
  agent_levne_pomer: 60,         // % ceníku — pod tím je obchod „pod cenou"
  agent_drahe_pomer: 160,        // % ceníku — nad tím je obchod „nad cenou"
  det_spojene_obchody: true,
  det_drazby: true,
  det_fond: true,
  det_pujcky: true,
};

// ─── Detektory ───────────────────────────────────────────────────────────────
// Každý dostane načtená data a mapu spojení, vrací nálezy:
//   { id, kod, nazev, utvar, skoda, duvod, dukazy: [] }
// Škoda je vždycky to, co hráč získal navíc — ne obrat, ne hodnota firmy.

// Co už bylo jednou souzeno, se nesoudí znovu: u hráče s uzavřeným případem se berou jen události
// PO zahájení jeho posledního uzavřeného případu (data.hranice: hráč → ms).
const po = (data, id, kdy) => { const h = (data.hranice || {})[id]; return !h || (kdy != null && new Date(kdy).getTime() > h); };

// 1) Obchody mezi účty jednoho člověka.
// Prodat si stroj sám sobě není obchod, je to přesun. Hra ale při každém
// obchodu něco dává: provize zvoucímu, nový účet startovní hotovost. Když
// cena neodpovídá ceníku, přelévá se hodnota, kterou nikdo nevydělal.
function spojeneObchody(data, S, R) {
  const dolni = (R.agent_levne_pomer || 60) / 100;
  const horni = (R.agent_drahe_pomer || 160) / 100;
  const nalezy = new Map();
  // Důkaz nese vedle české věty i klíč a údaje — v novinách se skládá
  // v jazyce čtenáře (zlocin-texty.js). text zůstává jako záloha.
  const pridej = (id, skoda, text, obchod, dukaz) => {
    const n = nalezy.get(id) || { id, kod: 'spojene_obchody', nazev: 'Obchody mezi vlastními účty',
      utvar: 'Celní správa', skoda: 0, dukazy: [] };
    n.skoda += skoda;
    if (n.dukazy.length < 12) n.dukazy.push(Object.assign({ obchod, text }, dukaz || {}));
    nalezy.set(id, n);
  };
  (data.obchody || []).forEach((t) => {
    const prod = t.smer === 'koupim' ? t.to_id : t.from_id;
    const kup = t.smer === 'koupim' ? t.from_id : t.to_id;
    if (!prod || !kup || prod === kup) return;
    if (!S.jedenClovek(prod, kup)) return;
    const fer = ['stroj', 'pradlomat'].indexOf(t.predmet) >= 0 ? cenik(t.model) : 0;
    if (!fer) return;                       // co neumíme ocenit, nesoudíme
    const cena = cislo(t.cena);
    const kdyT = t.resolved_at || t.created_at;
    if (cena < fer * dolni) {
      if (!po(data, kup, kdyT)) return;
      pridej(kup, fer - cena, 'koupil ' + t.predmet + ' od svého účtu za ' + L(cena)
        + ' místo ' + L(fer), t.id,
      { klic: 'levne', predmet: t.predmet, u: { p2: cena, p3: fer } });
    } else if (cena > fer * horni) {
      if (!po(data, prod, kdyT)) return;
      pridej(prod, cena - fer, 'prodal ' + t.predmet + ' svému účtu za ' + L(cena)
        + ' místo ' + L(fer), t.id,
      { klic: 'drahe', predmet: t.predmet, u: { p2: cena, p3: fer } });
    }
  });
  return [...nalezy.values()];
}

// 2) Dražby naoko.
// V dražbě dostane prodávající všechny příhozy, i od těch, kdo nevyhráli.
// Kdo si na vlastní věc přihazuje druhým účtem, nepřichází o nic — jen
// šroubuje cenu ostatním. Škoda je to, co na takové dražbě utratili ostatní.
function drazbyNaoko(data, S) {
  const nalezy = new Map();
  const podleDrazby = new Map();
  (data.prihozy || []).forEach((p) => {
    const l = podleDrazby.get(p.drazba_id) || []; l.push(p); podleDrazby.set(p.drazba_id, l);
  });
  (data.drazby || []).forEach((d) => {
    const prihozy = podleDrazby.get(d.id) || [];
    if (!prihozy.length) return;
    if (!po(data, d.prodavajici_id, d.konec || d.created_at)) return;
    const nastrceni = prihozy.filter((p) => p.player_id !== d.prodavajici_id
      && S.jedenClovek(p.player_id, d.prodavajici_id));
    if (!nastrceni.length) return;
    // Cizí peníze, které v téhle dražbě skončily u prodávajícího.
    const cizi = prihozy.filter((p) => p.player_id !== d.prodavajici_id
      && !S.jedenClovek(p.player_id, d.prodavajici_id))
      .reduce((a, p) => a + cislo(p.castka), 0);
    if (!cizi) return;
    const n = nalezy.get(d.prodavajici_id) || { id: d.prodavajici_id, kod: 'drazby',
      nazev: 'Přihazování na vlastní dražbu', utvar: 'Policie', skoda: 0, dukazy: [] };
    n.skoda += cizi;
    if (n.dukazy.length < 12) {
      n.dukazy.push({ drazba: d.id, text: 'na vlastní dražbu „' + (d.nazev || '') + '" přihazoval i jeho účet '
        + (nastrceni[0].nick || '') + '; ostatní v ní nechali ' + L(cizi),
      klic: 'drazba', u: { p1: d.nazev || '', p2: nastrceni[0].nick || '', p3: cizi } });
    }
    nalezy.set(d.prodavajici_id, n);
  });
  return [...nalezy.values()];
}

// 3) Fond a akcie.
// Fond je společná kasa. Když si do něj někdo prodá podíl ve vlastní firmě
// přes spojený účet, sahá na peníze ostatních členů.
function fondAkcie(data, S) {
  const nalezy = new Map();
  const fondu = new Map();
  (data.clenove || []).forEach((c) => {
    const l = fondu.get(c.aliance_id) || []; l.push(c.player_id); fondu.set(c.aliance_id, l);
  });
  (data.equity || []).forEach((e) => {
    if (!e.fond_id || e.stav !== 'bezi') return;
    const cena = cislo(e.cena);
    if (!cena) return;
    if (!po(data, e.firma_id, e.created_at)) return;
    // Komu fond zaplatil: majiteli firmy, ve které podíl drží.
    const clenove = fondu.get(e.fond_id) || [];
    const spojeny = clenove.filter((id) => id !== e.firma_id && S.jedenClovek(id, e.firma_id));
    if (!spojeny.length) return;
    const n = nalezy.get(e.firma_id) || { id: e.firma_id, kod: 'fond',
      nazev: 'Prodej podílu do fondu přes vlastní účet', utvar: 'Finanční úřad', skoda: 0, dukazy: [] };
    n.skoda += cena;
    if (n.dukazy.length < 12) {
      n.dukazy.push({ equity: e.id, text: 'fond koupil ' + Math.round((e.podil || 0) * 100)
        + ' % jeho firmy za ' + L(cena) + ', a ve fondu sedí i jeho účet',
      klic: 'fond', u: { p1: Math.round((e.podil || 0) * 100), p2: cena } });
    }
    nalezy.set(e.firma_id, n);
  });
  return [...nalezy.values()];
}

// 4) Půjčky, co se nesplácejí.
// Půjčka mezi vlastními účty nic nestojí — peníze se jen přelijí. Zajímavé
// je, co z ní zbyde: propadlá zástava u „správného" věřitele nebo dluh,
// který nikdo nevymáhá.
function pujckyNaoko(data, S) {
  const nalezy = new Map();
  (data.pujcky || []).forEach((p) => {
    if (!S.jedenClovek(p.lender_id, p.borrower_id)) return;
    if (!po(data, p.lender_id, p.created_at)) return;
    const splaceno = cislo(p.splaceno) * cislo(p.splatka);
    const zbyva = Math.max(0, cislo(p.castka) - splaceno);
    // Doběhlá a poctivě splacená půjčka mezi příbuznými není škoda.
    if (p.stav === 'splaceno' || !zbyva) return;
    const n = nalezy.get(p.lender_id) || { id: p.lender_id, kod: 'pujcky',
      nazev: 'Půjčka mezi vlastními účty', utvar: 'Finanční úřad', skoda: 0, dukazy: [] };
    n.skoda += zbyva;
    if (n.dukazy.length < 12) {
      n.dukazy.push({ pujcka: p.id, text: 'půjčil ' + L(p.castka) + ' svému účtu ' + (p.borrower_nick || '')
        + (p.zastava_spot ? ' proti zástavě ' + p.zastava_spot : '') + ', nesplaceno ' + L(zbyva)
        + ' (stav ' + p.stav + ')',
      klic: 'pujcka', zastava: p.zastava_spot || null,
      u: { p1: cislo(p.castka), p2: p.borrower_nick || '', p4: zbyva, p5: p.stav } });
    }
    nalezy.set(p.lender_id, n);
  });
  return [...nalezy.values()];
}

const DETEKTORY = [
  { kod: 'spojene_obchody', prepinac: 'det_spojene_obchody', fn: spojeneObchody },
  { kod: 'drazby', prepinac: 'det_drazby', fn: drazbyNaoko },
  { kod: 'fond', prepinac: 'det_fond', fn: fondAkcie },
  { kod: 'pujcky', prepinac: 'det_pujcky', fn: pujckyNaoko },
];

// ─── Průchod ─────────────────────────────────────────────────────────────────
async function data(prisma) {
  const [obchody, drazby, prihozy, equity, clenove, pujcky, hraci] = await Promise.all([
    prisma.gameTrade.findMany({ where: { stav: 'prijato' },
      select: { id: true, from_id: true, to_id: true, smer: true, predmet: true, model: true, cena: true, resolved_at: true, created_at: true } }),
    prisma.gameDrazba.findMany({ where: { stav: 'hotovo' },
      select: { id: true, prodavajici_id: true, nazev: true, suma: true, cena: true, vitez_id: true, konec: true, created_at: true } }),
    prisma.gameDrazbaPrihoz.findMany({ select: { drazba_id: true, player_id: true, nick: true, castka: true } }),
    prisma.gameEquity.findMany({ select: { id: true, investor_id: true, fond_id: true, firma_id: true, podil: true, cena: true, stav: true, created_at: true } }),
    prisma.gameAlianceClen.findMany({ where: { stav: 'clen' }, select: { aliance_id: true, player_id: true } }).catch(() => []),
    prisma.gameLoan.findMany({ select: { id: true, lender_id: true, borrower_id: true, borrower_nick: true,
      castka: true, splatka: true, splaceno: true, stav: true, zastava_spot: true, created_at: true } }),
    prisma.gamePlayer.findMany({ select: { id: true, nick: true, company: true, disabled: true } }),
  ]);
  const hranice = {};
  try { (await prisma.gameZlocin.findMany({ where: { stav: 'uzavreno' }, select: { hlavni_id: true, zahajeno_at: true } })).forEach((x) => {
    const t = new Date(x.zahajeno_at).getTime(); if (!hranice[x.hlavni_id] || t > hranice[x.hlavni_id]) hranice[x.hlavni_id] = t; }); } catch (e) { /* bez tabulky se počítá vše */ }
  return { obchody, drazby, prihozy, equity, clenove, pujcky, hraci, hranice };
}

// Nálezy agenta, sloučené po hráčích. Vrací řádky ve tvaru, který umí
// zahájit řízení (stejný jako pravidla zločinu).
function vyhodnot(d, S, R) {
  const pravidla = Object.assign({}, VYCHOZI, R || {});
  const podleHrace = new Map();
  DETEKTORY.forEach((det) => {
    if (!pravidla[det.prepinac]) return;
    det.fn(d, S, pravidla).forEach((n) => {
      if (!(n.skoda > 0)) return;
      const h = podleHrace.get(n.id) || { id: n.id, skoda: 0, nalezy: [] };
      h.skoda += Math.round(n.skoda);
      h.nalezy.push(Object.assign({}, n, { skoda: Math.round(n.skoda) }));
      podleHrace.set(n.id, h);
    });
  });
  const P = new Map((d.hraci || []).map((h) => [h.id, h]));
  const ven = [];
  podleHrace.forEach((h) => {
    const p = P.get(h.id);
    if (!p || p.disabled) return;           // zablokovaný účet už nestíháme
    // Případ vede útvar toho nálezu, který na hráči váží nejvíc.
    const hlavni = h.nalezy.slice().sort((a, b) => b.skoda - a.skoda)[0];
    ven.push({
      id: h.id, nick: p.nick, firma: p.company || null,
      typ: 'agent', kod: hlavni.kod, utvar: hlavni.utvar,
      po_datu: (d.hranice || {})[h.id] ? new Date(d.hranice[h.id]).toISOString() : undefined,
      skoda: h.skoda,
      zmrazit: Math.round(h.skoda * (pravidla.koef_zabaveni || 1.2)),
      trest: { nejnizsi: Math.round(h.skoda * (pravidla.trest_nejnizsi || 1)),
        stredni: Math.round(h.skoda * (pravidla.trest_stredni || 1.2)),
        nejvyssi: Math.round(h.skoda * (pravidla.trest_nejvyssi || 1.3)) },
      nalezy: h.nalezy.map((n) => ({ kod: n.kod, nazev: n.nazev, skoda: n.skoda,
        dukazy: n.dukazy, spojeni: null })),
      duvod: h.nalezy.map((n) => n.nazev + ' (' + L(n.skoda) + ')').join(', '),
    });
  });
  ven.sort((a, b) => b.skoda - a.skoda);
  return ven;
}

// Co agent našel teď. Nic nezahajuje — to dělá řízení.
async function projdi(prisma, R) {
  const [d, S] = await Promise.all([data(prisma), SPOJENI.nacti(prisma)]);
  return vyhodnot(d, S, R);
}

module.exports = { projdi, vyhodnot, data, DETEKTORY, VYCHOZI,
  spojeneObchody, drazbyNaoko, fondAkcie, pujckyNaoko, cenik };
