#!/usr/bin/env node
// =============================================================================
// Dopřeložení chybějících a zastaralých textů
// =============================================================================
// Projde katalog, najde klíče bez protějšku v cílovém jazyce nebo s otiskem,
// který nesedí s českou předlohou, a nechá je přeložit. Slovník pojmů jde do
// zadání s sebou — bez něj by z prádlomatu byl jednou laundromat a podruhé
// laundrette a hráč by si myslel, že jsou to dvě věci.
//
// Klíč k API se bere z prostředí (ANTHROPIC_API_KEY). Do repozitáře nepatří
// a tenhle nástroj si ho nikam neukládá.
//
// POUŽITÍ:  node nastroje/texty-prelozit.js [--jazyk=pl] [--davka=40] [--nanecisto]
//           bez --jazyk se překládá do angličtiny
'use strict';

// Klíč bereme z .env, když tam je — je gitignorovaný a stejně ho tam projekt
// má. Lepit ho do příkazové řádky je zbytečná příležitost, jak ho vypsat do
// chybové hlášky. Proměnná v prostředí má přednost, ať jde přebít jedním
// spuštěním.
try { require('dotenv').config(); } catch (e) { /* bez dotenv to jede z prostředí */ }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEXTY = path.join(__dirname, '..', 'services', 'game', 'texty');
const MODEL = process.env.TEXTY_MODEL || 'claude-sonnet-4-5';
const otisk = (x) => crypto.createHash('sha1')
  .update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);

const cesta = (f) => path.join(TEXTY, f);
const nacti = (f, v) => { try { return JSON.parse(fs.readFileSync(cesta(f), 'utf8')); } catch (e) { return v; } };
const zapis = (f, o) => fs.writeFileSync(cesta(f), JSON.stringify(o, null, 2) + '\n', 'utf8');

// Co o jazyce potřebuje vědět zadání. Tvary množného čísla musí sedět s tím,
// co umí jadro.js — kdyby se rozešly, hra by pro část čísel sáhla po tvaru,
// který v katalogu není.
const JAZYKY = {
  en: { nazev: 'angličtiny', tvary: 'one a other (angličtina nemá few ani many)' },
  pl: { nazev: 'polštiny',
    tvary: 'one, few a many. Polština: 1 = one; 2–4 na konci kromě 12–14 = few'
      + ' (22 few, ale 12 many); zbytek = many. Tvar "other" polština nepotřebuje' },
};

const ZADANI = `Překládáš texty počítačové hry Laundromat Tycoon z češtiny do {JAZYK}.
Hra je o budování sítě samoobslužných prádelen. Mluví na hráče přímo a věcně,
krátkými větami, občas suše. Stejně má znít i překlad — ne marketingově.

PRAVIDLA
- Zachovej značky {takhle} přesně, včetně tvarů {penize:cena} a {cislo:n}.
- Zachovej HTML, pokud v textu je — včetně id a class, hra se podle nich řídí.
- Uvozovky uvnitř textu piš typograficky („takhle"), nikdy jako rovnou ".
  Rovná uvozovka rozbije JSON, ve kterém odpovídáš.
- Nepřekládej L$ — je to herní měna.
- Kč je skutečná měna, ne herní. Nepřepisuj ji na L$.
- U textů s tvary množného čísla vrať objekt s klíči {TVARY}.
  Čeština má one/few/other.
- Drž se slovníku pojmů níž. Je závazný.

SLOVNÍK POJMŮ
{SLOVNIK}

Vrať POUZE JSON objekt {klíč: překlad}, nic jiného.`;

// Node si proxy z prostředí sám nevezme — curl ano, node ne. Za firemní
// proxy nebo v kontejneru se tedy překlad neodehraje vůbec a jediné, co
// z toho vypadne, je „fetch failed", což nikomu nic neřekne. Když proxy
// v prostředí je, jedeme přes ni; když není, nic se nemění.
// Síť přes proxy. Doma to nikdo nepotřebuje, ve firemní síti a v kontejneru
// bez ní API nevidíš vůbec — a jediné, co z toho vypadne, je „fetch failed".
// Dvě věci, na kterých to stojí a na kterých jsem se zdržel:
//  • Vestavěný fetch v Node se s dispatcherem z projektového undici nesnese
//    („invalid onRequestStart method"), takže bereme i fetch z undici.
//  • ProxyAgent si přihlašovací údaje z adresy sám nevezme. Když se
//    nepředají zvlášť, proxy vrátí holé „Unauthorized" a vypadá to jako
//    zamítnutý klíč k API, i když klíč vůbec neodešel.
let POSLI = fetch;
(function proxyZProstredi() {
  const adresa = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!adresa) return;
  try {
    const u = require('undici');
    const url = new URL(adresa);
    const udaje = (url.username || url.password)
      ? 'Basic ' + Buffer.from(decodeURIComponent(url.username) + ':'
          + decodeURIComponent(url.password)).toString('base64')
      : null;
    const agent = new u.ProxyAgent(udaje
      ? { uri: url.protocol + '//' + url.host, token: udaje }
      : adresa);
    POSLI = (odkud, opt) => u.fetch(odkud, Object.assign({}, opt, { dispatcher: agent }));
    console.log('síť: přes proxy z prostředí' + (udaje ? ' (s přihlášením)' : ''));
  } catch (e) {
    console.warn('síť: proxy v prostředí je, ale nejde použít (' + e.message + ')');
  }
}());

