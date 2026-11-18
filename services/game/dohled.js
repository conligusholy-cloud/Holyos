// =============================================================================
// Laundromat Tycoon — dohled: co by server odmítl, kdyby už odmítal
// =============================================================================
// Hra má dvě pojistky, které zatím jen měří: strop přírůstku hotovosti a
// povinný sklad při stavbě. Obě čekají na stejné rozhodnutí — jestli už smí
// doopravdy odmítat — a to rozhodnutí potřebuje čísla.
//
// Čísla se dala přečíst jen v administraci, do které se musí člověk
// přihlásit. To zní jako maličkost, ale v praxi to znamenalo, že se na ně
// za celou dobu nikdo nepodíval a oba vypínače zůstaly viset. Proto si je
// hra jednou denně napíše i do logu, kam se při nasazování stejně kouká.
//
// Oba přehledy jsou čtení, nic nemění a nic nezastavují. Když se nepovedou,
// jen se to poznamená.

'use strict';

const { prisma } = require('../../config/database');

const DEN_MS = 24 * 3600 * 1000;
const kc = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
const cas = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');

// ─── Strop přírůstku hotovosti ───────────────────────────────────────────────
// Otisky se ukládají při každém uložení hry, takže tenhle přehled má z čeho
// čerpat od chvíle, kdy strop vznikl.
async function stropPrehled(dnu) {
  const d = Math.max(1, Math.min(90, parseInt(dnu, 10) || 7));
  const od = new Date(Date.now() - d * 86400000);
  const [celkem, mimo, cekane] = await Promise.all([
    prisma.gameSnapshot.count({ where: { created_at: { gte: od } } }),
    prisma.gameSnapshot.findMany({
      where: { sedi: false, created_at: { gte: od } },
      orderBy: { created_at: 'desc' }, take: 300,
    }),
    // Druhý krok k pokladně: vedle skutečné změny hotovosti stojí ta, kterou
    // server čeká. Dokud se soustavně rozcházejí, není co stěhovat.
    prisma.gameSnapshot.findMany({
      where: { created_at: { gte: od }, ocekavano: { not: null }, od_ms: { gt: 60000 } },
      orderBy: { created_at: 'desc' }, take: 2000,
      select: { player_id: true, prirustek: true, ocekavano: true },
    }).catch(() => []),
  ]);
  // Jména pro obě sestavy najednou: hráč z porovnání čekané změny nemusí být
  // mezi těmi, kdo přetekli mez.
  const ids = Array.from(new Set(mimo.map((x) => x.player_id)));
  const vsechnyIds = Array.from(new Set(ids.concat(cekane.map((x) => x.player_id))));
  const hraci = vsechnyIds.length ? await prisma.gamePlayer.findMany({
    where: { id: { in: vsechnyIds } }, select: { id: true, nick: true } }) : [];
  const jmena = new Map(hraci.map((h) => [h.id, h.nick]));
  const poHraci = new Map();
  mimo.forEach((x) => {
    const a = poHraci.get(x.player_id) || { kolik: 0, max: 0 };
    a.kolik++;
    a.max = Math.max(a.max, (x.prirustek || 0) - (x.strop || 0));
    poHraci.set(x.player_id, a);
  });

  const out = [];
  out.push('STROP HOTOVOSTI · posledních ' + d + ' dnů · otisků ' + celkem
    + ' · mimo mez ' + mimo.length + ' · hráčů ' + ids.length);
  // Čekaná změna proti skutečné. Server nevidí do přípojek, poboček, čety
  // ani ceníku, takže čeká víc, než se opravdu stalo — zajímavý je opačný
  // směr: hráč, kterému hotovost roste rychleji, než se dá vysvětlit.
  if (cekane.length) {
    const nad = cekane.filter((x) => (x.prirustek || 0) > (x.ocekavano || 0) + 1000);
    const poHracich = new Map();
    nad.forEach((x) => poHracich.set(x.player_id,
      (poHracich.get(x.player_id) || 0) + ((x.prirustek || 0) - (x.ocekavano || 0))));
    out.push('');
    out.push('ČEKANÁ ZMĚNA PROTI SKUTEČNÉ · porovnaných uložení ' + cekane.length);
    out.push('  přibylo víc, než se dá vysvětlit: ' + nad.length
      + ' u ' + poHracich.size + ' hráčů');
    Array.from(poHracich.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([id, kolik]) => {
        out.push('    ' + String(jmena.get(id) || ('#' + id)).padEnd(20).slice(0, 20)
          + kc(kolik).padStart(16) + ' L$ navíc');
      });
    out.push('  Server nevidí do čety, karet z ceníku a oprav poruch, takže čeká');
    out.push('  víc, než se stane. Zajímavý je proto jen tenhle směr.');
  }
  // Přípojky: co naúčtovala hra proti tomu, co čekal server. Server počítá
  // horní odhad — čtyři slevy nevidí — takže se hra smí pohybovat pod ním.
  // Nad ním ne: tím by si hráč zvedl čekanou změnu a schoval pod ni hotovost.
  const prip = await prisma.gameSpotClaim.findMany({
    where: { pripojky: { not: null }, pripojky_srv: { not: null }, created_at: { gte: od } },
    select: { spot_id: true, nick: true, pripojky: true, pripojky_srv: true },
    take: 2000,
  }).catch(() => []);
  if (prip.length) {
    const nad = prip.filter((x) => x.pripojky > x.pripojky_srv + 1000);
    out.push('');
    out.push('PŘÍPOJKY · staveb se zapsanou cenou ' + prip.length
      + ' · hra si naúčtovala víc, než server čekal: ' + nad.length);
    nad.slice(0, 10).forEach((x) => {
      out.push('    ' + String(x.nick || '').padEnd(18).slice(0, 18)
        + String(x.spot_id).padEnd(26).slice(0, 26)
        + 'hra ' + kc(x.pripojky) + ' · server ' + kc(x.pripojky_srv));
    });
    if (!nad.length) {
      out.push('  Nic nad odhadem. Nižší čísla jsou v pořádku — četa, hotový plán,');
      out.push('  pronajatá plocha i karta na řemeslníka cenu snižují.');
    }
  }
  if (!mimo.length) {
    out.push('Žádné uložení mez nepřeteklo. To je buď dobře, nebo je mez moc');
    out.push('velkorysá — pozná se podle toho, až ji začneme utahovat.');
    return out.join('\n');
  }
  out.push('');
  out.push('hráč                 kolikrát      nejvíc nad mez');
  out.push('-'.repeat(52));
  Array.from(poHraci.entries())
    .sort((a, b) => b[1].kolik - a[1].kolik)
    .forEach(([id, a]) => {
      out.push(String(jmena.get(id) || ('#' + id)).padEnd(20).slice(0, 20)
        + String(a.kolik).padStart(10) + kc(a.max).padStart(20));
    });
  // Kolik přetečení si vysvětlí půjčka nebo doručenka a kolik ne. Utahovat
  // mez má smysl teprve tehdy, až druhé číslo pár dní zůstane na nule.
  const sDuvodem = mimo.filter((x) => (x.pujceno || 0) > 0 || (x.ze_serveru || 0) > 0).length;
  const bezUdaje = mimo.filter((x) => x.pujceno == null && x.ze_serveru == null).length;
  out.push('');
  out.push('z toho s nějakým serverovým důvodem (půjčka nebo doručenka): ' + sDuvodem
    + ' · bez něj: ' + (mimo.length - sDuvodem - bezUdaje)
    + (bezUdaje ? ' · starší otisky bez údaje: ' + bezUdaje : ''));
  out.push('');
  out.push('posledních 30 jednotlivě:');
  mimo.slice(0, 30).forEach((x) => {
    out.push('  ' + cas(x.created_at)
      + '  ' + String(jmena.get(x.player_id) || ('#' + x.player_id)).padEnd(16).slice(0, 16)
      + ' přidal ' + kc(x.prirustek).padStart(14)
      + ' · strop ' + kc(x.strop || 0).padStart(14)
      + ' · ' + x.pradlomatu + ' prádlomatů'
      + ' · za ' + Math.round((x.od_ms || 0) / 60000) + ' min'
      // Z čeho strop povolil, co povolil. Nula u obojího znamená, že na ten
      // skok nebyl žádný serverem známý důvod — a to je ten případ, kvůli
      // kterému se mez utahuje.
      + (x.pujceno == null && x.ze_serveru == null ? ''
        : ' · půjčeno ' + kc(x.pujceno || 0) + ', doručenky ' + kc(x.ze_serveru || 0)));
  });
  return out.join('\n');
}

