// Názvy zemí v žebříčku. Ručně přeložených je sedmadvacet, ale stavět se dá
// ve stovkách zemí — zbytku svítily jen dvoupísmenné kódy (CO, GI, PS).
// Zbytek umí pojmenovat prohlížeč; tenhle test hlídá, že se ho hra zeptá,
// že se nepřepíše ručně přeložený název a že bez prohlížečové podpory
// zůstane kód jako dřív.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const zac = SRC.indexOf('var ZEME_NAZEV = {');
const kon = SRC.indexOf('// Vlaječky zemí');
assert.ok(zac > 0 && kon > zac, 'blok s názvy zemí se v game.js nenašel');
const BLOK = SRC.slice(zac, kon);

const KATALOG = { 'hra.cesko': 'Česko', 'hra.francie': 'Francie' };
function postav(jazyk, intl) {
  const ctx = vm.createContext({
    tx: (k) => KATALOG[k] || k,
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;'),
    localeHrace: () => jazyk,
    Intl: intl,
  });
  vm.runInContext(BLOK, ctx);
  return ctx;
}
const skutecneIntl = { DisplayNames: Intl.DisplayNames };

// 1) Ručně přeložené země se berou z katalogu, ne z prohlížeče.
{
  const c = postav('cs-CZ', skutecneIntl);
  assert.strictEqual(vm.runInContext("zemeNazev('cz')", c), 'Česko', 'Česko se má brát z katalogu');
  assert.strictEqual(vm.runInContext("zemeNazev('fr')", c), 'Francie', 'Francie se má brát z katalogu');
}

// 2) Země z Honzovy obrazovky, které předtím svítily jen jako kód.
{
  const c = postav('cs-CZ', skutecneIntl);
  for (const [kod, cekam] of [['co', 'Kolumbie'], ['gi', 'Gibraltar'], ['li', 'Lichtenštejnsko'],
    ['fo', 'Faerské ostrovy'], ['tr', 'Turecko']]) {
    const m = vm.runInContext("zemeNazev('" + kod + "')", c);
    assert.strictEqual(m, cekam, kod + ' má být ' + cekam + ', je ' + m);
  }
  const ps = vm.runInContext("zemeNazev('ps')", c);
  assert.ok(ps && ps !== 'PS' && ps.length > 2, 'PS má mít název, ne kód: ' + ps);
}

// 3) Jazyk hráče se respektuje.
{
  // Konkrétní znění si drží prohlížeč (a mění ho — z „Turkey" se stalo
  // „Türkiye"), takže se tu porovnávají jazyky mezi sebou, ne s textem.
  const cs = vm.runInContext("zemeNazev('co')", postav('cs-CZ', skutecneIntl));
  const de = vm.runInContext("zemeNazev('co')", postav('de-DE', skutecneIntl));
  const fr = vm.runInContext("zemeNazev('co')", postav('fr-FR', skutecneIntl));
  assert.strictEqual(cs, 'Kolumbie', 'česky');
  assert.strictEqual(de, 'Kolumbien', 'německy');
  assert.strictEqual(fr, 'Colombie', 'francouzsky');
  assert.strictEqual(new Set([cs, de, fr]).size, 3, 'jazyk hráče se nepromítá do názvu');
}

// 4) Bez prohlížečové podpory se nic nerozbije — zůstane kód jako dřív.
{
  const bez = postav('cs-CZ', {});
  assert.strictEqual(vm.runInContext("zemeNazev('co')", bez), 'CO', 'bez Intl má zůstat kód');
  assert.strictEqual(vm.runInContext("zemeNazev('cz')", bez), 'Česko', 'katalog funguje i bez Intl');
  const rozbity = postav('cs-CZ', { DisplayNames: function () { throw new Error('ne'); } });
  assert.strictEqual(vm.runInContext("zemeNazev('co')", rozbity), 'CO', 'spadlé Intl nesmí shodit hru');
  const lzivy = postav('cs-CZ', { DisplayNames: function () { this.of = () => { throw new Error('ne'); }; } });
  assert.strictEqual(vm.runInContext("zemeNazev('co')", lzivy), 'CO', 'spadlé .of() nesmí shodit hru');
}

// 5) Nesmysly nesmí nic shodit.
{
  const c = postav('cs-CZ', skutecneIntl);
  for (const x of ["''", 'null', 'undefined', "'xxx'", "'1'", "'č@'"]) {
    const m = vm.runInContext('zemeNazev(' + x + ')', c);
    assert.strictEqual(typeof m, 'string', x + ' má vrátit text');
    assert.ok(!/undefined|null/.test(m), x + ' vrátilo ' + m);
  }
}

// 6) Dvojité escapování. Názvy chodí ven syrové a escapuje až to, kdo je
//    lepí do HTML — jinak by se z apostrofu stalo &amp;#39;.
{
  assert.ok(!/esc\(tx\(/.test(BLOK), 'v katalogu zemí se znovu objevil esc(tx(…)) — hrozí dvojí escapování');
  const volani = SRC.match(/zemeNazev/g) || [];
  assert.ok(volani.length >= 3, 'zemeNazev se nikde nepoužívá?');
  const radky = SRC.split('\n').filter((l) => /zemeNazev\(/.test(l) && !/function zemeNazev/.test(l));
  for (const l of radky) {
    assert.ok(/esc\(zemeNazev\(|map\(zemeNazev\)/.test(l),
      'název země jde do HTML bez esc(): ' + l.trim().slice(0, 90));
  }
  // A místo, kde se jméno lepí přes map(), musí esc() obalovat celek.
  const mapa = radky.find((l) => /map\(zemeNazev\)/.test(l));
  assert.ok(!mapa || /esc\(/.test(mapa), 'seznam zemí v title jde ven bez esc()');
}

console.log('tzemenazvy: ok');
