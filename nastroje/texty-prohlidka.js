#!/usr/bin/env node
// =============================================================================
// Prohlídka překladů — co je špatně, ne co chybí
// =============================================================================
// Kontrola (texty-kontrola.js) hlídá, co ještě není přeložené. Tohle hlídá to
// horší: že přeložené JE, ale špatně, takže to projde a rozbije se až hráči.
//
// Každá kontrola tady vznikla z chyby, která se opravdu stala:
//
//  značky   Chybějící {p1} znamená, že ze věty zmizí číslo. Hráč si přečte
//           „Chybí ti ." a neví, kolik.
//  stavba   Ve sloučených šablonách je i kus HTML včetně id prvků. Když
//           překlad id ztratí, nezmizí text — rozsype se celé okno a hra si
//           sáhne na prvek, co není. Přesně tohle se stalo u dražby.
//  měna     Kč jsou skutečné peníze, L$ herní. Překladač z Kč udělal L$ na
//           sedmnácti místech a v obchodě svítilo „49 L$“ za něco za 49 Kč.
//  tvary    Angličtina má one/other, čeština one/few/other. Chybějící tvar
//           znamená, že se u nějakého počtu nevypíše nic.
//  zbytky   Text, co zůstal česky, nebo věta namíchaná z obou jazyků.
//
// Tvrdé nálezy vracejí kód 1 — ty hru rozbijí. Měkké jen upozorní.
//
// POUŽITÍ:  node nastroje/texty-prohlidka.js [jazyk]
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const otisk = (x) => crypto.createHash('sha1')
  .update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);

const TEXTY = path.join(__dirname, '..', 'services', 'game', 'texty');
const ZDROJ = 'cs';
const nacti = (f, v) => { try { return JSON.parse(fs.readFileSync(path.join(TEXTY, f), 'utf8')); } catch (e) { return v; } };

// Písmena, která jinde než v češtině (a slovenštině) nepotkáš.
const CESKE = /[ěščřžůňťďĚŠČŘŽŮŇŤĎ]/;
const ZNACKA = /\{(?:[a-z]+:)?[a-zA-Z0-9_]+\}/g;

// ─── Značky ──────────────────────────────────────────────────────────────────
function znacky(s) {
  return (String(s).match(ZNACKA) || []).sort();
}

// ─── Stavba ──────────────────────────────────────────────────────────────────
// Nezajímá nás text, ale kostra: jaké značky v jakém pořadí a s jakými id,
// třídami a data-atributy. Ty drží hru pohromadě, text je jen náplň.
function kostra(s) {
  const out = [];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g;
  let m;
  while ((m = re.exec(String(s))) !== null) {
    const atr = [];
    // aria-label, title ani alt tady nejsou: čte je odečítač obrazovky, je to
    // text pro hráče a překládat se má. Zbytek drží okno pohromadě.
    const ar = /\b(id|class|data-[\w-]+|href|src|type|name|for|value|role)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[2])) !== null) atr.push(a[1] + '="' + a[2] + '"');
    out.push('<' + (m[0][1] === '/' ? '/' : '') + m[1] + (atr.length ? ' ' + atr.sort().join(' ') : '') + '>');
  }
  return out;
}

