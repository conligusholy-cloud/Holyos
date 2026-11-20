// Co držený podíl fondu nese a za jak dlouho se vrátí.
//
// Panel ukazoval u každého podílu jen částku měsíčně, a ta sama o sobě
// neřekne nic: 633 672 L$ ze zaplacených 17 625 000 je výborný obchod,
// 130 276 L$ ze šedesáti milionů je špatný. Vedle sebe to poznat nejde,
// dokud se obojí nevydělí.
//
// Testuje se SKUTEČNÝ kód vytažený z game.js, ne jeho opis.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const hra = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'compounder', 'game', 'game.js'), 'utf8');
const kusy = [
  (hra.match(/var NAVRATNOST_MAX = [^\n]*\n/) || [''])[0],
  (hra.match(/function podilVynos\(x\) \{[\s\S]*?\n\}/) || [''])[0],
];
ok('v game.js se našlo: podilVynos', !!kusy[1]);
if (!kusy[1]) { console.log('\n' + chyb + ' nesedí'); process.exit(1); }
const box = {};
vm.createContext(box);
vm.runInContext(kusy.join('\n'), box);
const vynos = box.podilVynos;
const pct = (v) => Math.round(v.podil * 1000) / 10;

// ─── Skutečné podíly fondu EX ALTO HOLDING, 20. 11. 2026 ─────────────────────
const laundryboss = vynos({ cena: 17625000, mesicne: 633672 });
ok('Laundryboss nese 3,6 % měsíčně', pct(laundryboss) === 3.6);
ok('a vrátí se za 28 měsíců', laundryboss.mesicu === 28);

const vypral = vynos({ cena: 1000000, mesicne: 864555 });
ok('Vypral a Zašpinil nese 86,5 % měsíčně', pct(vypral) === 86.5);
ok('a vrátí se za měsíc', vypral.mesicu === 1);

const los = vynos({ cena: 60000000, mesicne: 130276 });
ok('LosPrádlos nese 0,2 % měsíčně', pct(los) === 0.2);
ok('a vrátí se za 461 měsíců', los.mesicu === 461);
ok('461 měsíců je pořád číslo, ne „nevrátí se"', los.nevrati === false);

// ─── Kdy se výnos nedá spočítat ──────────────────────────────────────────────
// Podíl, který fond nekoupil, nemá z čeho výnos počítat — a dělení nulou
// by dalo nekonečno procent.
ok('nulová cena výnos nemá', vynos({ cena: 0, mesicne: 50000 }) === null);
// Podíl, co nenese nic: o tom mluví řádek nad ním, návratnost je nekonečná.
ok('nulový výnos se nepočítá', vynos({ cena: 1000000, mesicne: 0 }) === null);
ok('záporný výnos se nepočítá', vynos({ cena: 1000000, mesicne: -5 }) === null);
ok('chybějící čísla nic neshodí', vynos({}) === null && vynos(null) === null);

// ─── Hranice „nevrátí se" ────────────────────────────────────────────────────
// Sto herních let. Nad tím je číslo měsíců nesmysl, který se nedá přečíst.
ok('přesně na hranici se číslo ještě ukáže',
  vynos({ cena: 1200, mesicne: 1 }).nevrati === false);
ok('o měsíc dál už ne',
  vynos({ cena: 1201, mesicne: 1 }).nevrati === true);
// Jedna koruna měsíčně z miliardy: návratnost v řádu milionů měsíců.
ok('absurdní návratnost se neukazuje číslem',
  vynos({ cena: 1000000000, mesicne: 1 }).nevrati === true);

// ─── Zapojení ────────────────────────────────────────────────────────────────
// Počet sám nestačí: musí se u každého drženého podílu opravdu vypsat.
const blok = hra.slice(hra.indexOf("tx('fond.drzi')"));
const usek = blok.slice(0, blok.indexOf("fond.nese_mesicne"));
ok('panel fondu výnos vypisuje', usek.indexOf('podilVynos(x)') > 0);
ok('a u nenávratného podílu jinou větou',
  usek.indexOf("fond.vynos_nevrati") > 0 && usek.indexOf("tx('fond.vynos'") > 0);

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nSedí.');
process.exit(chyb ? 1 : 0);