// Jedna pokažená odpověď nesmí stát čtyřicet textů. Stane se, že se model
// netrefí do JSONu — delší odpověď má víc příležitostí. Dávku proto při
// nezdaru půlíme a zkoušíme znovu; co nakonec selže, je jeden text, ne celá
// dávka, a ten se doplní při dalším spuštění. Bez tohohle se čtyřicet textů
// ztratilo na jednom řádku v logu, kterého si nikdo nevšiml.
async function poDavkach(davka, slovnik, jazyk) {
  const klice = Object.keys(davka);
  try {
    return await prelozDavku(davka, slovnik, jazyk);
  } catch (e) {
    if (klice.length === 1) {
      console.error('    text ' + klice[0] + ' se nepovedl: ' + e.message);
      return {};
    }
    console.error('    dávka ' + klice.length + ' textů selhala (' + e.message.slice(0, 80)
      + '), zkouším po polovinách');
    const pul = Math.ceil(klice.length / 2);
    const vyber = (ks) => { const o = {}; ks.forEach((k) => { o[k] = davka[k]; }); return o; };
    const a = await poDavkach(vyber(klice.slice(0, pul)), slovnik, jazyk);
    const b = await poDavkach(vyber(klice.slice(pul)), slovnik, jazyk);
    return Object.assign({}, a, b);
  }
}

async function prelozDavku(davka, slovnik, jazyk) {
  const klic = process.env.ANTHROPIC_API_KEY;
  if (!klic) throw new Error('chybí ANTHROPIC_API_KEY v prostředí');
  const r = await POSLI('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': klic,
      'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000,
      system: ZADANI.replace('{JAZYK}', (JAZYKY[jazyk] || JAZYKY.en).nazev)
        .replace('{TVARY}', (JAZYKY[jazyk] || JAZYKY.en).tvary)
        .replace('{SLOVNIK}', slovnik),
      messages: [{ role: 'user', content: JSON.stringify(davka, null, 1) }] }),
  });
  if (!r.ok) throw new Error('API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const text = (j.content || []).map((c) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('odpověď bez JSON');
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    // Nejčastější důvod, proč se odpověď nedá přečíst: v překladu zůstala
    // rovná uvozovka a neutekla se. Celá dávka pak padne kvůli jednomu
    // znaku. Zkusíme ji opravit a přečíst znovu — a když ani to nepomůže,
    // ukážeme kus okolo chyby, ať je vidět, co se vlastně vrátilo.
    try { return JSON.parse(spravUvozovky(m[0])); } catch (e2) { /* vypíšeme níž */ }
    const kde = Number((e.message.match(/position (\d+)/) || [])[1]);
    const okolo = Number.isFinite(kde)
      ? ' · kolem chyby: …' + m[0].slice(Math.max(0, kde - 60), kde + 40).replace(/\s+/g, ' ') + '…'
      : '';
    throw new Error(e.message + okolo);
  }
}

// Uvnitř hodnoty je rovná uvozovka koncem řetězce jen tehdy, když po ní
// (přes mezery) přijde čárka nebo složená závorka. Jinak patří do textu
// a musí se escapovat. Na tvar {"klíč": "text"} to stačí a nic jiného
// z API nechodí.
function spravUvozovky(txt) {
  let ven = '', vRetezci = false, jeKlic = false;
  for (let i = 0; i < txt.length; i++) {
    const z = txt[i];
    if (z === '\\') { ven += z + (txt[i + 1] || ''); i++; continue; }
    if (z !== '"') { ven += z; continue; }
    if (!vRetezci) {
      // Začátek řetězce. Klíč poznáme podle toho, že za ním přijde dvojtečka.
      const konec = txt.indexOf('":', i);
      const radek = txt.slice(i, konec + 2);
      jeKlic = konec > i && !/[^\\]"/.test(radek.slice(1, -2));
      vRetezci = true; ven += z; continue;
    }
    // Uvnitř řetězce: konec jen před čárkou nebo závorkou.
    const dal = txt.slice(i + 1).match(/^\s*([,}:])/);
    if (dal) { vRetezci = false; ven += z; continue; }
    ven += jeKlic ? z : '\\"';
  }
  return ven;
}