// ─── Povinný sklad při stavbě ────────────────────────────────────────────────
// Rozhodující číslo není „kolikrát", ale „kolika hráčům, kteří mají nákupy
// zapsané". Kdo kupoval dřív, než se nákupy začaly ukládat, bude chybět
// vždycky a přepnutí se ho netýká — ten stroj mu doplnil dopočet.
async function skladChybi(dnu) {
  const d = Math.max(1, Math.min(90, parseInt(dnu, 10) || 7));
  const od = new Date(Date.now() - d * 86400000);
  const rows = await prisma.gameDohled.findMany({
    where: { druh: 'sklad', created_at: { gte: od } },
    orderBy: { created_at: 'desc' }, take: 500,
  });
  const ids = Array.from(new Set(rows.map((r) => r.player_id)));
  const [hraci, objednavky, vsechnyObj, claimy] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { id: { in: ids } }, select: { id: true, nick: true } }),
    prisma.gameOrder.groupBy({ by: ['player_id'], where: { player_id: { in: ids } },
      _count: { _all: true } }).catch(() => []),
    // Celá evidence nákupů těch hráčů. Samotný počet nákupů nic neříká —
    // teprve vedle počtu postavených míst je vidět, jestli stroje odněkud
    // přibývají, nebo jestli se jen nestihly zapsat.
    prisma.gameOrder.findMany({ where: { player_id: { in: ids } },
      select: { player_id: true, postaveno_at: true, zruseno_at: true, doplneno: true } }).catch(() => []),
    prisma.gameSpotClaim.findMany({ where: { player_id: { in: ids }, model: { not: '' } },
      select: { player_id: true } }).catch(() => []),
  ]);
  const jmena = new Map(hraci.map((h) => [h.id, h.nick]));
  const maObjednavky = new Map(objednavky.map((o) => [o.player_id, o._count._all]));
  const bilance = new Map();
  const dej = (id) => {
    let a = bilance.get(id);
    if (!a) { a = { mist: 0, nakupu: 0, doplnenych: 0, naSklade: 0 }; bilance.set(id, a); }
    return a;
  };
  claimy.forEach((c) => { dej(c.player_id).mist++; });
  vsechnyObj.forEach((o) => {
    const a = dej(o.player_id);
    if (o.zruseno_at) return;
    a.nakupu++;
    if (o.doplneno) a.doplnenych++;
    if (!o.postaveno_at) a.naSklade++;
  });
  const poHraci = new Map();
  rows.forEach((r) => {
    const a = poHraci.get(r.player_id) || { kolik: 0, posledni: r.created_at };
    a.kolik++;
    poHraci.set(r.player_id, a);
  });
  const sObjednavkami = ids.filter((id) => (maObjednavky.get(id) || 0) > 0);

  const out = [];
  out.push('POVINNÝ SKLAD · posledních ' + d + ' dnů · odmítnutí nanečisto '
    + rows.length + ' · hráčů ' + ids.length);
  out.push('Z toho hráčů se zapsanými nákupy: ' + sObjednavkami.length
    + (sObjednavkami.length ? '  ← tyhle by přepnutí odmítlo' : '  ← přepnout by šlo'));
  if (!rows.length) {
    out.push('Ani jednou. Buď od nasazení nikdo nestavěl stroj, který server');
    out.push('nezná, nebo evidence sedí. Pozor: eviduje se to teprve od');
    out.push('18. 11. 2026, takže pár dnů to znamená spíš „zatím nic nevíme".');
    return out.join('\n');
  }
  out.push('');
  out.push('hráč                 kolikrát   nákupů  z toho zpětně  míst  na skladě   naposledy');
  out.push('-'.repeat(94));
  Array.from(poHraci.entries())
    .sort((a, b) => b[1].kolik - a[1].kolik)
    .slice(0, 60)
    .forEach(([id, a]) => {
      const obj = maObjednavky.get(id) || 0;
      const b = bilance.get(id) || { mist: 0, doplnenych: 0, naSklade: 0 };
      out.push(String(jmena.get(id) || ('#' + id)).padEnd(20).slice(0, 20)
        + String(a.kolik).padStart(10) + String(obj).padStart(9)
        + String(b.doplnenych).padStart(15) + String(b.mist).padStart(6)
        + String(b.naSklade).padStart(11)
        + '   ' + cas(a.posledni)
        + (obj > 0 ? '   ← tohohle by se přepnutí dotklo' : ''));
    });
  out.push('');
  out.push('posledních 30 jednotlivě:');
  rows.slice(0, 30).forEach((r) => {
    out.push('  ' + cas(r.created_at)
      + '  ' + String(jmena.get(r.player_id) || ('#' + r.player_id)).padEnd(16).slice(0, 16)
      + '  ' + (r.detail || ''));
  });
  out.push('');
  out.push('Sloupec „míst" je počet postavených prádlomatů podle evidence míst,');
  out.push('„nákupů" počet nezrušených objednávek a „z toho zpětně" ty, které');
  out.push('nevznikly nákupem, ale dopočtem ze stavu hry. Je-li míst výrazně víc');
  out.push('než nákupů, berou se stroje odněkud, kam server nevidí.');
  out.push('');
  out.push('Přepnout sklad_povinny na 1 má smysl teprve tehdy, až je řádek');
  out.push('„hráčů se zapsanými nákupy" nula — jinak by hra odmítla někoho,');
  out.push('kdo si stroj poctivě koupil.');
  return out.join('\n');
}

