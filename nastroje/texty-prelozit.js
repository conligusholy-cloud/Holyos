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
  if (!kdopotrebuje.length) return;
  if (nanecisto) { console.log(kdopotrebuje.slice(0, 20).join('\n')); return; }

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
}
main().catch((e) => { console.error(e.message); process.exit(1); });
