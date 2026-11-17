#!/usr/bin/env node
// =============================================================================
// Dopřeložení chybějících a zastaralých textů
// =============================================================================
// Projde katalog, najde klíče bez anglického protějšku nebo s otiskem, který
// nesedí s českou předlohou, a nechá je přeložit. Slovník pojmů jde do zadání
// s sebou — bez něj by z prádlomatu byl jednou laundromat a podruhé
// laundrette a hráč by si myslel, že jsou to dvě věci.
//
// Klíč k API se bere z prostředí (ANTHROPIC_API_KEY). Do repozitáře nepatří
// a tenhle nástroj si ho nikam neukládá.
//
// POUŽITÍ:  node nastroje/texty-prelozit.js [--davka 40] [--nanecisto]
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

const ZADANI = `Překládáš texty počítačové hry Laundromat Tycoon z češtiny do angličtiny.
Hra je o budování sítě samoobslužných prádelen. Mluví na hráče přímo a věcně,
krátkými větami, občas suše. Stejně má znít i angličtina — ne marketingově.

PRAVIDLA
- Zachovej značky {takhle} přesně, včetně tvarů {penize:cena} a {cislo:n}.
- Zachovej HTML, pokud v textu je.
- Nepřekládej L$ — je to herní měna.
- U textů s tvary množného čísla vrať objekt s klíči one a other (angličtina
  nemá few). Čeština má one/few/other.
- Drž se slovníku pojmů níž. Je závazný.

SLOVNÍK POJMŮ
{SLOVNIK}

Vrať POUZE JSON objekt {klíč: překlad}, nic jiného.`;

async function prelozDavku(davka, slovnik) {
  const klic = process.env.ANTHROPIC_API_KEY;
  if (!klic) throw new Error('chybí ANTHROPIC_API_KEY v prostředí');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': klic,
      'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000,
      system: ZADANI.replace('{SLOVNIK}', slovnik),
      messages: [{ role: 'user', content: JSON.stringify(davka, null, 1) }] }),
  });
  if (!r.ok) throw new Error('API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const text = (j.content || []).map((c) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('odpověď bez JSON');
  return JSON.parse(m[0]);
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
  const cs = nacti('cs.json', {});
  const en = nacti('en.json', {});
  const meta = nacti('en.meta.json', {});
  let slovnik = '';
  try { slovnik = fs.readFileSync(cesta('slovnik.md'), 'utf8'); } catch (e) { /* bez něj to jde taky, jen hůř */ }

  const kdopotrebuje = Object.keys(cs).filter((k) =>
    en[k] == null || (meta[k] && meta[k] !== otisk(cs[k])));
  console.log('k překladu: ' + kdopotrebuje.length + ' z ' + Object.keys(cs).length);
  if (nanecisto) {
    console.log(kdopotrebuje.slice(0, 20).join('\n'));
    await linka(slovnik);
    return;
  }
  if (!kdopotrebuje.length) { await linka(slovnik); return; }

  let hotovo = 0;
  for (let i = 0; i < kdopotrebuje.length; i += velikost) {
    const klice = kdopotrebuje.slice(i, i + velikost);
    const davka = {};
    klice.forEach((k) => { davka[k] = cs[k]; });
    try {
      const vysledek = await prelozDavku(davka, slovnik);
      klice.forEach((k) => {
        if (vysledek[k] == null) return;
        en[k] = vysledek[k];
        meta[k] = otisk(cs[k]);
        hotovo++;
      });
      zapis('en.json', en);
      zapis('en.meta.json', meta);
      console.log('  ' + Math.min(i + velikost, kdopotrebuje.length) + '/' + kdopotrebuje.length);
    } catch (e) {
      console.error('  dávka od ' + i + ' selhala: ' + e.message);
    }
  }
  console.log('přeloženo: ' + hotovo);
  await linka(slovnik);
}

// -----------------------------------------------------------------------------
// Scénáře infolinky
// -----------------------------------------------------------------------------
// Souvislá próza, ne klíče — překládá se po celých scénářích, aby odpovědi
// seděly na otázky. Otisk je u celého scénáře; když se jeden upraví, přeloží
// se znovu jen on.
async function linka(slovnik) {
  const cs = nacti('linka.cs.json', null);
  if (!cs) return;
  const en = nacti('linka.en.json', []);
  const meta = nacti('linka.en.meta.json', {});
  // Podle pořadí, ne podle id. Dva scénáře se stejným id si jinak přepíšou
  // překlad navzájem a jeden z nich dostane text toho druhého — což se taky
  // stalo. Id jsou sice teď jedinečná, ale pořadí je jistota.
  const hotove = cs.map((_, i) => en[i] || null);

  const chybi = cs.map((s, i) => ({ s, i }))
    .filter(({ s, i }) => !hotove[i] || hotove[i].id !== s.id || meta[s.id] !== otisk(s));
  console.log('scénářů linky k překladu: ' + chybi.length + ' z ' + cs.length);
  if (!chybi.length) return;
  if (process.argv.includes('--nanecisto')) { console.log(chybi.map(({ s }) => s.id).join(', ')); return; }

  for (const { s: scenar, i: poradi } of chybi) {
    try {
      // Překládají se jen věty. id, bod a rod musí zůstat, jak jsou —
      // podle nich hra scénář řídí.
      const vysledek = await prelozDavku({ scenar: JSON.stringify(scenar) }, slovnik
        + '\n\nTohle je scénář hovoru na infolince. Vrať ho jako JSON se stejnou'
        + ' stavbou a stejnými klíči. Přelož jen hodnoty t a r. Klíče id, b a rod'
        + ' nech beze změny — podle nich hra hovor řídí. Vrať {"scenar": "<JSON jako text>"}.');
      const prelozeny = JSON.parse(vysledek.scenar);
      if (prelozeny.id !== scenar.id) throw new Error('scénář se vrátil s jiným id');
      hotove[poradi] = prelozeny;
      meta[scenar.id] = otisk(scenar);
      // Zapisuje se celé pole v pořadí předlohy. Zatím nepřeložené scénáře
      // drží svoje místo, ať se ostatní neposunou na cizí pozici.
      zapis('linka.en.json', hotove.map((x, i) => x || en[i] || null).filter(Boolean));
      zapis('linka.en.meta.json', meta);
      console.log('  ' + scenar.id);
    } catch (e) {
      console.error('  scénář ' + scenar.id + ' selhal: ' + e.message);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
