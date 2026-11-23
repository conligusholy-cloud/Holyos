// =============================================================================
// Laundromat Tycoon — zločin: zprávy do novin v jazyce čtenáře
// =============================================================================
// Zpráva v novinách leží v databázi dny a přečte ji každý hráč, ne jen ten,
// komu se píše. Když se do ní uloží hotová česká věta, vidí ji česky i hráč,
// co hraje italsky — a zpětně se s tím nedá dělat nic. Proto se do tabulky
// ukládá kód a údaje (stejně jako u doručenek) a věta se skládá až u čtenáře.
//
// Hotový český text se do sloupců zapisuje dál: je to záloha pro řádky, co
// v databázi už jsou, a pro případ, že by klíč v katalogu chyběl.
//
// Co se musí skládat až tady, ne při zápisu:
//  · název útvaru, nálezu a podezření — slova, ne čísla
//  · výčet skutků i s důkazy (skutek) — věta se liší jazyk od jazyka
//  · věta o dřívějším odsouzení (uzOdsouzeno)
// Čísla se formátují značkou {penize:…}, takže oddělovač tisíců sedí na
// jazyk čtenáře. Stará L() s pevným cs-CZ by Italovi psala české mezery.
// =============================================================================
'use strict';

const TEXTY = require('./texty');

// Útvar je v případu uložený jako české jméno (sahá se na něj i v administraci),
// takže se na klíč překládá podle tabulky. Co v ní není, projde, jak je.
const UTVAR = {
  'Celní správa': 'zlocin.utvar.celni_sprava',
  'Policie': 'zlocin.utvar.policie',
  'Finanční úřad': 'zlocin.utvar.financni_urad',
};
const NALEZY = ['spojene_obchody', 'drazby', 'fond', 'pujcky'];
const DUKAZY = ['levne', 'drahe', 'drazba', 'fond', 'pujcka'];
const PREDMETY = ['stroj', 'pradlomat'];
// Stav půjčky leží v databázi jako strojový kód (bezi, vymahano). Hráči se
// musí přeložit — jinak mu v obvinění svítí slovo z tabulky.
const STAVY_PUJCKY = ['bezi', 'splaceno', 'propadlo', 'vymahano'];

const t = (klic, udaje, jazyk) => TEXTY.t(klic, udaje, jazyk);

function utvar(nazev, jazyk) {
  const k = UTVAR[nazev];
  return k ? t(k, null, jazyk) : String(nazev || '');
}

function nalez(kod, jazyk) {
  return NALEZY.indexOf(kod) >= 0 ? t('zlocin.nalez.' + kod, null, jazyk) : String(kod || '?');
}

// Čeho se případ týká. U agenta podle kódu detektoru, u pevných pravidel
// podle typu případu.
function podezreni(o, jazyk) {
  if (o && o.typ === 'agent') {
    const kod = o.kod || '';
    return NALEZY.indexOf(kod) >= 0
      ? t('zlocin.podezreni.' + kod, null, jazyk)
      : t('zlocin.podezreni.jine', null, jazyk);
  }
  return t((o && o.typ) === 'kupec' ? 'zlocin.podezreni.kupec' : 'zlocin.podezreni.zvouci', null, jazyk);
}

// Jeden důkaz. Klíč a údaje přidává agent; text je záloha pro nálezy z doby,
// kdy se důkaz ukládal rovnou česky.
function dukaz(d, jazyk) {
  if (!d) return '';
  if (!d.klic || DUKAZY.indexOf(String(d.klic)) < 0) return String(d.text || '');
  const u = Object.assign({}, d.u || {});
  if (d.predmet) {
    u.p1 = PREDMETY.indexOf(d.predmet) >= 0
      ? t('zlocin.predmet.' + d.predmet, null, jazyk) : String(d.predmet);
  }
  if (d.klic === 'pujcka') {
    u.p3 = d.zastava ? t('zlocin.dukaz.pujcka_zastava', { p1: d.zastava }, jazyk) : '';
    if (STAVY_PUJCKY.indexOf(u.p5) >= 0) u.p5 = t('zlocin.stav_pujcky.' + u.p5, null, jazyk);
  }
  return t('zlocin.dukaz.' + d.klic, u, jazyk);
}

// Čím přesně se firma provinila — i s čísly, aby šlo každé tvrzení ověřit.
// Bez toho vypadá obvinění jako „podezření ze zvoucího" a nedá se proti němu
// nic namítnout.
function skutek(o, jazyk) {
  const casti = [];
  if (o && o.typ === 'agent' && Array.isArray(o.nalezy)) {
    o.nalezy.forEach((n) => {
      if (!n) return;
      const dk = (n.dukazy || []).slice(0, 2).map((x) => dukaz(x, jazyk)).filter(Boolean).join('; ');
      casti.push(t(dk ? 'zlocin.skutek.nalez_dukazy' : 'zlocin.skutek.nalez',
        { p1: nalez(n.kod, jazyk), p2: Math.round(n.skoda || 0), p3: dk }, jazyk));
    });
  } else if (o) {
    if (o.provize > 0) {
      const nicky = (o.mrtvi_nicky || []).slice(0, 5);
      const kdo = nicky.length
        ? t('zlocin.skutek.kdo', { p1: nicky.join(', ')
          + ((o.mrtvych || 0) > 5 ? t('zlocin.skutek.a_dalsi', null, jazyk) : '') }, jazyk)
        : '';
      casti.push(t('zlocin.skutek.provize',
        { p1: Math.round(o.provize), p2: o.mrtvych || 0, p3: kdo }, jazyk));
    }
    if (o.sleva > 0) {
      casti.push(t('zlocin.skutek.sleva', { p1: o.nakupu || 0, p2: Math.round(o.sleva) }, jazyk));
    }
  }
  if (!casti.length) casti.push(podezreni(o, jazyk));
  return casti.join('; ');
}

