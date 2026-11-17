#!/usr/bin/env node
// =============================================================================
// Oprava rozbitých uvozovek v odpovědi překladače
// =============================================================================
// Model občas nechá v přeloženém textu rovnou uvozovku a neutče ji — a celá
// dávka se kvůli jednomu znaku nedá přečíst. Na textu o splátce a úroku, kde
// je v češtině „Zbyde měsíčně", to padalo pokaždé, i když byl v dávce sám.
//
// Zadání teď říká, ať se uvozovky píšou typograficky, a tohle je záchranná
// síť pro případ, že se model netrefí. Pravidlo: uvnitř hodnoty je rovná
// uvozovka koncem řetězce jen tehdy, když po ní (přes mezery) přijde čárka,
// dvojtečka nebo složená závorka. Jinak patří do textu.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/texty-prelozit.js', 'utf8');
const zac = src.indexOf('function spravUvozovky');
const kon = src.indexOf('\n}\n', zac) + 3;
const spravUvozovky = eval('(' + src.slice(zac, kon).replace('function spravUvozovky', 'function') + ')');

let chyb = 0;
const zkus = (co, vstup, ceka) => {
  let v;
  try { v = JSON.parse(spravUvozovky(vstup)); } catch (e) { v = 'NEPŘEČTENO: ' + e.message; }
  const ok = JSON.stringify(v) === JSON.stringify(ceka);
  console.log((ok ? 'OK    ' : 'CHYBA ') + co);
  if (!ok) { console.log('   čekal:  ' + JSON.stringify(ceka)); console.log('   dostal: ' + JSON.stringify(v)); chyb++; }
};

zkus('rovná uvozovka uvnitř textu',
  '{"a": "Zbytek umazává dluh. "Zbyde měsíčně" je totéž číslo."}',
  { a: 'Zbytek umazává dluh. "Zbyde měsíčně" je totéž číslo.' });
zkus('správný JSON zůstane beze změny',
  '{"a": "nic tu není", "b": "ani tady"}',
  { a: 'nic tu není', b: 'ani tady' });
zkus('už escapovaná uvozovka se nerozbije',
  '{"a": "říká \\"ahoj\\" a jde"}',
  { a: 'říká "ahoj" a jde' });
zkus('typografické uvozovky projdou',
  '{"a": "„Zbyde miesięcznie" to ta sama liczba."}',
  { a: '„Zbyde miesięcznie" to ta sama liczba.' });
zkus('víc klíčů, rozbitý je prostřední',
  '{"a": "ok", "b": "má "uvozovky" uvnitř", "c": "taky ok"}',
  { a: 'ok', b: 'má "uvozovky" uvnitř', c: 'taky ok' });
zkus('text končící uvozovkou před čárkou',
  '{"a": "konec "takhle"", "b": "dál"}',
  { a: 'konec "takhle"', b: 'dál' });
zkus('HTML s atributy v hodnotě',
  '{"a": "<b class=\\"x\\">text</b>"}',
  { a: '<b class="x">text</b>' });
// Půlení dávky: má zafungovat na pokaženou odpověď, ale NE na chybu
// přístupu — tam je menší dávka k ničemu a jen se opakuje totéž.
{
  const zac = src.indexOf('function stojiZaPuleni');
  const kon = src.indexOf('\n}\n', zac) + 3;
  const stojiZaPuleni = eval('(' + src.slice(zac, kon).replace('function stojiZaPuleni', 'function') + ')');
  const zk = (zprava, ceka) => {
    const v = stojiZaPuleni(new Error(zprava));
    const ok = v === ceka;
    console.log((ok ? 'OK    ' : 'CHYBA ') + (ceka ? 'půlí se: ' : 'nepůlí se: ') + zprava);
    if (!ok) chyb++;
  };
  zk('Expected \',\' or \'}\' after property value in JSON', true);
  zk('odpověď bez JSON', true);
  zk('API 401: Unauthorized', false);
  zk('API 429: rate limit', false);
  zk('API 529: overloaded', false);
  zk('chybí ANTHROPIC_API_KEY v prostředí', false);
}
console.log(chyb ? '\n' + chyb + ' CHYB' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