async function main() {
  // Bez klíče nemá smysl zkoušet ani první dávku. Dřív to selhalo u každé
  // zvlášť a vypsalo sto stejných řádků, ve kterých ta podstatná věta zapadla.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Chybí ANTHROPIC_API_KEY v prostředí — nemám se čím přihlásit k API.');
    console.error('');
    console.error('Nejjednodušší: dej ho do .env v kořeni projektu jako řádek');
    console.error('  ANTHROPIC_API_KEY=sk-ant-...');
    console.error('Soubor je v .gitignore, takže nikam neodejde, a nemusíš klíč');
    console.error('psát do příkazové řádky, kde ho umí vyplivnout chybová hláška.');
    console.error('');
    console.error('Jen pro tohle okno:  $env:ANTHROPIC_API_KEY = "sk-ant-..."  (s uvozovkami)');
    process.exit(1);
  }
  const velikost = Number((process.argv.find((a) => a.startsWith('--davka=')) || '').split('=')[1]) || 40;
  const nanecisto = process.argv.includes('--nanecisto');
  const jazyk = (process.argv.find((a) => a.startsWith('--jazyk=')) || '--jazyk=en').split('=')[1];
  if (!JAZYKY[jazyk]) {
    console.error('Jazyk ' + jazyk + ' neumím. Znám: ' + Object.keys(JAZYKY).join(', '));
    console.error('Nový jazyk se přidává v JAZYKY tady a v services/game/texty/jadro.js.');
    process.exit(1);
  }
  const souborJ = jazyk + '.json', souborM = jazyk + '.meta.json';
  const cs = nacti('cs.json', {});
  const en = nacti(souborJ, {});
  const meta = nacti(souborM, {});
  // Slovník pojmů pro cílový jazyk, jinak ten obecný. Bez něj to jede taky,
  // jen se pojmy rozejdou.
  let slovnik = '';
  for (const f of ['slovnik.' + jazyk + '.md', 'slovnik.md']) {
    try { slovnik = fs.readFileSync(cesta(f), 'utf8'); console.log('slovník: ' + f); break; }
    catch (e) { /* zkusíme další */ }
  }
  console.log('překládám do: ' + jazyk);

  // Slovník pojmů je závazný a překlad se podle něj řídí. Když se změní,
  // hotové texty se samy nepřeloží znovu — otisk je u české předlohy, ne
  // u slovníku. Tiše by pak vedle sebe stály překlady podle dvou různých
  // slovníků. Otisk slovníku proto držíme v metadatech a při neshodě se
  // ozveme; přepsat všechno se dá přepínačem, ať se to nestane omylem.
  const SLOVNIK_KLIC = '__slovnik';
  const slovnikOtisk = otisk(slovnik);
  const znovu = process.argv.includes('--znovu');
  const hotovych = Object.keys(cs).filter((k) => en[k] != null).length;
  if (meta[SLOVNIK_KLIC] && meta[SLOVNIK_KLIC] !== slovnikOtisk && hotovych) {
    console.log('');
    console.log('POZOR: slovník pojmů se od minulého překladu změnil.');
    console.log(hotovych + ' textů je přeložených podle toho starého a samy se nepřeloží znovu.');
    console.log('Když chceš, aby se podle nového slovníku přeložilo všechno:');
    console.log('  node nastroje/texty-prelozit.js --jazyk=' + jazyk + ' --znovu');
    console.log('Teď se doplní jen to, co chybí.');
    console.log('');
  }

  const kdopotrebuje = Object.keys(cs).filter((k) =>
    znovu || en[k] == null || (meta[k] && meta[k] !== otisk(cs[k])));
  console.log('k překladu: ' + kdopotrebuje.length + ' z ' + Object.keys(cs).length);
  if (nanecisto) {
    console.log(kdopotrebuje.slice(0, 20).join('\n'));
    await linka(slovnik, jazyk);
    return;
  }
  if (!kdopotrebuje.length) { await linka(slovnik, jazyk); return; }

  let hotovo = 0;
  for (let i = 0; i < kdopotrebuje.length; i += velikost) {
    const klice = kdopotrebuje.slice(i, i + velikost);
    const davka = {};
    klice.forEach((k) => { davka[k] = cs[k]; });
    try {
      const vysledek = await poDavkach(davka, slovnik, jazyk);
      klice.forEach((k) => {
        if (vysledek[k] == null) return;
        en[k] = vysledek[k];
        meta[k] = otisk(cs[k]);
        hotovo++;
      });
      meta[SLOVNIK_KLIC] = slovnikOtisk;
      zapis(souborJ, en);
      zapis(souborM, meta);
      console.log('  ' + Math.min(i + velikost, kdopotrebuje.length) + '/' + kdopotrebuje.length);
    } catch (e) {
      console.error('  dávka od ' + i + ' selhala: ' + e.message);
    }
  }
  // Stejně u textů: kolik se jich nepovedlo, musí být vidět na konci,
  // ne jen v řádku uprostřed výpisu.
  const zbyva = kdopotrebuje.length - hotovo;
  console.log('přeloženo: ' + hotovo + (zbyva > 0
    ? ' · nepovedlo se: ' + zbyva + ' (zůstávají česky, spusť příkaz znovu)' : ''));
  if (hotovo) { meta[SLOVNIK_KLIC] = slovnikOtisk; zapis(souborM, meta); }
  await linka(slovnik, jazyk);
}

