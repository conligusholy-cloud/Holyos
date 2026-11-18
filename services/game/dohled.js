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
  const [celkem, mimo] = await Promise.all([
    prisma.gameSnapshot.count({ where: { created_at: { gte: od } } }),
    prisma.gameSnapshot.findMany({
      where: { sedi: false, created_at: { gte: od } },
      orderBy: { created_at: 'desc' }, take: 300,
    }),
  ]);
  const ids = Array.from(new Set(mimo.map((x) => x.player_id)));
  const hraci = await prisma.gamePlayer.findMany({
    where: { id: { in: ids } }, select: { id: true, nick: true } });
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
  out.push('');
  out.push('posledních 30 jednotlivě:');
  mimo.slice(0, 30).forEach((x) => {
    out.push('  ' + cas(x.created_at)
      + '  ' + String(jmena.get(x.player_id) || ('#' + x.player_id)).padEnd(16).slice(0, 16)
      + ' přidal ' + kc(x.prirustek).padStart(14)
      + ' · strop ' + kc(x.strop || 0).padStart(14)
      + ' · ' + x.pradlomatu + ' prádlomatů'
      + ' · za ' + Math.round((x.od_ms || 0) / 60000) + ' min');
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
  const [hraci, objednavky] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { id: { in: ids } }, select: { id: true, nick: true } }),
    prisma.gameOrder.groupBy({ by: ['player_id'], where: { player_id: { in: ids } },
      _count: { _all: true } }).catch(() => []),
  ]);
  const jmena = new Map(hraci.map((h) => [h.id, h.nick]));
  const maObjednavky = new Map(objednavky.map((o) => [o.player_id, o._count._all]));
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
  out.push('hráč                 kolikrát   zapsaných nákupů   naposledy');
  out.push('-'.repeat(68));
  Array.from(poHraci.entries())
    .sort((a, b) => b[1].kolik - a[1].kolik)
    .slice(0, 60)
    .forEach(([id, a]) => {
      const obj = maObjednavky.get(id) || 0;
      out.push(String(jmena.get(id) || ('#' + id)).padEnd(20).slice(0, 20)
        + String(a.kolik).padStart(10) + String(obj).padStart(19)
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
  out.push('Přepnout sklad_povinny na 1 má smysl teprve tehdy, až je řádek');
  out.push('„hráčů se zapsanými nákupy" nula — jinak by hra odmítla někoho,');
  out.push('kdo si stroj poctivě koupil.');
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

module.exports = { start, doLogu, stropPrehled, skladChybi, nastaveniPrehled, vlastnictvi };
