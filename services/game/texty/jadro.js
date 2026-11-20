// =============================================================================
// Laundromat Tycoon — jádro překladů
// =============================================================================
// Jeden soubor pro server i prohlížeč. Schválně: kdyby to byly dvě kopie,
// rozejdou se do měsíce a hráč uvidí jinou větu, než jaká mu přijde ze serveru.
// Server si ho načte přes require, hra ho dostane jako /game/texty.js.
//
// Klíč vypadá jako 'drazba.vyvolal', text jako 'Vyvolal {nick}.'. Chybí-li
// klíč v cílovém jazyce, spadne se na češtinu; chybí-li i tam, vrátí se
// samotný klíč. Nikdy se nevrátí prázdno — prázdné místo ve hře je horší
// než česká věta v anglické hře.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.T18N = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZDROJ = 'cs';                 // v téhle řeči se texty píšou
  var JAZYKY = ['cs', 'en', 'pl', 'de', 'es', 'fr', 'pt'];

  // ─── Množné číslo ─────────────────────────────────────────────────────────
  // Každá řeč jinak. Čeština tři tvary (1 / 2–4 / 5 a víc), angličtina,
  // němčina a španělština dva, polština čtyři — a ten čtvrtý je ten
  // nejčastější, takže se na něj nedá zapomenout: 5 prádlomatów, ale
  // 22 prádlomaty. Tvary se v katalogu píšou jako { one, few, many, other };
  // co která řeč nemá, prostě chybí.
  function tvar(jazyk, n) {
    var a = Math.abs(n);
    if (jazyk === 'cs') {
      if (a === 1) return 'one';
      if (a >= 2 && a <= 4) return 'few';
      return 'other';
    }
    if (jazyk === 'pl') {
      if (a === 1) return 'one';
      var des = a % 10, sto = a % 100;
      // 2–4 na konci, ale ne 12–14: 22 few, ale 12 many
      if (des >= 2 && des <= 4 && !(sto >= 12 && sto <= 14)) return 'few';
      return 'many';
    }
    // Francouzština bere jako jednotné číslo i nulu: 0 prádlomat, ne
    // 0 prádlomatů. Vypadá to jako drobnost, ale „0 machine" proti
    // „0 machines" je rozdíl, kterého si Francouz všimne hned.
    // Brazilská portugalština bere nulu stejně jako francouzština:
    // 0 lavanderia, ne 0 lavanderias.
    if (jazyk === 'fr' || jazyk === 'pt') return (a === 0 || a === 1) ? 'one' : 'other';
    return a === 1 ? 'one' : 'other';
  }

  // ─── Čísla, peníze, čas ───────────────────────────────────────────────────
  // Čeština píše 1 234 567, angličtina 1,234,567, polština zase po svém.
  // Měna zůstává L$ ve všech — je to herní měna, ne koruna ani zlotý.
  var LOCALE = { cs: 'cs-CZ', en: 'en-GB', pl: 'pl-PL', de: 'de-DE', es: 'es-ES',
                 fr: 'fr-FR', pt: 'pt-BR' };
  function locale(jazyk) { return LOCALE[jazyk] || LOCALE[ZDROJ]; }
  function cislo(n, jazyk) {
    var x = Math.round(Number(n) || 0);
    try { return x.toLocaleString(locale(jazyk)); }
    catch (e) { return String(x); }
  }
  function penize(n, jazyk) { return cislo(n, jazyk) + ' L$'; }
  function datum(d, jazyk) {
    var t = (d instanceof Date) ? d : new Date(d);
    if (isNaN(t.getTime())) return '';
    try {
      return t.toLocaleString(locale(jazyk),
        { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return t.toISOString().slice(0, 16).replace('T', ' '); }
  }

  // ─── Dosazování údajů ─────────────────────────────────────────────────────
  // {nick} vloží hodnotu tak, jak přišla. {penize:cena} a {cislo:kolik} ji
  // naformátují podle jazyka. Chybějící údaj nechá značku být — ať je na první
  // pohled vidět, že se zapomnělo něco předat, místo tichého „undefined".
  var ZNACKA = /\{(?:([a-z]+):)?([a-zA-Z0-9_]+)\}/g;
  function dosad(text, udaje, jazyk) {
    if (!udaje) udaje = {};
    return String(text).replace(ZNACKA, function (cele, format, klic) {
      if (!(klic in udaje)) return cele;
      var v = udaje[klic];
      if (format === 'penize') return penize(v, jazyk);
      if (format === 'cislo') return cislo(v, jazyk);
      if (format === 'datum') return datum(v, jazyk);
      return String(v == null ? '' : v);
    });
  }

  // ─── Vlastní překladač ────────────────────────────────────────────────────
  function Preklady(katalogy) {
    this.k = katalogy || {};
  }
  Preklady.prototype.nastav = function (jazyk, katalog) { this.k[jazyk] = katalog || {}; };
  Preklady.prototype.ma = function (jazyk, klic) {
    return !!(this.k[jazyk] && this.k[jazyk][klic] != null);
  };
  // Vrátí hotovou větu. jazyk → zdrojový jazyk → klíč.
  Preklady.prototype.t = function (klic, udaje, jazyk) {
    var j = JAZYKY.indexOf(jazyk) >= 0 ? jazyk : ZDROJ;
    var zaznam = (this.k[j] && this.k[j][klic]);
    if (zaznam == null && j !== ZDROJ) { zaznam = this.k[ZDROJ] && this.k[ZDROJ][klic]; j = ZDROJ; }
    if (zaznam == null) return klic;
    // Tvary množného čísla: vybere se podle {n} v údajích.
    if (typeof zaznam === 'object') {
      var n = udaje && udaje.n != null ? Number(udaje.n) : 0;
      // Chybějící tvar nesmí shodit větu na prázdno. Bereme, co je po ruce —
      // špatný pád je pořád lepší než díra v textu.
      zaznam = zaznam[tvar(j, n)] || zaznam.other || zaznam.many
        || zaznam.few || zaznam.one || '';
    }
    return dosad(zaznam, udaje, j);
  };

  return { ZDROJ: ZDROJ, JAZYKY: JAZYKY, LOCALE: LOCALE, Preklady: Preklady,
    tvar: tvar, locale: locale, cislo: cislo, penize: penize, datum: datum, dosad: dosad };
}));
