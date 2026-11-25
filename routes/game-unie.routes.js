// =============================================================================
// Laundromat Tycoon — Unie prádlomatů: území, licence, servisní tok
// =============================================================================
// Pozdní hra pro velké hráče. Pravidla, ceny a vyúčtování drží
// services/game/unie.js; tady je jen obsluha požadavků.
//
// Peníze: hotovost žije v prohlížeči, stejně jako u zbytku hry. Co hráč
// zaplatí, strhne si hra u sebe a server to zapíše mezi výdaje (VYD.zapis);
// co hráč dostane, pošle server jako doručenku (GameDelivery).
//
// Všechno je zamčené uzavřeným testem (nastavení game.unie_povoleni) —
// dokud hráč není v Unii, vidí jen 403.
'use strict';

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const acct = require('./game-account.routes');
const requirePlayer = acct._requirePlayer;
const unieSmi = acct._unieSmi;
const stx = acct._stx;
const VYD = require('../services/game/vydaje');
const UNIE = require('../services/game/unie');
const OKRESY = require('../services/game/okresy');
const UNIE_OKRESY = OKRESY;
const stavu = (p) => (p && p.state) || {};

router.use(express.json({ limit: '32kb' }));

const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Brána uzavřeného testu. Sedí před každým požadavkem téhle sekce.
async function jenUnie(req, res, next) {
  try {
    if (!(await unieSmi(req.player.id))) {
      return res.status(403).json({ error: stx(req)('server.unie_zatim_nedostupna') });
    }
    next();
  } catch (e) { next(e); }
}

