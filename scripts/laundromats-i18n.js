// =============================================================================
// Laundromats — doplnění překladů (EN, PL)
// =============================================================================
// Projde veřejné stránky webu, vytáhne z nich všechny české texty a chybějící
// nechá přeložit Claudem do apps/laundromats/i18n/en.json a pl.json.
// Čeština ve stránkách zůstává zdrojem pravdy — klíčem překladu je sama česká
// věta, takže nový text se objeví jako nový klíč a tenhle skript ho doplní.
//
//   node scripts/laundromats-i18n.js --report     co chybí (nic nepřekládá)
//   node scripts/laundromats-i18n.js              doplní chybějící překlady
//   node scripts/laundromats-i18n.js --lang en    jen jeden jazyk
//   node scripts/laundromats-i18n.js --prune      navíc vyhodí klíče, které už na webu nejsou
//   node scripts/laundromats-i18n.js --force      přeloží znovu i to, co už přeložené je

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'apps', 'laundromats');
const I = require(path.join(DIR, 'i18n'));
const MODEL = process.env.LM_I18N_MODEL || 'claude-sonnet-4-6';
const DAVKA = 25; // vět na jedno volání — menší dávka = přesnější překlad

const args = process.argv.slice(2);
const has = (f) => args.indexOf('--' + f) > -1;
const val = (f, d) => { const i = args.indexOf('--' + f); return i > -1 ? args[i + 1] : d; };
const JAZYKY = val('lang') ? [val('lang')] : ['en', 'pl'];

// ── Odkud se texty berou ────────────────────────────────────────────────────
function vsechnyTexty() {
  const HP = require(path.join(DIR, 'home-page')), CP = require(path.join(DIR, 'cesta-pages'));
  const EP = require(path.join(DIR, 'ekonomika-page')), COMP = require(path.join(DIR, 'compounder-page'));
  const PRAD = require(path.join(DIR, 'pradlomaty-page'));
  const stranky = {
    'úvodní stránka': () => HP.homePage('cs'),
    '/cesta': () => fs.readFileSync(path.join(DIR, 'cesta.html'), 'utf8'),
    '/cesta/info': () => CP.infoPage(),
    '/cesta/vlastni-kapital': () => CP.vlastniPage(),
    '/cesta/financovani': () => CP.financovaniPage(),
    '/cesta/schuzka': () => CP.schuzkaPage(),
    '/cesta/ekonomika': () => EP.economyPage('cs'),
    '/cesta/ekonomika/podrobne': () => EP.economyDetailPage('cs'),
    '/cesta/compounder': () => COMP.compounderPage(),
    '/cesta/pradlomaty': () => PRAD.pradlomatyPage([], { items: {} }),
  };
  const soubory = ['cesta-booking.js', 'ekonomika.js', 'pradlomat-economy.js', 'lm-header.js'];
  const texty = new Map(); // text → kde se vyskytuje (kvůli kontextu pro překlad)
  const pridej = (t, kde) => { if (!texty.has(t)) texty.set(t, kde); };
  for (const [jm, f] of Object.entries(stranky)) {
    try { I.extract(f()).forEach((t) => pridej(t, jm)); }
    catch (e) { console.warn('! ' + jm + ': ' + e.message); }
  }
  for (const f of soubory) {
    try { I.extractJs(fs.readFileSync(path.join(DIR, f), 'utf8')).forEach((t) => pridej(t, f)); }
    catch (e) { console.warn('! ' + f + ': ' + e.message); }
  }
  return texty;
}

const cestaSlovniku = (lang) => path.join(DIR, 'i18n', lang + '.json');
function nactiSlovnik(lang) {
  try { return JSON.parse(fs.readFileSync(cestaSlovniku(lang), 'utf8')) || {}; } catch (e) { return {}; }
}
function ulozSlovnik(lang, d) {
  const serazene = {};
  Object.keys(d).sort((a, b) => a.localeCompare(b, 'cs')).forEach((k) => { serazene[k] = d[k]; });
  fs.mkdirSync(path.join(DIR, 'i18n'), { recursive: true });
  fs.writeFileSync(cestaSlovniku(lang), JSON.stringify(serazene, null, 2) + '\n', 'utf8');
}