// ─── Zisk: hra proti serveru ─────────────────────────────────────────────────
// Měřítko, podle kterého se pozná, jestli se dá serverovému počítání věřit.
// Zajímá nás rozptyl, ne průměr: když se devadesát hráčů shodne do procenta
// a tři se rozcházejí o polovinu, není to chyba vzorce, ale tři případy
// k prohlédnutí.
// Co ve stavu hry zabírá místo.
//
// Stav se posílá na server při každém uložení, tedy u aktivního hráče každých
// patnáct vteřin. U největších hráčů je to přes půl megabajtu — z telefonu
// a z mobilních dat. Strop je sice tři megabajty, takže zatím nic nepadá, ale
// než se začne cokoli zmenšovat, musí být vidět, co z toho ten objem dělá.
//
// Měří se velikost každé položky nejvyšší úrovně, jak ji vidí JSON — tedy
// přesně to, co jde po drátě.
async function stavRozpad(nick) {
  const kde = String(nick || '').trim()
    ? { nick: String(nick).trim() }
    : { disabled: false };
  const hraci = await prisma.gamePlayer.findMany({
    where: kde, select: { id: true, nick: true, state: true }, take: 400 });
  const s = hraci.map((h) => ({ h, velikost: h.state ? JSON.stringify(h.state).length : 0 }))
    .sort((a, b) => b.velikost - a.velikost);
  if (!s.length || !s[0].velikost) return 'Žádný uložený stav.';

  const out = [];
  out.push('CO VE STAVU HRY ZABÍRÁ MÍSTO');
  out.push('Stav jde na server při každém uložení — u aktivního hráče jednou za');
  out.push('patnáct vteřin. Strop je ' + Math.round(3000000 / 1024) + ' kB.');
  out.push('');
  const kb = (n) => (Math.round(n / 102.4) / 10).toFixed(1).padStart(8) + ' kB';
  s.slice(0, 5).forEach(({ h, velikost }) => {
    out.push(String(h.nick || ('#' + h.id)).padEnd(20).slice(0, 20) + kb(velikost));
    const st = h.state || {};
    Object.keys(st)
      .map((k) => ({ k, v: JSON.stringify(st[k] == null ? null : st[k]).length }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 6)
      .forEach((x) => {
        const podil = Math.round((x.v / velikost) * 100);
        out.push('    ' + String(x.k).padEnd(16).slice(0, 16) + kb(x.v)
          + String(podil + ' %').padStart(7)
          + (Array.isArray(st[x.k]) ? '   ' + st[x.k].length + ' položek'
            : (st[x.k] && typeof st[x.k] === 'object'
              ? '   ' + Object.keys(st[x.k]).length + ' klíčů' : '')));
      });
    out.push('');
  });
  out.push('Co z toho je kopie serverových dat (města, místa), se dá při');
  out.push('ukládání vynechat a po načtení si to hra stáhne znovu.');
  return out.join('\n');
}

// Sdílené odkazy: co o nich ví hra a co server.
//
// Přivedení hráči zvedají návštěvnost, a tou se násobí tržba celé sítě —
// jeden přivedený navíc je u malého hráče skoro desetina příjmu. Dokud se
// hotovost počítá v prohlížeči, je rozdíl jen v přehledu. Jakmile se přesune
// na server, bude to rozdíl v penězích: hráč, o jehož odkazu server neví,
// přijde o příjem a nepozná to — prostě mu bude vycházet míň.
//
// Rozcházet se to může dvěma způsoby a každý znamená něco jiného:
//   účet bez odkazu   hra počítá přivedené pod id, které si drží jen
//                     prohlížeč; server k účtu žádný odkaz navázaný nemá
//   jiný počet        odkaz navázaný je, ale čísla nesedí — obvykle proto,
//                     že prohlížeč má starý údaj a ještě si ho nestáhl
async function odkazyRozpor() {
  const NAV = require('./navstevnost');
  const [hraci, refy] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { disabled: false },
      select: { id: true, nick: true, ref_id: true, state: true } }),
    prisma.gameRef.findMany({ select: { ref_id: true }, take: 50000 }).catch(() => []),
  ]);
  const pocty = new Map();
  refy.forEach((r) => pocty.set(r.ref_id, (pocty.get(r.ref_id) || 0) + 1));

  const l = [];
  hraci.forEach((h) => {
    const st = h.state || {};
    const hra = Math.round(Number(st.refs) || 0);
    const srv = h.ref_id ? Math.min(NAV.REF_MAX, pocty.get(h.ref_id) || 0) : 0;
    if (hra === srv) return;
    // O kolik se tím liší návštěvnost, a tedy tržba celé jeho sítě.
    const spol = { boost: Number(st.boost) || 0,
      kampanAdd: (st.kampan && Number(st.kampan.add)) || 0, povest: Number(st.povest) || 0 };
    const ted = Date.now();
    const aHra = NAV.spocti(Object.assign({ refs: hra }, spol), ted);
    const aSrv = NAV.spocti(Object.assign({ refs: srv }, spol), ted);
    l.push({ nick: h.nick, maOdkaz: !!h.ref_id, hra, srv,
      pct: aHra ? ((aSrv - aHra) / aHra) * 100 : 0,
      pradlomatu: Array.isArray(st.units) ? st.units.length : 0 });
  });
  l.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  const out = [];
  out.push('SDÍLENÉ ODKAZY: HRA PROTI SERVERU · hráčů ' + hraci.length
    + ' · rozchází se ' + l.length);
  const bezOdkazu = l.filter((r) => !r.maOdkaz);
  out.push('  z toho účtů bez navázaného odkazu: ' + bezOdkazu.length
    + ' (tyhle server nikdy nedopočítá sám)');
  out.push('');
  if (!l.length) { out.push('Nic se nerozchází.'); return out.join('\n'); }
  out.push('nick                 odkaz   přivedení hra/server   návštěvnost  prádlomatů');
  out.push('-'.repeat(78));
  l.slice(0, 60).forEach((r) => {
    out.push(String(r.nick).padEnd(20).slice(0, 20)
      + (r.maOdkaz ? ' má   ' : ' CHYBÍ')
      + (r.hra + '/' + r.srv).padStart(14)
      + ((r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + ' %').padStart(14)
      + String(r.pradlomatu).padStart(12));
  });
  out.push('');
  out.push('Sloupec „návštěvnost" říká, o kolik by hráči klesl (nebo stoupl)');
  out.push('příjem celé sítě, kdyby se počítalo podle serveru. Dokud hotovost');
  out.push('žije v prohlížeči, je to rozdíl jen v přehledu.');
  return out.join('\n');
}