// Co se NEsoudí znovu. Bez téhle věty vypadá druhý případ jako druhý trest
// za totéž.
function uzOdsouzeno(o, jazyk) {
  const kolik = Math.round((o && o.drive) || 0);
  return kolik > 0 ? t('zlocin.uz_odsouzeno', { p1: kolik }, jazyk) : '';
}

// Obvinění z případu do podoby, která se dá uložit a později přeložit.
// Ukládá se k zprávě, ne jen k případu: případ se časem mění (přeměřuje se
// škoda), ale zpráva má zůstat taková, jaká se tehdy napsala.
function obvineni(z) {
  const d = (z && z.detail) || {};
  const o = { typ: z && z.typ, kod: d.kod || null, drive: Math.round(d.drive_odsouzeno || 0) };
  if (z && z.typ === 'agent' && Array.isArray(d.nalezy)) {
    o.nalezy = d.nalezy.map((n) => ({
      kod: n && n.kod, skoda: Math.round((n && n.skoda) || 0),
      dukazy: ((n && n.dukazy) || []).slice(0, 2).map((x) => ({
        klic: x && x.klic, u: (x && x.u) || null, predmet: (x && x.predmet) || null,
        zastava: (x && x.zastava) || null, text: (x && x.text) || null })),
    }));
  } else {
    o.provize = Math.round(d.provize || 0);
    o.mrtvych = d.mrtvych || 0;
    o.mrtvi_nicky = (d.mrtvi_nicky || []).slice(0, 5);
    o.sleva = Math.round(d.sleva || 0);
    o.nakupu = d.nakupu_od_mrtvych || d.nakupu_ks || 0;
  }
  return o;
}

// Zpráva → nadpis a text v jazyce čtenáře. Bez kódu (staré řádky) se vrátí,
// co je uložené.
function vykresli(z, jazyk) {
  if (!z) return { nadpis: '', text: '' };
  const kod = z.text_kod || '';
  if (!kod) return { nadpis: z.nadpis || '', text: z.text || '' };
  const d = z.text_data || {};
  const o = d.obvineni || null;
  // Znak útvaru u kontroly, u ostatních zpráv pevná ikona podle druhu —
  // tu nese ikona v údajích, aby se emoji nepřekládalo.
  const znak = d.ikona || z.emblem || '';
  const emblem = znak ? znak + ' ' : '';
  const nadpis = (klic, u) => emblem + t('zlocin.zprava.' + klic + '.nadpis', u, jazyk);
  const text = (klic, u) => t('zlocin.zprava.' + klic + '.text', u, jazyk);
  const firma = d.firma || '';

  if (kod === 'kontrola') {
    return { nadpis: nadpis('kontrola', { p1: firma }),
      text: text('kontrola', { p1: utvar(d.utvar, jazyk), p2: firma,
        p3: podezreni(o, jazyk), p4: skutek(o, jazyk), p5: Math.round(d.skoda || 0),
        p6: uzOdsouzeno(o, jazyk) }) };
  }
  if (kod === 'premer') {
    return { nadpis: nadpis('premer', { p1: firma }),
      text: text('premer', { p1: firma, p2: Math.round(d.stara || 0), p3: Math.round(d.nova || 0) }) };
  }
  if (kod === 'soud') {
    return { nadpis: nadpis('soud', { p1: firma }),
      text: text('soud', { p1: firma, p2: Math.round(d.skoda || 0), p3: d.hodin || 0 }) };
  }
  if (kod === 'rozsudek') {
    const h = d.hlasy || {};
    return { nadpis: nadpis('rozsudek', { p1: firma }),
      text: text('rozsudek', { p1: firma, p2: Math.round(d.trest || 0), p3: Math.round(d.skoda || 0),
        p4: d.koef, p5: skutek(o, jazyk), p6: h.nejnizsi || 0, p7: h.stredni || 0, p8: h.nejvyssi || 0,
        p9: d.pozn ? t('zlocin.pozn.' + d.pozn, null, jazyk) : '' }) };
  }
  if (kod === 'odvolani') {
    return { nadpis: nadpis('odvolani', { p1: firma }), text: text('odvolani', { p1: firma }) };
  }
  if (kod === 'uzavreno') {
    return { nadpis: nadpis('uzavreno', { p1: firma }),
      text: text('uzavreno', { p1: firma, p2: Math.round(d.trest || 0),
        p3: d.propadlo > 0 ? t('zlocin.zprava.uzavreno.propadlo', { p1: d.propadlo }, jazyk) : '',
        p4: d.nedoplatek > 0 ? t('zlocin.zprava.uzavreno.nedoplatek', { p1: Math.round(d.nedoplatek) }, jazyk) : '' }) };
  }
  if (kod === 'zruseno') {
    return { nadpis: nadpis('zruseno', { p1: firma }), text: text('zruseno', { p1: firma }) };
  }
  return { nadpis: z.nadpis || '', text: z.text || '' };
}

module.exports = { UTVAR, utvar, nalez, podezreni, dukaz, skutek, uzOdsouzeno, obvineni, vykresli };
