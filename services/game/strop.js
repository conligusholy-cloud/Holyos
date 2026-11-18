// =============================================================================
// Laundromat Tycoon — strop přírůstku hotovosti
// =============================================================================
// Hra běží v prohlížeči a server zatím ukládá to, co mu přijde. U jednoho
// hráče samotného to nevadí — kdo si dopíše peníze, podvádí jen sám na sobě.
// Jakmile se ale za herní peníze kupují podíly ve firmách jiných hráčů,
// přestává to být neškodné: za vymyšlenou hotovost by šlo koupit něco, co
// někdo stavěl měsíc.
//
// Tohle je první krok k tomu, aby o penězích rozhodoval server. Není to
// výpočet zisku — je to hrubá mez, kterou poctivý hráč nemůže překročit:
//
//   za jeden herní měsíc nevydělá jeden prádlomat víc, než kolik je
//   kapacita stroje × nejvyšší myslitelná návštěvnost × cena praní,
//
// a to ještě bez odečtení energií, servisu a nájmu, které se ve skutečnosti
// platí. Kolik prádlomatů hráč má, ví server sám z GameSpotClaim — to je
// jediný údaj, který klient nemůže ovlivnit.
//
// K tomu se přičte všechno, co hráči poslal server (výplaty podílů, splátky,
// dárky, výhry v dražbě), protože to v těch strojích není, a pevná rezerva
// na drobné příjmy, které tu nemodelujeme.
//
// Zatím se jen loguje. Teprve až bude z provozu vidět, kolik to dělá planých
// poplachů, se z meze stane skutečný strop.

'use strict';

const { prisma } = require('../../config/database');

const MESIC_MS = 43200000;            // herní měsíc = 12 skutečných hodin

// Musí sedět s MODELS v public/compounder/game/game.js: kapacita je počet
// lidí denně, spend tržba na člověka v eurech, EUR kurz herní měny.
const EUR = 24.35;
const DNU_V_MESICI = 30.5;
const STROJE = {
  mini: { kapacita: 7.1, spend: 16.52 },
  flex: { kapacita: 14.3, spend: 11.33 },
  max: { kapacita: 20, spend: 11.33 },
};
// Nejvyšší návštěvnost, jaké jde ve hře dosáhnout, je 1,1 plus trvalé karty
// plus běžící kampaň. Dáváme 2,0 — dvojnásobek stropu — ať se mez nikdy
// netrefí do hráče, který má všechno a ještě má štěstí na konjunkturu.
const NAVSTEVNOST_STROP = 2.0;
// Drobné, které tu nemodelujeme: startovní hotovost, denní odměna, prodej
// stroje ze skladu, vratky. Radši velkoryse — tohle má chytat řádový nesmysl,
// ne optimalizaci.
const REZERVA = 3000000;

// Co nejvíc může jeden stroj vydělat za herní měsíc. Hrubá tržba, bez
// odečtení nákladů — strop má být nedosažitelný, ne přesný.
function stropStroje(model) {
  const m = STROJE[model] || STROJE.mini;
  return m.kapacita * NAVSTEVNOST_STROP * DNU_V_MESICI * m.spend * EUR;
}

// Strop za celou síť a daný čas. Prádlomaty bere ze serverové evidence míst,
// ne ze stavu hry.
function stropSite(claims, odMs) {
  const mesicu = Math.max(0, odMs) / MESIC_MS;
  let zaMesic = 0;
  (claims || []).forEach((c) => { zaMesic += stropStroje(c && c.model); });
  return zaMesic * mesicu;
}

