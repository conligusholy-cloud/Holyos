// HolyOS — předehřátí měst pro hru Laundromats Milionář.
//
// První hledání nového města trvá na OpenStreetMap i dvě minuty. Tenhle skript
// je projde dopředu, takže hráč dostane výsledek okamžitě. Výsledky končí
// v databázi (game_areas), takže platí i po nasazení nové verze.
//
// Spuštění z kořene projektu:
//   node scripts/warm-game-cities.js
//   node scripts/warm-game-cities.js https://pradlomaty.info
//
// Běží to dlouho (desítky minut) — klidně na pozadí, hra mezitím funguje.
const BASE = (process.argv[2] || 'https://pradlomaty.info').replace(/\/+$/, '');

const CITIES = [
  'Praha', 'Brno', 'Ostrava', 'Plzeň', 'Liberec', 'Olomouc', 'České Budějovice',
  'Hradec Králové', 'Ústí nad Labem', 'Pardubice', 'Zlín', 'Havířov', 'Kladno',
  'Most', 'Opava', 'Frýdek-Místek', 'Karviná', 'Jihlava', 'Teplice', 'Děčín',
  'Karlovy Vary', 'Chomutov', 'Jablonec nad Nisou', 'Mladá Boleslav', 'Prostějov',
  'Přerov', 'Česká Lípa', 'Třebíč', 'Třinec', 'Tábor', 'Znojmo', 'Příbram',
  'Cheb', 'Kolín', 'Trutnov', 'Kroměříž', 'Šumperk', 'Vsetín', 'Valašské Meziříčí',
  'Litvínov', 'Nový Jičín', 'Uherské Hradiště', 'Chrudim', 'Havlíčkův Brod',
  'Krnov', 'Litoměřice', 'Strakonice', 'Svitavy', 'Klatovy', 'Kutná Hora',
  'Náchod', 'Žďár nad Sázavou', 'Mělník', 'Beroun', 'Jindřichův Hradec',
  'Rychnov nad Kněžnou', 'Benešov', 'Pelhřimov', 'Písek', 'Sokolov',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT = 5 * 60e3;

async function warm(city) {
  const url = BASE + '/api/game/scout?q=' + encodeURIComponent(city);
  const started = Date.now();
  for (;;) {
    let r, j;
    try { r = await fetch(url, { cache: 'no-store' }); j = await r.json(); }
    catch (e) { return { city, ok: false, msg: 'síť: ' + e.message }; }
    if (r.status === 429) { await sleep(30000); continue; }
    if (!r.ok && r.status !== 202) return { city, ok: false, msg: j.error || ('chyba ' + r.status) };
    if (j && j.pending) {
      if (Date.now() - started > MAX_WAIT) return { city, ok: false, msg: 'trvá moc dlouho' };
      await sleep(4000); continue;
    }
    return { city, ok: true, spots: (j.spots || []).length, sec: Math.round((Date.now() - started) / 1000) };
  }
}

(async () => {
  console.log('Předehřívám ' + CITIES.length + ' měst přes ' + BASE + '\n');
  let hotovo = 0, chyb = 0;
  for (const c of CITIES) {
    const r = await warm(c);
    if (r.ok) { hotovo++; console.log('  ✓ ' + c.padEnd(24) + r.spots + ' míst · ' + r.sec + ' s'); }
    else { chyb++; console.log('  ✗ ' + c.padEnd(24) + r.msg); }
    await sleep(1500); // ať nenarazíme na limit
  }
  console.log('\nHotovo: ' + hotovo + ', neúspěšně: ' + chyb);
})();