// ─── Přehled ─────────────────────────────────────────────────────────────────
// Jedno volání, ze kterého se poskládá celá obrazovka Unie: jakou mám roli,
// co držím, kde bych mohl začít a kdo mě vyzývá. Při té příležitosti se
// dopočítá, co se za uplynulé herní měsíce mělo stát — nic neběží na pozadí.
router.get('/unie/prehled', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const me = req.player;
    // Území z doby, kdy se vázala na město, se převedou na okres. Běží to na
    // pozadí: převod sahá na cizí službu a přehled na ni čekat nesmí.
    OKRESY.prevodNaPozadi();
    const nast = await UNIE.nastaveni();
    const moje_role = await UNIE.role(me.id);

    // Okresy, kde mám prádlomaty — jen o ty se můžu ucházet. Zábor nese
    // město, okres se k němu dohledá (a při prvním dotazu i uloží).
    const zabory = await prisma.gameSpotClaim.findMany({
      where: { player_id: me.id, model: { not: '' } }, select: { area_key: true },
    });
    const okresy = await OKRESY.proKlice([...new Set(zabory.map((z) => z.area_key))]);
    const mojeOkresy = [...new Set([...okresy.values()].map((o) => o.key))];

    // Území, která se mě týkají: moje, moje licence, a ta v mých okresech.
    const licence = await prisma.gameOperatorLicence.findMany({
      where: { player_id: me.id, zrusena: false },
    });
    const klice = [...new Set(mojeOkresy.concat(licence.map((l) => l.okres_key)))];
    let uzemi = await prisma.gameTerritory.findMany({
      where: { OR: [{ master_id: me.id }, { okres_key: { in: klice } }, { vyzyvatel_id: me.id }] },
    });

    // Doběhlé výzvy a nevyúčtované měsíce — líně, až se někdo podívá.
    const hotovo = [];
    for (const t of uzemi) {
      const po = await UNIE.vyhodnotVyzvu(t);
      await UNIE.vyuctujUzemi(po, nast);
      hotovo.push(await prisma.gameTerritory.findUnique({ where: { id: po.id } }));
    }
    uzemi = hotovo.filter(Boolean);

    const pub = [];
    for (const t of uzemi) pub.push(await UNIE.uzemiPub(t, me.id, nast));

    // Moje místa v území. Master je potřebuje vidět pohromadě: tohle je
    // sklad, ze kterého nabízí na Market place, a bez něj by musel hledat
    // po mapě, co v okrese vlastně má a co na tom je hotové.
    for (const u of pub) {
      if (!u.moje) continue;
      const mesta = await OKRESY.oblasti(u.okres_key);
      if (!mesta.length) { u.mista = []; continue; }
      const [claims, nabidky, nazvy] = await Promise.all([
        prisma.gameSpotClaim.findMany({
          where: { player_id: me.id, area_key: { in: mesta } },
          orderBy: { id: 'asc' }, take: 60,
        }),
        prisma.gameMarket.findMany({
          where: { player_id: me.id, koupil_id: null, zruseno_at: null, do: { gt: new Date() } },
          select: { spot_id: true } }).catch(() => []),
        prisma.gameArea.findMany({ where: { key: { in: mesta } },
          select: { key: true, name: true } }).catch(() => []),
      ]);
      const visi = new Set(nabidky.map((n) => n.spot_id));
      const mesto = new Map(nazvy.map((a) => [a.key, a.name]));
      u.mista = claims.map((c) => ({
        spot_id: c.spot_id, nazev: c.name || c.spot_id,
        mesto: mesto.get(c.area_key) || c.area_key,
        // Co na místě je hotové: koupená zem, natažené přípojky, stojící stroj.
        pozemek: !!c.pozemek, pozemek_cena: Math.max(0, Math.round(c.cena || 0)),
        pripojky: Math.max(0, Math.round(c.pripojky || 0)),
        model: c.model || '', score: c.score == null ? null : c.score,
        rent: Math.max(0, Math.round(c.rent || 0)),
        na_marketu: visi.has(c.spot_id),
      }));
    }

    // Volné oblasti, kde mám prádlomaty: co by stálo je převzít.
    const obsazene = new Set(uzemi.map((t) => t.okres_key));
    const volne = [];
    for (const k of mojeOkresy) {
      if (obsazene.has(k)) continue;
      volne.push(await UNIE.potencial(k));
    }

    res.json({ ok: true, role: moje_role, nastaveni: {
      poplatek_min: nast.poplatek_min, poplatek_max: nast.poplatek_max,
      vyzva_prah: nast.vyzva_prah, vyzva_mesicu: nast.vyzva_mesicu,
      vyzva_priplatek_pct: nast.vyzva_priplatek_pct, odvod_pct: nast.odvod_pct,
    }, uzemi: pub, volne, licence: licence.map((l) => {
      // Co licence operátorovi nese, spočítalo už uzemiPub toho území.
      const u = pub.filter((x) => x.okres_key === l.okres_key)[0] || {};
      return { okres_key: l.okres_key, nazev: u.nazev || l.okres_key, cena: l.cena,
        podil_pct: l.podil_pct, od: l.od, do_kdy: l.do_kdy,
        prijem_mesic: u.operator_prijem || 0, stroju: u.stroju || 0, cizich: u.cizich || 0 };
    }) });
  } catch (e) { next(e); }
});

// ─── Území na mapě ───────────────────────────────────────────────────────────
// Lehký seznam pro vrstvu na mapě: kde území leží, kdo ho drží a jestli je
// moje. Žádné vyúčtování se tu nepočítá — mapa se překresluje často.
router.get('/unie/mapa', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    OKRESY.prevodNaPozadi();
    const uzemi = await prisma.gameTerritory.findMany({
      select: { okres_key: true, master_id: true, master_nick: true, poplatek_pct: true, nespokojenost: true },
    });
    if (!uzemi.length) return res.json({ ok: true, uzemi: [] });
    // Hranice území. Buňka se počítá, takže chybějící řádek se rovnou založí —
    // nic se nestahuje a na nic se nečeká. Kruh kolem středu už mapa kreslí
    // jen u území, které se ještě nepřevedlo ze starého okresu.
    const klice = uzemi.map((t) => t.okres_key);
    let okresy = await prisma.gameOkres.findMany({ where: { key: { in: klice } } }).catch(() => []);
    const chybi = klice.filter((k) => {
      const mam = okresy.find((o) => o.key === k);
      return !mam || !Array.isArray(mam.hranice) || mam.hranice.length < 4;
    });
    if (chybi.length) {
      for (const k of chybi) await OKRESY.zajisti(k, null, null).catch(() => {});
      okresy = await prisma.gameOkres.findMany({ where: { key: { in: klice } } }).catch(() => []);
    }
    const mapa = {};
    okresy.forEach((o) => { mapa[o.key] = o; });
    // Nespokojenost se počítá, ne čte: uložená hodnota se posouvá až při
    // vyúčtování, takže čerstvě koupené území by hlásilo nulu.
    const nast = await UNIE.nastaveni();
    res.json({ ok: true, uzemi: uzemi.map((t) => {
      const o = mapa[t.okres_key] || {};
      return { okres_key: t.okres_key, nazev: o.nazev || t.okres_key, lat: o.lat, lon: o.lon,
        hranice: Array.isArray(o.hranice) ? o.hranice : null,
        master_nick: t.master_nick, moje: t.master_id === req.player.id,
        poplatek_pct: t.poplatek_pct, nespokojenost: UNIE.nespokojenostZ(t.poplatek_pct, nast) };
    }).filter((t) => t.lat != null || t.hranice) });
  } catch (e) { next(e); }
});

