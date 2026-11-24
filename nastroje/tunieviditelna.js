// Kdy se hráči ukáže záložka Unie.
//
// Povolení do uzavřeného testu se přidává v administraci za běhu, ale hra
// si příznak brala jen z /account/me — a to se tahá jedinkrát, při načtení.
// Kdo se do testu přidal, zatímco hrál, neviděl nic a vypadalo to, že se
// přidání neuložilo. Hlídá se proto, že příznak chodí i v tom, co si hra
// bere každou minutu, a že se podle něj záložka doopravdy odkryje.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}
const koren = path.join(__dirname, '..');
const cti = (p) => fs.readFileSync(path.join(koren, p), 'utf8');
const hra = cti('public/compounder/game/game.js');

// ─── Záložka se řídí příznakem ───────────────────────────────────────────────
const m = hra.match(/function unieTab\(\) \{[\s\S]*?\n\}/);
ok('v game.js se našlo: unieTab', !!m);
if (m) {
  let schovano = null;
  const tlacitko = { classList: { toggle: (_t, v) => { schovano = v; } } };
  const box = { ME: null, $: (id) => (id === 'net-tab-unie' ? tlacitko : null) };
  vm.createContext(box);
  vm.runInContext(m[0], box);
  box.unieTab();
  ok('bez účtu je záložka schovaná', schovano === true);
  box.ME = { unie: false };
  box.unieTab();
  ok('a mimo uzavřený test taky', schovano === true);
  box.ME = { unie: true };
  box.unieTab();
  ok('v testu se odkryje', schovano === false);
}

// ─── Příznak musí dorazit i za běhu ──────────────────────────────────────────
const R = cti('routes/game-account.routes.js');
ok('server posílá povolení i v /cards',
  /router\.get\('\/cards'[\s\S]{0,2600}unie: p \? await unieSmi\(p\.id\)/.test(R));
ok('a /account/me ho posílá dál', /unie: await unieSmi\(p\.id\)/.test(R));
ok('hra si ho z toho bere', /r\.j\.unie === 'boolean'[\s\S]{0,200}ME\.unie = r\.j\.unie/.test(hra));
ok('a hned překreslí záložku', /ME\.unie = r\.j\.unie;[\s\S]{0,80}unieTab\(\);/.test(hra));
// Bez tohohle by se příznak bral jen při načtení hry — tedy nikdy za běhu.
ok('a bere se každou minutu', /setInterval\(function \(\) \{[^}]*loadCards\(\)[\s\S]{0,200}\}, 60000\)/.test(hra));
ok('hráč se o otevření doví', /hra\.unie_otevrena/.test(hra));

const KAT = JSON.parse(cti('services/game/texty/cs.json'));
ok('katalog má hra.unie_otevrena', !!KAT['hra.unie_otevrena']);
ok('a ví, kde Unii hledat', /Síti|Sít/.test(KAT['hra.unie_otevrena'] || ''));

// Záložka musí v stránce vůbec být — jinak se nemá co odkrývat.
const html = cti('public/compounder/game/index.html');
ok('tlačítko záložky je ve stránce', /id="net-tab-unie"/.test(html));
ok('a je schované, dokud se neodkryje', /id="net-tab-unie" class="hidden"/.test(html));

console.log(chyb ? '\n' + chyb + ' nesedí' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