// Rozbor jednoho hráče: prádlomat po prádlomatu, hra vedle serveru.
//
// Souhrn výš řekne, že se čísla rozešla, ale ne proč. Tohle ukáže, u kterého
// stroje se rozcházejí a který vstup za to může — skóre, nájem, podíl na
// místě nebo chod. Jedno číslo vedle druhého; rozdíl bývá jen u jednoho
// stroje a hned je vidět, čím to je.
async function ziskRozbor(nick) {
  const EKO = require('./ekonomika');
  const NAV = require('./navstevnost');
  const POZEMKY = require('./pozemky');
  const jm = String(nick || '').trim();
  if (!jm) return 'Zadej nick: /zisk-rozbor?nick=...';
  const p = await prisma.gamePlayer.findFirst({ where: { nick: jm } });
  if (!p) return 'Hráče „' + jm + '" neznám.';
  const st = p.state || {};
  const units = Array.isArray(st.units) ? st.units : [];
  const claims = await prisma.gameSpotClaim.findMany({
    where: { player_id: p.id, model: { not: '' } },
    select: { spot_id: true, area_key: true, model: true, rent: true, pozemek: true, score: true },
  });

  const ted = new Date();
  const [eventy, oblasti] = await Promise.all([
    prisma.gameEvent.findMany({ where: { do: { gt: ted } }, take: 60 }).catch(() => []),
    prisma.gameArea.findMany({ where: { country: { not: null } },
      select: { key: true, country: true }, take: 1000 }).catch(() => []),
  ]);
  const udalosti = eventy.map((e) => ({
    dobra: e.dobra, dopad: e.dopad, do: e.do,
    mesta: e.uroven === 'svet' ? null
      : e.uroven === 'mesto' ? [e.area_key]
        : oblasti.filter((o) => o.country === e.zeme).map((o) => o.key),
  }));
  const nav = await NAV.proHrace(p, st);

  // Stav hry podle spotId, ať se dá k místu přiřadit, co o něm říká hra.
  const zHry = new Map();
  units.forEach((u) => { if (u && u.spotId) zHry.set(u.spotId, u); });

  const kc = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
  const out = [];
  out.push('ROZBOR ZISKU · ' + p.nick + ' (#' + p.id + ')');
  // Vstupy návštěvnosti vedle sebe. Rozdíl rozprostřený rovnoměrně přes
  // všechny stroje bývá právě tady — tržba se návštěvností násobí, takže
  // jeden přivedený hráč navíc posune celou síť o stejné procento.
  const kampanHry = st.kampan && Number(st.kampan.add) ? Number(st.kampan.add) : 0;
  const vstupyHry = { refs: Math.round(Number(st.refs) || 0), boost: Number(st.boost) || 0,
    kampanAdd: kampanHry, povest: Number(st.povest) || 0 };
  const navHry = NAV.spocti(vstupyHry, ted.getTime());
  // Zaokrouhlení na tři místa: boost vychází ze sčítání desetin a bez toho
  // se v přehledu objeví 0.44999999999999996 proti 0.45.
  const cis = (x) => (typeof x === 'number' ? String(Math.round(x * 1000) / 1000) : String(x));
  const par = (a, b) => cis(a) + '/' + cis(b);
  out.push('návštěvnost hra/server ' + navHry.toFixed(4) + '/' + nav.navstevnost.toFixed(4)
    + '  (' + (nav.navstevnost / (navHry || 1)).toFixed(4) + '×)');
  out.push('  vstupy hra/server · přivedení ' + par(vstupyHry.refs, nav.refs)
    + ' · boost ' + par(vstupyHry.boost, nav.boost)
    + ' · kampaň ' + par(vstupyHry.kampanAdd, nav.kampanAdd)
    + ' · pověst ' + par(vstupyHry.povest, nav.povest)
    + ' (' + (((nav.zdroje || {}).povest === 'server')
      ? 'pověst počítá server' : 'pověst zná jen hra') + ')');
  out.push('běžících událostí ' + eventy.length + ' · prádlomatů podle serveru '
    + claims.length + ', podle hry ' + units.length);
  // Stará uložená hra je nejčastější důvod rozdílu, který vypadá jako chyba:
  // hra počítala s konjunkturou a událostmi svého posledního tiknutí.
  const ulozeno = p.state_at ? new Date(p.state_at) : null;
  out.push('uloženo ' + (ulozeno ? ulozeno.toISOString().slice(0, 16).replace('T', ' ')
    + ' (před ' + Math.round((ted - ulozeno) / 60000) + ' minutami)' : 'neznámo'));
  out.push('');
  out.push('místo                     model  skóre   nájem     podíl chod'
    + '  událost hra/srv      hra      server    rozdíl');
  out.push('-'.repeat(120));

  let hraC = 0, srvC = 0;
  claims.forEach((c) => {
    const u = zHry.get(c.spot_id);
    const eco = (u && u.eco) || {};
    const presne = c.score != null;
    const score = presne ? c.score
      : EKO.skoreZNajmu(c.rent, 0.9 + POZEMKY.spotHash(c.spot_id, 'r') * 0.3);
    const podil = eco.podil == null ? 1 : Number(eco.podil);
    const chod = eco.chod == null ? 1 : Number(eco.chod);
    // Server počítá tak, jak počítá doopravdy — včetně podílu na místě,
    // aby bylo vidět, jestli rozdíl dělá vstup, nebo vzorec.
    const udSrv = EKO.udalostKoef(udalosti, c.area_key, claims.length, ted.getTime());
    const e = EKO.jedenStroj({ model: c.model, score: score || 0, rent: c.rent,
      pozemek: !!c.pozemek, podil, area_key: c.area_key },
    nav.navstevnost, { udalost: udSrv, chod });
    // Hra si svůj koeficient událostí ukládá ke stroji, takže se dá postavit
    // vedle serverového. Když se tyhle dva liší, není to ve vzorci.
    const udHra = eco.udalost == null ? null : Number(eco.udalost);
    const hra = Math.round(eco.profit || 0);
    hraC += hra; srvC += e.zisk;
    const rozdil = hra ? ((e.zisk - hra) / Math.abs(hra)) * 100 : 0;
    out.push(String(c.spot_id).padEnd(26).slice(0, 26)
      + String(c.model || '?').padEnd(7)
      + (String(Math.round(score)) + (presne ? '' : '~')).padStart(5)
      + kc(c.rent).padStart(8)
      + (c.pozemek ? ' vlastní' : '        ')
      + podil.toFixed(2).padStart(6) + chod.toFixed(2).padStart(5)
      + ((udHra == null ? '—' : udHra.toFixed(3)) + '/' + udSrv.navstevnost.toFixed(3)).padStart(15)
      + kc(hra).padStart(10) + kc(e.zisk).padStart(12)
      + ((rozdil >= 0 ? '+' : '') + rozdil.toFixed(1) + ' %').padStart(10));
  });
  // Co hra počítá na místech, o kterých server neví.
  const bezClaimu = units.filter((u) => u && u.spotId
    && !claims.some((c) => c.spot_id === u.spotId));
  bezClaimu.forEach((u) => {
    const hra = Math.round((u.eco && u.eco.profit) || 0);
    hraC += hra;
    out.push(String(u.spotId).padEnd(26).slice(0, 26) + '— server o tomhle místě neví —'.padEnd(32)
      + kc(hra).padStart(25) + '           —');
  });
  out.push('-'.repeat(120));
  out.push('celkem'.padEnd(73) + kc(hraC).padStart(10) + kc(srvC).padStart(12)
    + ((hraC ? (((srvC - hraC) / Math.abs(hraC)) * 100) : 0).toFixed(1) + ' %').padStart(10));
  out.push('');
  out.push('Podíl a chod se berou ze stavu hry — server je sám nezná. Vlnka');
  out.push('u skóre znamená, že ho server dopočítal z nájmu, místo aby ho měl.');
  out.push('Sloupec „událost" staví koeficient, se kterým počítala hra, vedle');
  out.push('serverového. Liší-li se, není chyba ve vzorci, ale ve vstupu — a');
  out.push('taky se tím pozná stará uložená hra: hra počítala s tím, co platilo');
  out.push('při jejím posledním tiknutí, server s tím, co platí teď.');
  return out.join('\n');
}

