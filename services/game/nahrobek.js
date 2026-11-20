// =============================================================================
// Náhrobek po odebraném stroji
// =============================================================================
// Když hra dostane doručenku unit_remove (soud zabavil prádlomat), poznamená
// si místo do S.prodano. Díky tomu se stroj nevrátí na sklad a neobnoví se ze
// záboru — u zabaveného stroje je to tak správně.
//
// Poznámka ale platí napořád, a to je potíž, když se místo mezitím vrátí do
// hry jinak než novou stavbou: hra na něm stroj nikdy neuvidí. Tenhle modul
// umí poznámku sundat z JEDNOHO místa, aby se to dalo napravit adresně.
// Hromadně nikdy — jinak by se tím hráčům vrátily i stroje, o které u soudu
// skutečně přišli.
'use strict';

// Vrací nový stav; původní se nemění. Stav hráče je jedna velká struktura,
// která se ukládá celá — kdyby se přepisovala na místě a zápis pak spadl,
// zůstala by v paměti rozdělaná a uložilo by se něco mezi.
function sundej(state, spotId) {
  const st = (state && typeof state === 'object' && !Array.isArray(state)) ? state : null;
  const id = typeof spotId === 'string' ? spotId : '';
  if (!st || !id) return { zmena: false, state: state };
  const p = st.prodano;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { zmena: false, state: state };
  if (!Object.prototype.hasOwnProperty.call(p, id)) return { zmena: false, state: state };
  const prodano = Object.assign({}, p);
  delete prodano[id];
  return { zmena: true, state: Object.assign({}, st, { prodano: prodano }) };
}

// Co na tom místě hra vidí. Používá se jen pro výpis do administrace, aby
// bylo před zásahem vidět, jestli tam hráč stroj má, nebo ne.
function maStroj(state, spotId) {
  const u = (state && Array.isArray(state.units)) ? state.units : [];
  return u.some((x) => x && x.spotId === spotId);
}

module.exports = { sundej, maStroj };
