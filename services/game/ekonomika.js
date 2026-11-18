// =============================================================================
// Laundromat Tycoon — kolik firma vydělává, počítáno serverem
// =============================================================================
// První etapa firemní pokladny. Zisk zatím počítá prohlížeč a server jen
// ukládá, co mu přijde; než se dá hotovost přestěhovat na server, musí server
// umět spočítat totéž sám — a muset se oba výsledky potkat.
//
// Tenhle modul proto zrcadlí vzorec z public/compounder/game/game.js. Nic
// neodmítá a nic nepřepisuje: jen řekne, kolik by firmě mělo měsíčně zbýt.
// Porovnání s tím, co hlásí hra, je o patro výš.
//
// Vzorec, krok za krokem:
//
//   poptávka    kolik lidí denně místo nabídne — roste se skóre rychleji
//               než lineárně (špičkové místo má dvojnásobek průměrného)
//   obslouží    kolik z nich stroj pobere; zbytek odejde ke konkurenci
//   tržba       obslouží × návštěvnost × 30,5 dne × útrata × kurz eura
//   náklady     energie 9 % a servis 13 % z tržby, k tomu nájem
//
// Co server zatím neví a vědět nemůže: kampaň, karty, pověst a krize mění
// návštěvnost a žijí ve stavu hry. Proto se návštěvnost předává zvenčí —
// a dokud se bere z klientského stavu, je tahle část pořád na dobré slovo.
// Ta hranice je tu schválně vidět; posune se, až bude návštěvnost taky na
// serveru.
//
// Všechny konstanty MUSÍ sedět s game.js. Když se tam změní, musí se změnit
// i tady — a test to pozná, protože počítá stejné případy jako prohlížeč.

'use strict';

const EUR = 24.35;
const DNU_V_MESICI = 30.5;
const ENERGY_SHARE = 0.09;
const SERVIS_SHARE = 0.13;
const POPTAVKA_SPICKA = 20;        // lidí denně na místě se skóre 100
const POPTAVKA_SKLON = 1.5;
const RENT_EUR = 165;              // základní měsíční nájem z reálného modelu

const MODELS = {
  mini: { kapacita: 7.1, spend: 16.52 },
  flex: { kapacita: 14.3, spend: 11.33 },
  max: { kapacita: 20, spend: 11.33 },
};

function poptavkaMista(score) {
  const sc = Math.max(0, Math.min(100, Number(score) || 0));
  return POPTAVKA_SPICKA * Math.pow(sc / 100, POPTAVKA_SKLON);
}

// ─── Světové události ────────────────────────────────────────────────────────
// Povodeň, festival, recese, zdražení energií. Vyhlašuje je server, takže
// o nich ví sám — a dokud je nezapočítával, vycházel mu zisk sítě výš než
// hře. Negativním událostem se hra vyhýbá hráčům s pěti a méně prádlomaty,
// aby začátečníka nesrazila na kolena hned.
const UDAL_OCHRANA = 5;
const UDAL_DNO = 0.45;
const UDAL_STROP = 1.8;

function udalostKoef(udalosti, areaKey, pocetMist, ted) {
  let navst = 1, nakl = 1;
  const t = ted == null ? Date.now() : ted;
  (udalosti || []).forEach((e) => {
    if (!e.dobra && (Number(pocetMist) || 0) < UDAL_OCHRANA) return;
    // mesta === null znamená celý svět.
    if (e.mesta && e.mesta.indexOf(areaKey) < 0) return;
    if (new Date(e.do).getTime() <= t) return;
    const d = e.dopad || {};
    navst *= 1 + (Number(d.navstevnost) || 0);
    nakl *= 1 + (Number(d.naklady) || 0);
  });
  return { navstevnost: Math.max(UDAL_DNO, Math.min(UDAL_STROP, navst)),
    naklady: Math.max(0.5, Math.min(2, nakl)) };
}

