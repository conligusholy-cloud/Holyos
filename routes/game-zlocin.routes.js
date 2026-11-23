// =============================================================================
// Laundromat Tycoon — noviny o zločinu: zprávy, hlasování poroty, odvolání
// =============================================================================
// Hráči vidí průběh případů (kontrola → soud → odvolání). Porotce smí hlasovat
// v případu, kde je to dovoleno (zlocin-rizeni.smiHlasovat), obviněný se smí
// odvolat. Rozhodování a časování dělá services/game/zlocin-rizeni.js.
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const acct = require('./game-account.routes');
const ZL = require('../services/game/zlocin');
const RIZ = require('../services/game/zlocin-rizeni');
const ZT = require('../services/game/zlocin-texty');
const TEXTY = require('../services/game/texty');

router.use(express.json({ limit: '8kb' }));

function hrac(req, res, next) {
  acct._currentPlayer(req).then((p) => {
    if (!p) return res.status(401).json({ error: TEXTY.t('server.neprihlasen', {}, TEXTY.ZDROJ) });
    req.player = p; next();
  }).catch(next);
}
const api = (fn) => (req, res, next) => fn(req, res).catch(next);

const verejny = (z) => ({
  id: z.id, hlavni_id: z.hlavni_id, firma: z.firma || z.hlavni_nick, emblem: z.emblem, utvar: z.utvar, stav: z.stav, typ: z.typ,
  skoda: z.skoda, zahajeno: z.zahajeno_at, kontrola_do: z.kontrola_do, soud_do: z.soud_do, odvolani_do: z.odvolani_do,
  trest_uroven: z.trest_uroven, trest_castka: z.trest_castka, odvolani_podano: !!z.odvolani_at,
});

// GET /zlocin/noviny?po=<id zprávy> → nové zprávy, běžící případy a co smím já
router.get('/zlocin/noviny', hrac, api(async (req, res) => {
  const po = parseInt(req.query.po, 10) || 0;
  const me = req.player;
  const jazyk = TEXTY.jazykHrace(me);
  const [zpravy, aktivni, uzavrene] = await Promise.all([
    prisma.gameZlocinZprava.findMany({ where: po ? { id: { gt: po } } : {}, orderBy: { id: 'desc' }, take: po ? 30 : 40 }),
    prisma.gameZlocin.findMany({ where: { stav: { in: RIZ.AKTIVNI } }, orderBy: { id: 'desc' }, take: 40 }),
    prisma.gameZlocin.findMany({ where: { stav: { in: ['uzavreno', 'zruseno'] } }, orderBy: { id: 'desc' }, take: 10 }),
  ]);
  const R = await ZL.nastaveni();
  // Průběžné výsledky hlasování — jen počty, nikdy kdo jak hlasoval
  const poctyHlasu = {};
  const hl = aktivni.length ? await prisma.gameZlocinHlas.groupBy({ by: ['zlocin_id', 'volba'], where: { zlocin_id: { in: aktivni.map((x) => x.id) } }, _count: { _all: true } }) : [];
  hl.forEach((x) => { (poctyHlasu[x.zlocin_id] = poctyHlasu[x.zlocin_id] || { nejnizsi: 0, stredni: 0, nejvyssi: 0 })[x.volba] = x._count._all; });
  const hlasyPro = (z) => (z.stav === 'soud' || z.stav === 'odvolani') ? (poctyHlasu[z.id] || { nejnizsi: 0, stredni: 0, nejvyssi: 0 }) : null;
  const moje = aktivni.find((z) => z.hlavni_id === me.id) || null;
  // Hlasování: případy ve stavu soud, kde smím hlasovat
  const hlasovani = [];
  for (const z of aktivni.filter((x) => x.stav === 'soud')) {
    const s = await RIZ.smiHlasovat(prisma, R, me, z);
    if (!s.ok) continue;
    const h = await prisma.gameZlocinHlas.findUnique({ where: { zlocin_id_player_id: { zlocin_id: z.id, player_id: me.id } } });
    hlasovani.push({ id: z.id, firma: z.firma || z.hlavni_nick, skoda: z.skoda, soud_do: z.soud_do,
      moje_volba: h ? h.volba : null,
      urovne: RIZ.UROVNE.map((u) => ({ klic: u, castka: Math.round(z.skoda * R['trest_' + u]), koef: R['trest_' + u], hlasu: (hlasyPro(z) || {})[u] || 0 })) });
  }
  // Texty rozhraní posílá server — v klientu jsou jen údaje. Skládají se
  // v jazyce čtenáře, ne v češtině: noviny čte i hráč, co hraje italsky.
  const u = (klic) => TEXTY.t('zlocin.ui.' + klic, null, jazyk);
  const ui = { noviny: u('noviny'), precteno: u('precteno'), hlasovani: u('hlasovani'), hlasuj: u('hlasuj'), bezi: u('bezi'),
    zadne: u('zadne'), trest: u('trest'), skoda: u('skoda'), moje: u('moje'), odvolat: u('odvolat'), odeslat: u('odeslat'),
    odvolani_ph: u('odvolani_ph'), hlasoval: u('hlasoval'), konci: u('konci'), zavrit: u('zavrit'), hlasy: u('hlasy'), hlasu: u('hlasu'),
    odvolani_podano: u('odvolani_podano'),
    stav: { kontrola: u('stav_kontrola'), soud: u('stav_soud'), odvolani: u('stav_odvolani'), uzavreno: u('stav_uzavreno'), zruseno: u('stav_zruseno') },
    urovne: { nejnizsi: u('uroven_nejnizsi'), stredni: u('uroven_stredni'), nejvyssi: u('uroven_nejvyssi') } };
  res.json({ ok: true, ui,
    zpravy: zpravy.map((z) => {
      const v = ZT.vykresli(z, jazyk);
      return { id: z.id, nadpis: v.nadpis, text: v.text, emblem: z.emblem, stav: z.stav, kdy: z.created_at };
    }),
    pripady: aktivni.concat(uzavrene).map((z) => Object.assign(verejny(z), { hlasy: hlasyPro(z) })),
    moje: moje ? Object.assign(verejny(moje), { muze_odvolat: moje.stav === 'odvolani' && !moje.odvolani_at && new Date(moje.odvolani_do) > new Date() }) : null,
    hlasovani });
}));

// Chyba z řízení přijde jako klíč do katalogu. U nepovoleného hlasování je
// uvnitř ještě druhý klíč (proč to nejde) — ten se musí složit dřív.
function chyba(r, jazyk) {
  const t = (klic, udaje) => TEXTY.t(klic, udaje, jazyk);
  if (!r.klic) return String(r.error || '');
  const udaje = Object.assign({}, r.udaje || {});
  if (r.duvod) udaje.p1 = t(r.duvod, r.duvod_udaje || null);
  return t(r.klic, udaje);
}

router.post('/zlocin/:id/hlas', hrac, api(async (req, res) => {
  const r = await RIZ.hlasuj(prisma, req.player.id, parseInt(req.params.id, 10), String((req.body || {}).volba || ''));
  if (!r.ok) return res.status(400).json({ error: chyba(r, TEXTY.jazykHrace(req.player)) });
  res.json({ ok: true });
}));

router.post('/zlocin/:id/odvolani', hrac, api(async (req, res) => {
  const r = await RIZ.odvolej(prisma, req.player.id, parseInt(req.params.id, 10), (req.body || {}).text);
  if (!r.ok) return res.status(400).json({ error: chyba(r, TEXTY.jazykHrace(req.player)) });
  res.json({ ok: true });
}));

module.exports = router;
