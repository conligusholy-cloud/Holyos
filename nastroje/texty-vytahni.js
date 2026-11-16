#!/usr/bin/env node
// =============================================================================
// Vytažení českých textů z game.js do katalogu
// =============================================================================
// Ruční přepisování nedává smysl: v game.js je přes tři a půl tisíce českých
// řetězců a čtyřicet procent z nich je slepených přes +. Tenhle nástroj to
// udělá mechanicky a člověk jen kontroluje výsledek.
//
// Co umí a co schválně neumí:
//  · Uvnitř řetězce hledá text mezi značkami — co leží mezi > a <, je text
//    pro hráče; samotné HTML se nechává být.
//  · Řetězec úplně bez HTML se nahradí celý.
//  · Text, ve kterém zbyde kus kódu (apostrof, složená závorka), nechá být
//    a nahlásí ho. Raději ho přepíšu ručně, než aby to tiše rozbil.
//
// POUŽITÍ:  node nastroje/texty-vytahni.js <funkce> <predpona> [--zapsat]
// Bez --zapsat jen ukáže, co by udělal.
'use strict';

const fs = require('fs');
const path = require('path');

const HRA = path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js');
const CS = path.join(__dirname, '..', 'services', 'game', 'texty', 'cs.json');
const CZ = /[ěščřžýáíéúůňťďóĚŠČŘŽÝÁÍÉÚŮŇŤĎÓ]/;

// Podle háčků a čárek se text pro hráče nepozná — 'Koupit za', 'Za den'
// a 'Hotovost' jsou česky a diakritiku nemají. Rozhoduje proto, kde text
// stojí a jak vypadá.
//
// Text mezi značkami je vždycky vidět, stačí aby v něm bylo slovo.
// Samostatný řetězec je naopak obvykle technický — třída, selektor, adresa,
// klíč — a ten se nesmí vzít. Pustíme ho jen tehdy, když vypadá jako věta:
// začíná velkým písmenem nebo má mezeru a žádné znaky ze světa kódu.
const TECHNICKE = /[=<>{}#;|\\]|\/\/|\bhttp|^[a-z0-9_]+(\.[a-z0-9_]+)+$|^[.#][a-zA-Z]/;
function jeText(s, meziZnackami) {
  const c = String(s).trim();
  if (!/[A-Za-zÀ-ž]{2}/.test(c)) return false;
  if (CZ.test(c)) return true;
  if (TECHNICKE.test(c)) return false;
  // Jedno slovo, co vypadá jako z kódu: AbortError, Content-Type, POST.
  // Text pro hráče se takhle nepíše.
  if (!/\s/.test(c)) {
    if (/^[A-Z0-9_-]+$/.test(c)) return false;
    if (/[a-z][A-Z]/.test(c)) return false;
    if (/-[A-Z]/.test(c)) return false;
  }
  if (meziZnackami) return true;
  // Samostatný řetězec: buď začíná velkým písmenem, nebo je to kus věty
  // s mezerou. Jedno malé slovo je skoro vždycky název třídy nebo klíč.
  if (/^[A-ZÀ-Ž]/.test(c)) return true;
  if (/\s/.test(c) && !/^[a-z0-9_-]+( [a-z0-9_-]+)*$/.test(c)) return true;
  return false;
}

// Klíč z textu: bez diakritiky, slova spojená podtržítkem, rozumně krátký.
// Znak zapsaný ve zdroji jako \u00d7 patří do katalogu jako samotný znak.
// Jinak by hráč v okně viděl ten zápis, ne křížek.
function dekoduj(s) {
  return String(s)
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function klicZ(text, predpona, obsazene) {
  let z = text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  z = z.split('_').filter(Boolean).slice(0, 5).join('_') || 'text';
  let k = predpona + '.' + z, i = 2;
  while (obsazene.has(k)) { k = predpona + '.' + z + '_' + i; i++; }
  obsazene.add(k);
  return k;
}

// Najde tělo funkce podle jména — od 'function jmeno(' po další deklaraci
// na začátku řádku.
function telo(zdroj, jmeno) {
  const radky = zdroj.split('\n');
  const od = radky.findIndex((l) => l.startsWith('function ' + jmeno + '('));
  if (od < 0) return null;
  let doR = od + 1;
  while (doR < radky.length && !/^function \w+/.test(radky[doR])) doR++;
  return { od, doR, text: radky.slice(od, doR).join('\n') };
}

// Je ten text samostatná věta nebo popisek, nebo jen úlomek něčeho většího?
// Když se do věty vprostřed vkládá číslo, rozpadne se na kusy jako „. Máš"
// a „, takže klid." — ty přeložit nejde, protože v angličtině je jiný
// slovosled. Takový text nástroj nechá být a nahlásí ho k ruční práci.
// Poznávací znamení úlomku: začíná interpunkcí nebo malým písmenem, anebo
// nekončí tečkou, otazníkem či dvojtečkou a zároveň na něj přímo navazuje
// vkládaná hodnota.
function uUlomek(cisty, pred, po) {
  if (/^[.,;:!?%)\]]/.test(cisty)) return true;             // začíná interpunkcí
  if (/^[a-záčďéěíňóřšťúůýž]/.test(cisty) && pred) return true; // pokračuje větou
  if (po && !/[.!?:]$/.test(cisty)) return true;             // věta pokračuje za ním
  return false;
}

