#!/usr/bin/env node
// =============================================================================
// Kontrola překladů — co chybí, co zestaralo, kde se zapomnělo na katalog
// =============================================================================
// Pouští se před nasazením. Hlídá tři věci:
//
//  1. Chybějící překlad — klíč je v češtině a v angličtině ne.
//  2. Zastaralý překlad — česká předloha se od posledního překladu změnila.
//     Pozná se podle otisku uloženého v en.meta.json; bez něj by se změna
//     české věty tiše nepromítla a anglická verze by lhala.
//  3. Zapomenutý text — český řetězec přímo v kódu, mimo katalog. Tohle je
//     ta nejdůležitější past: bez téhle kontroly se za měsíc začne zase
//     programovat s textem přivařeným do kódu a celá práce se rozpadne.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOREN = path.join(__dirname, '..');
const TEXTY = path.join(KOREN, 'services', 'game', 'texty');
const HRA = path.join(KOREN, 'public', 'compounder', 'game', 'game.js');
const CZ = /[ěščřžýáíéúůňťďóĚŠČŘŽÝÁÍÉÚŮŇŤĎÓ]/;

function nacti(jmeno, vychozi) {
  try { return JSON.parse(fs.readFileSync(path.join(TEXTY, jmeno), 'utf8')); }
  catch (e) { return vychozi; }
}
const otisk = (x) => crypto.createHash('sha1')
  .update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);