// ─── Sousedé: o co jde území rozšířit ────────────────────────────────────────
// Vrací okresy vedle mých území i s cenou licence a s tím, jestli tam mám
// pobočku. Hledání sousedů je drahé (dotaz na každý směr), takže první
// otevření chvíli trvá; podruhé už se čte z databáze.
router.get('/unie/sousedi', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const me = req.player;
    const moje = await prisma.gameTerritory.findMany({ where: { master_id: me.id },
      select: { okres_key: true } });
    if (!moje.length) return res.json({ ok: true, sousedi: [] });
    const mam = new Set(moje.map((t) => t.okres_key));
    const klice = new Set();
    for (const t of moje) {
      (await UNIE_OKRESY.sousedi(t.okres_key).catch(() => [])).forEach((k) => {
        if (!mam.has(k)) klice.add(k);
      });
    }
    if (!klice.size) return res.json({ ok: true, sousedi: [] });
    const [uzemi, okresy] = await Promise.all([
      prisma.gameTerritory.findMany({ where: { okres_key: { in: [...klice] } },
        select: { okres_key: true, master_nick: true } }),
      prisma.gameOkres.findMany({ where: { key: { in: [...klice] } } }),
    ]);
    const drzi = new Map(uzemi.map((t) => [t.okres_key, t.master_nick]));
    const st = stavu(me);
    const out = [];
    for (const o of okresy) {
      const pot = await UNIE.potencial(o.key);
      // Pobočka v okrese: území si smíš vzít tam, kam dosáhneš servisem.
      // Jinak by šlo skoupit půl republiky od stolu.
      const mesta = await prisma.gameArea.findMany({ where: { okres_key: o.key },
        select: { name: true, lat: true, lon: true } }).catch(() => []);
      let pobocka = null;
      for (const m of mesta) {
        const p = pobockaVOkrese(st, m);
        if (p) { pobocka = p; break; }
      }
      out.push({ okres_key: o.key, nazev: o.nazev, lat: o.lat, lon: o.lon,
        hranice: Array.isArray(o.hranice) ? o.hranice : null,
        drzi: drzi.get(o.key) || null,
        licence: pot.licence, volnych: pot.volnych, mist: pot.mist, skore: pot.skore,
        zavazek: pot.zavazek, obyvatel: pot.obyvatel || null, mest: pot.mest,
        pobocka: pobocka ? String(pobocka.name || '') : null });
    }
    res.json({ ok: true, sousedi: out });
  } catch (e) { next(e); }
});

// Pobočka v okrese. Pobočky žijí ve stavu hry jako jméno města a souřadnice,
// takže se berou obě cesty: shodné jméno, nebo pobočka do osmi kilometrů od
// města okresu. Sídlo je taky pobočka — je to první základna.
function pobockaVOkrese(st, mesto) {
  const pob = (Array.isArray(st && st.pobocky) ? st.pobocky.slice() : []);
  if (st && st.sidlo) pob.push(st.sidlo);
  const jmeno = String((mesto && mesto.name) || '').trim().toLowerCase();
  const km = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return Infinity;
    const r = Math.PI / 180, R = 6371;
    const dx = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r);
    const dy = (b.lat - a.lat) * r;
    return Math.sqrt(dx * dx + dy * dy) * R;
  };
  for (const b of pob) {
    if (!b) continue;
    if (jmeno && String(b.name || '').trim().toLowerCase() === jmeno) return b;
    if (km(b, mesto) <= 8) return b;
  }
  return null;
}

