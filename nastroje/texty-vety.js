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
      const syrovy = txt.slice(u.odClenu, i);
      const c = syrovy.trim();
      if (c) u.cleny.push({ s: c, od: u.odClenu + syrovy.indexOf(c), do: u.odClenu + syrovy.indexOf(c) + c.length });
    }
    u.odClenu = -1;
  };
  const uzavri = (i) => {
    const u = vrch();
    dejClen(i);
    if (u.cleny.length > 1 && u.cleny.some((c) => c.s[0] === "'" && CZ.test(c.s)) && u.od >= 0) {
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
    // Komentář řetěz ukončí. Vysvětlivka mezi dvěma kusy věty je legální
    // JavaScript, ale do šablony nepatří — a kdyby se vzala jako člen,
    // rozbije zbytek řádku.
    if (z === '/' && (txt[i + 1] === '/' || txt[i + 1] === '*')) {
      uzavri(i);
      if (txt[i + 1] === '/') { while (i < txt.length && txt[i] !== '\n') i++; }
      else { i += 2; while (i < txt.length && !(txt[i] === '*' && txt[i + 1] === '/')) i++; i += 2; }
      continue;
    }
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

// Znak zapsaný ve zdroji jako \u00d7 patří do katalogu jako samotný znak.
function dekoduj(s) {
  return String(s)
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
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
  // Jeden špatný člen nesmí zabít celý řetěz. Dlouhá věta často končí
  // přílepkem s podmínkou — + (lze ? neco() : '') — a kvůli němu by se
  // nesloučilo nic. Bereme proto nejdelší souvislé úseky bezpečných členů.
  const bezpecny = (c) => {
    if (c[0] === "'") return true;
    if (/\b(if|return|var|let|const|for|while|function|new|delete|typeof)\b/.test(c)) return false;
    // Celý člen v závorce je uzavřený výraz — klidně i s podmínkou.
    // '... stojí ' + (kolik === 1 ? 'jeden' : 'dva') + ' kusy' se takhle
    // dá složit do jedné věty a podmínka se jen dosadí. Bez toho by se
    // kvůli jediné podmínce nesloučilo nic a věta zůstala v úlomcích.
    if (c[0] === '(' && c[c.length - 1] === ')' && !/[;{}]|=>/.test(c)
        && !/(^|[^=!<>])=([^=]|$)/.test(c)) {
      let h = 0, celek = true;
      for (let i = 0; i < c.length; i++) {
        if (c[i] === '(') h++;
        else if (c[i] === ')') { h--; if (h === 0 && i < c.length - 1) { celek = false; break; } }
      }
      if (celek && h === 0) return true;
    }
    if (/=>|[?:]/.test(c)) return false;
    if (/(^|[^=!<>])=([^=]|$)/.test(c)) return false;
    if (/[;{}]/.test(c)) return false;
    return /^[A-Za-z_$][\w$.]*(\s*\([^;{}]*\))?(\s*\[[^\];{}]*\])?$/.test(c)
      || /^[A-Za-z_$][\w$.]*\s*\([\s\S]*\)$/.test(c);
  };
  const useky = [];
  nalezy.forEach((n) => {
    let bezi = [];
    const uloz = () => {
      if (bezi.length > 1 && bezi.some((c) => c.s[0] === "'" && CZ.test(c.s))) useky.push(bezi.slice());
      bezi = [];
    };
    n.cleny.forEach((c) => { if (bezpecny(c.s)) bezi.push(c); else { uloz(); vynechane.push(c.s.slice(0, 60)); } });
    uloz();
  });
  useky.sort((a, b) => b[0].od - a[0].od).forEach((u) => {
    let sablona = '', udaje = [], i = 0;
    u.forEach((c) => {
      if (c.s[0] === "'") { sablona += c.s.slice(1, -1); return; }
      i++; udaje.push('p' + i + ': ' + c.s); sablona += '{p' + i + '}';
    });
    if (!CZ.test(sablona) || sablona.indexOf("\\'") >= 0) return;
    let k = Object.keys(nove).find((x) => nove[x] === sablona);
    if (!k) { k = klicZ(dekoduj(sablona), predpona, obsazene); nove[k] = dekoduj(sablona); }
    const nahrada = 'tx(\'' + k + '\'' + (udaje.length ? ', { ' + udaje.join(', ') + ' }' : '') + ')';
    text = text.slice(0, u[0].od) + nahrada + text.slice(u[u.length - 1].do);
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