// Jeden prádlomat za jeden herní měsíc. podil < 1 znamená, že se o zákazníky
// na tom místě dělí víc strojů.
//
// Pořadí výpočtu musí sedět s refreshUnits() v game.js do koruny:
// servis se počítá z PLNÉ tržby (technik vyjede, i když stroj stojí),
// energie až z té skutečné.
function jedenStroj(misto, navstevnost, opts) {
  const m = MODELS[(misto && misto.model)] || MODELS.flex;
  const podil = misto && misto.podil != null ? Number(misto.podil) : 1;
  const ud = (opts && opts.udalost) || { navstevnost: 1, naklady: 1 };
  const chod = opts && opts.chod != null ? Math.max(0, Number(opts.chod)) : 1;
  const poptavka = poptavkaMista(misto && misto.score) * podil;
  const obslouzi = Math.min(m.kapacita, poptavka);
  const perday = obslouzi * Math.max(0, Number(navstevnost) || 0)
    * (Number(ud.navstevnost) || 1);
  const plne = Math.round(perday * DNU_V_MESICI * m.spend * EUR);
  const trzba = Math.round(plne * chod);
  const energie = Math.round(trzba * ENERGY_SHARE * (Number(ud.naklady) || 1));
  const servis = Math.round(plne * SERVIS_SHARE * (Number(ud.naklady) || 1));
  // Na vlastní zemi se nájem neplatí. Jinak platí to, co je domluvené.
  const najem = misto && misto.pozemek ? 0 : Math.max(0, Math.round((misto && misto.rent) || 0));
  const naklady = energie + servis + najem;
  return { trzba, plne, energie, servis, najem, naklady, zisk: trzba - naklady };
}

// Celá síť jednoho hráče. Vrací součty, ať se dá rovnou porovnat s tím,
// co hlásí hra.
function site(mista, navstevnost, opts) {
  const out = { pradlomatu: 0, trzba: 0, energie: 0, servis: 0, najem: 0, naklady: 0, zisk: 0 };
  const udalosti = (opts && opts.udalosti) || null;
  const ted = opts && opts.ted;
  const kolik = (mista || []).length;
  (mista || []).forEach((p) => {
    const e = jedenStroj(p, navstevnost, {
      udalost: udalosti ? udalostKoef(udalosti, p.area_key, kolik, ted) : null,
      chod: p.chod,
    });
    out.pradlomatu++;
    out.trzba += e.trzba; out.energie += e.energie; out.servis += e.servis;
    out.najem += e.najem; out.naklady += e.naklady; out.zisk += e.zisk;
  });
  return out;
}

// Skóre místa, když ho server nemá uložené. Dá se dopočítat z nájmu, protože
// ten z něj vznikl: rent = RENT_EUR × EUR × attract × deal, zaokrouhlený na
// stovky, kde attract roste se skóre a deal je otisk místa.
//
// Je to odhad, ne údaj: zaokrouhlení na stovky dělá u slabých míst chybu
// několika bodů. U míst s vyjednaným nájmem je mimo úplně — tam se nájem
// neodvozoval ze skóre. Proto se tím počítá jen to, co ještě nemá skóre
// uložené, a výsledek se označuje jako přibližný.
function skoreZNajmu(rent, deal) {
  const r = Math.max(0, Number(rent) || 0);
  const d = Number(deal) || 1;
  if (!r || !d) return null;
  const attract = (r / (RENT_EUR * EUR * d));
  const sc = ((attract - 0.7) / 0.8) * 100;
  if (!isFinite(sc)) return null;
  return Math.max(0, Math.min(100, Math.round(sc)));
}

module.exports = { jedenStroj, site, poptavkaMista, skoreZNajmu, udalostKoef,
  UDAL_OCHRANA, UDAL_DNO, UDAL_STROP,
  EUR, DNU_V_MESICI, ENERGY_SHARE, SERVIS_SHARE, POPTAVKA_SPICKA, POPTAVKA_SKLON,
  RENT_EUR, MODELS };
