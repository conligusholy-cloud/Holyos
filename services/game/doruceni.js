// =============================================================================
// Laundromat Tycoon — text doručenky
// =============================================================================
// Doručenka je zpráva o tom, co se komu stalo s penězi nebo majetkem. Čte ji
// hráč, který může mít nastavený jiný jazyk než ten, kdo ji vyvolal — proto se
// v databázi drží jako kód a údaje a věta se skládá až tady, u čtenáře.
//
// Starší řádky mají jen hotovou českou větu ve sloupci popis. Ty se nechávají
// být: přeložit je zpětně nejde a prázdná doručenka by byla horší.
'use strict';

const TEXTY = require('./texty');
const { nazevOdmeny } = require('./hodnosti');

// Některé údaje nejsou text, ale kód něčeho, co má vlastní název v každém
// jazyce — hodnost, odznak. Ty se dopřekládají tady.
const DOPLN = {
  'odmena.hodnost': (u, j) => ({ nazev: nazevOdmeny('hodnost', u.kod, j) }),
  'odmena.odznak': (u, j) => ({ nazev: nazevOdmeny('odznak', u.kod, j) }),
};

// V hláškách se ukazuje název firmy, ne nick. V údajích doručenky je nick uložen
// jako text (p1, p2…), takže u čtenáře ho nahradíme firmou, pokud známe hráče
// s přesně takovým nickem. Starší řádky s hotovou českou větou zůstávají.
function nahradNicky(u, jmena) {
  if (!jmena) return u;
  const o = Object.assign({}, u);
  Object.keys(o).forEach((k) => {
    if (/^p\d+$/.test(k) && typeof o[k] === 'string') {
      const f = jmena[o[k].toLowerCase()];
      if (f) o[k] = f;
    }
  });
  return o;
}

function textDorucenky(d, jazyk, jmena) {
  if (!d) return '';
  if (!d.text_kod) return d.popis || '';
  const u = nahradNicky(d.text_data || {}, jmena);
  const dopln = DOPLN[d.text_kod];
  try {
    const veta = TEXTY.t(d.text_kod, dopln ? dopln(u, jazyk) : u, jazyk);
    // t() vrací samotný klíč, když text v katalogu není. Takovou „větu"
    // hráči ukázat nemůžeme — radši uloženou českou zálohu.
    if (veta === d.text_kod) return d.popis || veta;
    return veta;
  } catch (e) {
    // Rozbitá doručenka nesmí shodit výpis peněz.
    return d.popis || d.text_kod;
  }
}

module.exports = { textDorucenky, DOPLN };