// Kolik hráči poslal sám server. Doručenky jsou výplaty podílů, splátky
// půjček, dárky a výhry — hra si je připisuje na pokyn serveru, takže do
// stropu patří celé. Rozhoduje chvíle vyzvednutí, ne založení: peníze
// přistanou v hotovosti až tehdy, a doručenka může ležet i týden.
async function doruceno(playerId, od, do_) {
  try {
    const rows = await prisma.gameDelivery.findMany({
      where: { player_id: playerId, amount: { gt: 0 },
        claimed_at: { gte: new Date(od - 60000), lte: new Date(do_ + 60000) } },
      select: { amount: true },
    });
    return rows.reduce((a, r) => a + Math.max(0, Number(r.amount) || 0), 0);
  } catch (e) {
    // Doručenky nejsou podmínka: bez nich bude mez jen přísnější a nanejvýš
    // se něco zaloguje zbytečně. Zastavit kvůli tomu ukládání hry by bylo
    // mnohem horší.
    return 0;
  }
}

// Půjčené peníze nejsou vydělané. Hráč se sítí má velký úvěrový rámec a
// čerpá z něj miliony jedním klepnutím — strop počítaný z toho, co stihnou
// vydělat stroje, by na takovém hráči vyskočil pokaždé, a byl by to planý
// poplach. Rozpozná se to podle dluhu: půjčka zvedne hotovost i dluh
// o stejnou částku, vymyšlené peníze jen hotovost.
//
// Nadsadit si dluh, aby se pod ním schovala vymyšlená hotovost, jde — jenže
// dluh je ve hře skutečný: odečítá se od jmění, musí se splácet i s úrokem
// a při zmeškané splátce propadá zástava. Kdo si ho nafoukne, platí za to
// dvakrát.
function dluhu(st) { return Math.round(Number((st || {}).loan) || 0); }
function hotovosti(st) { return Math.round(Number((st || {}).cash) || 0); }

// Hlavní otázka: je skok hotovosti, který klient poslal, vůbec možný?
// Vrací popis, ne verdikt — rozhodnutí, co s tím, patří tomu, kdo volá.
async function prirustek(p, novyStav) {
  // Snese i holé číslo, aby starší volání nespadlo.
  const st = (novyStav && typeof novyStav === 'object') ? novyStav : { cash: novyStav };
  const stara = hotovosti(p.state);
  const nova = hotovosti(st);
  const rozdil = nova - stara;
  // Kolik z toho skoku je půjčka. Splátka dluh snižuje a hotovost taky,
  // takže se ze záporného rozdílu nesmí stát povolenka.
  const pujceno = Math.max(0, dluhu(st) - dluhu(p.state));
  const ted = Date.now();
  const naposledy = p.state_at ? new Date(p.state_at).getTime() : 0;
  // Bez předchozího uložení není co porovnávat — nový hráč, nebo první save
  // po obnovení účtu.
  if (!naposledy || rozdil <= 0) {
    return { sedi: true, rozdil, strop: null, od: 0 };
  }
  const od = Math.max(0, ted - naposledy);
  const claims = await prisma.gameSpotClaim.findMany({
    where: { player_id: p.id }, select: { model: true },
  });
  const zeStroju = stropSite(claims, od);
  const zeServeru = await doruceno(p.id, naposledy, ted);
  // Půjčka se přičítá do stropu, ne odečítá od přírůstku: v otisku pak
  // zůstane skutečný skok hotovosti a vedle něj mez, která ho vysvětluje.
  const strop = Math.round(zeStroju + zeServeru + REZERVA + pujceno);
  return {
    sedi: rozdil <= strop,
    rozdil, strop, od,
    pradlomatu: claims.length,
    ze_stroju: Math.round(zeStroju),
    ze_serveru: Math.round(zeServeru),
    pujceno,
  };
}

// Zápis do logu. Zvlášť, aby se dal v testu obejít a aby bylo na jednom
// místě vidět, co se o hráči zapisuje.
function zapis(p, v) {
  console.warn('[game-strop] hráč #' + p.id + ' (' + (p.nick || '?') + ') přidal '
    + v.rozdil + ' L$ za ' + Math.round(v.od / 60000) + ' min, strop byl ' + v.strop
    + ' (' + v.pradlomatu + ' prádlomatů, ze strojů ' + v.ze_stroju
    + ', ze serveru ' + v.ze_serveru + ', půjčeno ' + (v.pujceno || 0) + ')');
}