// Rozdělí obsah řetězcového literálu na části: co je text pro hráče a co HTML.
// Text pro hráče = úsek mezi > a < (nebo celý literál, když HTML neobsahuje).
function casti(obsah) {
  if (obsah.indexOf('<') < 0 && obsah.indexOf('>') < 0) {
    return jeText(obsah, false) ? [{ text: true, s: obsah }] : [{ text: false, s: obsah }];
  }
  const out = [];
  // Text pro hráče nesedí jen mezi dvěma značkami. Řetězec často končí
  // uprostřed věty — '<b>Hodnocení: ' — nebo jí naopak začíná —
  // 'To s hodnocením zamávalo.</p>'. Bereme proto i úsek před první
  // značkou a za poslední.
  const prvni = obsah.indexOf('<');
  const posledni = obsah.lastIndexOf('>');
  let pos = 0;
  if (prvni > 0) { out.push({ text: jeText(obsah.slice(0, prvni), true), s: obsah.slice(0, prvni) }); pos = prvni; }
  const stred = posledni >= pos ? obsah.slice(pos, posledni + 1) : '';
  const re = />([^<>]+)</g;
  let p2 = 0, m;
  while ((m = re.exec(stred)) !== null) {
    const zacatek = m.index + 1;
    if (zacatek > p2) out.push({ text: false, s: stred.slice(p2, zacatek) });
    out.push({ text: jeText(m[1], true), s: m[1] });
    p2 = zacatek + m[1].length;
    re.lastIndex = p2;
  }
  if (p2 < stred.length) out.push({ text: false, s: stred.slice(p2) });
  if (posledni >= pos && posledni + 1 < obsah.length) {
    const konec = obsah.slice(posledni + 1);
    out.push({ text: jeText(konec, true), s: konec });
  }
  return out;
}

