// =============================================================================
// Laundromats — překlad stránek do EN a PL
// =============================================================================
// Zdrojem pravdy zůstává ČEŠTINA přímo ve stránkách. Klíčem překladu je sama česká
// věta, takže když kdekoli napíšeš nový český text, objeví se jako nový klíč a
// scripts/laundromats-i18n.js ho doplní do i18n/en.json a i18n/pl.json. Dokud
// překlad chybí, zobrazí se česky — stránka se nikdy nerozbije.
//
// Překládají se TEXTOVÉ UZLY a vybrané atributy, ne celé HTML najednou. Změna
// obalujících značek proto překlad nerozbije (to byl problém starého slovníku
// přesných řetězců v cesta-i18n.js).

'use strict';
const fs = require('fs');
const path = require('path');

const LANGS = ['cs', 'en', 'pl'];
const LANG_LABEL = { cs: 'CZ', en: 'EN', pl: 'PL' };
const DICT_DIR = path.join(__dirname, 'i18n');

// Atributy, jejichž obsah uživatel vidí.
const ATTRS = ['title', 'alt', 'placeholder', 'aria-label', 'data-lock', 'data-slabel'];
// <meta name="description">, og:title, og:description — obsah v atributu content.
const META_RE = /<meta\s+[^>]*?(?:name|property)\s*=\s*"(description|og:title|og:description|twitter:title|twitter:description)"[^>]*>/gi;

const cache = new Map();
function dict(lang) {
  if (lang === 'cs' || !LANGS.includes(lang)) return null;
  if (cache.has(lang)) return cache.get(lang);
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(DICT_DIR, lang + '.json'), 'utf8')) || {}; }
  catch (e) { if (e.code !== 'ENOENT') console.warn('[i18n] ' + lang + '.json:', e.message); }
  cache.set(lang, d);
  return d;
}
function reload() { cache.clear(); }

// Jazyky, které se nabídnou v přepínači. Jazyk s prázdným (nebo skoro prázdným)
// slovníkem se nenabízí — návštěvník by klikl na EN a dostal českou stránku.
// Prahem lze pohnout přes LM_I18N_MIN, seznam natvrdo určit přes LM_LANGS=cs,en.
const MIN_KLICU = parseInt(process.env.LM_I18N_MIN || '150', 10);
function available() {
  const rucne = String(process.env.LM_LANGS || '').trim();
  if (rucne) return rucne.split(',').map((x) => x.trim()).filter((x) => LANGS.includes(x));
  return LANGS.filter((l) => l === 'cs' || Object.keys(dict(l) || {}).length >= MIN_KLICU);
}

// Klíč = česká věta bez okolních mezer, vnitřní bílé znaky sražené na jednu mezeru.
const key = (t) => String(t).replace(/\s+/g, ' ').trim();
// Co nemá smysl překládat: prázdné, bez písmen, samá čísla / značky / entity.
const PREKLADATELNE = /\p{L}{2,}/u;
function translatable(t) {
  const k = key(t);
  if (!k || k.length > 2000) return false;
  if (!PREKLADATELNE.test(k.replace(/&[a-z]+;|&#\d+;/gi, ' '))) return false;
  return true;
}

// Rozdělí HTML na úseky: značky, komentáře, obsah <script>/<style>/<svg> a text mezi nimi.
// `onText(text)` / `onTag(tag)` vrací náhradu (nebo původní hodnotu).
function walk(html, onText, onTag, onScript) {
  onScript = onScript || ((x) => x);
  const s = String(html);
  let out = '', i = 0;
  const re = /<!--[\s\S]*?-->|<(script)\b[^>]*>([\s\S]*?)<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > i) out += onText(s.slice(i, m.index));
    if (m[1]) {
      // Vnořený <script>: texty jsou v řetězcových literálech, ne v textových uzlech.
      const telo = m[2] || '';
      out += m[0].slice(0, m[0].length - telo.length - ('</script>'.length)) + onScript(telo) + m[0].slice(m[0].length - '</script>'.length);
    } else {
      out += (m[0][0] === '<' && m[0][1] !== '!') ? onTag(m[0]) : m[0];
    }
    i = m.index + m[0].length;
  }
  if (i < s.length) out += onText(s.slice(i));
  return out;
}

// Text uzlu: přeložíme jen vnitřek, okolní mezery necháme být (kvůli mezerám mezi slovy).
function mapText(raw, fn) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const jadro = m[2];
  if (!translatable(jadro)) return raw;
  const prel = fn(key(jadro));
  return m[1] + (prel == null ? jadro : prel) + m[3];
}