// ─── Zisk: hra proti serveru ─────────────────────────────────────────────────
// Server zná modely strojů, skóre míst, nájmy i návštěvnost, takže umí
// spočítat, kolik síti měsíčně zbude. Tahle funkce postaví obě čísla vedle
// sebe — nic nerozhoduje a nic neodmítá, jen měří.
//
// Porovnává se JEN zisk za prádlomaty. Pobočky, četa a úvěry se do něj
// nepočítají ani na jedné straně; kdyby ano, porovnávaly by se různé věci
// a rozdíl by neznamenal nic.
async function ziskSrovnani(p, st) {
  const EKO = require('./ekonomika');
  const NAV = require('./navstevnost');
  const POZEMKY = require('./pozemky');

  const claims = await prisma.gameSpotClaim.findMany({
    where: { player_id: p.id, model: { not: '' } },
    select: { spot_id: true, area_key: true, model: true, rent: true,
      pozemek: true, score: true },
  });
  if (!claims.length) return null;

  // Světové události vyhlašuje server, takže o nich ví sám — a dokud je
  // nezapočítával, vycházel mu zisk sítě výš než hře. Skládají se stejně
  // jako v herním výpočtu: celosvětová platí všude, zemní ve svých městech.
  const ted2 = new Date();
  const [eventy, oblasti] = await Promise.all([
    prisma.gameEvent.findMany({ where: { do: { gt: ted2 } }, take: 60 }).catch(() => []),
    prisma.gameArea.findMany({ where: { country: { not: null } },
      select: { key: true, country: true }, take: 1000 }).catch(() => []),
  ]);
  const udalosti = eventy.map((e) => ({
    dobra: e.dobra, dopad: e.dopad, do: e.do,
    mesta: e.uroven === 'svet' ? null
      : e.uroven === 'mesto' ? [e.area_key]
        : oblasti.filter((o) => o.country === e.zeme).map((o) => o.key),
  }));

  // Porouchaný stroj vydělává míň. Chod žije ve stavu hry — bereme ho odtud
  // a je to, stejně jako pověst, zbývající místo, kde se věří klientovi.
  const chody = new Map();
  // Druhý a třetí stroj na jednom pozemku si zákazníky nepřivede — dělí se o
  // ty, co tam chodí tak jako tak. Server o tom dělení neví: evidence míst má
  // na stroj jeden řádek a kolik z poptávky na něj připadá, drží jen hra.
  // Bez toho vycházel serverový zisk takovému hráči o třetinu výš.
  const podily = new Map();
  (Array.isArray(st && st.units) ? st.units : []).forEach((u) => {
    if (!u || !u.spotId || !u.eco) return;
    if (u.eco.chod != null) chody.set(u.spotId, Number(u.eco.chod));
    if (u.eco.podil != null) podily.set(u.spotId, Number(u.eco.podil));
  });

  // Kolik prádlomatů umí server ocenit přesně. Zbytku se skóre dopočítá
  // z nájmu, což je odhad — a je potřeba vědět, kolika se to týká.
  let presne = 0;
  const mista = claims.map((c) => {
    let score = c.score;
    if (score == null) {
      const deal = 0.9 + POZEMKY.spotHash(c.spot_id, 'r') * 0.3;
      score = EKO.skoreZNajmu(c.rent, deal);
    } else presne++;
    return { model: c.model, score: score || 0, rent: c.rent, pozemek: !!c.pozemek,
      area_key: c.area_key, chod: chody.has(c.spot_id) ? chody.get(c.spot_id) : 1,
      podil: podily.has(c.spot_id) ? podily.get(c.spot_id) : 1 };
  });

  const nav = await NAV.proHrace(p, st);
  const server = EKO.site(mista, nav.navstevnost, { udalosti, ted: ted2.getTime() }).zisk;
  // Totéž podle hry: součet zisků jednotlivých prádlomatů z uloženého stavu.
  const units = Array.isArray(st && st.units) ? st.units : [];
  const hra = units.reduce((a, u) => a + Math.round((u && u.eco && u.eco.profit) || 0), 0);
  return { hra, server: Math.round(server), presne };
}