// ─── Převzetí volného území ──────────────────────────────────────────────────
router.post('/unie/uzemi/prevzit', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const me = req.player;
    const area = s((req.body || {}).okres_key || (req.body || {}).area_key, 80);
    const r = await UNIE.role(me.id);
    if (!r.master) return res.status(403).json({ error: stx(req)('server.unie_jen_pro_mastera') });
    const pot = await UNIE.potencial(area);
    if (!pot.mist) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    const uz = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (uz) return res.status(409).json({ error: stx(req)('server.unie_uzemi_uz_ma_mastera') });
    // Území si smíš vzít tam, kam dosáhneš: kde už máš prádlomat, nebo kde
    // máš pobočku či sídlo. Bez toho by šlo skoupit půl republiky od stolu
    // a servis by v těch okresech neměl kdo dělat.
    const mamStroje = await prisma.gameSpotClaim.count({
      where: { player_id: me.id, model: { not: '' },
        area_key: { in: await OKRESY.oblasti(area) } } }).catch(() => 0);
    if (!mamStroje) {
      const mesta = await prisma.gameArea.findMany({ where: { okres_key: area },
        select: { name: true, lat: true, lon: true } }).catch(() => []);
      const st = stavu(me);
      const ma = mesta.some((m) => !!pobockaVOkrese(st, m));
      if (!ma) return res.status(409).json({ error: stx(req)('server.unie_bez_pobocky') });
    }
    const stroju = await UNIE.pocetVOkrese(area);
    const t = await prisma.gameTerritory.create({ data: {
      okres_key: area, master_id: me.id, master_nick: me.nick,
      licence: pot.licence, licence_do: new Date(Date.now() + UNIE.MESIC_MS),
      zavazek: pot.zavazek, zavazek_od: new Date(), zavazek_start: stroju,
      servis_do: new Date(),
    } });
    await VYD.zapis(me.id, 'unie_licence', pot.licence, null, { okres_key: area, prevzeti: true });
    console.log('[game] unie — území', area, 'přebírá', me.nick, 'za', pot.licence, 'L$');
    res.json({ ok: true, zaplaceno: pot.licence, uzemi: await UNIE.uzemiPub(t, me.id) });
  } catch (e) { next(e); }
});

// ─── Výše poplatku v pásmu ───────────────────────────────────────────────────
router.post('/unie/uzemi/poplatek', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const b = req.body || {};
    const area = s(b.okres_key || b.area_key, 80);
    const pct = Math.round(Number(b.pct) || 0);
    const nast = await UNIE.nastaveni();
    const t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    if (pct < nast.poplatek_min || pct > nast.poplatek_max) {
      return res.status(400).json({ error: stx(req)('server.unie_poplatek_mimo_pasmo') });
    }
    // Nejdřív doúčtovat za staré sazby, teprve pak měnit.
    await UNIE.vyuctujUzemi(t, nast);
    const upd = await prisma.gameTerritory.update({ where: { id: t.id },
      data: { poplatek_pct: pct, nespokojenost: UNIE.nespokojenostZ(pct, nast) } });
    res.json({ ok: true, uzemi: await UNIE.uzemiPub(upd, req.player.id, nast) });
  } catch (e) { next(e); }
});

// ─── Doplacení licence ───────────────────────────────────────────────────────
// Licence se platí opakovaně — nerozvíjené území krvácí. Platí se vždy
// na jeden herní měsíc dopředu, od toho, co je pozdější: dneška nebo konce
// zaplaceného období.
router.post('/unie/uzemi/licence', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const area = s((req.body || {}).okres_key || (req.body || {}).area_key, 80);
    const t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    const od = Math.max(Date.now(), new Date(t.licence_do).getTime());
    const upd = await prisma.gameTerritory.update({ where: { id: t.id },
      data: { licence_do: new Date(od + UNIE.MESIC_MS) } });
    await VYD.zapis(req.player.id, 'unie_licence', t.licence, null, { okres_key: area });
    res.json({ ok: true, zaplaceno: t.licence, uzemi: await UNIE.uzemiPub(upd, req.player.id) });
  } catch (e) { next(e); }
});