// Atributy ve značce.
function mapTag(tag, fn) {
  return tag.replace(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g, (cela, jmeno, hodnota) => {
    if (ATTRS.indexOf(jmeno.toLowerCase()) === -1) return cela;
    if (!translatable(hodnota)) return cela;
    const prel = fn(key(hodnota));
    return prel == null ? cela : jmeno + '="' + String(prel).replace(/"/g, '&quot;') + '"';
  });
}

// <meta name="description" content="…"> — content překládáme jen u vyjmenovaných meta.
function mapMeta(html, fn) {
  return String(html).replace(META_RE, (tag) => tag.replace(/content\s*=\s*"([^"]*)"/i, (cela, hodnota) => {
    if (!translatable(hodnota)) return cela;
    const prel = fn(key(hodnota));
    return prel == null ? cela : 'content="' + String(prel).replace(/"/g, '&quot;') + '"';
  }));
}

// ── Texty uvnitř JavaScriptu ────────────────────────────────────────────────
// V inline skriptech i v samostatných souborech (booking, kalkulačka…) se část
// textů skládá až v prohlížeči. Bereme jen řetězcové literály s ČESKOU DIAKRITIKOU —
// ty nemůžou být selektor, klíč ani název třídy, takže nehrozí, že přeložíme kód.
const DIAKRITIKA = /[ěščřžýáíéúůóďťňĚŠČŘŽÝÁÍÉÚŮÓĎŤŇ]/;
const JS_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\r\n])*?)\1/g;

function mapJs(js, fn) {
  return String(js).replace(JS_LITERAL, (cely, uvozovka, obsah) => {
    if (!DIAKRITIKA.test(obsah)) return cely;
    // Literál s HTML uvnitř (časté: '<span class="htag">Jak to u nás probíhá</span>')
    // projdeme jako kus stránky — klíčem pak je samotná věta, ne věta i se značkami.
    let novy;
    if (/<[a-zA-Z/!]/.test(obsah) && /</.test(obsah) && />/.test(obsah)) {
      novy = walk(obsah, (t) => mapText(t, fn), (tag) => mapTag(tag, fn));
      if (novy === obsah) return cely;
    } else {
      if (!translatable(obsah)) return cely;
      const prel = fn(key(obsah));
      if (prel == null) return cely;
      novy = String(prel);
    }
    const prel = novy;
    // Uvozovku i zpětná lomítka v překladu ošetříme, ať literál zůstane platný.
    const bezpecne = String(prel).replace(/\\/g, '\\\\').replace(new RegExp(uvozovka, 'g'), '\\' + uvozovka);
    return uvozovka + bezpecne + uvozovka;
  });
}

/** Všechny české texty ze stránky — podklad pro překladový soubor. */
function extract(html) {
  const found = new Set();
  const sber = (k) => { found.add(k); return null; };
  walk(html, (t) => mapText(t, sber), (tag) => mapTag(tag, sber), (js) => mapJs(js, sber));
  mapMeta(html, sber);
  return [...found];
}

/** Totéž pro samostatný .js soubor (booking.js, ekonomika.js…). */
function extractJs(js) {
  const found = new Set();
  mapJs(js, (k) => { found.add(k); return null; });
  return [...found];
}

/** Přeloží samostatný .js soubor. */
function applyJs(js, lang, missing) {
  const d = dict(lang);
  if (!d) return String(js);
  return mapJs(js, (k) => { const v = d[k]; if (v == null || v === '') { if (missing) missing.add(k); return null; } return v; });
}

/**
 * Přeloží stránku do daného jazyka. Chybějící překlad = zůstane česky.
 * `missing` (volitelně) posbírá nepřeložené klíče pro hlášení.
 */
function apply(html, lang, missing) {
  const d = dict(lang);
  if (!d) return String(html);
  const prel = (k) => {
    const v = d[k];
    if (v == null || v === '') { if (missing) missing.add(k); return null; }
    return v;
  };
  let out = walk(html, (t) => mapText(t, prel), (tag) => mapTag(tag, prel), (js) => mapJs(js, prel));
  out = mapMeta(out, prel);
  return out.replace(/<html lang="cs"/i, '<html lang="' + lang + '"');
}

module.exports = { LANGS, LANG_LABEL, available, extract, extractJs, apply, applyJs, dict, reload, key, translatable, walk };
