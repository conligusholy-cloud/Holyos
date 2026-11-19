// Nouzová brzda na burzu.
//
// Brzda má dvě možné chyby a obě jsou tiché. Když zastaví míň, než má,
// zůstane otevřená ta díra, kvůli které se tahala. Když zastaví víc, zamkne
// hráče uprostřed rozjednaného obchodu — nemůže přijmout, splatit ani
// vyzvednout, co mu patří — a vypadá to jako rozbitá hra, ne jako brzda.
//
// Proto se tu nezkouší jen pár cest, ale VŠECHNY, které burza zná: seznam se
// vyčte přímo z obsluhy. Přibude-li nová cesta, test spadne a donutí
// rozhodnout, jestli se má brzdit — nikdo na ni nezapomene.
const fs = require('fs');
const path = require('path');
const B = require('../services/game/brzda');

let chyb = 0;
function ok(co, podminka, detail) {
  console.log((podminka ? 'OK    ' : 'CHYBA ') + co + (detail ? '  ' + detail : ''));
  if (!podminka) chyb++;
}

// Co má brzda zastavit (true) a co musí projít i při zatažené brzdě (false).
const OCEKAVANI = {
  '/trade/offer': true,                 // nabídka i půjčka
  '/trade/:id/counter': true,           // protinávrh je nová nabídka
  '/trade/:id/decline': false,
  '/trade/:id/accept': false,
  '/trade/prevzeti': true,
  '/trade/prevzeti/:id/zrusit': false,
  '/trade/prevzeti/:id/prodat': false,  // prodej do vyhlášené nabídky je dokončení
  '/trade/zastava-souhlas': false,
  '/trade/aliance': true,
  '/trade/aliance/pozvat': true,
  '/trade/aliance/prijmout': false,
  '/trade/aliance/odejit': false,
  // Stáhnout a odmítnout pozvánku brzda nezastavuje: ani jedno nezakládá
  // závazek, obojí jen uvolňuje místo ve fondu. Při díře je lepší, když to
  // jde udělat, než když to visí.
  '/trade/aliance/pozvanku-zrusit': false,
  '/trade/aliance/odmitnout': false,
  // Vklad do fondu je nový závazek — zastavuje se. Převod podílu ve fondu
  // taky: nehýbe hotovostí, ale mění, komu z fondu kolik patří, a to je
  // přesně ta věc, kterou při díře nechceš nechat běžet.
  '/trade/aliance/fond/vklad': true,
  '/trade/aliance/fond/prevod': true,
  // Nový návrh zastavujeme: je to nový závazek fondu. Hlasování o už
  // běžícím návrhu ne — jinak by brzda zavřela členy v rozjednané věci,
  // stejně jako u rozjetého obchodu.
  '/trade/aliance/fond/navrh': true,
  '/trade/aliance/fond/navrh/:id/hlas': false,
  // Provedení přijatého návrhu zastavujeme: vyhlašuje se tím veřejná
  // nabídka, a ta je nový závazek stejně jako hráčova.
  '/trade/aliance/fond/navrh/:id/provest': true,
  // Stažení vlastního návrhu je opak nového závazku — brzda ho nezastavuje.
  '/trade/aliance/fond/navrh/:id/zrusit': false,
  '/trade/dividenda': false,            // pravidlo vlastní firmy, ne nový závazek
  '/trade/pujcka/:id/splatit': false,
  '/trade/deliveries/claim': false,
  '/trade/konkurz': false,              // únikový východ se nezavírá
  '/trade/aukce/:id/koupit': true,
  '/trade/trh': true,
  '/trade/trh/:id/stahnout': false,
  '/trade/trh/:id/koupit': true,
  '/trade/drazba': true,
  '/trade/drazba/prihoz': true,
};

// Vzorek za :id. Čísla i textové klíče — aukce se nejmenují číslem.
const vzorek = (c) => c.replace(/:id/g, c.indexOf('/aukce/') >= 0 ? 'praha-1-max' : '12');

const zdroj = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game-trade.routes.js'), 'utf8');
const cesty = [];
zdroj.replace(/router\.post\(\s*'([^']+)'/g, (_, c) => { cesty.push(c); return _; });

ok('seznam cest se z obsluhy vyčetl', cesty.length > 10, 'nalezeno ' + cesty.length);

const nove = cesty.filter((c) => !(c in OCEKAVANI));
ok('žádná cesta burzy není nerozhodnutá', nove.length === 0,
  nove.length ? 'rozhodni o: ' + nove.join(', ') : '');
const zmizely = Object.keys(OCEKAVANI).filter((c) => cesty.indexOf(c) < 0);
ok('žádná hlídaná cesta z burzy nezmizela', zmizely.length === 0,
  zmizely.length ? 'už tam nejsou: ' + zmizely.join(', ') : '');

let sedi = 0;
cesty.forEach((c) => {
  if (!(c in OCEKAVANI)) return;
  const skutecnost = B.zastavit('POST', vzorek(c));
  if (skutecnost === OCEKAVANI[c]) { sedi++; return; }
  chyb++;
  console.log('CHYBA ' + c + ' · čekáno ' + (OCEKAVANI[c] ? 'zastavit' : 'pustit')
    + ', skutečnost ' + (skutecnost ? 'zastavit' : 'pustit'));
});
ok('každá cesta se chová, jak má', sedi === cesty.length, sedi + ' z ' + cesty.length);

// Čtení se nezastavuje nikdy — hráč musí vidět, co má rozjednané.
ok('GET brzda nezastavuje',
  !B.zastavit('GET', '/trade/offer') && !B.zastavit('GET', '/trade/drazba'));

// Zatažení se bere jen jako přesná jednička. Překlep ani „true" brzdu
// nezatáhne, aby se burza nezavřela omylem.
ok('brzda je zatažená jen na přesné jedničce',
  B.zataseno({ obchod_pozastaven: '1' }) === true
  && B.zataseno({ obchod_pozastaven: '0' }) === false
  && B.zataseno({ obchod_pozastaven: 'true' }) === false
  && B.zataseno({}) === false && B.zataseno(null) === false);

// Výchozí nastavení musí brzdu mít a mít ji puštěnou — jinak by se zapínala
// jen zápisem do databáze naslepo a po nasazení by nikdo nevěděl, že existuje.
const acct = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game-account.routes.js'), 'utf8');
ok('výchozí nastavení zná obchod_pozastaven a je puštěná',
  /obchod_pozastaven:\s*'0'/.test(acct));

console.log(chyb ? '\n' + chyb + ' chyb' : '\nvšechno sedí');
process.exit(chyb ? 1 : 0);