// ─── Měna ────────────────────────────────────────────────────────────────────
// L$ je herní měna a zůstává všude stejná. Kč jsou skutečné peníze — ty se
// překládají na kód měny, ale nikdy na L$.
// Jediný klíč, jehož úkolem JE nést značku měny: než doběhne ceník ze
// serveru, musí klient něco ukázat. Server ho pak přebije.
const MENA_SMI = new Set(['obecne.mena_vychozi']);
function menaSedi(c, e, klic) {
  if (MENA_SMI.has(klic)) return null;
  if (/L\$/.test(c) && !/L\$/.test(e)) return 'herní měna L$ se z překladu ztratila';
  if (/Kč/.test(c) && /L\$/.test(e)) return 'z korun se staly herní L$ (skutečné peníze vydávané za herní)';
  // Značku skutečné měny si vybírá server podle jazyka hráče. Kdyby ji
  // překlad napsal natvrdo, Polák by viděl zlotý i tam, kde platí v eurech.
  // POZOR na \b: v regulárním výrazu platí jen pro ASCII, takže „zł" by
  // uvnitř slova „złożony" prošlo jako značka měny a hlásilo by to nesmysly.
  // Hledá se proto zł nebo PLN jako samostatné slovo, ručně.
  const samostatne = (text, znacka) => {
    const i0 = String(text).indexOf(znacka);
    if (i0 < 0) return false;
    for (let i = i0; i >= 0; i = String(text).indexOf(znacka, i + 1)) {
      const pred = text[i - 1], po = text[i + znacka.length];
      const okolo = (ch) => ch === undefined || /[\s(),.;:!?„""'\u00a0-]/.test(ch);
      if (okolo(pred) && okolo(po)) return true;
    }
    return false;
  };
  // Platí to pro každou měnu, ne jen pro zlotý: Němec platí v eurech, ale
  // text o tom nesmí rozhodovat — zítra se mapování změní a zůstane lež.
  const ZNACKY = ['zł', 'PLN', '€', 'EUR', 'CZK', 'USD', 'Kč'];
  const najdi = (t) => ZNACKY.filter((z) => samostatne(t, z));
  // Dolar hledáme zvlášť: $ se píše rovnou k číslu ($5), takže okolí
  // samostatného slova na něj nesedí. A L$ není měna, ale herní peníze.
  const maDolar = (t) => /(^|[^L\w])\$\s*\d/.test(t);
  const vPredloze = najdi(c).length > 0 || maDolar(c);
  const vPrekladu = najdi(e);
  if (!vPredloze && (vPrekladu.length || maDolar(e))) {
    return 'překlad si dosadil měnu natvrdo (' + (vPrekladu[0] || '$')
      + ') — značku určuje server podle toho, kde hráč platí';
  }
  if (!/L\$/.test(c) && /L\$/.test(e)) return 'L$ v překladu přibylo, i když v předloze nebylo';
  return null;
}

// ─── Délka ──────────────────────────────────────────────────────────
// Němčina skládá slova a bývá o půlku delší než čeština. Na tlačítku se to
// pozná až v telefonu, kdy už je pozdě. Hlídáme jen krátké texty bez HTML —
// tedy popisky tlačítek a hlaviček, kde na pár znacích záleží. Je to měkký
// nález: dlouhé slovo není chyba, jen místo, kam se má člověk podívat.
const KRATKY = 28;          // delší předloha je věta, ne popisek
const NEJVYS = 1.7;         // kolikrát smí překlad narůst
const SNESE = 20;           // do téhle délky se vejde všechno
function delkaSedi(c, e) {
  if (typeof c !== 'string' || typeof e !== 'string') return null;
  if (c.length > KRATKY || /[<>{]/.test(c)) return null;
  if (e.length <= SNESE || e.length <= c.length * NEJVYS) return null;
  return 'popisek je ' + Math.round((e.length / Math.max(1, c.length)) * 10) / 10
    + '× delší než česky (' + c.length + ' → ' + e.length + ' znaků)';
}

// ─── Obrácená interpunkce (španělština) ─────────────────────────────
// Otázka i zvolání mají ve španělštině znaménko na obou koncích: ¿Empezar
// de nuevo? a ¡Listo! Při strojovém překladu se na to zapomíná a je to
// v okně hned vidět. Kontrolujeme jen jednoduché texty — u souvětí a HTML
// by se nedalo poznat, ke které části znaménko patří.
function obracenaInterpunkce(c, e, jazyk) {
  if (jazyk !== 'es') return null;
  if (typeof c !== 'string' || typeof e !== 'string') return null;
  if (/[<>{]/.test(c)) return null;
  const chybi = [];
  // Větu bereme podle konce: co končí otazníkem, má začínat obráceným.
  const konec = e.trim().slice(-1);
  if (konec === '?' && !e.includes('¿')) chybi.push('¿');
  if (konec === '!' && !e.includes('¡')) chybi.push('¡');
  if (!chybi.length) return null;
  return 'chybí ' + chybi.join(' a ') + ' na začátku';
}

// ─── Tvary množného čísla ────────────────────────────────────────────────────
// Co která řeč potřebuje. Musí sedět s tvar() v jadro.js — kdyby se rozešly,
// hra by pro část čísel sáhla po tvaru, který v katalogu není, a věta by
// spadla na jiný pád nebo na prázdno.
const TVARY = { cs: ['one', 'few', 'other'], en: ['one', 'other'],
  pl: ['one', 'few', 'many'], de: ['one', 'other'], es: ['one', 'other'] };
function tvaryChybi(hodnota, jazyk) {
  if (typeof hodnota !== 'object' || !hodnota) return ['není objekt s tvary'];
  const chce = TVARY[jazyk] || ['one', 'other'];
  return chce.filter((t) => typeof hodnota[t] !== 'string' || !hodnota[t].trim());
}

function texty(h) {
  if (typeof h === 'string') return [h];
  if (h && typeof h === 'object') return Object.keys(h).map((k) => h[k]).filter((x) => typeof x === 'string');
  return [];
}

// ─── Scénáře infolinky ───────────────────────────────────────────────────────
// Próza, ale se stavbou: hra podle ní řídí hovor. Když se při překladu ztratí
// krok nebo se změní bod, hovor se chová jinak než v češtině.
function scenarSedi(c, e) {
  const chyby = [];
  if (!e) return ['scénář chybí'];
  if (c.id !== e.id) chyby.push('jiné id: ' + c.id + ' vs ' + e.id);
  const ck = Array.isArray(c.kroky) ? c.kroky : [];
  const ek = Array.isArray(e.kroky) ? e.kroky : [];
  if (ck.length !== ek.length) chyby.push('jiný počet kroků: ' + ck.length + ' vs ' + ek.length);
  ck.forEach((k, i) => {
    const t = ek[i]; if (!t) return;
    if (!String(t.t || '').trim()) chyby.push('krok ' + (i + 1) + ': prázdná otázka');
    const co = Array.isArray(k.o) ? k.o : [];
    const eo = Array.isArray(t.o) ? t.o : [];
    if (co.length !== eo.length) { chyby.push('krok ' + (i + 1) + ': jiný počet odpovědí'); return; }
    co.forEach((x, j) => {
      const y = eo[j]; if (!y) return;
      if (Number(x.b) !== Number(y.b)) chyby.push('krok ' + (i + 1) + ', odpověď ' + (j + 1) + ': jiný bod ' + x.b + ' vs ' + y.b);
      if (!String(y.t || '').trim()) chyby.push('krok ' + (i + 1) + ', odpověď ' + (j + 1) + ': prázdný text');
    });
  });
  return chyby;
}

// -----------------------------------------------------------------------------
function main() {
  const jazyk = process.argv[2] || 'en';
  const cs = nacti(ZDROJ + '.json', {});
  const en = nacti(jazyk + '.json', null);
  if (!en) { console.error('Katalog ' + jazyk + '.json nenalezen.'); process.exit(1); }

  const tvrde = [], mekke = [], ceka = [];
  const pridej = (pole, klic, co, detail) => pole.push({ klic, co, detail });
  // Otisk předlohy u hotového překladu. Když nesedí, překlad je zastaralý
  // nebo na něj teprve dojde — a tyhle nálezy nejsou chyba překladu, jen
  // práce, která ještě nespadla. Blokovat kvůli nim commit by znamenalo, že
  // se nedá uložit rozdělaná věta.
  const meta = nacti(jazyk + '.meta.json', {});
  const lmeta = nacti('linka.' + jazyk + '.meta.json', {});
  const hotovy = (k, zdroj) => meta[k] != null && meta[k] === otisk(zdroj);

  Object.keys(cs).forEach((k) => {
    const c = cs[k], e = en[k];
    if (e == null) return;                      // chybějící řeší kontrola
    if (!hotovy(k, c)) { ceka.push({ klic: k, co: 'čeká na překlad', detail: '' }); return; }

    // Tvary množného čísla
    if (typeof c === 'object') {
      const chybi = tvaryChybi(e, jazyk);
      if (chybi.length) pridej(tvrde, k, 'chybí tvar', chybi.join(', '));
      const ct = texty(c)[0] || '', et = texty(e)[0] || '';
      if (znacky(ct).join('|') !== znacky(et).join('|')) {
        pridej(tvrde, k, 'jiné značky v tvarech', znacky(ct).join(' ') + '  →  ' + znacky(et).join(' '));
      }
      return;
    }
    if (typeof e !== 'string') { pridej(tvrde, k, 'překlad není text', typeof e); return; }
    if (c.trim() && !e.trim()) { pridej(tvrde, k, 'prázdný překlad', ''); return; }

    // Značky
    const zc = znacky(c), ze = znacky(e);
    if (zc.join('|') !== ze.join('|')) {
      pridej(tvrde, k, 'jiné značky', (zc.join(' ') || '—') + '  →  ' + (ze.join(' ') || '—'));
    }
    // Stavba
    const kc = kostra(c), ke = kostra(e);
    if (kc.join('|') !== ke.join('|')) {
      const chybi = kc.filter((x) => !ke.includes(x));
      const navic = ke.filter((x) => !kc.includes(x));
      pridej(tvrde, k, 'jiná stavba',
        (chybi.length ? 'chybí ' + chybi.slice(0, 3).join(' ') : '')
        + (navic.length ? ' · navíc ' + navic.slice(0, 3).join(' ') : ''));
    }
    // Měna
    const m = menaSedi(c, e, k);
    if (m) pridej(tvrde, k, 'měna', m);
    // Délka krátkých popisků — měkký nález, do layoutu se musí podívat člověk.
    const d = delkaSedi(c, e);
    if (d) pridej(mekke, k, 'dlouhý popisek', d);
    const oi = obracenaInterpunkce(c, e, jazyk);
    if (oi) pridej(mekke, k, 'obrácená interpunkce', oi + ': ' + e.slice(0, 50));

    // Zbytky češtiny. Jména volajících jsou česká schválně — operátor zvedá
    // telefon v Česku a paní Vondráčková se jmenuje pořád stejně.
    const jmeno = /^hra\.(pan|pani|slecna|doktor|doktorka)_/.test(k);
    if (jazyk !== 'cs' && CESKE.test(e) && !jmeno) {
      pridej(mekke, k, 'české písmeno v překladu', e.slice(0, 60));
    } else if (jazyk !== 'cs' && c === e && /[A-Za-zÀ-ž]{3}/.test(c) && !/^[A-Z0-9 .,:%+-]+$/.test(c)) {
      pridej(mekke, k, 'nepřeloženo (shodné s předlohou)', c.slice(0, 60));
    }
  });

  // Scénáře infolinky
  const lcs = nacti('linka.' + ZDROJ + '.json', null);
  const len = nacti('linka.' + jazyk + '.json', null);
  if (lcs && len) {
    // Páruje se podle id, ne podle pořadí. Když se jeden scénář nepřeloží,
    // pořadí se posune a porovnávání po pozicích pak hlásí rozdíl u každého
    // dalšího — u polštiny z toho bylo 189 nálezů, z nichž ani jeden nebyl
    // skutečná chyba překladu. Id jsou jedinečná (hlídá se to níž), takže
    // párování podle nich sedne vždycky.
    const podleId = new Map();
    len.forEach((x) => { if (x && x.id != null) podleId.set(x.id, x); });
    const chybejici = lcs.filter((c) => lmeta[c.id] === otisk(c) && !podleId.has(c.id));
    if (chybejici.length) {
      pridej(tvrde, 'linka', 'scénář chybí v překladu',
        chybejici.map((c) => c.id).join(', '));
    }
    lcs.forEach((c) => {
      if (lmeta[c.id] !== otisk(c)) {
        ceka.push({ klic: 'linka:' + c.id, co: 'scénář čeká na překlad', detail: '' });
        return;
      }
      const t = podleId.get(c.id);
      if (!t) return;        // chybějící už je nahlášený výš, podruhé netřeba
      scenarSedi(c, t).forEach((x) => pridej(tvrde, 'linka:' + c.id, 'scénář', x));
    });
    // Hra vybírá scénáře tak, že vynechá ty, co padly naposled — a pozná je
    // podle id. Dvě stejná id si tedy navzájem blokují místo v nabídce.
    const poc = {};
    lcs.forEach((c) => { poc[c.id] = (poc[c.id] || 0) + 1; });
    Object.keys(poc).filter((k) => poc[k] > 1).forEach((k) => {
      pridej(tvrde, 'linka:' + k, 'shodné id', 'scénář s tímhle id je ' + poc[k] + '×');
    });
  }

  const vypis = (nazev, pole) => {
    console.log('\n' + nazev + ': ' + pole.length);
    const dle = {};
    pole.forEach((x) => { (dle[x.co] = dle[x.co] || []).push(x); });
    Object.keys(dle).forEach((co) => {
      console.log('  ' + co + ' (' + dle[co].length + ')');
      dle[co].slice(0, 8).forEach((x) => console.log('    ' + x.klic.padEnd(40) + ' ' + x.detail));
      if (dle[co].length > 8) console.log('    … a dalších ' + (dle[co].length - 8));
    });
  };

  console.log('Prohlídka překladu ' + ZDROJ + ' → ' + jazyk
    + ' · klíčů ' + Object.keys(cs).length);
  vypis('Tvrdé nálezy (rozbijí hru)', tvrde);
  vypis('Měkké nálezy (stojí za kouknutí)', mekke);
  console.log('\nČeká na překlad: ' + ceka.length);

  if (tvrde.length) {
    console.log('\nTvrdé nálezy je potřeba spravit — takhle to hráči nefunguje.');
    process.exit(1);
  }
  console.log('\nStavba, značky i měna sedí.');
  process.exit(0);
}

main();