async function ziskSrovnani(dnu) {
  const d = Math.max(1, Math.min(90, parseInt(dnu, 10) || 7));
  const od = new Date(Date.now() - d * 86400000);
  const rows = await prisma.gameSnapshot.findMany({
    where: { created_at: { gte: od }, zisk_server: { not: null } },
    orderBy: { created_at: 'desc' }, take: 2000,
    select: { player_id: true, zisk_hra: true, zisk_server: true, zisk_presne: true,
      pradlomatu: true, created_at: true },
  });
  // Na hráče bereme jen jeho nejnovější otisk — jinak by aktivní hráči
  // převážili ty, co se dnes přihlásili jednou.
  const posledni = new Map();
  rows.forEach((r) => { if (!posledni.has(r.player_id)) posledni.set(r.player_id, r); });
  const l = Array.from(posledni.values());

  const ids = l.map((r) => r.player_id);
  const hraci = ids.length ? await prisma.gamePlayer.findMany({
    where: { id: { in: ids } }, select: { id: true, nick: true } }) : [];
  const jm = new Map(hraci.map((h) => [h.id, h.nick]));

  const sOdchylkou = l.map((r) => {
    const hra = Number(r.zisk_hra) || 0;
    const srv = Number(r.zisk_server) || 0;
    const zaklad = Math.max(Math.abs(hra), 1);
    return { nick: jm.get(r.player_id) || ('#' + r.player_id),
      hra, srv, pct: ((srv - hra) / zaklad) * 100,
      presne: r.zisk_presne || 0, pradlomatu: r.pradlomatu || 0 };
  }).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  const kc = (n) => Math.round(n).toLocaleString('cs-CZ');
  const out = [];
  out.push('ZISK: HRA PROTI SERVERU · posledních ' + d + ' dnů · hráčů ' + l.length);
  if (!l.length) {
    out.push('Zatím nic. Porovnání se zapisuje k otisku hry, tedy nanejvýš');
    out.push('jednou za deset minut na hráče — po nasazení chvíli trvá.');
    return out.join('\n');
  }
  const doPct = (x) => sOdchylkou.filter((r) => Math.abs(r.pct) <= x).length;
  out.push('  do 1 % od sebe:  ' + doPct(1) + ' hráčů');
  out.push('  do 5 %:          ' + doPct(5));
  out.push('  do 20 %:         ' + doPct(20));
  out.push('  přes 20 %:       ' + (l.length - doPct(20)) + '  \u2190 tyhle prohlédnout');
  out.push('');
  out.push('nick                 hra            server         rozdíl   přesně/prádl.');
  out.push('-'.repeat(78));
  sOdchylkou.slice(0, 40).forEach((r) => {
    out.push(String(r.nick).padEnd(20).slice(0, 20)
      + kc(r.hra).padStart(14) + kc(r.srv).padStart(15)
      + ((r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + ' %').padStart(10)
      + ('   ' + r.presne + '/' + r.pradlomatu).padStart(16));
  });
  out.push('');
  out.push('Obě čísla jsou jen za prádlomaty — pobočky, četa ani úvěry se');
  out.push('do nich nepočítají. Sloupec vpravo říká, kolik z těch prádlomatů');
  out.push('umí server ocenit přesně; u zbytku se skóre dopočítává z nájmu.');
  return out.join('\n');
}

// ─── Vlastnické změny ────────────────────────────────────────────────────────
// Odpověď na otázku, kterou dřív nešlo zodpovědět: kam se poděl kus firmy.
// Čte se to dvojím způsobem — co se dělo s firmou, a co se dělo s podílem
// jednoho hráče — proto obojí.
async function vlastnictvi(dnu, firmaId, hracId) {
  const d = Math.max(1, Math.min(90, parseInt(dnu, 10) || 7));
  const od = new Date(Date.now() - d * 86400000);
  const kde = { created_at: { gte: od } };
  if (firmaId) kde.firma_id = parseInt(firmaId, 10) || 0;
  if (hracId) kde.investor_id = parseInt(hracId, 10) || 0;
  const rows = await prisma.gameVlastnictvi.findMany({
    where: kde, orderBy: { created_at: 'desc' }, take: 200 });
  const ids = Array.from(new Set(rows.flatMap((r) => [r.firma_id, r.investor_id, r.protistrana_id])
    .filter(Boolean)));
  const hraci = ids.length ? await prisma.gamePlayer.findMany({
    where: { id: { in: ids } }, select: { id: true, nick: true, company: true } }) : [];
  const jm = new Map(hraci.map((h) => [h.id, h.company || h.nick]));
  const kdo = (id) => (id ? (jm.get(id) || ('#' + id)) : '\u2014');
  const pct = (x) => (Math.round((Number(x) || 0) * 1000) / 10).toFixed(1).replace('.', ',');

  const out = [];
  out.push('VLASTNICKÉ ZMĚNY · posledních ' + d + ' dnů · záznamů ' + rows.length
    + (firmaId ? ' · firma ' + kdo(parseInt(firmaId, 10)) : '')
    + (hracId ? ' · hráč ' + kdo(parseInt(hracId, 10)) : ''));
  if (!rows.length) {
    out.push('Nic. Buď se podíly nehýbaly, nebo se zápis nedaří — pozná se to');
    out.push('tak, že se jeden podíl prodá a číslo výš se zvedne.');
    return out.join('\n');
  }
  out.push('');
  out.push('kdy               firma            podílník          z      na    důvod');
  out.push('-'.repeat(78));
  rows.forEach((r) => {
    out.push(cas(r.created_at)
      + '  ' + String(kdo(r.firma_id)).padEnd(16).slice(0, 16)
      + ' ' + String(kdo(r.investor_id)).padEnd(17).slice(0, 17)
      + (pct(r.podil_pred) + ' %').padStart(7)
      + (pct(r.podil_po) + ' %').padStart(7)
      + '  ' + r.duvod
      + (r.protistrana_id ? ' \u00b7 ' + kdo(r.protistrana_id) : ''));
  });
  return out.join('\n');
}

// ─── Jak je co nastavené ─────────────────────────────────────────────────────
// Výchozí hodnota v kódu a skutečně platná hodnota jsou dvě různé věci:
// nastavení v databázi má přednost. Po každé změně výchozí hodnoty je proto
// potřeba vidět, co doopravdy platí — jinak se čeká na účinek, který
// přebitý řádek v databázi zrušil.
async function nastaveniPrehled() {
  const acct = require('../../routes/game-account.routes');
  const n = typeof acct._nastaveni === 'function' ? await acct._nastaveni() : {};
  const radek = (k) => k + ': ' + (n[k] == null ? '?' : n[k]);
  return 'NASTAVENÍ · ' + ['sklad_povinny', 'hodnosti_odmeny', 'hodnosti_zpetne', 'udalosti_zap']
    .map(radek).join(' · ');
}

// ─── Denní výpis do logu ─────────────────────────────────────────────────────
// Do administrace se musí člověk přihlásit; do logu při nasazování kouká
// stejně. Proto si to hra napíše sama.
async function doLogu() {
  // Skóre míst se doplňuje samo. Nová místa ho většinou dostanou rovnou při
  // zabrání, ale ne všechna — a každé místo bez skóre je prádlomat, který
  // server umí ocenit jen odhadem z nájmu. Spouštět to ručně znamená na to
  // zapomenout; přesně to je práce pro hlídku.
  try {
    const SROV = require('./srovnani');
    const v = await SROV.sitDoplnit({ ostro: true });
    if (v.doplneno || (v.nesedi && v.nesedi.length)) {
      console.log('[game-dohled] skóre doplněno k ' + v.doplneno + ' místům'
        + (v.nesedi && v.nesedi.length ? ', nesedělo u ' + v.nesedi.length : ''));
    }
  } catch (e) {
    console.warn('[game-dohled] doplnění skóre: ' + (e && e.message));
  }
  for (const [nazev, fn] of [['nastavení', nastaveniPrehled],
    ['strop', stropPrehled], ['sklad', skladChybi]]) {
    try {
      console.log('\n[game-dohled] ' + (await fn(7)) + '\n');
    } catch (e) {
      console.warn('[game-dohled] ' + nazev + ': ' + (e && e.message));
    }
  }
}

function start() {
  setTimeout(doLogu, 120000);     // po startu, až se usadí zbytek
  setInterval(doLogu, DEN_MS);
  console.log('[game-dohled] denní přehled pojistek běží');
}

module.exports = { start, doLogu, stropPrehled, skladChybi, nastaveniPrehled, ziskRozbor, odkazyRozpor, stavRozpad,
  vlastnictvi, ziskSrovnani };
