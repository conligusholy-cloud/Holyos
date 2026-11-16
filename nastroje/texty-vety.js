#!/usr/bin/env node
// =============================================================================
// Druhý průchod: slepené věty do jedné šablony
// =============================================================================
// První nástroj bere text mezi značkami a vět rozsekaných vloženým číslem se
// schválně nedotkne — po kouskách je přeložit nejde. Tenhle je bere jinak:
// celý řetěz 'kus' + hodnota + 'kus' sloučí do JEDNÉ šablony se značkami
// a hodnoty předá jako údaje.
//
//   'Zbývá ' + kcFull(x) + ' do splacení.'
//   →  tx('klic', { p1: kcFull(x) })      kde klic = 'Zbývá {p1} do splacení.'
//
// Co nechá být: řetěz, ve kterém je podmínka (a ? 'x' : 'y'), protože ta
// v sobě nese vlastní věty a sloučením by se z toho stala kaše. Takové místo
// nahlásí a přepíše se ručně.
'use strict';

const fs = require('fs');
const path = require('path');

const HRA = path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js');
const CS = path.join(__dirname, '..', 'services', 'game', 'texty', 'cs.json');
const CZ = /[ěščřžýáíéúůňťďóĚŠČŘŽÝÁÍÉÚŮŇŤĎÓ]/;

function telo(zdroj, jmeno) {
  const radky = zdroj.split('\n');
  const od = radky.findIndex((l) => l.startsWith('function ' + jmeno + '('));
  if (od < 0) return null;
  let doR = od + 1;
  while (doR < radky.length && !/^function \w+/.test(radky[doR])) doR++;
  return { od, doR, text: radky.slice(od, doR).join('\n') };
}

// Najde řetězy spojené plusem na VŠECH úrovních závorek. Věty jsou často
// schované uvnitř podmínky — (ma ? 'Máš ' + x + '.' : 'Chybí ' + y + '.') —
// a scanner, který kouká jen na nejvyšší úroveň, je nenajde.
//
// Každá úroveň závorek má vlastní rozdělanou větu. Otazník, dvojtečka, čárka
// i středník větu na své úrovni uzavřou: za nimi začíná něco jiného. Obsah
// závorky se do členu bere doslova z původního textu podle indexů — skládat
// ho znovu by znamenalo ztratit mezery a vnořená volání.
function retezy(txt) {
  const out = [];
  const zas = [{ cleny: [], odClenu: -1, od: -1 }];
  const vrch = () => zas[zas.length - 1];
  const dejClen = (i) => {
    const u = vrch();
    if (u.odClenu >= 0) {
      const c = txt.slice(u.odClenu, i).trim();
      if (c) u.cleny.push(c);
    }
    u.odClenu = -1;
  };
  const uzavri = (i) => {
    const u = vrch();
    dejClen(i);
    if (u.cleny.length > 1 && u.cleny.some((c) => c[0] === "'" && CZ.test(c)) && u.od >= 0) {
      out.push({ od: u.od, do: i, cleny: u.cleny.slice() });
    }
    u.cleny = []; u.od = -1; u.odClenu = -1;
  };
  const zacni = (i) => {
    const u = vrch();
    if (u.od < 0) u.od = i;
    if (u.odClenu < 0) u.odClenu = i;
  };
  let i = 0;
  while (i < txt.length) {
    const z = txt[i];
    if (z === "'") {
      let j = i + 1;
      while (j < txt.length && (txt[j] !== "'" || txt[j - 1] === '\\')) j++;
      zacni(i);
      i = j + 1;
      continue;
    }
    // Složené závorky se počítají taky. Bez nich řetěz přeroste přes konec
    // objektu — [{ t: 'Vyřídil ' + n + ' hovorů.' }] — a vznikne nesmysl.
    if (z === '(' || z === '[' || z === '{') {
      zacni(i);
      zas.push({ cleny: [], odClenu: -1, od: -1 });
      i++; continue;
    }
    if (z === ')' || z === ']' || z === '}') {
      uzavri(i);
      if (zas.length > 1) zas.pop();
      i++; continue;
    }
    if (z === '+') { dejClen(i); i++; continue; }
    if (z === '?' || z === ':' || z === ',' || z === ';') { uzavri(i); i++; continue; }
    if (z !== ' ' && z !== '\t' && z !== '\n') zacni(i);
    i++;
  }
  uzavri(txt.length);
  // Vnořené řetězy se překrývají s vnějšími — bereme ty nejvnitřnější,
  // ty vnější by do šablony vtáhly cizí kód.
  out.sort((a, b) => (a.od - b.od) || (a.do - b.do));
  const cisto = [];
  out.forEach((n) => {
    if (cisto.some((x) => x.od <= n.od && x.do >= n.do)) return;
    while (cisto.length && n.od <= cisto[cisto.length - 1].od && n.do >= cisto[cisto.length - 1].do) cisto.pop();
    cisto.push(n);
  });
  return cisto;
}

