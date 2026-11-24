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
    const nast = await UNIE.nastaveni();
    const moje_role = await UNIE.role(me.id);

    // Oblasti, kde mám prádlomaty — jen o ty se můžu ucházet.
    const zabory = await prisma.gameSpotClaim.findMany({
      where: { player_id: me.id, model: { not: '' } }, select: { area_key: true },
    });
    const mojeOblasti = [...new Set(zabory.map((z) => z.area_key))];

    // Území, která se mě týkají: moje, moje licence, a ta v mých oblastech.
    const licence = await prisma.gameOperatorLicence.findMany({
      where: { player_id: me.id, zrusena: false },
    });
    const klice = [...new Set(mojeOblasti.concat(licence.map((l) => l.area_key)))];
    let uzemi = await prisma.gameTerritory.findMany({
      where: { OR: [{ master_id: me.id }, { area_key: { in: klice } }, { vyzyvatel_id: me.id }] },
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

    // Volné oblasti, kde mám prádlomaty: co by stálo je převzít.
    const obsazene = new Set(uzemi.map((t) => t.area_key));
    const volne = [];
    for (const k of mojeOblasti) {
      if (obsazene.has(k)) continue;
      volne.push(await UNIE.potencial(k));
    }

    res.json({ ok: true, role: moje_role, nastaveni: {
      poplatek_min: nast.poplatek_min, poplatek_max: nast.poplatek_max,
      vyzva_prah: nast.vyzva_prah, vyzva_mesicu: nast.vyzva_mesicu,
      vyzva_priplatek_pct: nast.vyzva_priplatek_pct, odvod_pct: nast.odvod_pct,
    }, uzemi: pub, volne, licence: licence.map((l) => ({
      area_key: l.area_key, cena: l.cena, podil_pct: l.podil_pct, od: l.od, do_kdy: l.do_kdy,
    })) });
  } catch (e) { next(e); }
});

// ─── Území na mapě ───────────────────────────────────────────────────────────
// Lehký seznam pro vrstvu na mapě: kde území leží, kdo ho drží a jestli je
// moje. Žádné vyúčtování se tu nepočítá — mapa se překresluje často.
router.get('/unie/mapa', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const uzemi = await prisma.gameTerritory.findMany({
      select: { area_key: true, master_id: true, master_nick: true, poplatek_pct: true, nespokojenost: true },
    });
    if (!uzemi.length) return res.json({ ok: true, uzemi: [] });
    const oblasti = await prisma.gameArea.findMany({
      where: { key: { in: uzemi.map((t) => t.area_key) } },
      select: { key: true, name: true, lat: true, lon: true },
    });
    const mapa = {};
    oblasti.forEach((o) => { mapa[o.key] = o; });
    // Nespokojenost se počítá, ne čte: uložená hodnota se posouvá až při
    // vyúčtování, takže čerstvě koupené území by hlásilo nulu.
    const nast = await UNIE.nastaveni();
    res.json({ ok: true, uzemi: uzemi.map((t) => {
      const o = mapa[t.area_key] || {};
      return { area_key: t.area_key, nazev: o.name || t.area_key, lat: o.lat, lon: o.lon,
        master_nick: t.master_nick, moje: t.master_id === req.player.id,
        poplatek_pct: t.poplatek_pct, nespokojenost: UNIE.nespokojenostZ(t.poplatek_pct, nast) };
    }).filter((t) => t.lat != null) });
  } catch (e) { next(e); }
});

// ─── Převzetí volného území ──────────────────────────────────────────────────
router.post('/unie/uzemi/prevzit', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const me = req.player;
    const area = s((req.body || {}).area_key, 80);
    const r = await UNIE.role(me.id);
    if (!r.master) return res.status(403).json({ error: stx(req)('server.unie_jen_pro_mastera') });
    const pot = await UNIE.potencial(area);
    if (!pot.mist) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    const uz = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
    if (uz) return res.status(409).json({ error: stx(req)('server.unie_uzemi_uz_ma_mastera') });
    const stroju = await prisma.gameSpotClaim.count({ where: { area_key: area, model: { not: '' } } });
    const t = await prisma.gameTerritory.create({ data: {
      area_key: area, master_id: me.id, master_nick: me.nick,
      licence: pot.licence, licence_do: new Date(Date.now() + UNIE.MESIC_MS),
      zavazek: pot.zavazek, zavazek_od: new Date(), zavazek_start: stroju,
      servis_do: new Date(),
    } });
    await VYD.zapis(me.id, 'unie_licence', pot.licence, null, { area_key: area, prevzeti: true });
    console.log('[game] unie — území', area, 'přebírá', me.nick, 'za', pot.licence, 'L$');
    res.json({ ok: true, zaplaceno: pot.licence, uzemi: await UNIE.uzemiPub(t, me.id) });
  } catch (e) { next(e); }
});