// ─── Výzva přeplacením ───────────────────────────────────────────────────────
// Stejná mechanika jako u míst: vyzyvatel nabídne víc a běží lhůta, po kterou
// území ještě vydělává dosavadnímu masterovi. Vyzvat jde jen území, které si
// o to říká — vysokým poplatkem, nesplněným závazkem nebo dluhem na licenci.
router.post('/unie/uzemi/vyzva', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const b = req.body || {};
    const area = s(b.okres_key || b.area_key, 80);
    const cena = Math.max(0, Math.round(Number(b.cena) || 0));
    const me = req.player;
    const nast = await UNIE.nastaveni();
    const r = await UNIE.role(me.id);
    if (!r.master) return res.status(403).json({ error: stx(req)('server.unie_jen_pro_mastera') });
    let t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (!t) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    if (t.master_id === me.id) return res.status(409).json({ error: stx(req)('server.unie_vlastni_uzemi') });
    t = await UNIE.vyhodnotVyzvu(t);
    if (t.vyzyvatel_id) return res.status(409).json({ error: stx(req)('server.unie_vyzva_uz_bezi') });
    const pridano = await UNIE.pridanoOdPrevzeti(t);
    if (!UNIE.duvodVyzvy(t, nast, pridano)) {
      return res.status(409).json({ error: stx(req)('server.unie_zatim_nejde_vyzvat') });
    }
    const minimum = Math.round(t.licence * (1 + nast.vyzva_priplatek_pct / 100));
    if (cena < minimum) return res.status(400).json({ error: stx(req)('server.unie_vyzva_malo'), minimum });
    const upd = await prisma.gameTerritory.update({ where: { id: t.id }, data: {
      vyzyvatel_id: me.id, vyzyvatel_nick: me.nick, vyzyvatel_cena: cena,
      vyzva_do: new Date(Date.now() + nast.vyzva_mesicu * UNIE.MESIC_MS),
    } });
    await prisma.gameDelivery.create({ data: {
      player_id: t.master_id, kind: 'zprava', spot_id: 'unie:vyzva:nova:' + t.id,
      text_kod: 'dor.unie_vyzva', text_data: { p1: area, p2: me.nick, penize: cena },
      popis: 'O tvoje území ' + area + ' se uchází ' + me.nick + ' za ' + cena.toLocaleString('cs-CZ') + ' L$',
    } }).catch(() => {});
    console.log('[game] unie — výzva o území', area, 'od', me.nick, cena + ' L$');
    res.json({ ok: true, uzemi: await UNIE.uzemiPub(upd, me.id, nast) });
  } catch (e) { next(e); }
});

// Master výzvu dorovná: zaplatí stejnou částku a území si nechá.
router.post('/unie/uzemi/dorovnat', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const area = s((req.body || {}).okres_key || (req.body || {}).area_key, 80);
    const t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    if (!t.vyzyvatel_id) return res.status(409).json({ error: stx(req)('server.unie_zatim_nejde_vyzvat') });
    const cena = t.vyzyvatel_cena || t.licence;
    const vyzyvatel = t.vyzyvatel_id;
    const upd = await prisma.gameTerritory.update({ where: { id: t.id }, data: {
      licence: cena, licence_do: new Date(Math.max(Date.now(), new Date(t.licence_do).getTime()) + UNIE.MESIC_MS),
      vyzyvatel_id: null, vyzyvatel_nick: null, vyzyvatel_cena: null, vyzva_do: null,
    } });
    await VYD.zapis(req.player.id, 'unie_licence', cena, null, { okres_key: area, dorovnani: true });
    await prisma.gameDelivery.create({ data: {
      player_id: vyzyvatel, kind: 'zprava', spot_id: 'unie:dorovnano:' + t.id,
      text_kod: 'dor.unie_dorovnano', text_data: { p1: area, p2: t.master_nick },
      popis: 'Území ' + area + ' si udržel ' + t.master_nick + ' — tvoji nabídku dorovnal.',
    } }).catch(() => {});
    res.json({ ok: true, zaplaceno: cena, uzemi: await UNIE.uzemiPub(upd, req.player.id) });
  } catch (e) { next(e); }
});