// ─── Otisk hry v čase ────────────────────────────────────────────────────────
// Ukládaný stav si drží jen poslední podobu. Když se hráč zeptá, kam se
// podělo dvacet milionů, nemáme co otevřít — historie neexistuje. Otisk je
// nejlevnější historie, jaká dává smysl: pár čísel, ne celý stav.
//
// Zapisuje se nanejvýš jednou za deset minut na hráče, aby z toho nebyl
// řádek při každém uložení, ale vždycky, když přírůstek přeteče mez — právě
// ty řádky jsou k něčemu. Kdy se naposled zapsalo, si držíme v paměti:
// po restartu se jednou zapíše navíc, což nevadí.
const OTISK_ODSTUP = 10 * 60000;
const naposled = new Map();

async function otisk(p, st, v) {
  const ted = Date.now();
  const minule = naposled.get(p.id) || 0;
  if (v.sedi && ted - minule < OTISK_ODSTUP) return;
  naposled.set(p.id, ted);
  // Mapa by jinak rostla s každým hráčem, co kdy hrál. Když je velká,
  // vyhodíme z ní ty, co se dlouho neozvali — příště se jim zapíše otisk
  // navíc a nic se nestane.
  if (naposled.size > 5000) {
    naposled.forEach((kdy, id) => { if (ted - kdy > 6 * 3600000) naposled.delete(id); });
  }
  let jmeni = null;
  try {
    const acct = require('../../routes/game-account.routes');
    if (typeof acct._cisteJmeni === 'function') jmeni = Math.round(acct._cisteJmeni(st) || 0);
  } catch (e) { /* bez jmění to má pořád cenu */ }
  // Zisk podle hry a podle serveru vedle sebe. Počítá se jen tady, u otisku,
  // tedy nanejvýš jednou za deset minut na hráče — pro každé uložení by to
  // bylo pět dotazů navíc a nic by to nepřineslo.
  const zisk = await ziskSrovnani(p, st).catch(() => null);
  await prisma.gameSnapshot.create({ data: {
    player_id: p.id,
    hotovost: Math.round(Number(st && st.cash) || 0),
    jmeni,
    pradlomatu: v.pradlomatu != null ? v.pradlomatu
      : (Array.isArray(st && st.units) ? st.units.length : 0),
    prirustek: Math.round(v.rozdil || 0),
    strop: v.strop != null ? Math.round(v.strop) : null,
    sedi: !!v.sedi,
    od_ms: Math.min(2147483647, Math.max(0, Math.round(v.od || 0))),
    zisk_hra: zisk ? zisk.hra : null,
    zisk_server: zisk ? zisk.server : null,
    zisk_presne: zisk ? zisk.presne : null,
  } });
}

// Co se volá z ukládání hry. Nikdy nevyhodí výjimku a nikdy neblokuje —
// zatím jen měří a zapisuje otisk. Vrací true, když je přírůstek v mezích.
async function zkontroluj(p, st) {
  try {
    const v = await prirustek(p, st);
    if (!v.sedi) zapis(p, v);
    await otisk(p, st, v).catch((e) => console.warn('[game-otisk]', e && e.message));
    return v.sedi;
  } catch (e) {
    console.warn('[game-strop]', e && e.message);
    return true;
  }
}

module.exports = { zkontroluj, prirustek, otisk, stropStroje, stropSite,
  MESIC_MS, NAVSTEVNOST_STROP, REZERVA, STROJE, OTISK_ODSTUP };
