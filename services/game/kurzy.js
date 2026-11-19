// =============================================================================
// Laundromat Tycoon — kurzy měn z ČNB
// =============================================================================
// Ceny v ceníku jsou v haléřích a kdo hraje jinou řečí, platí v eurech,
// dolarech nebo zlotých. Přepočet dělá kurz, a ten se doteď bral z čísla,
// které jsem jednou odhadl a napsal do kódu. Zlotý byl o osm procent vedle,
// takže polští hráči rok platili míň, než měli — a nikdo se to nemohl
// dozvědět, protože se to nikde neporovnávalo se skutečností.
//
// Nastavení hry (kurz_eur, kurz_usd, kurz_pln) bylo postavené právě na tohle:
// kurz jde změnit bez nasazení. Jenže ručně ho nikdo nezmění, protože na to
// nikdo nemyslí. Proto si ho hra bere sama z ČNB, jednou denně.
//
// ČNB vydává denní kurz jako prostý text, zdarma a bez klíče:
//
//   30.12.2025 #250
//   země|měna|množství|kód|kurz
//   EMU|euro|1|EUR|24,430
//
// Na co si dát pozor a proč to má pojistky:
//
//   Množství není vždycky jedna. Forint se vydává po stu, takže kurz za
//   jednotku je hodnota dělená množstvím. Kdyby se to přehlédlo, byla by
//   cena stokrát vedle.
//
//   Desetinná čárka, ne tečka. Number('24,430') je NaN — a NaN, který
//   proklouzne do nastavení, zastaví platby úplně.
//
//   Rozbor se může rozbít tiše. Když ČNB změní formát, nevypadne chyba,
//   jen se přečtou nesmysly. Proto se zapisuje jen hodnota, která projde
//   rozumným rozsahem a neliší se od té dosavadní o víc než desetinu —
//   skutečný kurz se přes noc o desetinu nepohne, zato špatný rozbor ano.
//
// Když cokoli z toho selže, nezapíše se nic a jede se na posledním známém
// kurzu. Hra nikdy nestojí na tom, že je ČNB zrovna dostupná.

'use strict';

const { prisma } = require('../../config/database');
const J = require('./meny-jadro');

const URL_CNB = 'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/'
  + 'kurzy-devizoveho-trhu/denni_kurz.txt';
const DEN_MS = 24 * 3600 * 1000;
// O kolik nejvíc smí kurz za jedno čtení poskočit. Víc znamená spíš rozbitý
// rozbor než pohyb na trhu.
const MAX_SKOK = 0.1;
// Hranice, mimo které to zjevně není kurz koruny k ničemu, co hra účtuje.
const ROZSAH = { min: 0.5, max: 1000 };

// Rozbor textu z ČNB → { EUR: 24.43, USD: 22.182, … }. Čistá funkce, ať se
// dá otestovat bez sítě; to je ta část, která se může rozbít tiše.
function rozeber(text) {
  const out = {};
  String(text || '').split('\n').forEach((radek) => {
    const c = radek.split('|');
    if (c.length < 5) return;
    const mnozstvi = Number(String(c[2]).trim().replace(',', '.'));
    const kod = String(c[3]).trim().toUpperCase();
    const kurz = Number(String(c[4]).trim().replace(',', '.'));
    if (!/^[A-Z]{3}$/.test(kod)) return;
    if (!isFinite(mnozstvi) || mnozstvi <= 0) return;
    if (!isFinite(kurz) || kurz <= 0) return;
    out[kod] = kurz / mnozstvi;
  });
  return out;
}

// Smí se tímhle kurzem přepsat ten dosavadní? Vrací důvod odmítnutí,
// nebo null, když je všechno v pořádku.
function proc_ne(novy, stavajici) {
  if (!isFinite(novy) || novy <= 0) return 'není to číslo';
  if (novy < ROZSAH.min || novy > ROZSAH.max) return 'je mimo rozumný rozsah';
  if (isFinite(stavajici) && stavajici > 0) {
    const skok = Math.abs(novy - stavajici) / stavajici;
    if (skok > MAX_SKOK) {
      return 'skočil by o ' + Math.round(skok * 100) + ' % proti ' + stavajici;
    }
  }
  return null;
}

// Které měny hra účtuje a pod jakým klíčem si drží kurz.
function sledovane() {
  return Object.keys(J.MENY)
    .filter((k) => J.MENY[k].nastaveni)
    .map((k) => ({ kod: k, klic: J.MENY[k].nastaveni, iso: k.toUpperCase() }));
}