// ─── Operátorské licence ─────────────────────────────────────────────────────
// Master vypíše, za kolik licenci v území prodává a jaký podíl ze servisu
// k ní patří. Operátor si ji koupí; v jednom území je v jednu chvíli jeden.
router.post('/unie/licence/vypsat', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const b = req.body || {};
    const area = s(b.okres_key || b.area_key, 80);
    const cena = Math.max(0, Math.round(Number(b.cena) || 0));
    const podil = Math.max(0, Math.min(100, Math.round(Number(b.podil_pct) || 60)));
    const t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    const upd = await prisma.gameTerritory.update({ where: { id: t.id },
      data: { operator_cena: cena > 0 ? cena : null, operator_podil: podil } });
    res.json({ ok: true, cena: upd.operator_cena, podil_pct: upd.operator_podil });
  } catch (e) { next(e); }
});

router.post('/unie/licence/koupit', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const me = req.player;
    const area = s((req.body || {}).okres_key || (req.body || {}).area_key, 80);
    const r = await UNIE.role(me.id);
    if (!r.operator) return res.status(403).json({ error: stx(req)('server.unie_jen_pro_operatora') });
    const t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    if (!t) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    if (t.master_id === me.id) return res.status(409).json({ error: stx(req)('server.unie_vlastni_uzemi') });
    if (!t.operator_cena) return res.status(409).json({ error: stx(req)('server.unie_licenci_prodava_master') });
    const stava = await prisma.gameOperatorLicence.findFirst({ where: { okres_key: area, zrusena: false } });
    if (stava && stava.player_id === me.id) return res.status(409).json({ error: stx(req)('server.unie_licence_uz_mas') });
    if (stava) return res.status(409).json({ error: stx(req)('server.unie_licenci_prodava_master') });
    const cena = t.operator_cena;
    const lic = await prisma.gameOperatorLicence.upsert({
      where: { okres_key_player_id: { okres_key: area, player_id: me.id } },
      create: { okres_key: area, player_id: me.id, nick: me.nick, cena, podil_pct: t.operator_podil, od: new Date(), zrusena: false },
      update: { nick: me.nick, cena, podil_pct: t.operator_podil, od: new Date(), do_kdy: null, zrusena: false },
    });
    await VYD.zapis(me.id, 'unie_operator', cena, null, { okres_key: area });
    // Master dostane zaplaceno, nabídka se tím vyčerpá.
    await prisma.gameTerritory.update({ where: { id: t.id }, data: { operator_cena: null } });
    await prisma.gameDelivery.create({ data: {
      player_id: t.master_id, kind: 'cash', amount: cena, spot_id: 'unie:lic:' + lic.id,
      text_kod: 'dor.unie_licence_prodana', text_data: { p1: area, p2: me.nick, penize: cena },
      popis: 'Operátorskou licenci v území ' + area + ' koupil ' + me.nick + ' — ' + cena.toLocaleString('cs-CZ') + ' L$',
    } });
    console.log('[game] unie — operátorská licence', area, me.nick, cena + ' L$');
    res.json({ ok: true, zaplaceno: cena, licence: { okres_key: area, cena, podil_pct: lic.podil_pct } });
  } catch (e) { next(e); }
});

// Zrušit licenci může operátor sám i master území.
router.post('/unie/licence/zrusit', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const b = req.body || {};
    const area = s(b.okres_key || b.area_key, 80);
    const lic = await prisma.gameOperatorLicence.findFirst({ where: { okres_key: area, zrusena: false } });
    if (!lic) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    const t = await prisma.gameTerritory.findUnique({ where: { okres_key: area } });
    const smi = lic.player_id === req.player.id || (t && t.master_id === req.player.id);
    if (!smi) return res.status(403).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    if (t) await UNIE.vyuctujUzemi(t, await UNIE.nastaveni());
    await prisma.gameOperatorLicence.update({ where: { id: lic.id },
      data: { zrusena: true, do_kdy: new Date() } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
