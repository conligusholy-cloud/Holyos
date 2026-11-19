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

router.use(express.json({ limit: '8kb' }));

function hrac(req, res, next) {
  acct._currentPlayer(req).then((p) => {
    if (!p) return res.status(401).json({ error: 'Nejsi přihlášen.' });
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
  // Texty rozhraní posílá server (čeština) — v klientu jsou jen údaje
  const ui = { noviny: 'Prádelní noviny', precteno: 'Přečteno', hlasovani: 'Hlasování poroty', hlasuj: 'Hlasovat', bezi: 'Běžící případy',
    zadne: 'Zatím žádné zprávy.', trest: 'Trest:', skoda: 'Škoda:', moje: 'Řízení proti tvé firmě', odvolat: 'Odvolat se', odeslat: 'Odeslat odvolání',
    odvolani_ph: 'Napiš, proč se odvoláváš (aspoň pár vět)', hlasoval: 'Tvůj hlas je zapsán', zavrit: 'Zavřít', hlasy: 'hlasy (nejnižší/střední/nejvyšší):', hlasu: 'hlasů',
    odvolani_podano: 'Odvolání podáno, čeká na rozhodnutí správy hry. Majetek zůstává zmrazen.',
    stav: { kontrola: 'kontrola', soud: 'soud', odvolani: 'rozsudek / odvolání', uzavreno: 'uzavřeno', zruseno: 'zrušeno' },
    urovne: { nejnizsi: 'Nejnižší trest', stredni: 'Střední trest', nejvyssi: 'Nejvyšší trest' } };
  res.json({ ok: true, ui,
    zpravy: zpravy.map((z) => ({ id: z.id, nadpis: z.nadpis, text: z.text, emblem: z.emblem, stav: z.stav, kdy: z.created_at })),
    pripady: aktivni.concat(uzavrene).map((z) => Object.assign(verejny(z), { hlasy: hlasyPro(z) })),
    moje: moje ? Object.assign(verejny(moje), { muze_odvolat: moje.stav === 'odvolani' && !moje.odvolani_at && new Date(moje.odvolani_do) > new Date() }) : null,
    hlasovani });
}));

router.post('/zlocin/:id/hlas', hrac, api(async (req, res) => {
  const r = await RIZ.hlasuj(prisma, req.player.id, parseInt(req.params.id, 10), String((req.body || {}).volba || ''));
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
}));

router.post('/zlocin/:id/odvolani', hrac, api(async (req, res) => {
  const r = await RIZ.odvolej(prisma, req.player.id, parseInt(req.params.id, 10), (req.body || {}).text);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
}));

module.exports = router;