function klicZ(text, predpona, obsazene) {
  let z = text.replace(/\{p\d+\}/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  z = z.split('_').filter(Boolean).slice(0, 6).join('_') || 'veta';
  let k = predpona + '.' + z, i = 2;
  while (obsazene.has(k)) { k = predpona + '.' + z + '_' + i; i++; }
  obsazene.add(k);
  return k;
}

function main() {
  const [jmeno, predpona, prepinac] = process.argv.slice(2);
  if (!jmeno || !predpona) { console.error('použití: <funkce> <predpona> [--zapsat]'); process.exit(1); }
  const zapsat = prepinac === '--zapsat';
  const zdroj = fs.readFileSync(HRA, 'utf8');
  const fn = telo(zdroj, jmeno);
  if (!fn) { console.error('funkci ' + jmeno + ' jsem nenašel.'); process.exit(1); }
  if (/(?:var|let|const)\s+tx\b/.test(fn.text)) { console.error('lokální tx — ručně.'); process.exit(2); }

  const cs = JSON.parse(fs.readFileSync(CS, 'utf8'));
  const obsazene = new Set(Object.keys(cs));
  const nalezy = retezy(fn.text);
  const nove = {};
  const vynechane = [];
  let text = fn.text;

  // Od konce, ať se posuny nerozbijí.
  nalezy.slice().sort((a, b) => b.od - a.od).forEach((n) => {
    const cleny = n.cleny;
    // Do šablony smí jít jen to, co je opravdu hodnota: jméno, přístup přes
    // tečku nebo volání. Jakmile se v členu objeví příkaz nebo přiřazení,
    // řetěz přerostl přes konec výrazu a sloučením by vznikl nesmysl —
    // takové místo se nechá být a nahlásí.
    const bezpecny = (c) => {
      if (c[0] === "'") return true;
      if (/\b(if|return|var|let|const|for|while|function|new|delete|typeof)\b/.test(c)) return false;
      if (/=>|[?:]/.test(c)) return false;
      if (/(^|[^=!<>])=([^=]|$)/.test(c)) return false;     // přiřazení
      if (/[;{}]/.test(c)) return false;
      return /^[A-Za-z_$][\w$.]*(\s*\([^;{}]*\))?(\s*\[[^\];{}]*\])?$/.test(c)
        || /^[A-Za-z_$][\w$.]*\s*\([\s\S]*\)$/.test(c);
    };
    if (!cleny.every(bezpecny)) { vynechane.push(cleny.join(' + ').slice(0, 70)); return; }
    let sablona = '', udaje = [], i = 0;
    cleny.forEach((c) => {
      if (c[0] === "'") { sablona += c.slice(1, -1); return; }
      i++; udaje.push('p' + i + ': ' + c); sablona += '{p' + i + '}';
    });
    if (!CZ.test(sablona)) return;
    if (sablona.indexOf("\\'") >= 0) { vynechane.push(sablona.slice(0, 70)); return; }
    const k = klicZ(sablona, predpona, obsazene);
    nove[k] = sablona;
    const nahrada = 'tx(\'' + k + '\'' + (udaje.length ? ', { ' + udaje.join(', ') + ' }' : '') + ')';
    text = text.slice(0, n.od) + nahrada + text.slice(n.do);
  });

  console.log('funkce ' + jmeno + ' · sloučených vět: ' + Object.keys(nove).length
    + (vynechane.length ? ' · k ruce: ' + vynechane.length : ''));
  Object.keys(nove).slice(0, 6).forEach((k) => console.log('  ' + k.padEnd(44) + ' = ' + nove[k].slice(0, 64)));
  if (!zapsat) { console.log('(nanečisto)'); return; }
  Object.assign(cs, nove);
  fs.writeFileSync(CS, JSON.stringify(cs, null, 2) + '\n', 'utf8');
  const radky = zdroj.split('\n');
  fs.writeFileSync(HRA, radky.slice(0, fn.od).concat(text.split('\n')).concat(radky.slice(fn.doR)).join('\n'), 'utf8');
  console.log('zapsáno.');
}
main();