function main() {
  const [jmeno, predpona, prepinac] = process.argv.slice(2);
  if (!jmeno || !predpona) {
    console.error('použití: node nastroje/texty-vytahni.js <funkce> <predpona> [--zapsat]');
    process.exit(1);
  }
  const zapsat = prepinac === '--zapsat';
  const zdroj = fs.readFileSync(HRA, 'utf8');
  const fn = telo(zdroj, jmeno);
  if (!fn) { console.error('funkci ' + jmeno + ' jsem v game.js nenašel.'); process.exit(1); }
  // Překladač se jmenuje tx schválně: 't' je v game.js na devětadvaceti
  // místech lokální proměnná a volání by se tiše stínilo. Kdyby se někde
  // objevilo i lokální tx, radši se zastavím, než abych to rozbil.
  if (/(?:var|let|const)\s+tx\b|,\s*tx\s*=/.test(fn.text)) {
    console.error('ve funkci ' + jmeno + ' je lokální proměnná tx — přepiš ji ručně.');
    process.exit(2);
  }

  const cs = JSON.parse(fs.readFileSync(CS, 'utf8'));
  const obsazene = new Set(Object.keys(cs));
  const nove = {};
  const preskoceno = [];

  // Jen literály v jednoduchých uvozovkách — tak je celý game.js psaný.
  const novyText = fn.text.replace(/'((?:[^'\\\n]|\\.)*)'/g, (cele, obsah) => {
    if (!jeText(obsah, true)) return cele;
    // Text, ve kterém je kus kódu, nechávám na ruční přepis.
    if (/\\'|\$\{|\\n/.test(obsah)) { preskoceno.push(obsah); return cele; }
    const ch = casti(obsah);
    if (!ch.some((c) => c.text)) return cele;
    // Navazuje na literál zleva nebo zprava vkládaná hodnota? Podle toho se
    // pozná, jestli text uprostřed věty pokračuje někde jinde.
    const kde = fn.text.indexOf(cele);
    const okoliPred = fn.text.slice(Math.max(0, kde - 40), kde);
    // Porovnání — e.key === 'Enter' — není text pro hráče, je to hodnota.
    if (/[=!]==?\s*$/.test(okoliPred)) { preskoceno.push(obsah); return cele; }
    // Ukázka ve vysvětlivce taky ne.
    const radek = okoliPred.slice(okoliPred.lastIndexOf('\n') + 1);
    if (radek.indexOf('//') >= 0) return cele;
    const okoliPo = fn.text.slice(kde + cele.length, kde + cele.length + 40);
    const lepiPred = /\+\s*$/.test(okoliPred);
    const lepiPo = /^\s*\+/.test(okoliPo);
    const ulomky = ch.filter((c) => c.text).some((c, i, pole) => {
      const prvni = i === 0 && ch[0] === c;
      const posledni = ch[ch.length - 1] === c;
      return uUlomek(c.s.trim(), prvni && lepiPred, posledni && lepiPo);
    });
    if (ulomky) { preskoceno.push(obsah); return cele; }
    const kusy = [];
    ch.forEach((c) => {
      if (!c.text) { if (c.s) kusy.push("'" + c.s + "'"); return; }
      const cisty = c.s.trim();
      if (!cisty) { kusy.push("'" + c.s + "'"); return; }
      const pred = c.s.slice(0, c.s.indexOf(cisty));
      const po = c.s.slice(c.s.indexOf(cisty) + cisty.length);
      const k = klicZ(dekoduj(cisty), predpona, obsazene);
      nove[k] = dekoduj(cisty);
      if (pred) kusy.push("'" + pred + "'");
      kusy.push('esc(tx(\'' + k + '\'))');
      if (po) kusy.push("'" + po + "'");
    });
    return kusy.join(' + ');
  });

  console.log('funkce ' + jmeno + ' · řádky ' + (fn.od + 1) + '–' + fn.doR);
  console.log('nových klíčů: ' + Object.keys(nove).length
    + (preskoceno.length ? ' · k ručnímu přepisu: ' + preskoceno.length : ''));
  Object.keys(nove).forEach((k) => console.log('  ' + k.padEnd(42) + ' = ' + nove[k].slice(0, 60)));
  preskoceno.forEach((x) => console.log('  [ručně] ' + x.slice(0, 80)));

  if (!zapsat) { console.log('\n(zkouška nanečisto — zapsat přes --zapsat)'); return; }
  Object.assign(cs, nove);
  fs.writeFileSync(CS, JSON.stringify(cs, null, 2) + '\n', 'utf8');
  const radky = zdroj.split('\n');
  fs.writeFileSync(HRA, radky.slice(0, fn.od).concat(novyText.split('\n'))
    .concat(radky.slice(fn.doR)).join('\n'), 'utf8');
  console.log('\nzapsáno.');
}
main();