async function stahni() {
  const r = await fetch(URL_CNB, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('ČNB odpověděla ' + r.status);
  return r.text();
}

// Jedno kolo: stáhnout, rozebrat, zapsat jen to, co projde pojistkami.
// Vrací přehled, ať se dá totéž spustit ručně z admina a vidět výsledek.
async function zapisKdy(datum) {
  const zapis = async (klic, hodnota) => prisma.gameSetting.upsert({
    where: { klic }, update: { hodnota }, create: { klic, hodnota } });
  await zapis(KLIC_KDY, new Date().toISOString());
  await zapis(KLIC_DEN, String(datum || '').slice(0, 60));
}

// Jak dlouho smí být kurz starý, než je to podezřelé. ČNB vydává jen
// v pracovní dny, takže přes Vánoce nebo dlouhý víkend je pauza normální;
// čtyři dny už normální nejsou.
const STARY_PO_DNECH = 4;

// Stav pro přehled v administraci. Vrací popis, ne verdikt.
async function stav() {
  const row = async (klic) => (await prisma.gameSetting.findUnique({ where: { klic } })
    .catch(() => null));
  const kdy = await row(KLIC_KDY);
  const den = await row(KLIC_DEN);
  if (!kdy) return { kdy: null, den: null, stary: true, dnu: null };
  const ms = Date.now() - new Date(kdy.hodnota).getTime();
  const dnu = ms / 86400000;
  return { kdy: kdy.hodnota, den: den ? den.hodnota : null,
    dnu: Math.round(dnu * 10) / 10, stary: dnu > STARY_PO_DNECH };
}

// Kdy se naposled povedlo stáhnout a z jakého dne ČNB to bylo. Bez toho
// nejde poznat tichý výpadek: když se rozbor rozbije nebo ČNB změní formát,
// nevypadne chyba — jen se jede dál na starém kurzu a ceny v cizí měně se
// pomalu rozcházejí se skutečností. Tohle je to jediné, podle čeho se to
// pozná zvenčí.
const KLIC_KDY = 'kurzy_stazeno_at';
const KLIC_DEN = 'kurzy_stazeno_den';

async function obnov(stahovac) {
  const text = await (stahovac || stahni)();
  const kurzy = rozeber(text);
  const prehled = { zmeneno: [], ponechano: [], datum: String(text || '').split('\n')[0] || '' };

  for (const m of sledovane()) {
    const novy = kurzy[m.iso];
    if (!isFinite(novy)) {
      prehled.ponechano.push({ kod: m.kod, proc: 'ČNB ho dnes neposlala' });
      continue;
    }
    const row = await prisma.gameSetting.findUnique({ where: { klic: m.klic } }).catch(() => null);
    const stavajici = row ? Number(row.hodnota) : (J.KURZY_VYCHOZI[m.kod] || 0);
    const ne = proc_ne(novy, stavajici);
    if (ne) {
      prehled.ponechano.push({ kod: m.kod, proc: ne, novy });
      console.warn('[game-kurzy] ' + m.kod + ' nezapsán: ' + ne);
      continue;
    }
    // Zaokrouhlení na tři desetinná místa: víc než ČNB sama vydává nemá smysl.
    const hodnota = String(Math.round(novy * 1000) / 1000);
    if (row && row.hodnota === hodnota) continue;
    await prisma.gameSetting.upsert({
      where: { klic: m.klic },
      update: { hodnota },
      create: { klic: m.klic, hodnota },
    });
    prehled.zmeneno.push({ kod: m.kod, z: stavajici, na: Number(hodnota) });
  }
  if (prehled.zmeneno.length) {
    require('./meny').zapomen();
    console.log('[game-kurzy] ' + prehled.zmeneno
      .map((z) => z.kod + ' ' + z.z + ' → ' + z.na).join(', '));
  }
  // Zapisuje se i tehdy, když se žádný kurz nezměnil: podstatné je, že ČNB
  // odpověděla a text se dal přečíst. Kurz, který se den nepohnul, je
  // v pořádku; kurz, který se nestáhl, není.
  await zapisKdy(prehled.datum).catch(() => {});
  return prehled;
}

let bezi = false;
async function tik() {
  if (bezi) return;
  bezi = true;
  try { await obnov(); } catch (e) {
    // Nedostupná ČNB není důvod cokoli měnit. Jede se na posledním kurzu.
    console.warn('[game-kurzy] ' + e.message + ' — jede se na posledním známém kurzu');
  } finally { bezi = false; }
}

function start() {
  setTimeout(tik, 40000);     // po startu chvíli počkáme, ať naběhne zbytek
  setInterval(tik, DEN_MS);
  console.log('[game-kurzy] denní kurzy z ČNB běží');
}

module.exports = { start, tik, obnov, rozeber, proc_ne, sledovane, stav, STARY_PO_DNECH,
  URL_CNB, MAX_SKOK, ROZSAH };