// Stejné pravidlo jako ve vytahovacím nástroji: mezi značkami je text vždycky
// vidět, samostatný řetězec se pustí jen tehdy, když vypadá jako věta.
const TECHNICKE = /[=<>{}#;|\\]|\/\/|\bhttp|^[a-z0-9_]+(\.[a-z0-9_]+)+$|^[.#][a-zA-Z]/;
function jeText(v) {
  const c = String(v).trim();
  if (!/[A-Za-zÀ-ž]{2}/.test(c)) return false;
  if (CZ.test(c)) return true;
  if (TECHNICKE.test(c)) return false;
  if (!/\s/.test(c)) {
    if (/^[A-Z0-9_-]+$/.test(c)) return false;
    if (/[a-z][A-Z]/.test(c) || /-[A-Z]/.test(c)) return false;
  }
  if (/^[A-ZÀ-Ž]/.test(c)) return true;
  if (/\s/.test(c) && !/^[a-z0-9_-]+( [a-z0-9_-]+)*$/.test(c)) return true;
  return false;
}

// Text pro hráče nesedí jen samostatně — bývá uvnitř HTML, mezi značkami.
// Bez tohohle dělení by '<span>Cena</span>' prošlo jako kus kódu.
function casti(obsah) {
  if (obsah.indexOf('<') < 0 && obsah.indexOf('>') < 0) return [{ s: obsah, mezi: false }];
  const out = [];
  const prvni = obsah.indexOf('<'), posledni = obsah.lastIndexOf('>');
  let pos = 0;
  if (prvni > 0) { out.push({ s: obsah.slice(0, prvni), mezi: true }); pos = prvni; }
  const stred = posledni >= pos ? obsah.slice(pos, posledni + 1) : '';
  const re = />([^<>]+)</g;
  let m;
  while ((m = re.exec(stred)) !== null) out.push({ s: m[1], mezi: true });
  if (posledni >= pos && posledni + 1 < obsah.length) out.push({ s: obsah.slice(posledni + 1), mezi: true });
  return out;
}

function main() {
  const cs = nacti('cs.json', {});
  const en = nacti('en.json', {});
  const meta = nacti('en.meta.json', {});

  const chybi = [], zastarale = [];
  Object.keys(cs).forEach((k) => {
    if (en[k] == null) { chybi.push(k); return; }
    if (meta[k] && meta[k] !== otisk(cs[k])) zastarale.push(k);
  });

  // Zapomenuté texty v kódu. Podle háčků a čárek se text pro hráče nepozná —
  // 'Koupit za', 'Za den' a 'Hotovost' jsou česky a diakritiku nemají. Bere
  // se proto i text bez ní, když vypadá jako věta a ne jako kus kódu.
  // Komentáře se přeskakují, ty jsou pro nás, ne pro hráče.
  // Kouká se i na server: doručenky, události a vyrovnání čte hráč stejně
  // jako okna ve hře. Správa hry sem nepatří, tu vidí jen majitel, a
  // game.routes.js je veřejná cesta bez přihlášeného hráče.
  const HLIDANE = [
    ['game.js', HRA],
    ['finance.js', path.join(KOREN, 'services', 'game', 'finance.js')],
    ['udalosti.js', path.join(KOREN, 'services', 'game', 'udalosti.js')],
    ['vyrovnani.js', path.join(KOREN, 'services', 'game', 'vyrovnani.js')],
    ['game-account.routes.js', path.join(KOREN, 'routes', 'game-account.routes.js')],
    ['game-trade.routes.js', path.join(KOREN, 'routes', 'game-trade.routes.js')],
  ];
  const zapomenute = [];
  HLIDANE.forEach(([jmeno, cesta]) => {
    let obsah = '';
    try { obsah = fs.readFileSync(cesta, 'utf8'); } catch (e) { return; }
    const radkyS = obsah.split('\n');
    // Posun každého řádku v celém souboru — potřeba na okolí kolem nálezu.
    const zacatky = []; let poz = 0;
    radkyS.forEach((l) => { zacatky.push(poz); poz += l.length + 1; });
    // Úsek, který se schválně nepřekládá. Jsou místa, kde jsou řetězce
    // technické a hráč je nikdy neuvidí — otisk prohlížeče zkouší písma a
    // kreslí do plátna, takže tam stojí „16px Arial" i „Pračka 18 kg €".
    // Hlásit je jako zapomenutý text znamená držet číslo natrvalo nad nulou,
    // a pak si nikdo nevšimne toho jednoho, který tam opravdu nepatří.
    // Hranice se značí komentáři v původním zdroji:
    //   /* bez překladu od */ … /* bez překladu do */
    const mimo = new Set();
    let vUseku = false;
    radkyS.forEach((l, i) => {
      if (/bez překladu od/.test(l)) vUseku = true;
      if (vUseku) mimo.add(i);
      if (/bez překladu do/.test(l)) vUseku = false;
    });
    radkyS.forEach((l, i) => {
      if (mimo.has(i)) return;
      const bezKomentare = l.replace(/\/\/.*$/, '');
      // Výpis do konzole je pro nás, ne pro hráče.
      if (/\bconsole\.(log|warn|error|info)\s*\(/.test(bezKomentare)) return;
      const re = /'((?:[^'\\\n]|\\.)*)'/g;
      let m;
      while ((m = re.exec(bezKomentare)) !== null) {
        // Porovnání — e.key === 'Enter' — je hodnota, ne text pro hráče.
        const pred = bezKomentare.slice(0, m.index);
        if (/[=!]==?\s*$/.test(pred)) continue;
        // Dotaz do databáze ani technický klíč nejsou text pro hráče:
        // popis: { startsWith: 'Provize' } je filtr, timeZone je časové pásmo.
        if (/\b(startsWith|contains|endsWith|equals|timeZone|locale|label|id)\s*:\s*$/.test(pred)) continue;
        // Doručenka, která má text_kod, si český popis nechává schválně:
        // je to záloha zapsaná do databáze pro případ, že by klíč zmizel.
        // Hráč ji normálně nevidí, překládá se podle klíče.
        const kolem = obsah.slice(Math.max(0, zacatky[i] - 500), zacatky[i] + l.length + 500);
        if (kolem.indexOf('text_kod') >= 0 || kolem.indexOf('nazev_kod') >= 0 || kolem.indexOf('nazevKod') >= 0) continue;
        // Víceřádkový výpis do konzole — pokračovací řádek sám o sobě
        // console nemá, pozná se podle začátku příkazu nad ním.
        const predRadky = radkyS.slice(Math.max(0, i - 3), i).join('\n');
        const otevrene = (predRadky.match(/console\.(log|warn|error|info)\s*\(/g) || []).length;
        if (otevrene) {
          // Počítáme závorky od posledního console — dokud se nezavřou, jsme
          // pořád uvnitř výpisu, i o několik řádků níž.
          const od = predRadky.lastIndexOf('console.');
          const zbytek = predRadky.slice(od);
          let h = 0;
          for (const z of zbytek) { if (z === '(') h++; else if (z === ')') h--; }
          if (h > 0) continue;
        }
        if (!m[1]) continue;
        const nalez = casti(m[1]).map((c) => c.s.trim()).filter((c) => jeText(c))[0];
        if (nalez) zapomenute.push({ kde: jmeno, radek: i + 1, text: nalez.slice(0, 60) });
      }
    });
  });

  // Klíč použitý v kódu, který v katalogu není. Takový se hráči ukáže jako
  // holý 'server.neprihlasen' — přesně to se stalo, když jsem jeden klíč
  // napsal ručně a zapomněl ho do katalogu doplnit. Prošlo to až na produkci.
  const soubory = [HRA,
    path.join(KOREN, 'routes', 'game-trade.routes.js'),
    path.join(KOREN, 'routes', 'game-account.routes.js')];
  const chybejiciKlice = new Set();
  soubory.forEach((f) => {
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    // Komentáře ven — ukázky klíčů ve vysvětlivkách nejsou volání.
    txt = txt.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    // Klíč skládaný za běhu — tx('model.' + k + '.popis') — není chybějící
    // klíč, jen ho tady nedohlédneme. Poznáme ho podle toho, že za uvozovkou
    // pokračuje výraz, ne čárka nebo konec volání.
    const re = /(?:^|[^\w$.])(?:tx|stx\(req\)|TEXTY\.t)\(\s*'([a-z][\w.]+)'\s*[,)]/g;
    let m;
    while ((m = re.exec(txt)) !== null) if (cs[m[1]] == null) chybejiciKlice.add(m[1]);
  });

  console.log('klíčů použitých v kódu a chybějících v katalogu: ' + chybejiciKlice.size);
  if (chybejiciKlice.size) [...chybejiciKlice].slice(0, 20).forEach((k) => console.log('  BEZ TEXTU  ' + k));

  // ─── esc() na textu, který nese HTML ──────────────────────────────────
  // Sloučené šablony vozí i stavbu okna. Když se taková hodnota prožene
  // přes esc(), uvozovka v atributu se změní na &quot;, značka se nezavře
  // a spolkne zbytek řádku. Na pobočkách se to stalo: řádky se slily do
  // jednoho odstavce a křížek na zrušení zmizel. Okem se to v katalogu
  // nepozná, protože samotný text vypadá v pořádku.
  const sHtml = new Set(Object.keys(cs).filter((k) => {
    const v = cs[k];
    const t = typeof v === 'string' ? v : Object.keys(v || {}).map((x) => v[x]).join(' ');
    return /[<>"]/.test(String(t));
  }));
  const escHtml = [];
  soubory.forEach((f) => {
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    txt = txt.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const re2 = /esc\(\s*(?:tx|stx\(req\)|TEXTY\.t)\(\s*'([a-z][\w.]+)'/g;
    let m2;
    while ((m2 = re2.exec(txt)) !== null) {
      if (!sHtml.has(m2[1])) continue;
      escHtml.push({ kde: path.basename(f), radek: txt.slice(0, m2.index).split('\n').length, klic: m2[1] });
    }
  });
  console.log('textů s HTML prohnaných přes esc(): ' + escHtml.length);
  escHtml.forEach((x) => console.log('  ROZBITÉ HTML  ' + x.kde + ' ř.' + x.radek + '  ' + x.klic));

  console.log('klíčů v češtině: ' + Object.keys(cs).length
    + ' · přeloženo: ' + (Object.keys(cs).length - chybi.length)
    + ' · chybí: ' + chybi.length
    + ' · zastaralých: ' + zastarale.length);
  console.log('českých textů přímo v kódu: ' + zapomenute.length);

  // Scénáře infolinky jdou vedle katalogu — próza, ne klíče.
  let linkaChybi = 0, linkaCelkem = 0;
  try {
    const lcs = JSON.parse(fs.readFileSync(path.join(KOREN, 'services', 'game', 'texty', 'linka.cs.json'), 'utf8'));
    let len = [], lmeta = {};
    try { len = JSON.parse(fs.readFileSync(path.join(KOREN, 'services', 'game', 'texty', 'linka.en.json'), 'utf8')); } catch (e) { /* ještě není */ }
    try { lmeta = JSON.parse(fs.readFileSync(path.join(KOREN, 'services', 'game', 'texty', 'linka.en.meta.json'), 'utf8')); } catch (e) { /* ještě není */ }
    const mam = new Set(len.map((x) => x.id));
    linkaCelkem = lcs.length;
    linkaChybi = lcs.filter((x) => !mam.has(x.id) || lmeta[x.id] !== otisk(x)).length;
    console.log('scénářů infolinky: ' + linkaCelkem + ' · k překladu: ' + linkaChybi);
  } catch (e) { /* linka nemusí být */ }

  if (process.argv.includes('--vypis')) {
    chybi.slice(0, 40).forEach((k) => console.log('  chybí      ' + k));
    zastarale.forEach((k) => console.log('  zastaralé  ' + k));
    zapomenute.slice(0, 200).forEach((z) => console.log('  v kódu  ' + z.kde + ' ř.' + z.radek + '  ' + z.text));
  }

  // Nasazení se kvůli překladům nezastavuje — tak to bylo rozhodnuto.
  // Návratový kód jen říká, jestli je co dopřekládat, aby se na to dal
  // pověsit automatický překlad.
  // Chybějící klíč je horší než chybějící překlad: hráč uvidí holý klíč.
  // Proto vlastní kód, ať jde odlišit od „je co dopřekládat".
  // Rozbité HTML je stejně zlé jako chybějící klíč — hráč uvidí slité okno.
  if (chybejiciKlice.size || escHtml.length) process.exit(2);
  process.exit(chybi.length || zastarale.length || linkaChybi ? 1 : 0);
}
main();