// ── Překlad ────────────────────────────────────────────────────────────────
const NAZEV_JAZYKA = { en: 'angličtiny', pl: 'polštiny' };
const POKYN = (lang) => [
  'Překládáš texty z webu laundromats.eu — prodejní web české firmy, která vyrábí a provozuje',
  'samoobslužné prádelny („prádlomaty") a nabízí je jako podnikatelskou příležitost.',
  'Přelož z češtiny do ' + (NAZEV_JAZYKA[lang] || lang) + '.',
  '',
  'PRAVIDLA:',
  '1. Zachovej tón originálu: věcný, přímý, bez marketingových frází navíc. Vykání → odpovídající zdvořilá forma.',
  '2. „Prádlomat" je název produktu — v angličtině použij „laundromat", v polštině „pralnia samoobsługowa"',
  '   (nebo „automat pralniczy", pokud jde o samotný stroj). „Laundromats" jako název firmy nepřekládej.',
  '3. HTML značky, entity (&nbsp;, &amp;), zástupné znaky ({x}, %s, @@…@@) a emoji nech PŘESNĚ tak, jak jsou.',
  '4. Čísla, jednotky a měny nepřepočítávej ani neměň (Kč zůstává Kč).',
  '5. Zachovej velikost písmen u nadpisů psaných verzálkami a koncovou interpunkci.',
  '6. Nepřidávej nic, co v originálu není, a nic nevynechávej.',
  '',
  'Vrátíš POUZE JSON pole překladů ve stejném pořadí a stejné délce jako vstup. Nic dalšího.',
].join('\n');

async function prelozDavku(client, lang, vety) {
  const { messagesCreate } = require(path.join(__dirname, '..', 'services', 'anthropic-retry'));
  const r = await messagesCreate(client, {
    model: MODEL,
    max_tokens: 8000,
    system: POKYN(lang),
    messages: [{ role: 'user', content: JSON.stringify(vety, null, 1) }],
  });
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  const zacatek = text.indexOf('['), konec = text.lastIndexOf(']');
  if (zacatek < 0 || konec < 0) throw new Error('Model nevrátil JSON pole: ' + text.slice(0, 200));
  const out = JSON.parse(text.slice(zacatek, konec + 1));
  if (!Array.isArray(out) || out.length !== vety.length) throw new Error('Model vrátil ' + (Array.isArray(out) ? out.length : '?') + ' překladů místo ' + vety.length);
  return out;
}

(async () => {
  const texty = vsechnyTexty();
  const klice = [...texty.keys()];
  console.log('Textů na webu: ' + klice.length);

  for (const lang of JAZYKY) {
    const d = nactiSlovnik(lang);
    const chybi = klice.filter((k) => has('force') || d[k] == null || d[k] === '');
    const navic = Object.keys(d).filter((k) => klice.indexOf(k) === -1);

    console.log('\n── ' + lang.toUpperCase() + ' ── přeloženo ' + (klice.length - chybi.length) + '/' + klice.length
      + (chybi.length ? ' · chybí ' + chybi.length : '') + (navic.length ? ' · nepoužívaných ' + navic.length : ''));

    if (has('report')) {
      chybi.slice(0, 40).forEach((k) => console.log('   chybí: [' + texty.get(k) + '] ' + k.slice(0, 90)));
      if (chybi.length > 40) console.log('   … a dalších ' + (chybi.length - 40));
      continue;
    }
    if (has('prune') && navic.length) {
      navic.forEach((k) => { delete d[k]; });
      console.log('   vyhozeno ' + navic.length + ' klíčů, které už na webu nejsou');
    }
    if (!chybi.length) { if (has('prune') && navic.length) ulozSlovnik(lang, d); continue; }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Chybí ANTHROPIC_API_KEY (.env nebo proměnná prostředí). Překlad nelze spustit.');
      process.exit(2);
    }
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    for (let i = 0; i < chybi.length; i += DAVKA) {
      const davka = chybi.slice(i, i + DAVKA);
      process.stdout.write('   ' + (i + davka.length) + '/' + chybi.length + ' … ');
      try {
        const prel = await prelozDavku(client, lang, davka);
        davka.forEach((k, j) => { if (prel[j] && String(prel[j]).trim()) d[k] = String(prel[j]); });
        ulozSlovnik(lang, d); // průběžně, ať se při chybě neztratí hotová práce
        console.log('hotovo');
      } catch (e) {
        console.log('CHYBA: ' + e.message);
        // Špatný klíč nebo došlý kredit se opakováním nespraví — nemá smysl mlátit do API.
        if (/invalid x-api-key|authentication_error|401/.test(e.message)) {
          console.error('\nKlíč ANTHROPIC_API_KEY není platný. Překlad zastaven, nic se nepoškodilo.');
          console.error('Buď ho oprav v .env, nebo ho pro jedno spuštění předej takto (PowerShell):');
          console.error('  $env:ANTHROPIC_API_KEY="sk-ant-..."; node scripts/laundromats-i18n.js');
          process.exit(2);
        }
        if (/credit balance|insufficient/i.test(e.message)) {
          console.error('\nDošel kredit na Anthropic API. Dobij ho v Console → Plans & Billing a spusť znovu.');
          process.exit(3);
        }
      }
    }
    ulozSlovnik(lang, d);
    const zbyva = klice.filter((k) => d[k] == null || d[k] === '').length;
    console.log('   ' + lang + '.json uloženo' + (zbyva ? ' · stále chybí ' + zbyva + ' (spusť znovu)' : ' · kompletní'));
  }
})().catch((e) => { console.error('Chyba:', e.message); process.exit(1); });