// -----------------------------------------------------------------------------
// Scénáře infolinky
// -----------------------------------------------------------------------------
// Souvislá próza, ne klíče — překládá se po celých scénářích, aby odpovědi
// seděly na otázky. Otisk je u celého scénáře; když se jeden upraví, přeloží
// se znovu jen on.
async function linka(slovnik, jazyk) {
  const cs = nacti('linka.cs.json', null);
  if (!cs) return;
  const souborJ = 'linka.' + jazyk + '.json', souborM = 'linka.' + jazyk + '.meta.json';
  const en = nacti(souborJ, []);
  const meta = nacti(souborM, {});
  // Páruje se podle id. Pořadí nestačí: když se jeden scénář nepřeloží,
  // zápis se o něj zkrátí a všechny další se posunou na cizí pozici —
  // u polštiny se takhle ztratily dva scénáře a zbytek se rozjel. Id jsou
  // jedinečná (hlídá to prohlídka), takže párování podle nich drží.
  const podleId = new Map();
  en.forEach((x) => { if (x && x.id != null) podleId.set(x.id, x); });
  const hotove = cs.map((x) => podleId.get(x.id) || null);

  const chybi = cs.map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !hotove[i] || meta[s.id] !== otisk(s));
  console.log('scénářů linky k překladu: ' + chybi.length + ' z ' + cs.length);
  if (!chybi.length) return;
  if (process.argv.includes('--nanecisto')) { console.log(chybi.map(({ s }) => s.id).join(', ')); return; }

  const nepovedlo = [];
  for (const { s: scenar, i: poradi } of chybi) {
    try {
      // Překládají se jen věty. id, bod a rod musí zůstat, jak jsou —
      // podle nich hra scénář řídí.
      const vysledek = await prelozDavku({ scenar: JSON.stringify(scenar) }, slovnik
        + '\n\nTohle je scénář hovoru na infolince. Vrať ho jako JSON se stejnou'
        + ' stavbou a stejnými klíči. Přelož jen hodnoty t a r. Klíče id, b a rod'
        + ' nech beze změny — podle nich hra hovor řídí. Vrať {"scenar": "<JSON jako text>"}.', jazyk);
      const prelozeny = JSON.parse(vysledek.scenar);
      if (prelozeny.id !== scenar.id) throw new Error('scénář se vrátil s jiným id');
      hotove[poradi] = prelozeny;
      meta[scenar.id] = otisk(scenar);
      // Zapisuje se v pořadí předlohy. Nepřeložené se vynechají — hra si
      // scénář hledá podle id, takže mezera nevadí; co vadí, je přiřadit
      // překlad k cizímu scénáři, a to párování podle id vylučuje.
      zapis(souborJ, hotove.filter(Boolean));
      zapis(souborM, meta);
      console.log('  ' + scenar.id);
    } catch (e) {
      console.error('  scénář ' + scenar.id + ' selhal: ' + e.message);
      nepovedlo.push(scenar.id);
    }
  }
  // Ať se nestane, že se to ztratí v záplavě řádků. Nepřeložený scénář
  // zůstane česky a hra jede dál, ale má se o tom vědět.
  if (nepovedlo.length) {
    console.log('');
    console.log('scénáře, které se nepovedly: ' + nepovedlo.join(', '));
    console.log('Zůstávají česky. Spusť příkaz znovu, zkusí se jen ony.');
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