// ─── Výše poplatku v pásmu ───────────────────────────────────────────────────
router.post('/unie/uzemi/poplatek', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const b = req.body || {};
    const area = s(b.area_key, 80);
    const pct = Math.round(Number(b.pct) || 0);
    const nast = await UNIE.nastaveni();
    const t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
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
    const area = s((req.body || {}).area_key, 80);
    const t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    const od = Math.max(Date.now(), new Date(t.licence_do).getTime());
    const upd = await prisma.gameTerritory.update({ where: { id: t.id },
      data: { licence_do: new Date(od + UNIE.MESIC_MS) } });
    await VYD.zapis(req.player.id, 'unie_licence', t.licence, null, { area_key: area });
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
    const area = s(b.area_key, 80);
    const cena = Math.max(0, Math.round(Number(b.cena) || 0));
    const me = req.player;
    const nast = await UNIE.nastaveni();
    const r = await UNIE.role(me.id);
    if (!r.master) return res.status(403).json({ error: stx(req)('server.unie_jen_pro_mastera') });
    let t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
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
    const area = s((req.body || {}).area_key, 80);
    const t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    if (!t.vyzyvatel_id) return res.status(409).json({ error: stx(req)('server.unie_zatim_nejde_vyzvat') });
    const cena = t.vyzyvatel_cena || t.licence;
    const vyzyvatel = t.vyzyvatel_id;
    const upd = await prisma.gameTerritory.update({ where: { id: t.id }, data: {
      licence: cena, licence_do: new Date(Math.max(Date.now(), new Date(t.licence_do).getTime()) + UNIE.MESIC_MS),
      vyzyvatel_id: null, vyzyvatel_nick: null, vyzyvatel_cena: null, vyzva_do: null,
    } });
    await VYD.zapis(req.player.id, 'unie_licence', cena, null, { area_key: area, dorovnani: true });
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
    const area = s(b.area_key, 80);
    const cena = Math.max(0, Math.round(Number(b.cena) || 0));
    const podil = Math.max(0, Math.min(100, Math.round(Number(b.podil_pct) || 60)));
    const t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
    if (!t || t.master_id !== req.player.id) return res.status(409).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    const upd = await prisma.gameTerritory.update({ where: { id: t.id },
      data: { operator_cena: cena > 0 ? cena : null, operator_podil: podil } });
    res.json({ ok: true, cena: upd.operator_cena, podil_pct: upd.operator_podil });
  } catch (e) { next(e); }
});

router.post('/unie/licence/koupit', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const me = req.player;
    const area = s((req.body || {}).area_key, 80);
    const r = await UNIE.role(me.id);
    if (!r.operator) return res.status(403).json({ error: stx(req)('server.unie_jen_pro_operatora') });
    const t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
    if (!t) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    if (t.master_id === me.id) return res.status(409).json({ error: stx(req)('server.unie_vlastni_uzemi') });
    if (!t.operator_cena) return res.status(409).json({ error: stx(req)('server.unie_licenci_prodava_master') });
    const stava = await prisma.gameOperatorLicence.findFirst({ where: { area_key: area, zrusena: false } });
    if (stava && stava.player_id === me.id) return res.status(409).json({ error: stx(req)('server.unie_licence_uz_mas') });
    if (stava) return res.status(409).json({ error: stx(req)('server.unie_licenci_prodava_master') });
    const cena = t.operator_cena;
    const lic = await prisma.gameOperatorLicence.upsert({
      where: { area_key_player_id: { area_key: area, player_id: me.id } },
      create: { area_key: area, player_id: me.id, nick: me.nick, cena, podil_pct: t.operator_podil, od: new Date(), zrusena: false },
      update: { nick: me.nick, cena, podil_pct: t.operator_podil, od: new Date(), do_kdy: null, zrusena: false },
    });
    await VYD.zapis(me.id, 'unie_operator', cena, null, { area_key: area });
    // Master dostane zaplaceno, nabídka se tím vyčerpá.
    await prisma.gameTerritory.update({ where: { id: t.id }, data: { operator_cena: null } });
    await prisma.gameDelivery.create({ data: {
      player_id: t.master_id, kind: 'cash', amount: cena, spot_id: 'unie:lic:' + lic.id,
      text_kod: 'dor.unie_licence_prodana', text_data: { p1: area, p2: me.nick, penize: cena },
      popis: 'Operátorskou licenci v území ' + area + ' koupil ' + me.nick + ' — ' + cena.toLocaleString('cs-CZ') + ' L$',
    } });
    console.log('[game] unie — operátorská licence', area, me.nick, cena + ' L$');
    res.json({ ok: true, zaplaceno: cena, licence: { area_key: area, cena, podil_pct: lic.podil_pct } });
  } catch (e) { next(e); }
});

// Zrušit licenci může operátor sám i master území.
router.post('/unie/licence/zrusit', requirePlayer, jenUnie, async (req, res, next) => {
  try {
    const b = req.body || {};
    const area = s(b.area_key, 80);
    const lic = await prisma.gameOperatorLicence.findFirst({ where: { area_key: area, zrusena: false } });
    if (!lic) return res.status(404).json({ error: stx(req)('server.unie_uzemi_neexistuje') });
    const t = await prisma.gameTerritory.findUnique({ where: { area_key: area } });
    const smi = lic.player_id === req.player.id || (t && t.master_id === req.player.id);
    if (!smi) return res.status(403).json({ error: stx(req)('server.unie_neni_tvoje_uzemi') });
    if (t) await UNIE.vyuctujUzemi(t, await UNIE.nastaveni());
    await prisma.gameOperatorLicence.update({ where: { id: lic.id },
      data: { zrusena: true, do_kdy: new Date() } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
