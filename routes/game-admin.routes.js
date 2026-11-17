// =============================================================================
// Laundromat Tycoon — administrace (HolyOS, sekce Soukromé)
// =============================================================================
// Přehled hráčů, objednávek, ceník a statistiky. Vidí to jen lidé, kteří mají
// přístup do soukromých sekcí (stejné pravidlo jako Best Series 2.0).
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const acct = require('./game-account.routes');
const MENY = require('../services/game/meny');

router.use(express.json({ limit: '64kb' }));
router.use(requireAuth);

// Kdo smí dovnitř: stejný okruh jako u ostatních soukromých sekcí.
function allowed(user) {
  const person = user && user.person;
  if (!person) return false;
  const ids = String(process.env.GAME_ADMIN_PERSON_IDS || process.env.BS2_ALLOWED_PERSON_IDS || '')
    .split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
  if (ids.length) return ids.includes(person.id);
  const fn = String(person.first_name || '').trim().toLowerCase();
  const ln = String(person.last_name || '').trim().toLowerCase();
  return ln === 'holý' && (fn === 'tomáš' || fn === 'jan');
}
router.use((req, res, next) => {
  if (!allowed(req.user)) return res.status(403).json({ error: 'Do této sekce nemáš přístup.' });
  next();
});

// Nákupy jsou v měně hráče. Součty v adminu se počítají v korunách přepočtem
// kurzem z nastavení hry — cizí měny se nikdy nesčítají s korunami „po hlavě".
let KURZY = Object.assign({}, MENY.KURZY_VYCHOZI);
let KURZ_EUR = MENY.KURZY_VYCHOZI.eur;
router.use(async (req, res, next) => {
  try { KURZY = await MENY.kurzy(); KURZ_EUR = KURZY.eur; } catch (e) { /* zůstanou poslední */ }
  next();
});
const menaZ = (n) => String((n && n.currency) || 'czk').toLowerCase();
const kcZ = (n) => MENY.naKoruny(n.amount_cents, menaZ(n), KURZY);
const api = (fn) => (req, res, next) => fn(req, res).catch(next);

// Sídlo firmy ve hře (vybírá se na začátku; u starších her se dopočítá z prvního prádlomatu)
const sidloZ = (st) => (st && st.sidlo && st.sidlo.name) ? String(st.sidlo.name).replace(/<[^>]*>/g, '').slice(0, 80) : null;
// Kolik toho o hráči víme: seznam údajů, které máme / chybí, a procento.
// Váhy: kontakt a identita víc, herní chování méně.
function znalostHrace(p, extra) {
  const st = p.state || {};
  const x = extra || {};
  const polozky = [
    ['E-mail', !!p.email, 3], ['Jméno a příjmení', !!(p.first_name || p.last_name), 3],
    ['Plný účet (heslo)', !!p.password_hash, 2], ['Odkud přišel', !!(p.zdroj || p.invited_by_id || p.invited_by_ref), 2],
    ['Město z IP (ověřené)', p.geo_presnost === 'mesto' && !!p.geo_city, 1], ['Země / operátor', !!(p.geo_country || p.geo_isp), 1],
    ['Sídlo ve hře', !!sidloZ(st), 1], ['Profil hráče', !!st.profile, 1],
    ['Sleduje FB / IG', !!(p.facebook_at || p.instagram_at), 1], ['Něco koupil', (x.nakupu || 0) > 0, 2],
    ['Přivedl hráče', (x.privedl || 0) > 0, 1], ['Hraje přes 1 h', (p.hra_s_celkem || 0) >= 3600, 1],
    ['Otisk zařízení', !!p.dev_pid, 1],
  ];
  const max = polozky.reduce((a, q) => a + q[2], 0), ma = polozky.filter((q) => q[1]);
  return { pct: Math.round(ma.reduce((a, q) => a + q[2], 0) / max * 100), ma: ma.map((q) => q[0]), chybi: polozky.filter((q) => !q[1]).map((q) => q[0]) };
}
// Zařízení z User-Agentu lidsky (jen hrubě: systém + prohlížeč)
function zarizeni(ua) {
  const u = String(ua || ''); if (!u) return null;
  const os = /iPhone|iPad/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : 'jiný systém';
  const br = /FBAN|FBAV|FB_IAB/.test(u) ? 'Facebook (vestavěný prohlížeč)' : /Instagram/.test(u) ? 'Instagram (vestavěný prohlížeč)' : /Edg\//.test(u) ? 'Edge' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'jiný prohlížeč';
  const model = (/Android [\d.]+; ([^;)]+)/.exec(u) || [])[1];
  return os + ' · ' + br + (model && !/^K$|wv/.test(model) ? ' · ' + model.trim() : '');
}
const den = (d) => new Date(d).toISOString().slice(0, 10);

// ─── Hráči ───────────────────────────────────────────────────────────────────
// GET /players?q=&limit= → kdo hraje, jak daleko je a kolik utratil
router.get('/players', api(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const where = q ? {
    OR: [
      { nick: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { last_name: { contains: q, mode: 'insensitive' } },
    ],
  } : {};
  const rows = await prisma.gamePlayer.findMany({ where, orderBy: { created_at: 'desc' }, take });
  const ids = rows.map((r) => r.id);
  const [spots, cards, pays, privedl, zvouci] = await Promise.all([
    prisma.gameSpotClaim.groupBy({ by: ['player_id'], where: { player_id: { in: ids } }, _count: { _all: true } }),
    prisma.gameCard.groupBy({ by: ['player_id'], where: { player_id: { in: ids } }, _count: { _all: true } }),
    prisma.gamePurchase.findMany({ where: { player_id: { in: ids }, status: 'paid' }, select: { player_id: true, amount_cents: true, currency: true } })
      .then((nak) => { const m = {}; nak.forEach((n) => { const o = m[n.player_id] || (m[n.player_id] = { player_id: n.player_id, _sum: { amount_cents: 0 }, _count: { _all: 0 } }); o._sum.amount_cents += kcZ(n) * 100; o._count._all++; }); return Object.keys(m).map((k) => m[k]); }),
    // Kolik hráčů kdo přivedl — základ pro distributorský program.
    prisma.gamePlayer.groupBy({ by: ['invited_by_id'], where: { invited_by_id: { in: ids } }, _count: { _all: true } }),
    prisma.gamePlayer.findMany({ where: { invited: { some: { id: { in: ids } } } }, select: { id: true, nick: true, company: true } }),
  ]);
  // Nevyřízená AI upozornění na texty hráče (škodí / podezřelé)
  const MOD = {};
  (await prisma.gameModerace.groupBy({ by: ['player_id'], where: { player_id: { in: ids }, verdikt: { in: ['skodi', 'podezrele'] }, resolved_at: null }, _count: { _all: true } }).catch(() => []))
    .forEach((x) => { MOD[x.player_id] = x._count._all; });
  const by = (arr) => { const m = {}; arr.forEach((x) => { m[x.player_id] = x; }); return m; };
  const S = by(spots), C = by(cards), P = by(pays);
  const PRIV = {}; privedl.forEach((x) => { PRIV[x.invited_by_id] = x._count._all; });
  const ZVOU = {}; zvouci.forEach((z) => { ZVOU[z.id] = z.company || z.nick; });
  res.json({ ok: true, players: rows.map((p) => {
    const st = p.state || {};
    const units = Array.isArray(st.units) ? st.units : [];
    // Co hráči měsíčně zbyde po celých splátkách, pobočkách a četě — to samé
    // číslo, které vidí v hlavičce hry. Jinak si stěžuje, že Velín lže.
    const prijem = acct._zbydeMesicne(st);
    return {
      id: p.id, nick: p.nick, email: p.email,
      prijem: Math.round(prijem),
      jmeno: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      created_at: p.created_at, last_login_at: p.last_login_at, state_at: p.state_at,
      profil: st.profile || null,
      hotovost: typeof st.cash === 'number' ? Math.round(st.cash) : null,
      uver: typeof st.loan === 'number' ? Math.round(st.loan) : null,
      pradlomatu: units.length,
      mest: st.areas ? Object.keys(st.areas).length : 0,
      // Jak velký má uložený stav. Roste hlavně se seznamem prozkoumaných
      // míst a je to to, co dřív naráželo na strop a tiše blokovalo ukládání.
      stav_kb: p.state ? Math.round(JSON.stringify(p.state).length / 1024) : 0,
      pozvanek: st.refs || 0,
      privedl: PRIV[p.id] || 0,
      privedl_me: p.invited_by_id ? (ZVOU[p.invited_by_id] || ('hráč #' + p.invited_by_id)) : null,
      // Odkud přišel, když ho nikdo nepozval — z reklamy, z odkazu, sám.
      zdroj: p.zdroj || null,
      // Odkud se připojuje — z IP, nikde se na to neptáme. U mobilních sítí
      // a VPN to ukazuje bránu operátora, ne skutečné město.
      geo_mesto: p.geo_city || null,
      geo_kraj: p.geo_region || null,
      geo_zeme: p.geo_country || null,
      geo_cc: p.geo_cc || null,
      geo_isp: p.geo_isp || null,
      geo_tip: p.geo_tip || null,
      geo_presnost: p.geo_presnost || null,
      mist: (S[p.id] && S[p.id]._count._all) || 0,
      karet: (C[p.id] && C[p.id]._count._all) || 0,
      nakupu: (P[p.id] && P[p.id]._count._all) || 0,
      utraceno: ((P[p.id] && P[p.id]._sum.amount_cents) || 0) / 100,
      disabled: p.disabled,
      // Sídlo firmy ve hře + co o hráči víme
      sidlo: sidloZ(st),
      hra_h: Math.round((p.hra_s_celkem || 0) / 360) / 10,
      znalost: znalostHrace(p, { nakupu: (P[p.id] && P[p.id]._count._all) || 0, privedl: PRIV[p.id] || 0 }),
      varovani: MOD[p.id] || 0,
    };
  }) });
}));

// POST /players/:id/disabled { disabled } — zablokování účtu
router.post('/players/:id/disabled', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const off = !!(req.body || {}).disabled;
  const p = await prisma.gamePlayer.update({ where: { id },
    data: { disabled: off, token_version: { increment: off ? 1 : 0 } } });
  res.json({ ok: true, disabled: p.disabled });
}));

// POST /players/:id/privedl { zvouci_id } — ruční oprava sítě: kdo tohohle hráče
// do hry přivedl. Prázdné zvouci_id vazbu zruší. Provize za už koupené stroje
// pak zvoucímu doběhnou samy, až otevře záložku Já.
router.post('/players/:id/privedl', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zvouciId = parseInt((req.body || {}).zvouci_id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  if (!Number.isFinite(zvouciId)) {
    await prisma.gamePlayer.update({ where: { id }, data: { invited_by_id: null } });
    return res.json({ ok: true, privedl_me: null });
  }
  if (zvouciId === id) return res.status(400).json({ error: 'Hráč nemůže přivést sám sebe.' });
  const z = await prisma.gamePlayer.findUnique({ where: { id: zvouciId },
    select: { id: true, nick: true, company: true } });
  if (!z) return res.status(404).json({ error: 'Zvoucí hráč nenalezen.' });
  // Kruh by rozbil počítání sítě — zvoucí nesmí být někým, koho přivedl tenhle hráč.
  let chod = z, kroku = 0;
  while (chod && chod.invited_by_id && kroku++ < 50) {
    if (chod.invited_by_id === id) return res.status(400).json({ error: 'To by udělalo kruh.' });
    chod = await prisma.gamePlayer.findUnique({ where: { id: chod.invited_by_id },
      select: { id: true, invited_by_id: true } });
  }
  await prisma.gamePlayer.update({ where: { id },
    data: { invited_by_id: z.id, invited_at: p.invited_at || new Date() } });
  res.json({ ok: true, privedl_me: { id: z.id, nick: z.nick, firma: z.company || z.nick } });
}));

// GET /nahlasene → zprávy, na které si někdo stěžoval
// GET /jmeni-srovnani → co hlásí hra proti tomu, co si spočítá server.
// Čistě ke čtení. Je to podklad k posunu prahů hodností, až se žebříček
// přepne na serverové počítání jmění. Posílá se jako holý text, aby se dal
// otevřít v prohlížeči a rovnou zkopírovat.
router.get('/jmeni-srovnani', api(async (req, res) => {
  const { srovnani, tisk } = require('../services/game/srovnani');
  const kolik = Math.max(10, Math.min(500, parseInt(req.query.kolik, 10) || 40));
  res.type('text/plain; charset=utf-8').send(tisk(await srovnani(), kolik));
}));

// GET /evidence-rozdily → kde se evidence míst a stav hry rozcházejí.
// Dokud se to nevysvětlí, nejde na evidenci postavit jmění: jedněm by
// přibylo, druhým ubylo.
router.get('/evidence-rozdily', api(async (req, res) => {
  const { evidence, tiskEvidence } = require('../services/game/srovnani');
  res.type('text/plain; charset=utf-8').send(tiskEvidence(await evidence()));
}));

// GET /sklad-doplnit → co by se doplnilo (naprázdno, nic se nemění)
// POST /sklad-doplnit → doplnit opravdu
//
// Stroje koupené dřív, než se nákup začal zapisovat, server nezná. Dokud je
// nedopočítáme, sklad se nikdy nesrovná a nejde z něj udělat podmínku stavby.
// Nikomu to nic nebere — doplňuje jen to, co hráči proti jeho uložené hře chybí.
router.get('/sklad-doplnit', api(async (req, res) => {
  const sklad = require('../services/game/sklad');
  res.type('text/plain; charset=utf-8').send(sklad.tisk(await sklad.doplnit({ ostro: false })));
}));
router.post('/sklad-doplnit', api(async (req, res) => {
  const sklad = require('../services/game/sklad');
  const z = await sklad.doplnit({ ostro: true });
  console.log('[game-sklad] dopočteno ' + z.pridano + ' strojů u ' + z.hracu + ' hráčů');
  res.type('text/plain; charset=utf-8').send(sklad.tisk(z));
}));

// GET /sklad-uklid → co by se smazalo (naprázdno)
// POST /sklad-uklid → smazat doopravdy
//
// Úklid po nepovedeém dopočtu. Maže jen řádky, které vznikly dopočtem a na
// kterých zatím nic nestojí — koupených strojů a postavených prádlomatů se
// nedotkne. Po úklidu se dopočet pouští znovu načisto.
router.get('/sklad-uklid', api(async (req, res) => {
  const sklad = require('../services/game/sklad');
  res.type('text/plain; charset=utf-8').send(sklad.tiskUklid(await sklad.uklid({ ostro: false })));
}));
router.post('/sklad-uklid', api(async (req, res) => {
  const sklad = require('../services/game/sklad');
  const z = await sklad.uklid({ ostro: true });
  console.log('[game-sklad] úklid smazal ' + z.smazano + ' dopočtených strojů');
  res.type('text/plain; charset=utf-8').send(sklad.tiskUklid(z));
}));

// GET /sklad-rozdily → co o skladu ví server proti tomu, co má hra.
router.get('/sklad-rozdily', api(async (req, res) => {
  const { sklad, tiskSklad } = require('../services/game/srovnani');
  res.type('text/plain; charset=utf-8').send(tiskSklad(await sklad()));
}));

// GET /strop-prehled → kolik uložení přeteklo mez přírůstku hotovosti.
// Tohle je ladicí pohled, ne obvinění: mez je zatím schválně velkorysá a
// zajímá nás hlavně, kolik planých poplachů dělá, než se z ní stane strop.
router.get('/strop-prehled', api(async (req, res) => {
  const dnu = Math.max(1, Math.min(90, parseInt(req.query.dnu, 10) || 7));
  const od = new Date(Date.now() - dnu * 86400000);
  const [celkem, mimo] = await Promise.all([
    prisma.gameSnapshot.count({ where: { created_at: { gte: od } } }),
    prisma.gameSnapshot.findMany({
      where: { sedi: false, created_at: { gte: od } },
      orderBy: { created_at: 'desc' }, take: 300,
    }),
  ]);
  const hraci = await prisma.gamePlayer.findMany({
    where: { id: { in: Array.from(new Set(mimo.map((x) => x.player_id))) } },
    select: { id: true, nick: true },
  });
  const jmena = new Map(hraci.map((h) => [h.id, h.nick]));
  const poHraci = new Map();
  mimo.forEach((x) => {
    const a = poHraci.get(x.player_id) || { kolik: 0, max: 0 };
    a.kolik++;
    a.max = Math.max(a.max, (x.prirustek || 0) - (x.strop || 0));
    poHraci.set(x.player_id, a);
  });
  const kc = (n) => Math.round(n).toLocaleString('cs-CZ');
  const out = [];
  out.push('Posledních ' + dnu + ' dnů · otisků celkem ' + celkem
    + ' · mimo mez ' + mimo.length);
  out.push('');
  if (!mimo.length) {
    out.push('Žádné uložení mez nepřeteklo. To je buď dobře, nebo je mez moc');
    out.push('velkorysá — pozná se podle toho, až ji začneme utahovat.');
  } else {
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
      out.push('  ' + new Date(x.created_at).toISOString().slice(0, 16).replace('T', ' ')
        + '  ' + String(jmena.get(x.player_id) || ('#' + x.player_id)).padEnd(16).slice(0, 16)
        + ' přidal ' + kc(x.prirustek).padStart(14)
        + ' · strop ' + kc(x.strop || 0).padStart(14)
        + ' · ' + x.pradlomatu + ' prádlomatů'
        + ' · za ' + Math.round((x.od_ms || 0) / 60000) + ' min');
    });
  }
  res.type('text/plain; charset=utf-8').send(out.join('\n'));
}));

// GET /diagnostika-dat → prázdné řádky v seznamu hráčů: přišli o uložený stav,
// nebo ho nikdy neměli? Rozhoduje `state_rev` — zvedá se při KAŽDÉM uložení hry:
//   • stav prázdný a state_rev = 0 → hráč nikdy nic neuložil (registrace bez hraní)
//   • stav prázdný a state_rev > 0 → stav měl a přišel o něj; to umí jen „Začít
//     znovu" (/account/reset) a „Smazat účet" (/account/smazat), obojí si pouští
//     hráč sám s opsaným potvrzením
// Jen čte. Odpověď je text, ať se dá otevřít rovnou v prohlížeči.
router.get('/diagnostika-dat', api(async (req, res) => {
  const hraci = await prisma.gamePlayer.findMany({
    select: { id: true, nick: true, zdroj: true, disabled: true,
      state_at: true, state_rev: true, created_at: true, last_login_at: true },
    orderBy: { created_at: 'desc' },
  });
  // `state` je velký JSON (až stovky kB na hráče) — ptáme se jen, jestli vůbec je.
  const maStav = new Map();
  (await prisma.$queryRaw`select id, (state is not null) as ma from game_players`)
    .forEach((r) => maStav.set(Number(r.id), !!r.ma));

  const sStavem = [], nikdyNehrali = [], prisliOStav = [], smazani = [];
  for (const h of hraci) {
    if (h.nick === 'smazaný hráč') { smazani.push(h); continue; }
    if (maStav.get(h.id)) { sStavem.push(h); continue; }
    if ((h.state_rev || 0) > 0) prisliOStav.push(h); else nikdyNehrali.push(h);
  }

  const kc = (n) => Math.round(Number(n) || 0).toLocaleString('cs-CZ');
  const dt = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
  const out = [];
  out.push('HRÁČI CELKEM: ' + hraci.length);
  out.push('');
  out.push('  s uloženou rozehranou hrou : ' + sStavem.length);
  out.push('  nikdy nic neuložili        : ' + nikdyNehrali.length + '   (registrace bez hraní — nic nezmizelo)');
  out.push('  stav MĚLI a přišli o něj   : ' + prisliOStav.length);
  out.push('  smazané účty               : ' + smazani.length + '   (hráč si účet smazal sám)');
  out.push('');

  if (prisliOStav.length) {
    out.push('── Přišli o uložený stav ──');
    out.push('id     nick                 uložení  registrace        poslední přihlášení  zdroj');
    prisliOStav.forEach((h) => out.push(String(h.id).padEnd(7)
      + String(h.nick || '').slice(0, 20).padEnd(21)
      + String(h.state_rev).padStart(7) + '  '
      + dt(h.created_at).padEnd(18) + dt(h.last_login_at).padEnd(21) + (h.zdroj || '—')));
    out.push('');
  }

  if (smazani.length) {
    const ids = smazani.map((h) => h.id);
    const [nakupy, obchody, pujckyL, pujckyB] = await Promise.all([
      prisma.gamePurchase.groupBy({ by: ['player_id'], where: { player_id: { in: ids }, status: 'paid' }, _count: { _all: true }, _sum: { amount_cents: true } }),
      prisma.gameTrade.groupBy({ by: ['from_id'], where: { from_id: { in: ids } }, _count: { _all: true } }),
      prisma.gameLoan.groupBy({ by: ['lender_id'], where: { lender_id: { in: ids } }, _count: { _all: true } }),
      prisma.gameLoan.groupBy({ by: ['borrower_id'], where: { borrower_id: { in: ids } }, _count: { _all: true } }),
    ]);
    const mapa = (arr, klic) => { const m = {}; arr.forEach((x) => { m[x[klic]] = x; }); return m; };
    const N = mapa(nakupy, 'player_id'), O = mapa(obchody, 'from_id');
    const PL = mapa(pujckyL, 'lender_id'), PB = mapa(pujckyB, 'borrower_id');
    out.push('── Smazané účty: co po nich zbylo ──');
    out.push('(jméno ani e-mail v DB nejsou, to je smysl výmazu; původní nick najdeš');
    out.push(' v logu Railway na řádku „[game] konec hry <nick>" — píše se před anonymizací)');
    out.push('');
    out.push('id     registrace        poslední přihlášení  uložení     zaplatil  obchodů  půjček');
    smazani.forEach((h) => {
      const n = N[h.id];
      out.push(String(h.id).padEnd(7) + dt(h.created_at).padEnd(18) + dt(h.last_login_at).padEnd(21)
        + String(h.state_rev).padStart(7)
        + (n ? (kc((n._sum.amount_cents || 0) / 100) + ' Kč') : '—').padStart(13)
        + String((O[h.id] && O[h.id]._count._all) || 0).padStart(9)
        + String(((PL[h.id] && PL[h.id]._count._all) || 0) + ((PB[h.id] && PB[h.id]._count._all) || 0)).padStart(8));
    });
    out.push('');
    out.push('„uložení" = kolikrát se hra uložila, než hráč účet smazal.');
    out.push('0–1 → účet vznikl a hned zmizel · vyšší číslo → opravdu hrál.');
    out.push('');
  }

  // Zaplatili a nemají rozehranou hru — jediné, co opravdu pálí.
  const platici = await prisma.gamePurchase.groupBy({
    by: ['player_id'], where: { status: 'paid' }, _count: { _all: true }, _sum: { amount_cents: true },
  });
  const problem = platici.filter((x) => !maStav.get(x.player_id));
  out.push('── Zaplatili, ale nemají rozehranou hru: ' + problem.length + ' ──');
  problem.forEach((x) => {
    const h = hraci.find((y) => y.id === x.player_id);
    out.push('#' + x.player_id + ' ' + (h ? h.nick : '?') + ' · nákupů ' + x._count._all
      + ' · ' + kc((x._sum.amount_cents || 0) / 100) + ' Kč · uložení ' + (h ? h.state_rev : '?'));
  });
  out.push('');

  const posledni = sStavem.map((h) => h.state_at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a));
  const den1 = Date.now() - 86400000;
  out.push('── Poslední uložení hry ──');
  out.push('nejnovější: ' + dt(posledni[0]));
  out.push('nejstarší : ' + dt(posledni[posledni.length - 1]));
  out.push('za posledních 24 h se uložilo ' + posledni.filter((d) => new Date(d).getTime() > den1).length + ' hráčům');

  res.type('text/plain; charset=utf-8').send(out.join('\n'));
}));

// GET /players/:id/otisky → jak hráči rostla hotovost a jmění v čase.
// Jediná historie, kterou o rozehrané hře máme: uložený stav si drží
// jen poslední podobu.
router.get('/players/:id/otisky', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const kolik = Math.max(10, Math.min(500, parseInt(req.query.kolik, 10) || 100));
  const rows = await prisma.gameSnapshot.findMany({
    where: { player_id: id }, orderBy: { created_at: 'desc' }, take: kolik,
  });
  const kc = (n) => Math.round(n || 0).toLocaleString('cs-CZ');
  const out = ['kdy                 hotovost            jmění      prádlomatů   přírůstek'];
  out.push('-'.repeat(78));
  rows.forEach((x) => {
    out.push(new Date(x.created_at).toISOString().slice(0, 16).replace('T', ' ')
      + kc(x.hotovost).padStart(16)
      + kc(x.jmeni).padStart(18)
      + String(x.pradlomatu).padStart(12)
      + kc(x.prirustek).padStart(14)
      + (x.sedi ? '' : '   ← mimo mez'));
  });
  res.type('text/plain; charset=utf-8').send(out.join('\n'));
}));

router.get('/nahlasene', api(async (req, res) => {
  const vse = String(req.query.vse || '') === '1';
  const rows = await prisma.gameMessage.findMany({
    where: vse ? { reported_at: { not: null } } : { reported_at: { not: null }, resolved_at: null },
    orderBy: { reported_at: 'desc' }, take: 200,
  });
  const ids = [...new Set(rows.flatMap((m) => [m.from_id, m.to_id, m.reported_by].filter(Boolean)))];
  const lide = ids.length
    ? await prisma.gamePlayer.findMany({ where: { id: { in: ids } },
        select: { id: true, nick: true, company: true, disabled: true } })
    : [];
  const kdo = new Map(lide.map((p) => [p.id, p]));
  const jm = (id) => {
    const p = kdo.get(id);
    return p ? { id: p.id, nick: p.nick, firma: p.company || (p.nick + ' s.r.o.'), disabled: p.disabled } : null;
  };
  res.json({ ok: true, zpravy: rows.map((m) => ({
    id: m.id, text: m.text, kdy: m.created_at, nahlaseno: m.reported_at, vyrizeno: m.resolved_at,
    od: jm(m.from_id), komu: jm(m.to_id), nahlasil: jm(m.reported_by),
  })) });
}));

// POST /nahlasene/:id/vyrizeno { zpet } — označí nahlášení za vyřízené
router.post('/nahlasene/:id/vyrizeno', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zpet = !!(req.body || {}).zpet;
  await prisma.gameMessage.update({ where: { id }, data: { resolved_at: zpet ? null : new Date() } });
  res.json({ ok: true });
}));

// ─── Chyby z klientů (ukládání hry, chyby skriptu) ───────────────────────────
router.get('/chyby', api(async (req, res) => {
  const vse = String(req.query.vse || '') === '1';
  const list = await require('../services/game/chyby').nacti();
  const typy = {};
  list.filter((x) => !x.vyrizeno).forEach((x) => { typy[x.typ] = (typy[x.typ] || 0) + x.pocet; });
  res.json({ ok: true, chyby: vse ? list : list.filter((x) => !x.vyrizeno), nevyrizenych: list.filter((x) => !x.vyrizeno).length, typy });
}));
router.post('/chyby/:id/vyrizeno', api(async (req, res) => {
  await require('../services/game/chyby').vyrizeno(String(req.params.id), !(req.body || {}).zpet);
  res.json({ ok: true });
}));
router.post('/chyby/smazat-vyrizene', api(async (req, res) => {
  await require('../services/game/chyby').smazVyrizene();
  res.json({ ok: true });
}));

// GET /players → pro výběr zvoucího stačí nick a firma (lehký seznam)
router.get('/players-vyber', api(async (req, res) => {
  const rows = await prisma.gamePlayer.findMany({
    where: { disabled: false }, orderBy: { nick: 'asc' },
    select: { id: true, nick: true, company: true },
  });
  res.json({ ok: true, players: rows.map((p) => ({ id: p.id, nick: p.nick,
    firma: p.company || (p.nick + ' s.r.o.') })) });
}));

// GET /players/:id/transakce → herní transakce hráče: uložený stav, doručenky, burza, podíly, půjčky
router.get('/players/:id/transakce', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  const st = p.state || {};
  const units = Array.isArray(st.units) ? st.units : [];
  const [dor, obch, pod, puj] = await Promise.all([
    prisma.gameDelivery.findMany({ where: { player_id: id }, orderBy: { created_at: 'desc' }, take: 150 }),
    prisma.gameTrade.findMany({ where: { OR: [{ from_id: id }, { to_id: id }] }, orderBy: { created_at: 'desc' }, take: 100 }),
    prisma.gameEquity.findMany({ where: { OR: [{ firma_id: id }, { investor_id: id }] }, orderBy: { created_at: 'desc' } }),
    prisma.gameLoan.findMany({ where: { OR: [{ lender_id: id }, { borrower_id: id }] }, orderBy: { created_at: 'desc' } }),
  ]);
  res.json({ ok: true,
    stav: { state_at: p.state_at, state_rev: p.state_rev, kb: Math.round(JSON.stringify(st).length / 1024),
      hotovost: Math.round(st.cash || 0), pradlomatu: units.length,
      se_ziskem: units.filter((u) => u.eco && u.eco.profit > 0).length,
      eco_profit: Math.round(units.reduce((a, u) => a + ((u.eco && u.eco.profit) || 0), 0)),
      zbyde_mesicne: acct._zbydeMesicne(st) },
    dorucenky: dor.map((d) => ({ kdy: d.created_at, kind: d.kind, amount: d.amount, prijato: d.claimed_at, popis: d.popis || d.text_kod || '' })),
    obchody: obch.map((t) => ({ id: t.id, kdy: t.created_at, od: t.from_nick, komu: t.to_nick, smer: t.smer, predmet: t.predmet, cena: t.cena, stav: t.stav, data: t.data })),
    podily: pod.map((e) => ({ id: e.id, firma: e.firma_nick, investor: e.investor_nick, podil: e.podil, cena: e.cena, vyplaceno: e.vyplaceno, stav: e.stav, dalsi: e.dalsi_at, kdy: e.created_at })),
    pujcky: puj.map((l) => ({ id: l.id, veritel: l.lender_nick, dluznik: l.borrower_nick, castka: l.castka, splaceno: l.splaceno, mesicu: l.mesicu, zmeskano: l.zmeskano, stav: l.stav })),
  });
}));

// Co hráč komu poslal / od koho dostal: vzkazy u obchodů, staré zprávy (do 14. 11. 2026) a AI posudky
async function komunikaceHrace(id) {
  const [tr, zpr, mod] = await Promise.all([
    prisma.gameTrade.findMany({ where: { OR: [{ from_id: id }, { to_id: id }], vzkaz: { not: null } }, orderBy: { created_at: 'desc' }, take: 200,
      select: { id: true, from_id: true, from_nick: true, to_nick: true, vzkaz: true, predmet: true, cena: true, created_at: true } }),
    prisma.gameMessage.findMany({ where: { OR: [{ from_id: id }, { to_id: id }] }, orderBy: { created_at: 'desc' }, take: 200 }).catch(() => []),
    prisma.gameModerace.findMany({ where: { player_id: id }, orderBy: { created_at: 'desc' }, take: 200 }).catch(() => []),
  ]);
  const nid = [...new Set(zpr.flatMap((m) => [m.from_id, m.to_id]))];
  const nn = {}; (nid.length ? await prisma.gamePlayer.findMany({ where: { id: { in: nid } }, select: { id: true, nick: true } }) : []).forEach((x) => { nn[x.id] = x.nick; });
  const posudek = {}; mod.filter((m) => m.zdroj === 'vzkaz' && m.ref_id).forEach((m) => { posudek[m.ref_id] = m; });
  const pol = [];
  tr.forEach((t) => { const m = posudek[t.id]; pol.push({ kdy: t.created_at, druh: 'vzkaz', smer: t.from_id === id ? 'poslal' : 'dostal', od: t.from_nick, komu: t.to_nick, text: t.vzkaz, k: t.predmet + (t.cena ? ' · ' + t.cena.toLocaleString('cs-CZ') + ' L$' : ''), verdikt: m ? m.verdikt : null, duvod: m ? m.duvod : null }); });
  zpr.forEach((z) => pol.push({ kdy: z.created_at, druh: 'zprava', smer: z.from_id === id ? 'poslal' : 'dostal', od: nn[z.from_id] || ('#' + z.from_id), komu: nn[z.to_id] || ('#' + z.to_id), text: z.text, k: z.reported_at ? 'nahlášeno' : '', verdikt: null, duvod: null }));
  mod.filter((m) => m.zdroj !== 'vzkaz').forEach((m) => pol.push({ kdy: m.created_at, druh: m.zdroj, smer: 'veřejné', od: null, komu: null, text: m.text, k: '', verdikt: m.verdikt, duvod: m.duvod }));
  pol.sort((a, b) => new Date(b.kdy) - new Date(a.kdy));
  return pol;
}

// GET /moderace?vse=1 — AI upozornění na texty hráčů (výchozí jen nevyřízená škodí/podezřelé)
router.get('/moderace', api(async (req, res) => {
  const vse = req.query.vse === '1';
  const where = vse ? {} : { verdikt: { in: ['skodi', 'podezrele'] }, resolved_at: null };
  if (req.query.hrac) where.player_id = parseInt(req.query.hrac, 10) || 0;
  const rows = await prisma.gameModerace.findMany({ where, orderBy: { created_at: 'desc' }, take: 300 });
  const ids = [...new Set(rows.map((r) => r.player_id))];
  const nn = {}; (ids.length ? await prisma.gamePlayer.findMany({ where: { id: { in: ids } }, select: { id: true, nick: true, company: true } }) : []).forEach((x) => { nn[x.id] = x; });
  const MD = require('../services/game/moderace');
  res.json({ ok: true, nastaveni: await MD.nastaveni(), polozky: rows.map((r) => ({ id: r.id, kdy: r.created_at, hrac_id: r.player_id, nick: (nn[r.player_id] || {}).nick || ('#' + r.player_id), firma: (nn[r.player_id] || {}).company || null,
    zdroj: MD.ZDROJE[r.zdroj] || r.zdroj, komu: r.komu, text: r.text, verdikt: r.verdikt, cil: r.cil, duvod: r.duvod, vyrizeno: r.resolved_at })) });
}));
router.post('/moderace/:id/vyrizeno', api(async (req, res) => {
  const zpet = !!(req.body && req.body.zpet);
  await prisma.gameModerace.update({ where: { id: parseInt(req.params.id, 10) }, data: { resolved_at: zpet ? null : new Date() } });
  res.json({ ok: true });
}));
// POST /moderace/nastaveni { zapnuto, jmena[] } — hlídaná jména (provozovatel, partneři, Špagetka…)
router.post('/moderace/nastaveni', api(async (req, res) => {
  const MD = require('../services/game/moderace');
  const cur = await MD.nastaveni(); const b = req.body || {};
  const v = { zapnuto: b.zapnuto !== undefined ? !!b.zapnuto : cur.zapnuto,
    jmena: Array.isArray(b.jmena) ? b.jmena.map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean).slice(0, 60) : cur.jmena,
    person_ids: Array.isArray(b.person_ids) ? b.person_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : cur.person_ids };
  const { setSetting } = require('../services/settings');
  await setSetting(MD.KEY, v, { type: 'json', description: 'Laundromat Tycoon — AI hlídání textů hráčů (hlídaná jména, příjemci upozornění)', scope: 'game', userId: req.user && req.user.id });
  res.json({ ok: true, nastaveni: v });
}));

// GET /players/:id → detail: co hráč vlastní, co utratil, kde stojí
router.get('/players/:id', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  const [karty, nakupy, mista, privedeni, zvouci] = await Promise.all([
    prisma.gameCard.findMany({ where: { player_id: id }, select: { kind: true, used_at: true, purchase_id: true, amount: true } }),
    prisma.gamePurchase.findMany({ where: { player_id: id }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.gameSpotClaim.findMany({ where: { player_id: id }, select: { spot_id: true, name: true, model: true, rent: true, takeovers: true } }),
    // Koho hráč přivedl, včetně toho, kolik u nás každý z nich utratil.
    prisma.gamePlayer.findMany({
      where: { invited_by_id: id }, orderBy: { created_at: 'desc' }, take: 200,
      select: { id: true, nick: true, company: true, created_at: true, invited_at: true, last_login_at: true,
        purchases: { where: { status: 'paid' }, select: { amount_cents: true, currency: true } } },
    }),
    p.invited_by_id
      ? prisma.gamePlayer.findUnique({ where: { id: p.invited_by_id }, select: { id: true, nick: true, company: true } })
      : null,
  ]);
  const def = acct._defaults;
  const cekaHotovost = karty.filter((c) => c.kind === acct._cashCustom && !c.used_at)
    .reduce((a, c) => a + (c.amount || 0), 0);
  const polozky = Object.keys(def).map((kind) => {
    const moje = karty.filter((c) => c.kind === kind);
    return {
      kind, name: def[kind].name, typ: def[kind].laundry ? 'penize' : 'karta',
      laundry: def[kind].laundry || null,
      nepouzito: moje.filter((c) => !c.used_at).length,
      pouzito: moje.filter((c) => c.used_at).length,
      darem: moje.filter((c) => !c.purchase_id).length,
    };
  });
  const st = p.state || {};
  res.json({ ok: true, player: {
    id: p.id, nick: p.nick, email: p.email,
    jmeno: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
    created_at: p.created_at, last_login_at: p.last_login_at, disabled: p.disabled,
    profil: st.profile || null,
    hotovost: typeof st.cash === 'number' ? Math.round(st.cash) : null,
    uver: typeof st.loan === 'number' ? Math.round(st.loan) : null,
    // Rámec a zástava v bance — bez nich se u reklamace zaplaceného balíčku
    // nedá poznat, jestli se hráči opravdu připsal.
    ramec: typeof st.bank === 'number' ? Math.round(st.bank) : null,
    zastava: typeof st.duvera === 'number' ? Math.round(st.duvera) : null,
    pradlomatu: Array.isArray(st.units) ? st.units.length : 0,
    prijem: acct._zbydeMesicne(st),
    pozvanek: st.refs || 0,
    ref: p.ref_id || null,
    sid: p.sid || null,
    // Záznam první minuty, jestli se k účtu najde.
    zaznam: p.sid ? await zaznamInfo(p.sid) : null,
    sidlo: sidloZ(st),
    znalost: znalostHrace(p, { nakupu: nakupy.filter((o) => o.status === 'paid').length, privedl: privedeni.length }),
    // Všechno, co o hráči víme (bez hesla)
    dosie: {
      firma: p.company || null, jazyk: p.jazyk || 'cs', hodnost: p.hodnost || null,
      zdroj: p.zdroj || null, pozval_ref: p.invited_by_ref || null,
      hra_h: Math.round((p.hra_s_celkem || 0) / 360) / 10, hra_dnes_min: p.hra_den ? Math.round((p.hra_s_den || 0) / 60) : null, hra_at: p.hra_at,
      plny_ucet: !!p.password_hash, facebook_at: p.facebook_at, instagram_at: p.instagram_at, distributor_do: p.distributor_do, provize: p.provize_celkem,
      geo: [p.geo_city, p.geo_region, p.geo_country].filter(Boolean).join(', ') || null, geo_presnost: p.geo_presnost, geo_isp: p.geo_isp, geo_tip: p.geo_tip, geo_at: p.geo_at,
      reg_ip: p.reg_ip || null, zarizeni: zarizeni(p.reg_ua), reg_ua: p.reg_ua || null, dev_pid: p.dev_pid || null,
      stejne_zarizeni: p.dev_pid ? await prisma.gamePlayer.count({ where: { dev_pid: p.dev_pid, id: { not: id } } }) : 0,
      stejna_ip: p.reg_ip ? await prisma.gamePlayer.count({ where: { reg_ip: p.reg_ip, id: { not: id } } }) : 0,
    },
    privedl_me: zvouci ? { id: zvouci.id, nick: zvouci.nick, firma: zvouci.company || zvouci.nick } : null,
  }, polozky, mista, ceka_hotovost: cekaHotovost,
  komunikace: await komunikaceHrace(id),
  privedeni: privedeni.map((h) => ({
    id: h.id, nick: h.nick, firma: h.company || (h.nick + ' s.r.o.'),
    kdy: h.invited_at || h.created_at, posledne: h.last_login_at,
    utratil: h.purchases.reduce((a, x) => a + kcZ(x), 0),
  })),
  nakupy: nakupy.map((o) => ({ id: o.id, kind: o.kind, qty: o.qty, castka: o.amount_cents / 100, mena: menaZ(o),
    status: o.status, created_at: o.created_at, paid_at: o.paid_at })) });
}));

// POST /players/:id/grant { kind, qty } — přidá balíčky zdarma
// Karta bez vazby na nákup (purchase_id = null) je dárek; podle toho se pozná.
router.post('/players/:id/grant', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const kind = String((req.body || {}).kind || '');
  const qty = Math.max(1, Math.min(50, parseInt((req.body || {}).qty, 10) || 1));
  if (!acct._defaults[kind]) return res.status(400).json({ error: 'Taková položka není.' });
  const p = await prisma.gamePlayer.findUnique({ where: { id }, select: { id: true, nick: true } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  await prisma.gameCard.createMany({ data: Array.from({ length: qty }, () => ({ player_id: id, kind })) });
  const kdo = (req.user && (req.user.displayName || req.user.username)) || 'admin';
  console.log('[game] dárek: ' + qty + '× ' + kind + ' → ' + p.nick + ' (přidal ' + kdo + ')');
  res.json({ ok: true, qty });
}));

// POST /players/:id/cash { amount } — přidá hotovost rovnou, bez balíčku.
// Peníze čekají jako nevyzvednuté a hráči se připíšou, jakmile má hru otevřenou.
router.post('/players/:id/cash', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const castka = Math.round(Number((req.body || {}).amount) || 0);
  if (!(castka > 0) || castka > 1000000000) return res.status(400).json({ error: 'Zadej částku mezi 1 a 1 000 000 000 L$.' });
  const p = await prisma.gamePlayer.findUnique({ where: { id }, select: { id: true, nick: true } });
  if (!p) return res.status(404).json({ error: 'Hráč nenalezen.' });
  await prisma.gameCard.create({ data: { player_id: id, kind: acct._cashCustom, amount: castka } });
  const kdo = (req.user && (req.user.displayName || req.user.username)) || 'admin';
  console.log('[game] hotovost: ' + castka.toLocaleString('cs-CZ') + ' L$ → ' + p.nick + ' (přidal ' + kdo + ')');
  res.json({ ok: true, amount: castka });
}));

// POST /players/:id/revoke { kind } — odebere jeden nepoužitý kus (když se admin ukliknul)
router.post('/players/:id/revoke', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const kind = String((req.body || {}).kind || '');
  const c = await prisma.gameCard.findFirst({ where: { player_id: id, kind, used_at: null, purchase_id: null }, orderBy: { id: 'desc' } });
  if (!c) return res.status(409).json({ error: 'Není co odebrat — zbylé kusy hráč buď zaplatil, nebo už použil.' });
  await prisma.gameCard.delete({ where: { id: c.id } });
  res.json({ ok: true });
}));

// ─── Objednávky ──────────────────────────────────────────────────────────────
router.get('/orders', api(async (req, res) => {
  const stav = String(req.query.status || '').trim();
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const rows = await prisma.gamePurchase.findMany({
    where: stav ? { status: stav } : {},
    orderBy: { created_at: 'desc' }, take,
    include: { player: { select: { nick: true, email: true, created_at: true } } },
  });
  const paid = await prisma.gamePurchase.groupBy({ by: ['currency'], where: { status: 'paid' }, _sum: { amount_cents: true }, _count: { _all: true } });
  const poMenach = {}; let ks = 0, kc = 0;
  paid.forEach((r) => { const c = String(r.currency || 'czk').toLowerCase(); poMenach[c] = (poMenach[c] || 0) + (r._sum.amount_cents || 0) / 100; ks += r._count._all; kc += MENY.naKoruny(r._sum.amount_cents || 0, c, KURZY); });
  res.json({ ok: true,
    souhrn: { zaplaceno_ks: ks, zaplaceno_kc: kc, po_menach: poMenach, kurz_eur: KURZ_EUR, kurzy: KURZY },
    orders: rows.map((o) => ({
      id: o.id, kind: o.kind, qty: o.qty, castka: o.amount_cents / 100, mena: menaZ(o), status: o.status,
      nick: o.player ? o.player.nick : null, registrace: o.player ? o.player.created_at : null, email: o.email || (o.player ? o.player.email : null),
      session: o.stripe_session, created_at: o.created_at, paid_at: o.paid_at,
      // Období předplatného se zapisuje s ID faktury Stripe (in_…), jednorázový nákup s ID checkoutu (cs_…)
      opakovana: /^in_/.test(o.stripe_session || ''),
    })) });
}));

// ─── Předplatná ──────────────────────────────────────────────────────────────
// Co komu běží a dokud. Pravda je ve Stripu, tohle je její odraz z webhooků —
// když se tu něco rozchází, chybí nejspíš zapnutá událost ve Stripu.
router.get('/predplatne', api(async (req, res) => {
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const rows = await prisma.gameSubscription.findMany({
    orderBy: { created_at: 'desc' }, take,
    include: { player: { select: { nick: true, email: true } } },
  });
  const ted = Date.now();
  const bezi = rows.filter((r) => ['active', 'past_due'].includes(r.status)
    && (!r.plati_do || new Date(r.plati_do).getTime() > ted));
  res.json({ ok: true,
    souhrn: { bezi: bezi.length, techniku: bezi.reduce((a, r) => a + (r.qty || 1), 0) },
    subs: rows.map((r) => ({
      id: r.id, kind: r.kind, qty: r.qty, status: r.status, obnovi_se: r.obnovi_se,
      plati_do: r.plati_do, nick: r.player ? r.player.nick : null,
      email: r.player ? r.player.email : null,
      stripe_sub: r.stripe_sub, created_at: r.created_at, updated_at: r.updated_at,
    })) });
}));

// POST /predplatne/:id/dorovnat — dotáhne zaplacená období přímo ze Stripu.
// Na webhook se nečeká: tohle je záchrana pro případ, kdy událost nepřišla
// (nebyla zapnutá, spadla, nebo je období starší než nasazení téhle verze).
// Zapsat se nedá dvakrát — klíčem je číslo faktury.
router.post('/predplatne/:id/dorovnat', api(async (req, res) => {
  const stripe = require('./game-stripe.routes');
  const row = await prisma.gameSubscription.findUnique({ where: { id: parseInt(req.params.id, 10) } });
  if (!row || !row.stripe_sub) return res.status(404).json({ error: 'Předplatné nenalezeno.' });
  const fa = await stripe._stripeGet('invoices?limit=12&subscription=' + encodeURIComponent(row.stripe_sub));
  const zaplacene = (fa.data || []).filter((i) => i.status === 'paid' && i.amount_paid > 0);
  const zapsane = [];
  for (const i of zaplacene) {
    const pu = await stripe._zapisObdobi(row, i.id, i.amount_paid, i.customer_email);
    if (pu) zapsane.push({ id: pu.id, castka: pu.amount_cents / 100, faktura: i.id });
  }
  // Při té příležitosti srovnáme i stav předplatného podle Stripu.
  try { await stripe._stripeGet('subscriptions/' + row.stripe_sub).then(stripe._prepisPredplatne); }
  catch (e) { console.warn('[game] stav předplatného:', e.message); }
  res.json({ ok: true, nalezeno: zaplacene.length, zapsano: zapsane.length, zapsane });
}));

// ─── Nastavení hry ───────────────────────────────────────────────────────────
// Přepínače, které mění chování hry bez nasazování. Zatím jediný: zrychlený
// onboarding (hotová města hned, první obhlídka zdarma, nájem na jedno
// klepnutí, první stroj doručený okamžitě).
router.get('/nastaveni', api(async (req, res) => {
  // Kurzy a mapování jazyk → měna jsou taky nastavení hry a mění ceník
  // skutečnými penězi, takže patří do přehledu i s tím, co zrovna platí.
  res.json({ ok: true, nastaveni: await acct._nastaveni(),
    meny: { kurzy: await MENY.kurzy(), vychozi: MENY.KURZY_VYCHOZI,
      jazyk_mena: MENY.MENA_JAZYKA, umime: Object.keys(MENY.MENY) } });
}));
router.post('/nastaveni', api(async (req, res) => {
  const klic = String((req.body || {}).klic || '').slice(0, 40);
  const hodnota = String((req.body || {}).hodnota == null ? '' : (req.body || {}).hodnota).slice(0, 200);
  if (!/^[a-z0-9_]+$/.test(klic)) return res.status(400).json({ error: 'Divný klíč.' });
  await prisma.gameSetting.upsert({
    where: { klic }, update: { hodnota }, create: { klic, hodnota },
  });
  acct._dropNastaveni();
  // Měna se čte s pětiminutovou pamětí. Po ruční změně kurzu by se nový
  // ceník rozjel až za chvíli a vypadalo by to, že se změna neuložila.
  if (/^kurz_/.test(klic) || klic === 'meny_jazyku') MENY.zapomen();
  res.json({ ok: true, nastaveni: await acct._nastaveni() });
}));

// ─── Světové události ────────────────────────────────────────────────────────
// Přehled, ruční vyhlášení a předčasné ukončení. Generátor běží sám, tohle je
// pro případy, kdy chceme něco vyhlásit schválně — nebo rychle zarazit.
router.get('/udalosti', api(async (req, res) => {
  const ted = new Date();
  const [bezi, hotove] = await Promise.all([
    prisma.gameEvent.findMany({ where: { do: { gt: ted } }, orderBy: { od: 'asc' } }),
    prisma.gameEvent.findMany({ where: { do: { lte: ted } }, orderBy: { do: 'desc' }, take: 50 }),
  ]);
  res.json({ ok: true, bezi, hotove, katalog: require('../services/game/udalosti').KATALOG });
}));
router.post('/udalosti', api(async (req, res) => {
  const b = req.body || {};
  const sablona = require('../services/game/udalosti').KATALOG
    .filter((x) => x.typ === String(b.typ || ''))[0];
  if (!sablona) return res.status(400).json({ error: 'Takový typ události neznám.' });
  const uroven = ['svet', 'zeme', 'mesto'].indexOf(String(b.uroven)) >= 0 ? String(b.uroven) : 'zeme';
  if (uroven === 'mesto' && !b.area_key) return res.status(400).json({ error: 'Chybí město.' });
  if (uroven === 'zeme' && !b.zeme) return res.status(400).json({ error: 'Chybí země.' });
  const hodin = Math.max(1, Math.min(720, Number(b.hodin) || 24));
  const od = new Date();
  const e = await prisma.gameEvent.create({ data: {
    typ: sablona.typ, nazev: String(b.nazev || sablona.nazev).slice(0, 120),
    popis: String(b.popis || sablona.popis).slice(0, 1000), ikona: sablona.ikona,
    dobra: !!sablona.dobra, uroven, zavaznost: sablona.zavaznost,
    dopad: b.dopad && typeof b.dopad === 'object' ? b.dopad : sablona.dopad,
    zeme: uroven === 'svet' ? null : String(b.zeme || '').toLowerCase().slice(0, 2) || null,
    area_key: uroven === 'mesto' ? String(b.area_key).slice(0, 80) : null,
    od, do: new Date(od.getTime() + hodin * 3600000), rucni: true,
    autor: (req.user && (req.user.email || req.user.name)) || null,
  } });
  try { require('./game.routes')._dropUdalosti(); } catch (err) { /* jen cache */ }
  console.log('[game-udalosti] ručně vyhlášeno: ' + e.nazev + ' · ' + uroven);
  res.json({ ok: true, udalost: e });
}));
// Ukončit hned — do se posune na teď, takže se to chová jako doběhlá událost.
router.post('/udalosti/:id/konec', api(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const e = await prisma.gameEvent.findUnique({ where: { id } });
  if (!e) return res.status(404).json({ error: 'Taková událost tu není.' });
  const u = await prisma.gameEvent.update({ where: { id }, data: { do: new Date() } });
  try { require('./game.routes')._dropUdalosti(); } catch (err) { /* jen cache */ }
  res.json({ ok: true, udalost: u });
}));

// ─── Ceník ───────────────────────────────────────────────────────────────────
router.get('/prices', api(async (req, res) => {
  const def = acct._defaults;
  const rows = await prisma.gamePrice.findMany();
  const m = {}; rows.forEach((r) => { m[r.kind] = r; });
  res.json({ ok: true, prices: Object.keys(def).map((k) => {
    const d = def[k], u = m[k];
    return {
      kind: k, name: d.name,   // název je z kódu, ceník drží jen cenu
      typ: d.laundry ? 'penize' : 'karta',
      price_czk: (u ? u.price : d.price) / 100,
      vychozi_czk: d.price / 100,
      laundry: u && u.laundry != null ? u.laundry : (d.laundry || null),
      vychozi_laundry: d.laundry || null,
      active: u ? u.active : true,
      zmeneno: u ? u.updated_at : null, kdo: u ? u.updated_by : null,
    };
  }) });
}));

// POST /prices { kind, price_czk, laundry, active }
router.post('/prices', api(async (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '');
  const def = acct._defaults[kind];
  if (!def) return res.status(400).json({ error: 'Taková položka není.' });
  const czk = Number(b.price_czk);
  if (!Number.isFinite(czk) || czk < 1 || czk > 100000) return res.status(400).json({ error: 'Cena musí být mezi 1 a 100 000 Kč.' });
  const laundry = def.laundry != null ? Math.max(1, Math.round(Number(b.laundry) || def.laundry)) : null;
  const kdo = (req.user && (req.user.displayName || req.user.username)) || null;
  const data = { price: Math.round(czk * 100), laundry, active: b.active !== false, updated_by: kdo, name: def.name };
  await prisma.gamePrice.upsert({ where: { kind }, create: Object.assign({ kind }, data), update: data });
  acct._dropPrices();   // ať se změna projeví hned, ne až vyprší minutová paměť
  res.json({ ok: true });
}));

// ─── Statistiky ──────────────────────────────────────────────────────────────
// GET /stats?dny=30 → návštěvy, registrace, tržby a trychtýř
// ─── Provize ─────────────────────────────────────────────────────────
// GET /provize?nick=&limit= → kompletní kniha vyplacených provizí. Komu se co
// připsalo, za koho a kdy — včetně toho, jestli si to hráč už vyzvedl ve hře.
// Dorovnání po startu serveru se tu pozná podle data: je pozdější než nákup.
router.get('/provize', api(async (req, res) => {
  const nick = String(req.query.nick || '').trim().slice(0, 60);
  const take = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 200));
  const kde = { kind: 'cash', popis: { startsWith: 'Provize' } };
  if (nick) {
    const kdo = await prisma.gamePlayer.findMany({
      where: { OR: [{ nick: { contains: nick, mode: 'insensitive' } },
                    { company: { contains: nick, mode: 'insensitive' } }] },
      select: { id: true } });
    kde.player_id = { in: kdo.map((x) => x.id) };
  }
  const rows = await prisma.gameDelivery.findMany({
    where: kde, orderBy: { id: 'desc' }, take,
    select: { id: true, player_id: true, amount: true, popis: true, spot_id: true,
      created_at: true, claimed_at: true } });
  const hraci = await prisma.gamePlayer.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.player_id))] } },
    select: { id: true, nick: true, company: true, provize_celkem: true, distributor_do: true } });
  const podleId = {};
  hraci.forEach((h) => { podleId[h.id] = h; });
  const souhrn = {};
  rows.forEach((r) => {
    const h = podleId[r.player_id] || {};
    const k = h.nick || ('#' + r.player_id);
    if (!souhrn[k]) souhrn[k] = { nick: k, firma: h.firma || h.company || null, kusu: 0, castka: 0,
      nevyzvednuto: 0, provize_celkem: h.provize_celkem || 0, distributor_do: h.distributor_do || null };
    souhrn[k].kusu++;
    souhrn[k].castka += r.amount || 0;
    if (!r.claimed_at) souhrn[k].nevyzvednuto += r.amount || 0;
  });
  res.json({ ok: true, celkem: rows.length,
    souhrn: Object.keys(souhrn).map((k) => souhrn[k]).sort((a, b) => b.castka - a.castka),
    provize: rows.map((r) => {
      const h = podleId[r.player_id] || {};
      return { id: r.id, komu: h.nick || ('#' + r.player_id), firma: h.company || null,
        castka: r.amount,
        // V popisu je za pomlčkou „Kdo koupil co“ — přesně to, co chceme vidět.
        za: (String(r.popis || '').split(' \u2014 ')[1] || String(r.popis || '')).trim(),
        klic: r.spot_id || null,
        kdy: r.created_at, vyzvednuto: r.claimed_at || null };
    }) });
}));

// POST /provize/dorovnat → dopočítá a připočte všechno, co ještě nebylo vyplaceno.
// Stejná úloha, která jinak běží při startu serveru — jen se dá spustit ručně,
// když se nemá čekat na restart. Je idempotentní, opakovaný běh nic nepřiplatí.
router.post('/provize/dorovnat', api(async (req, res) => {
  const vysledek = await require('../services/game/provize').dorovnejVsem();
  res.json({ ok: true, ...vysledek });
}));

// GET /provize/kontrola → kde se počty rozcházejí. Za každýho pozvaného se
// spočítá, kolik má strojů (postavené, na cestě i skladem) a kolik provizí za něj
// zvoucí dostal. Co nesedí, je buď k dorovnání, nebo distribuce nebyla zapnutá.
router.get('/provize/kontrola', api(async (req, res) => {
  const [hraci, davky, mista] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { disabled: false },
      select: { id: true, nick: true, company: true, ref_id: true, state: true,
        invited_by_id: true, invited_by_ref: true, distributor_do: true } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } },
      select: { player_id: true, spot_id: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
  ]);
  // Čí je které místo — starší provize mají v klíči id místa, ne id hráče.
  const majitelMista = {};
  mista.forEach((m) => { majitelMista[m.spot_id] = m.player_id; });
  const podleId = {}, podleRef = {};
  hraci.forEach((h) => { podleId[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; });
  // Klíče provizí: „nakup:<id pozvaného>:<pořadí>“, starší jsou id místa.
  const zaplaceno = {};
  davky.forEach((d) => {
    const klic = String(d.spot_id || '');
    const m = /^nakup:(\d+):/.exec(klic);
    const za = m ? Number(m[1]) : majitelMista[klic];
    if (!za) return;
    const k = d.player_id + '|' + za;
    zaplaceno[k] = (zaplaceno[k] || 0) + 1;
  });
  const ted = new Date();
  const radky = [];
  hraci.forEach((h) => {
    const zvouci = podleId[h.invited_by_id] || podleRef[h.invited_by_ref];
    if (!zvouci || zvouci.id === h.id) return;
    const stroju = acct._strojeHrace(h.state).length;
    if (!stroju) return;
    const vyplaceno = zaplaceno[zvouci.id + '|' + h.id] || 0;
    radky.push({ pozvany: h.nick, firma: h.company || null, zvouci: zvouci.nick,
      vazba: h.invited_by_id ? 'napevno' : 'přes odkaz',
      stroju, provizi: vyplaceno, chybi: Math.max(0, stroju - vyplaceno),
      distribuce: !!(zvouci.distributor_do && new Date(zvouci.distributor_do) > ted) });
  });
  radky.sort((a, b) => b.chybi - a.chybi || a.zvouci.localeCompare(b.zvouci));
  res.json({ ok: true,
    chybi_celkem: radky.reduce((a, r) => a + (r.distribuce ? r.chybi : 0), 0),
    chybi_bez_distribuce: radky.reduce((a, r) => a + (r.distribuce ? 0 : r.chybi), 0),
    radky });
}));

// ─── Spojené účty ────────────────────────────────────────────────────────────
// GET /multi → skupiny účtů, které spolu nejspíš souvisí.
//
// Nic to neblokuje a hráč o tom neví. Jen to poskládá, co už víme: z jakého
// prohlížeče účet vznikl (trvalé id, které si klient nese sám), z jaké IP a
// z jaké sítě — a k tomu, kdo koho pozval a kolik na tom zvoucí vydělal.
//
// Čte se to opatrně: jedna IP neznamená podvod. Rodina u jedné wifi, kolej
// nebo mobilní síť (operátoři sdílejí jednu IP mezi stovky lidí) vypadají
// stejně. Důkaz je až spojení „stejné zařízení + jeden pozval druhého".
const IP_SIT = (ip) => {
  const x = String(ip || '');
  if (!x) return null;
  if (x.indexOf(':') >= 0) return x.split(':').slice(0, 4).join(':') + '::/64';
  const o = x.split('.');
  return o.length === 4 ? o.slice(0, 3).join('.') + '.0/24' : null;
};
router.get('/multi', api(async (req, res) => {
  const [hraci, davky, mista] = await Promise.all([
    prisma.gamePlayer.findMany({
      select: { id: true, nick: true, company: true, created_at: true, last_login_at: true,
        invited_by_id: true, invited_by_ref: true, ref_id: true, sid: true, state: true,
        dev_pid: true, reg_ip: true, reg_ua: true, zdroj: true, disabled: true,
        hra_s_celkem: true, provize_celkem: true, email: true },
      orderBy: { id: 'asc' } }),
    prisma.gameDelivery.findMany({ where: { kind: 'cash', popis: { startsWith: 'Provize' } },
      select: { player_id: true, spot_id: true, amount: true } }),
    prisma.gameSpotClaim.findMany({ select: { player_id: true, spot_id: true } }),
  ]);
  // Starší účty stopu u sebe nemají — dohledá se z první události té návštěvy.
  const sidy = hraci.filter((h) => !h.reg_ip && h.sid).map((h) => h.sid);
  const prvni = {};
  if (sidy.length) {
    const ev = await prisma.compounderEvent.findMany({
      where: { sid: { in: sidy.slice(0, 2000) } },
      select: { sid: true, ip: true, ua: true }, orderBy: { id: 'asc' }, take: 20000 });
    ev.forEach((e) => { if (!prvni[e.sid] && e.ip) prvni[e.sid] = e; });
  }
  hraci.forEach((h) => {
    const e = !h.reg_ip && h.sid ? prvni[h.sid] : null;
    h._ip = h.reg_ip || (e && e.ip) || null;
    h._ua = h.reg_ua || (e && e.ua) || null;
  });

  // Kdo koho pozval a kolik za něj zvoucí dostal.
  const podleId = {}, podleRef = {};
  hraci.forEach((h) => { podleId[h.id] = h; if (h.ref_id) podleRef[h.ref_id] = h; });
  const majitelMista = {};
  mista.forEach((m) => { majitelMista[m.spot_id] = m.player_id; });
  const provize = {};   // "zvouci|pozvany" → { kusu, castka }
  davky.forEach((d) => {
    const klic = String(d.spot_id || '');
    const m = /^nakup:(\d+):/.exec(klic);
    const za = m ? Number(m[1]) : majitelMista[klic];
    if (!za) return;
    const k = d.player_id + '|' + za;
    const z = provize[k] || (provize[k] = { kusu: 0, castka: 0 });
    z.kusu++; z.castka += Number(d.amount) || 0;
  });
  const zvouciOd = (h) => podleId[h.invited_by_id] || podleRef[h.invited_by_ref] || null;

  // Spojíme účty, které sdílí zařízení, IP nebo síť. Každé spojení si pamatuje,
  // čím vzniklo — bez toho by se „stejná mobilní síť" četla jako důkaz.
  const rodic = {};
  const najdi = (x) => { while (rodic[x] !== x) { rodic[x] = rodic[rodic[x]]; x = rodic[x]; } return x; };
  const spoj = (a, b) => { a = najdi(a); b = najdi(b); if (a !== b) rodic[b] = a; };
  hraci.forEach((h) => { rodic[h.id] = h.id; });
  const klice = { dev: {}, ip: {}, sit: {} };
  hraci.forEach((h) => {
    if (h.dev_pid) (klice.dev[h.dev_pid] = klice.dev[h.dev_pid] || []).push(h.id);
    if (h._ip) (klice.ip[h._ip] = klice.ip[h._ip] || []).push(h.id);
    const sit = IP_SIT(h._ip);
    if (sit) (klice.sit[sit] = klice.sit[sit] || []).push(h.id);
  });
  ['dev', 'ip', 'sit'].forEach((druh) => {
    Object.keys(klice[druh]).forEach((k) => {
      const l = klice[druh][k];
      for (let i = 1; i < l.length; i++) spoj(l[0], l[i]);
    });
  });
  // Pozvánka sama o sobě skupinu nedělá — jinak by v jedné skupině skončila
  // celá hra. Jen zpřísňuje hodnocení skupiny, která vznikla ze zařízení či IP.

  const skupiny = {};
  hraci.forEach((h) => {
    const k = najdi(h.id);
    (skupiny[k] = skupiny[k] || []).push(h);
  });
  const ven = [];
  Object.keys(skupiny).forEach((k) => {
    const cl = skupiny[k];
    if (cl.length < 2) return;
    const ids = {};
    cl.forEach((h) => { ids[h.id] = 1; });
    // Čím jsou spojení: stejný prohlížeč váží nejvíc, stejná síť nejmíň.
    const devy = {}, ipy = {}, site = {};
    cl.forEach((h) => {
      if (h.dev_pid) devy[h.dev_pid] = (devy[h.dev_pid] || 0) + 1;
      if (h._ip) ipy[h._ip] = (ipy[h._ip] || 0) + 1;
      const s2 = IP_SIT(h._ip); if (s2) site[s2] = (site[s2] || 0) + 1;
    });
    const sdileneZarizeni = Object.keys(devy).some((x) => devy[x] > 1);
    const sdilenaIp = Object.keys(ipy).some((x) => ipy[x] > 1);
    let uvnitrProvize = 0, uvnitrKusu = 0, pozvanihVeSkupine = 0;
    const clenove = cl.map((h) => {
      const z = zvouciOd(h);
      const vlastni = z && ids[z.id] ? 1 : 0;
      if (vlastni) pozvanihVeSkupine++;
      const pr = z ? (provize[z.id + '|' + h.id] || null) : null;
      if (vlastni && pr) { uvnitrProvize += pr.castka; uvnitrKusu += pr.kusu; }
      return {
        id: h.id, nick: h.nick, firma: h.company || null, zalozeno: h.created_at,
        naposledy: h.last_login_at, odehrano_s: h.hra_s_celkem || 0,
        stroju: acct._strojeHrace(h.state).length,
        pozval: z ? z.nick : null, pozval_ze_skupiny: !!vlastni,
        provize_za_nej: pr ? pr.castka : 0, provizi_kusu: pr ? pr.kusu : 0,
        zdroj: h.zdroj || null, ma_email: !!h.email, zablokovan: !!h.disabled,
        zarizeni: h.dev_pid || null, ip: h._ip || null, sit: IP_SIT(h._ip),
        prohlizec: (h._ua || '').slice(0, 120) || null,
      };
    });
    clenove.sort((a, b) => new Date(a.zalozeno) - new Date(b.zalozeno));
    const casy = clenove.map((c) => new Date(c.zalozeno).getTime());
    const rozpeti = Math.max(0, Math.max.apply(null, casy) - Math.min.apply(null, casy));
    // Hodnocení. Samotná sdílená síť je slabá stopa, teprve pozvánka uvnitř
    // skupiny z toho dělá něco, co stojí za pohled.
    let uroven = 'nizka', proc = [];
    if (sdileneZarizeni) proc.push('stejný prohlížeč');
    else if (sdilenaIp) proc.push('stejná IP');
    else proc.push('stejná síť');
    if (pozvanihVeSkupine) proc.push('pozvánka uvnitř skupiny');
    if (uvnitrProvize) proc.push('provize uvnitř skupiny');
    if (rozpeti && rozpeti < 2 * 3600e3) proc.push('účty vznikly do dvou hodin po sobě');
    if (clenove.some((c) => c.odehrano_s < 300 && c.stroju > 0)) proc.push('stroj po pár minutách hry');
    if (pozvanihVeSkupine && (sdileneZarizeni || sdilenaIp)) uroven = 'vysoka';
    else if (pozvanihVeSkupine || sdileneZarizeni) uroven = 'stredni';
    ven.push({ uroven, proc, clenu: clenove.length, pozvanych_uvnitr: pozvanihVeSkupine,
      provize_uvnitr: uvnitrProvize, provizi_kusu: uvnitrKusu,
      rozpeti_minut: Math.round(rozpeti / 60000),
      zarizeni_sdilene: sdileneZarizeni, ip_sdilena: sdilenaIp, clenove });
  });
  const vaha = { vysoka: 3, stredni: 2, nizka: 1 };
  ven.sort((a, b) => vaha[b.uroven] - vaha[a.uroven] || b.provize_uvnitr - a.provize_uvnitr || b.clenu - a.clenu);
  res.json({ ok: true, skupin: ven.length,
    bez_stopy: hraci.filter((h) => !h._ip && !h.dev_pid).length,
    hracu: hraci.length, skupiny: ven });
}));

router.get('/stats', api(async (req, res) => {
  const dny = Math.min(180, Math.max(7, parseInt(req.query.dny, 10) || 30));
  const od = new Date(Date.now() - dny * 86400e3);

  const [hraci, nakupy, udalosti, mista, celkem] = await Promise.all([
    prisma.gamePlayer.findMany({ where: { created_at: { gte: od } }, select: { created_at: true } }),
    prisma.gamePurchase.findMany({ where: { status: 'paid', paid_at: { gte: od } }, select: { paid_at: true, amount_cents: true, currency: true, kind: true } }),
    prisma.compounderEvent.findMany({ where: { created_at: { gte: od }, event: { startsWith: 'game_' } },
      select: { created_at: true, event: true, sid: true } }),
    prisma.gameSpotClaim.count(),
    prisma.gamePlayer.count(),
  ]);

  const dni = {};
  for (let i = 0; i < dny; i++) dni[den(Date.now() - i * 86400e3)] = { den: den(Date.now() - i * 86400e3), navstev: 0, registraci: 0, trzba: 0 };
  const navstevnici = {};
  udalosti.forEach((e) => {
    const d = den(e.created_at);
    if (e.event === 'game_open' && dni[d]) {
      const k = d + '|' + e.sid;
      if (!navstevnici[k]) { navstevnici[k] = 1; dni[d].navstev++; }
    }
  });
  hraci.forEach((h) => { const d = den(h.created_at); if (dni[d]) dni[d].registraci++; });
  nakupy.forEach((n) => { const d = den(n.paid_at); if (dni[d]) dni[d].trzba += kcZ(n); });

  // Trychtýř: kolik lidí hru otevřelo a kolik jich došlo dál.
  const sidy = new Set(udalosti.filter((e) => e.event === 'game_open').map((e) => e.sid));
  const krok = (ev) => new Set(udalosti.filter((e) => e.event === ev).map((e) => e.sid)).size;
  const trzbaCelkem = nakupy.reduce((a, n) => a + kcZ(n), 0);
  const podleDruhu = {};
  nakupy.forEach((n) => { podleDruhu[n.kind] = (podleDruhu[n.kind] || 0) + kcZ(n); });

  // Retence: vrátil se hráč den po registraci? A po týdnu? Bereme to podle
  // toho, kdy si naposledy uložil stav — hra ukládá průběžně, takže „poslední
  // uložení" je spolehlivá stopa toho, dokdy hrál.
  const vsichni = await prisma.gamePlayer.findMany({
    where: { disabled: false }, select: { created_at: true, state_at: true } });
  const zil = (h, dnu) => h.state_at
    && new Date(h.state_at).getTime() - new Date(h.created_at).getTime() >= dnu * 86400e3;
  const tydny = {};
  vsichni.forEach((h) => {
    const t = new Date(h.created_at);
    const pon = new Date(t.getTime() - ((t.getDay() + 6) % 7) * 86400e3);
    const k = den(pon);
    const r = tydny[k] || (tydny[k] = { tyden: k, registraci: 0, d1: 0, d7: 0 });
    r.registraci++;
    if (zil(h, 1)) r.d1++;
    if (zil(h, 7)) r.d7++;
  });
  const retence = {
    registraci: vsichni.length,
    d1: vsichni.filter((h) => zil(h, 1)).length,
    d7: vsichni.filter((h) => zil(h, 7)).length,
    cohorty: Object.values(tydny).sort((a, b) => (a.tyden < b.tyden ? 1 : -1)).slice(0, 8),
  };

  res.json({ ok: true, dny, retence,
    souhrn: { hracu_celkem: celkem, obsazenych_mist: mista, trzba_obdobi: Math.round(trzbaCelkem), nakupu_obdobi: nakupy.length },
    trychtyr: [
      // Trychtýř začíná načtením stránky, ne spuštěním hry: mezi tím se stahuje
      // game.js a kdo to nedočká, nebyl dřív vidět nikde.
      { krok: 'Načetli stránku', pocet: krok('game_nacita') },
      { krok: 'Spustila se hra', pocet: sidy.size },
      { krok: 'Vrátili se do rozehrané', pocet: krok('game_zpet'), vedlejsi: true },
      { krok: 'Viděli úvod (jen noví)', pocet: krok('game_intro') },
      { krok: 'Dokončili dotazník', pocet: krok('game_quiz') },
      { krok: 'Založili účet', pocet: krok('game_register') },
      // Mezi účtem a prvním prádlomatem je pět kroků tutoriálu. Teprve
      // s nimi je vidět, na kterém hráči odpadají.
      { krok: '1 · Vybrat město', pocet: krok('game_tut1') },
      { krok: 'Prozkoumali město', pocet: krok('game_scout') },
      { krok: '2 · Prověřit místo a nájem', pocet: krok('game_tut2') },
      { krok: '3 · Koupit prádlomat', pocet: krok('game_tut3') },
      { krok: '4 · Čekání na dodání', pocet: krok('game_tut4') },
      { krok: '5 · Postavit', pocet: krok('game_tut5') },
      { krok: 'Postavili prádlomat', pocet: krok('game_build') },
      { krok: 'Zaplatili', pocet: krok('game_paid') },
    ],
    trzba_podle_druhu: podleDruhu,
    rady: Object.values(dni).sort((a, b) => (a.den < b.den ? -1 : 1)),
  });
}));

// GET /stats/reklama?dny=30[&funnel=<id>] → po dnech: kolik šlo do reklamy (Meta, kampaně napojené na funnel
// „Tycoon" v Centru reklamy) a kolik lidé ve hře zaplatili → zisk / ztráta. Tržba je bez DPH (21 %).
router.get('/stats/reklama', api(async (req, res) => {
  const dk = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const isD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  // Období: ?od=YYYY-MM-DD&do=YYYY-MM-DD (max 366 dní), jinak posledních ?dny dní
  let odK, doK;
  if (isD(req.query.od) && isD(req.query.do) && req.query.od <= req.query.do) { odK = req.query.od; doK = req.query.do; }
  else { const n = Math.min(180, Math.max(1, parseInt(req.query.dny, 10) || 30)); doK = dk(Date.now()); odK = dk(Date.now() - (n - 1) * 86400e3); }
  const dni = {}; const seznam = [];
  for (let t = new Date(odK + 'T12:00:00Z'); ; t = new Date(t.getTime() + 86400e3)) {
    const k = t.toISOString().slice(0, 10); if (k > doK || seznam.length >= 366) break;
    dni[k] = { den: k, vydaj: 0, zobrazeni: 0, kliky: 0, registraci: 0, trzba: 0, nakupu: 0 }; seznam.push(k);
  }
  const dny = seznam.length;
  const od = new Date(new Date(odK + 'T00:00:00Z').getTime() - 86400e3), dok = new Date(new Date(doK + 'T00:00:00Z').getTime() + 2 * 86400e3);
  const [nakupy, hraci] = await Promise.all([
    prisma.gamePurchase.findMany({ where: { status: 'paid', paid_at: { gte: od, lt: dok } }, select: { paid_at: true, amount_cents: true, currency: true } }),
    prisma.gamePlayer.findMany({ where: { created_at: { gte: od, lt: dok } }, select: { created_at: true } }),
  ]);
  nakupy.forEach((n) => { const r = dni[dk(n.paid_at)]; if (r) { r.trzba += kcZ(n) / 1.21; r.nakupu++; } });
  hraci.forEach((h) => { const r = dni[dk(h.created_at)]; if (r) r.registraci++; });

  const ads = require('./ads-center.routes');
  let funnel = null, kampane = [], chyba = null;
  try {
    const fl = await ads.loadFunnels();
    funnel = (req.query.funnel && fl.find((f) => String(f.id) === String(req.query.funnel)))
      || fl.find((f) => /tycoon|game/i.test(String(f.name || f.title || '')));
    if (!funnel) chyba = 'V Centru reklamy jsem nenašel funnel „Tycoon" — výdaje na reklamu nejsou k dispozici.';
    else {
      const starts = (funnel.nodes || []).filter((n) => n.kind === 'start' && n.meta && n.meta.campaign && n.meta.campaign.id);
      const c = await ads.metaCfg(req);
      if (!c.token) chyba = 'Meta Ads není napojená (Centrum reklamy → Nastavení).';
      else if (!starts.length) chyba = 'Startovní bod funnelu nemá napojenou kampaň.';
      else {
        const tr = JSON.stringify({ since: odK, until: doK });
        for (const nd of starts) {
          const id = String(nd.meta.campaign.id).replace(/[^0-9]/g, '');
          try {
            const j = await ads.metaGraph(id + '/insights', { fields: 'spend,impressions,inline_link_clicks', time_increment: 1, time_range: tr, limit: 500 }, c.token);
            (j.data || []).forEach((r) => { const x = dni[r.date_start]; if (x) { x.vydaj += Number(r.spend || 0); x.zobrazeni += Number(r.impressions || 0); x.kliky += Number(r.inline_link_clicks || 0); } });
            kampane.push(nd.meta.campaign.name || id);
          } catch (e) { chyba = 'Meta: ' + e.message; }
        }
      }
    }
  } catch (e) { chyba = 'Reklamu se nepodařilo načíst: ' + e.message; }

  let kum = 0;
  const R2 = (n) => Math.round(n * 100) / 100;
  const rady = Object.values(dni).sort((a, b) => (a.den < b.den ? -1 : 1)).map((r) => {
    const zisk = r.trzba - r.vydaj; kum += zisk;
    return { den: r.den, vydaj: R2(r.vydaj), zobrazeni: r.zobrazeni, kliky: r.kliky, registraci: r.registraci, trzba: R2(r.trzba), nakupu: r.nakupu, zisk: R2(zisk), kumulativne: R2(kum) };
  });
  const sum = rady.reduce((a, r) => ({ vydaj: a.vydaj + r.vydaj, trzba: a.trzba + r.trzba, reg: a.reg + r.registraci, nak: a.nak + r.nakupu, kl: a.kl + r.kliky }), { vydaj: 0, trzba: 0, reg: 0, nak: 0, kl: 0 });
  const plus = rady.filter((r) => r.zisk > 0).length, minus = rady.filter((r) => r.zisk < 0).length;
  res.json({ ok: true, dny, od: odK, do: doK, funnel: funnel ? { id: funnel.id, name: funnel.name || funnel.title } : null, kampane, chyba, rady,
    souhrn: { vydaj: Math.round(sum.vydaj), trzba: Math.round(sum.trzba), zisk: Math.round(sum.trzba - sum.vydaj), roas: sum.vydaj > 0 ? R2(sum.trzba / sum.vydaj) : null,
      dnu_plus: plus, dnu_minus: minus, registraci: sum.reg, nakupu: sum.nak, kliku: sum.kl,
      cena_registrace: sum.reg ? R2(sum.vydaj / sum.reg) : null, cena_nakupu: sum.nak ? R2(sum.vydaj / sum.nak) : null } });
}));

// GET /stats/provoz → kdo je na hře právě teď. Návštěvy se poznají podle stop,
// které hra posílá (otevření a pak každých pár minut, dokud ji má hráč
// otevřenou), hráči podle toho, kdy si naposled uložili stav.
router.get('/stats/provoz', api(async (req, res) => {
  const ted = Date.now();
  const od24 = new Date(ted - 24 * 3600e3);
  const [udalosti, hraci, posledni, casy] = await Promise.all([
    prisma.compounderEvent.findMany({
      where: { created_at: { gte: od24 }, event: { startsWith: 'game_' } },
      select: { created_at: true, event: true, sid: true } }),
    prisma.gamePlayer.findMany({
      where: { state_at: { gte: new Date(ted - 60 * 60e3) }, disabled: false },
      select: { id: true, nick: true, company: true, state_at: true, created_at: true } }),
    prisma.compounderEvent.findMany({
      where: { event: { startsWith: 'game_' } },
      orderBy: { created_at: 'desc' }, take: 30,
      select: { created_at: true, event: true, sid: true } }),
    // Čas ve hře: server ho sčítá hráčům při ukládání stavu.
    prisma.gamePlayer.findMany({
      where: { disabled: false, hra_s_celkem: { gt: 0 } },
      orderBy: { hra_s_celkem: 'desc' }, take: 50,
      select: { id: true, nick: true, company: true, hra_s_den: true, hra_s_celkem: true,
        hra_den: true, hra_at: true, created_at: true } }),
  ]);
  const dnesek = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const casyVen = casy.map((h) => ({
    id: h.id, nick: h.nick, firma: h.company,
    dnes: h.hra_den === dnesek ? (h.hra_s_den || 0) : 0,
    celkem: h.hra_s_celkem || 0,
    dni: Math.max(1, Math.round((ted - new Date(h.created_at).getTime()) / 86400e3)),
    naposled: h.hra_at,
    zalozeno: h.created_at,
  }));
  const cas = (e) => new Date(e.created_at).getTime();
  const unikat = (ms) => new Set(udalosti.filter((e) => ted - cas(e) <= ms).map((e) => e.sid)).size;
  // Po hodinách za posledních 24 hodin — ať je vidět, kdy se hraje.
  const hodiny = [];
  for (let i = 23; i >= 0; i--) {
    const konec = ted - i * 3600e3, zacatek = konec - 3600e3;
    const v = udalosti.filter((e) => cas(e) > zacatek && cas(e) <= konec);
    hodiny.push({ hodina: new Date(konec).getHours(),
      navstev: new Set(v.map((e) => e.sid)).size,
      akci: v.filter((e) => e.event !== 'game_zije').length });
  }
  const podleUdalosti = {};
  udalosti.forEach((e) => { podleUdalosti[e.event] = (podleUdalosti[e.event] || 0) + 1; });
  res.json({ ok: true, ted: new Date().toISOString(),
    ted5: unikat(6 * 60e3), hodina: unikat(3600e3), den: unikat(24 * 3600e3),
    hracu_online: hraci.filter((h) => ted - new Date(h.state_at).getTime() <= 10 * 60e3).length,
    online: hraci
      .sort((a, b) => new Date(b.state_at).getTime() - new Date(a.state_at).getTime())
      .slice(0, 25)
      .map((h) => ({ id: h.id, nick: h.nick, firma: h.company,
        pred: Math.max(0, Math.round((ted - new Date(h.state_at).getTime()) / 60000)), zalozeno: h.created_at })),
    hodiny,
    casy: casyVen.slice().sort((a, b) => (b.dnes - a.dnes) || (b.celkem - a.celkem)),
    cas_souhrn: {
      dnes: casyVen.reduce((a, h) => a + h.dnes, 0),
      celkem: casyVen.reduce((a, h) => a + h.celkem, 0),
      hracu_dnes: casyVen.filter((h) => h.dnes > 0).length,
    },
    udalosti: podleUdalosti,
    posledni: posledni.map((e) => ({ kdy: e.created_at, event: e.event, sid: String(e.sid || '').slice(0, 6) })),
  });
}));

// ─── Záznamy první minuty ────────────────────────────────────────────────────
// Z první návštěvy se nahrává prvních šedesát vteřin dění na stránce. Tady se
// to jen čte: seznam záznamů a pak všechny části jednoho záznamu za sebou.
async function zaznamInfo(sid) {
  const casti = await prisma.gameReplay.findMany({
    where: { sid }, orderBy: { poradi: 'asc' },
    select: { poradi: true, ms: true, bajtu: true, created_at: true } });
  if (!casti.length) return null;
  return { sid, casti: casti.length, ms: Math.max.apply(null, casti.map((c) => c.ms || 0)),
    bajtu: casti.reduce((a, c) => a + (c.bajtu || 0), 0), kdy: casti[0].created_at };
}

// GET /zaznamy → poslední nahrané první minuty, i od návštěvníků bez účtu.
router.get('/zaznamy', api(async (req, res) => {
  const take = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 40));
  const prvni = await prisma.gameReplay.findMany({
    where: { poradi: 0 }, orderBy: { created_at: 'desc' }, take,
    select: { sid: true, created_at: true, ua: true, zdroj: true } });
  const sidy = prvni.map((r) => r.sid);
  const [casti, hraci] = await Promise.all([
    prisma.gameReplay.findMany({ where: { sid: { in: sidy } },
      select: { sid: true, ms: true, bajtu: true } }),
    prisma.gamePlayer.findMany({ where: { sid: { in: sidy } },
      select: { id: true, nick: true, company: true, sid: true, zdroj: true, created_at: true } }),
  ]);
  const H = {}; hraci.forEach((h) => { H[h.sid] = h; });
  res.json({ ok: true, zaznamy: prvni.map((r) => {
    const moje = casti.filter((c) => c.sid === r.sid);
    const h = H[r.sid] || null;
    return {
      sid: r.sid, kdy: r.created_at, zdroj: r.zdroj || (h ? h.zdroj : null),
      ms: Math.max.apply(null, moje.map((c) => c.ms || 0).concat([0])),
      bajtu: moje.reduce((a, c) => a + (c.bajtu || 0), 0),
      casti: moje.length,
      mobil: /Mobile|Android|iPhone/i.test(String(r.ua || '')),
      hrac: h ? { id: h.id, nick: h.nick, firma: h.company, zdroj: h.zdroj,
        zalozil_po_ms: new Date(h.created_at).getTime() - new Date(r.created_at).getTime() } : null,
    };
  }) });
}));

// GET /zaznam?sid=… → všechny části jednoho záznamu slepené za sebou.
router.get('/zaznam', api(async (req, res) => {
  const sid = String(req.query.sid || '').slice(0, 64);
  if (!/^[a-z0-9-]{6,64}$/.test(sid)) return res.status(400).json({ error: 'Chybí sid.' });
  const casti = await prisma.gameReplay.findMany({ where: { sid }, orderBy: { poradi: 'asc' } });
  if (!casti.length) return res.status(404).json({ error: 'Záznam tu není.' });
  let udalosti = [];
  casti.forEach((c) => { if (Array.isArray(c.udalosti)) udalosti = udalosti.concat(c.udalosti); });
  const hrac = await prisma.gamePlayer.findFirst({ where: { sid },
    select: { id: true, nick: true, company: true } });
  res.json({ ok: true, sid, kdy: casti[0].created_at, casti: casti.length,
    ms: Math.max.apply(null, casti.map((c) => c.ms || 0)), hrac, udalosti });
}));

// ─── Odkud hráči přišli: reklama / doporučení jiného hráče / jiný označený zdroj / neidentifikováno ───
// Účty založené v období. Doporučení = pozvánka od hráče (invited_by), reklama = zdroj z reklamy
// (utm_source / fbclid: facebook, instagram, google, tiktok…), jiný zdroj = označený odkaz, který není reklama.
const REKLAMA_RE = /(facebook|^fb\b|\bfb\b|instagram|^ig\b|\bmeta\b|google|gads|adwords|cpc|ppc|tiktok|seznam|sklik|ads?\b|paid)/i;
router.get('/odkud', api(async (req, res) => {
  const dny = Math.min(365, Math.max(1, parseInt(req.query.dny, 10) || 30));
  const od = new Date(Date.now() - dny * 86400e3);
  const hraci = await prisma.gamePlayer.findMany({ where: { created_at: { gte: od }, disabled: false }, select: { id: true, zdroj: true, invited_by_id: true, invited_by_ref: true, created_at: true } });
  const ids = hraci.map((h) => h.id);
  const nak = ids.length ? await prisma.gamePurchase.findMany({ where: { status: 'paid', player_id: { in: ids } }, select: { player_id: true, amount_cents: true, currency: true } }) : [];
  const plat = {}; nak.forEach((n) => { plat[n.player_id] = (plat[n.player_id] || 0) + kcZ(n); });
  const sk = {}, zdroje = {};
  // Po dnech (pražský čas): kolik účtů z které skupiny ten den vzniklo
  const denK = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const dnyMap = {}; for (let i = dny - 1; i >= 0; i--) { const k = denK(Date.now() - i * 86400e3); dnyMap[k] = { den: k, reklama: 0, doporuceni: 0, jiny: 0, nevime: 0, platicich: 0 }; }
  const pridej = (k, h) => { const o = sk[k] || (sk[k] = { hracu: 0, platicich: 0, trzba: 0 }); o.hracu++; if (plat[h.id]) { o.platicich++; o.trzba += plat[h.id]; } };
  hraci.forEach((h) => {
    const z = String(h.zdroj || '').trim();
    let k;
    if (h.invited_by_id || h.invited_by_ref) k = 'doporuceni';
    else if (z && REKLAMA_RE.test(z)) k = 'reklama';
    else if (z) k = 'jiny';
    else k = 'nevime';
    pridej(k, h);
    const dd = dnyMap[denK(h.created_at)]; if (dd) { dd[k]++; if (plat[h.id]) dd.platicich++; }
    if (k === 'reklama' || k === 'jiny') { const key = z.split(' / ')[0].toLowerCase() || '?'; const o = zdroje[key] || (zdroje[key] = { zdroj: key, typ: k, hracu: 0, platicich: 0, trzba: 0 }); o.hracu++; if (plat[h.id]) { o.platicich++; o.trzba += plat[h.id]; } }
  });
  const out = ['reklama', 'doporuceni', 'jiny', 'nevime'].map((k) => Object.assign({ klic: k }, sk[k] || { hracu: 0, platicich: 0, trzba: 0 }));
  out.forEach((o) => { o.trzba = Math.round(o.trzba); });
  res.json({ ok: true, dny, celkem: hraci.length, skupiny: out, po_dnech: Object.values(dnyMap), zdroje: Object.values(zdroje).map((o) => Object.assign(o, { trzba: Math.round(o.trzba) })).sort((a, b) => b.hracu - a.hracu) });
}));

// ─── A/B test úvodní obrazovky ───────────────────────────────────────────────
// Přepínač: off = jen původní úvod (A) · 50 = půl na půl · b = jen nový úvod (B).
// Vyhodnocení: návštěvníci, kteří úvod viděli (game_intro) → registrace (game_register), podle varianty.
router.get('/ab-intro', api(async (req, res) => {
  const { getSetting } = require('../services/settings');
  const rezim = await getSetting('game.ab_intro', { type: 'string', defaultValue: 'off' }).catch(() => 'off');
  const dny = Math.min(180, Math.max(1, parseInt(req.query.dny, 10) || 30));
  const od = new Date(Date.now() - dny * 86400e3);
  const ev = await prisma.compounderEvent.findMany({
    where: { created_at: { gte: od }, event: { in: ['game_intro', 'game_ab_a', 'game_ab_b', 'game_register', 'game_build', 'game_paid'] } },
    select: { sid: true, event: true }, take: 400000 });
  const S = {}; ev.forEach((e) => { (S[e.event] || (S[e.event] = new Set())).add(e.sid); });
  const set = (k) => S[k] || new Set();
  const intro = set('game_intro');
  const varianta = (v) => {
    const vs = set('game_ab_' + v); const vid = [...vs].filter((s) => intro.has(s));
    const n = vid.length, reg = vid.filter((s) => set('game_register').has(s)).length;
    const build = vid.filter((s) => set('game_build').has(s)).length, paid = vid.filter((s) => set('game_paid').has(s)).length;
    return { navstev: n, registraci: reg, postavilo: build, zaplatilo: paid, konverze_pct: n ? Math.round(reg / n * 1000) / 10 : 0 };
  };
  const A = varianta('a'), B = varianta('b');
  // Dvouvýběrový z-test podílů — orientačně, zda je rozdíl víc než náhoda
  let z = null; const nA = A.navstev, nB = B.navstev;
  if (nA >= 20 && nB >= 20) { const p = (A.registraci + B.registraci) / (nA + nB); const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB)); if (se > 0) z = Math.round(((B.registraci / nB) - (A.registraci / nA)) / se * 100) / 100; }
  const celkem = { navstev: intro.size, registraci: [...intro].filter((s) => set('game_register').has(s)).length };
  celkem.konverze_pct = celkem.navstev ? Math.round(celkem.registraci / celkem.navstev * 1000) / 10 : 0;
  res.json({ ok: true, rezim, dny, celkem, A, B, z });
}));
router.put('/ab-intro', api(async (req, res) => {
  const v = String((req.body || {}).rezim || '');
  if (!['off', '50', 'b'].includes(v)) return res.status(400).json({ error: 'Neplatný režim' });
  const { setSetting } = require('../services/settings');
  await setSetting('game.ab_intro', v, { type: 'string', description: 'Laundromat Tycoon — A/B test úvodní obrazovky (off / 50 / b)', scope: 'game', userId: req.user && req.user.id });
  res.json({ ok: true, rezim: v });
}));

// ─── AI analytik hry ─────────────────────────────────────────────────────────
// Sesbírá, jak se hráči ve hře chovají (trychtýř, retence, postup, čas ve hře, platby, zdroje, reklama)
// a nechá Claude navrhnout konkrétní změny, které povedou k víc platbám. Poslední rozbor se ukládá.
const AI_KEY = 'game.ai_analyza';
// Soupis toho, co ve hře už hotové je. Bez něj AI navrhovala věci, které
// dávno fungují (hraní bez registrace), nebo rovnou zhoršení (přidat e-mail
// a heslo tam, kde se nikdy nechtěly). Když přibude funkce, dopiš ji sem.
const CO_UZ_UMI = {
  vstup_do_hry: 'Na úvodu je JEDINÉ povinné pole: jméno hráče (3–24 znaků). Název firmy je nepovinný. Žádný e-mail, žádné heslo, žádné potvrzování. Po kliknutí na „Začít hrát" se účet založí a hra běží do pár sekund. NENAVRHUJ e-mail, heslo, ověřovací odkaz ani „guest mode" — to všechno je buď hotové, nebo by to bylo zhoršení.',
  ucet_a_prihlaseni: 'Nick + heslo slouží jen k přihlášení na dalším zařízení (obrazovka #acct) a na cestě nového hráče neleží. Jméno jde později změnit (jednou za 30 dnů, první změna hned).',
  onboarding: 'Po založení účtu běží tutoriál o pěti krocích (game_tut1–game_tut5): vybrat město, prověřit místo a nájem, koupit prádlomat, počkat na dodání, postavit. Je i bonus za rychlý start (odpočet 60 s na úvodu).',
  platby: 'Stripe: jednorázové balíčky (hotovost, karty, výhody) a předplatné. Ceník je v databázi (game_prices) a jde měnit v administraci.',
  ab_testy: 'Hotový rámec na A/B testy úvodní obrazovky (nastavení game.ab_intro: off / 50 / b) i s vyhodnocením a z-testem v administraci.',
  herni_systemy: 'Mapa skutečných míst, ekonomika prádlomatu, banka a úvěry, pojištění, infolinka s operátorem (placená), půjčky a podíly mezi hráči s burzou, zpětný odkup, převod podílu na třetího hráče, žebříček, pozvánky, světové události (povodně, festivaly, ceny energií), ekonomické krize a sezónnost.',
  mereni: 'Události game_* se ukládají jako compounderEvent. Měří se od načtení stránky (game_nacita) přes spuštění hry (game_open), vracející se hráče (game_zpet), úvod (game_intro), účet, průzkum, stavbu až po platbu.',
};
const medi = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const R1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

async function sesbirejDataHry(reklama) {
  const dny = 30, od = new Date(Date.now() - dny * 86400e3);
  const [udalosti, hraci, nakupy, ceny, zaznamu] = await Promise.all([
    prisma.compounderEvent.findMany({ where: { created_at: { gte: od }, event: { startsWith: 'game_' } }, select: { event: true, sid: true, created_at: true }, take: 300000 }),
    prisma.gamePlayer.findMany({ where: { disabled: false }, take: 4000, orderBy: { created_at: 'desc' },
      select: { id: true, created_at: true, state_at: true, state: true, zdroj: true, hra_s_celkem: true, invited_by_id: true } }),
    prisma.gamePurchase.findMany({ where: { status: 'paid' }, select: { player_id: true, kind: true, qty: true, amount_cents: true, currency: true, paid_at: true } }),
    prisma.gamePrice.findMany({ select: { kind: true, price: true, name: true, active: true } }),
    prisma.gameReplay.count().catch(() => 0),
  ]);
  // Události: kolik unikátních návštěv a kolikrát
  const ev = {};
  udalosti.forEach((e) => {
    const o = ev[e.event] || (ev[e.event] = { sids: new Set(), celkem: 0, od: null });
    o.sids.add(e.sid); o.celkem++;
    const t = new Date(e.created_at).getTime();
    if (!o.od || t < o.od) o.od = t;
  });
  const udalostiVystup = Object.keys(ev).map((k) => ({ udalost: k, unikatnich: ev[k].sids.size, celkem: ev[k].celkem,
    // Nová událost má kratší historii než okno — bez tohohle se srovnávají jablka s hruškami.
    merime_od: ev[k].od ? new Date(ev[k].od).toISOString().slice(0, 10) : null,
    merime_dnu: ev[k].od ? Math.max(1, Math.round((Date.now() - ev[k].od) / 86400e3)) : null,
  })).sort((a, b) => b.unikatnich - a.unikatnich);

  // ── Trychtýř. Počítáme ho tady, ne v hlavě AI. ───────────────────────────
  // Minulý rozbor vydělil game_intro / game_open a vyhlásil „62 % odpad před
  // úvodem", jenže úvod z principu nevidí nikdo, kdo má rozehranou hru.
  // Správný jmenovatel pro úvod jsou jen noví návštěvníci.
  const u = (k) => (ev[k] ? ev[k].sids.size : 0);
  const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
  const novych = Math.max(0, u('game_open') - u('game_zpet'));
  const trychtyr = [
    { krok: 'načetli stránku', udalost: 'game_nacita', pocet: u('game_nacita'), z_predchoziho_pct: null, jmenovatel: null },
    { krok: 'spustila se jim hra', udalost: 'game_open', pocet: u('game_open'), z_predchoziho_pct: pct(u('game_open'), u('game_nacita')), jmenovatel: 'game_nacita' },
    { krok: 'z toho noví (bez rozehrané hry)', udalost: 'game_open − game_zpet', pocet: novych, z_predchoziho_pct: pct(novych, u('game_open')), jmenovatel: 'game_open' },
    { krok: 'viděli úvod', udalost: 'game_intro', pocet: u('game_intro'), z_predchoziho_pct: pct(u('game_intro'), novych), jmenovatel: 'noví návštěvníci' },
    { krok: 'založili účet', udalost: 'game_register', pocet: u('game_register'), z_predchoziho_pct: pct(u('game_register'), u('game_intro')), jmenovatel: 'game_intro' },
    { krok: 'prozkoumali město', udalost: 'game_scout', pocet: u('game_scout'), z_predchoziho_pct: pct(u('game_scout'), u('game_register')), jmenovatel: 'game_register' },
    { krok: 'postavili prádlomat', udalost: 'game_build', pocet: u('game_build'), z_predchoziho_pct: pct(u('game_build'), u('game_scout')), jmenovatel: 'game_scout' },
    { krok: 'zaplatili', udalost: 'game_paid', pocet: u('game_paid'), z_predchoziho_pct: pct(u('game_paid'), u('game_build')), jmenovatel: 'game_build' },
  ];

  const plat = {}; nakupy.forEach((n) => { const o = plat[n.player_id] || (plat[n.player_id] = { n: 0, kc: 0, prvni: null }); o.n++; o.kc += kcZ(n); const t = new Date(n.paid_at).getTime(); if (!o.prvni || t < o.prvni) o.prvni = t; });
  const bucket = (v, hr) => { for (const [lbl, max] of hr) if (v < max) return lbl; return hr[hr.length - 1][0]; };
  const B = { pradlomatu: {}, cas_ve_hre: {}, dni_od_registrace_do_posledni_aktivity: {}, profil: {}, zdroj: {}, pozvany: {} };
  const pridej = (skupina, klic, plati) => { const o = skupina[klic] || (skupina[klic] = { hracu: 0, platicich: 0 }); o.hracu++; if (plati) o.platicich++; };
  const casy = [], dnuDoPlatby = [];
  hraci.forEach((h) => {
    const st = h.state || {}; const units = Array.isArray(st.units) ? st.units.length : 0; const plati = !!plat[h.id];
    const minut = (h.hra_s_celkem || 0) / 60;
    const dniAktivity = h.state_at ? (new Date(h.state_at).getTime() - new Date(h.created_at).getTime()) / 86400e3 : 0;
    pridej(B.pradlomatu, bucket(units, [['0', 1], ['1', 2], ['2', 3], ['3-5', 6], ['6+', 1e9]]), plati);
    pridej(B.cas_ve_hre, bucket(minut, [['<1 min', 1], ['1-5 min', 5], ['5-15 min', 15], ['15-30 min', 30], ['30+ min', 1e9]]), plati);
    pridej(B.dni_od_registrace_do_posledni_aktivity, bucket(dniAktivity, [['<1 den', 1], ['1-3 dny', 3], ['3-7 dní', 7], ['7+ dní', 1e9]]), plati);
    pridej(B.profil, String(st.profile || 'neuvedeno'), plati);
    pridej(B.zdroj, String(h.zdroj || 'přímo/neznámý').slice(0, 40), plati);
    pridej(B.pozvany, h.invited_by_id ? 'pozvaný hráčem' : 'nepozvaný', plati);
    if (minut > 0) casy.push(minut);
    if (plati && plat[h.id].prvni) dnuDoPlatby.push((plat[h.id].prvni - new Date(h.created_at).getTime()) / 86400e3);
  });
  const podleDruhu = {}; nakupy.forEach((n) => { const o = podleDruhu[n.kind] || (podleDruhu[n.kind] = { nakupu: 0, kc: 0 }); o.nakupu++; o.kc += kcZ(n); });
  const platici = Object.keys(plat).length;
  return {
    obdobi_udalosti_dnu: dny,
    hracu_celkem: hraci.length, platicich_hracu: platici,
    konverze_na_platbu_pct: hraci.length ? R1(platici / hraci.length * 100) : 0,
    // Tohle je JEDINÝ platný trychtýř. Syrové počty níž slouží k doplňkovým
    // pohledům, ne k dělení mezi sebou.
    trychtyr: trychtyr,
    udalosti_za_30_dni: udalostiVystup,
    co_uz_hra_umi: CO_UZ_UMI,
    chovani_podle_skupin: B,
    median_minut_ve_hre: R1(medi(casy)), median_dni_od_registrace_do_prvni_platby: R1(medi(dnuDoPlatby)),
    nakupy_podle_druhu: podleDruhu,
    cenik: ceny.map((c) => ({ druh: c.kind, nazev: c.name, cena_kc: c.price / 100, aktivni: c.active })),
    nahranych_zaznamu_prvni_minuty: zaznamu,
    // Bez tohohle si AI spočítá nesmysl: brala game_open→game_intro jako krok
    // trychtýře, i když úvod z principu nevidí nikdo, kdo má rozehranou hru.
    vyznam_udalosti: {
      game_nacita: 'Načetla se stránka hry. Posílá index.html ještě před stažením game.js — je to skutečný začátek trychtýře a jediné číslo, které zahrnuje i ty, co odešli během načítání.',
      game_open: 'Spustil se game.js. Posílá se KAŽDÉMU, i vracejícímu se hráči s rozehranou hrou.',
      game_zpet: 'Vracející se hráč s rozehranou hrou. Takový úvod nikdy neuvidí, takže game_open − game_zpet je správný jmenovatel pro game_intro.',
      game_intro: 'Nový návštěvník uvidel úvodní obrazovku. NEPOČÍTEJ game_open→game_intro jako ztrátu, rozdíl tvoří hlavně vracející se hráči (game_zpet). Lepší retence tenhle poměr naopak snižuje.',
      game_zije: 'Tichá stopa každých 5 minut u otevřené hry — slouží k počtu hráčů právě teď, ne jako krok trychtýře.',
    },
    reklama: reklama || null,
  };
}

// Odpověď AI → objekt. Když je JSON useknutý (dlouhá odpověď), zkusí ho opravit: zahodí nedokončený konec a doplní závorky.
function parseAiJson(text) {
  const a = text.indexOf('{'); if (a < 0) return { summary: text.slice(0, 2000) };
  let t = text.slice(a);
  try { return JSON.parse(t.slice(0, t.lastIndexOf('}') + 1)); } catch (e) { /* oprava níže */ }
  for (let cut = t.length; cut > 10; ) {
    const k = Math.max(t.lastIndexOf('},', cut - 1), t.lastIndexOf('",', cut - 1), t.lastIndexOf('}]', cut - 1));
    if (k < 0) break; cut = k;
    let cand = t.slice(0, k + 1); if (cand.endsWith(',')) cand = cand.slice(0, -1);
    // dopočítej neuzavřené závorky (ignoruje obsah řetězců)
    const st = []; let inS = false, esc = false;
    for (const ch of cand) { if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inS = false; continue; } if (ch === '"') inS = true; else if (ch === '{' || ch === '[') st.push(ch); else if (ch === '}' || ch === ']') st.pop(); }
    if (inS) continue;
    const fixed = cand + st.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
    try { const o = JSON.parse(fixed); o._nekompletni = true; return o; } catch (e) { /* zkus kratší */ }
  }
  return { summary: 'AI vrátila neúplnou odpověď — spusť rozbor znovu.' };
}

// Rozbor trvá i minuty — projít statisíce událostí a počkat na odpověď AI se
// do jednoho požadavku z mobilu nevejde (prohlížeč spojení utne a napíše jen
// „Load failed"). Běží tedy na pozadí a stránka se chodí ptát, jestli je hotovo.
const AI_STAV = 'game.ai_analyza_stav';
const AI_MAX_MS = 10 * 60000;        // po téhle době považujeme běh za spadlý
async function aiStav() {
  const { getSetting } = require('../services/settings');
  const v = await getSetting(AI_STAV, { type: 'json', defaultValue: null }).catch(() => null);
  if (!v) return { bezi: false };
  // Spadl-li server uprostřed rozboru, zůstal by příznak viset navždy.
  if (v.bezi && Date.now() - new Date(v.zacalo || 0).getTime() > AI_MAX_MS) {
    return { bezi: false, chyba: 'Rozbor se nedokončil — zkus to znovu.' };
  }
  return v;
}
async function aiStavZapis(v) {
  try {
    const { setSetting } = require('../services/settings');
    await setSetting(AI_STAV, v, { type: 'json', description: 'Laundromat Tycoon — stav běhu AI rozboru', scope: 'game' });
  } catch (e) { console.warn('[game-ai] stav rozboru neuložen:', e.message); }
}

// GET /ai-analyza → poslední uložený rozbor a jestli zrovna běží nový
router.get('/ai-analyza', api(async (req, res) => {
  const { getSetting } = require('../services/settings');
  const [v, stav] = await Promise.all([
    getSetting(AI_KEY, { type: 'json', defaultValue: null }).catch(() => null),
    aiStav(),
  ]);
  res.json({ ok: true, rozbor: v, stav });
}));

// POST /ai-analyza { reklama? } → spustí nový rozbor na pozadí a hned odpoví.
// Hotový výsledek si stránka vyzvedne přes GET.
router.post('/ai-analyza', api(async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI není nakonfigurováno (chybí ANTHROPIC_API_KEY).' });
  const bezi = await aiStav();
  if (bezi.bezi) return res.json({ ok: true, stav: bezi, uz_bezi: true });
  const rk = req.body && req.body.reklama && typeof req.body.reklama === 'object' ? req.body.reklama : null;
  const reklama = rk ? ['vydaj', 'trzba', 'zisk', 'roas', 'dnu_plus', 'dnu_minus', 'registraci', 'nakupu', 'kliku', 'cena_registrace', 'cena_nakupu'].reduce((o, k) => { if (Number.isFinite(Number(rk[k]))) o[k] = Number(rk[k]); return o; }, {}) : null;
  const zacalo = new Date().toISOString();
  await aiStavZapis({ bezi: true, zacalo });
  const uzivatel = req.user && req.user.id;
  // Odpovíme hned; zbytek doběhne na pozadí.
  res.json({ ok: true, stav: { bezi: true, zacalo } });
  aiRozborNaPozadi(reklama, uzivatel, zacalo).catch(async (e) => {
    console.error('[game-ai] rozbor selhal:', e && e.message);
    await aiStavZapis({ bezi: false, zacalo, chyba: String((e && e.message) || e).slice(0, 300) });
  });
}));

async function aiRozborNaPozadi(reklama, uzivatelId, zacalo) {
  const data = await sesbirejDataHry(reklama && Object.keys(reklama).length ? reklama : null);
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.GAME_AI_MODEL || 'claude-sonnet-4-6';
  // Prompt je psaný proti konkrétním chybám, které analytik dělal: dělil si
  // vlastní trychtýř ze syrových počtů, navrhoval funkce, které už existují,
  // a z deseti plateb dělal sebejisté odhady dopadu.
  const sys = [
    'Jsi senior produktový analytik a growth designér free-to-play her. Analyzuješ hru „Laundromat Tycoon" (prohlížečová tycoon hra o stavbě sítě samoobslužných prádlomatů na pradlomaty.info/game). Cíl majitele: víc plateb — vyšší konverze na platbu a vyšší tržba na hráče při rozumné ceně reklamy.',
    '',
    'TVRDÁ PRAVIDLA, bez kterých je rozbor k ničemu:',
    '1. TRYCHTÝŘ. Pole "trychtyr" je jediný platný trychtýř a jeho procenta už jsou spočítaná. NIKDY si nedělej vlastní poměry ze syrových počtů v "udalosti_za_30_dni" — ty události mají různé jmenovatele a různě dlouhou historii. Zvlášť NEDĚL game_intro děleno game_open: úvod z principu nevidí nikdo, kdo má rozehranou hru, takže ten rozdíl jsou hlavně vracející se hráči (game_zpet) a lepší retence ho ještě zvětší.',
    '2. CO UŽ EXISTUJE. Před každým návrhem si projdi "co_uz_hra_umi". Co tam je popsané, NENAVRHUJ — ani jinými slovy. Když je tvůj nápad v rozporu s tím soupisem, zahoď ho.',
    '3. MALÝ VZOREK. Když krok trychtýře stojí na méně než 30 přechodech, je to hypotéza, ne zjištění. Řekni to v textu, nepiš sebejisté odhady dopadu a místo úkolu navrhni měření nebo test. Deset platících neunese větu „přinese desítky plateb měsíčně".',
    '4. KRÁTKÁ HISTORIE. U každé události je "merime_od" a "merime_dnu". Událost měřenou pár dní nesrovnávej s událostí měřenou celé okno a neoznačuj nízký počet za propad.',
    '5. METRIKA SE JMENOVATELEM. V poli "kpi" vždycky napiš čitatele i jmenovatele („game_register ze všech, kdo viděli úvod"), ne jen název události.',
    '6. RIZIKO. Každý návrh musí mít pole "rizika": co se tím může zhoršit a která metrika kvůli tomu klesne, i když je změna správná. Typicky: když usnadníš vstup, naroste jmenovatel a konverze na platbu v procentech spadne, i kdyby plateb bylo víc. Když riziko nevidíš, napiš to natvrdo.',
    '7. Pracuj POUZE s dodanými čísly, nic si nedomýšlej. Když na něco data nemáš, patří to do "chybi_data", ne do návrhu.',
    '',
    'Najdi: kde se hráči doopravdy ztrácejí (podle "trychtyr"), co mají platící společné, co brání platbě (cena, načasování, nabídka, tření) a co s tím jde udělat v herním designu, nabídce, ceníku, onboardingu, notifikacích a reklamě.',
    '',
    'Odpověz POUZE platným JSON bez markdownu: {"summary":"<3-5 vět o stavu, včetně toho, jak velký je vzorek>","zjisteni":[{"nadpis":"<krátce>","detail":"<1-3 věty s čísly a se jmenovatelem>"}],"navrhy":[{"nazev":"<krátce>","co_zmenit":"<konkrétně co ve hře udělat>","proc":"<na jakých číslech to stojí>","rizika":"<co se tím může zhoršit a která metrika klesne>","ocekavany_dopad":"<odhad; u malého vzorku napiš, že je to hypotéza>","narocnost":"nízká|střední|vysoká","priorita":1,"dopad":4,"snadnost":3,"jistota":"nízká|střední|vysoká","oblast":"onboarding|nabídka|ceník|herní design|notifikace|reklama","kpi":"<metrika i se jmenovatelem>","cil":"<měřitelný cíl>"}],"experimenty":["<test, který hypotézu ověří>"],"chybi_data":["<co začít měřit>"]}.',
    '5–8 návrhů podle priority (1 = nejdřív); dopad a snadnost jsou celá čísla 1–5. Každé zjištění musí mít aspoň jeden návrh, který ho řeší. Buď stručný: summary max 5 vět, detail max 2 věty, co_zmenit max 3 věty. Piš česky, konkrétně, s čísly.',
  ].join('\n');
  const msg = await client.messages.create({ model, max_tokens: 8000, system: sys, messages: [{ role: 'user', content: 'Data hry (JSON):\n' + JSON.stringify(data) }] });
  let text = (msg && msg.content && msg.content[0] && msg.content[0].text) || '';
  text = text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
  const j = parseAiJson(text);
  const S = (x, n) => String(x == null ? '' : x).slice(0, n);
  const rozbor = {
    vytvoreno: new Date().toISOString(), model,
    prehled: { hracu: data.hracu_celkem, platicich: data.platicich_hracu, konverze_pct: data.konverze_na_platbu_pct },
    summary: S(j.summary, 2000),
    zjisteni: (Array.isArray(j.zjisteni) ? j.zjisteni : []).slice(0, 10).map((x) => ({ nadpis: S(x.nadpis, 120), detail: S(x.detail, 500) })),
    navrhy: (Array.isArray(j.navrhy) ? j.navrhy : []).slice(0, 10).map((x) => ({ nazev: S(x.nazev, 120), co_zmenit: S(x.co_zmenit, 600), proc: S(x.proc, 500), rizika: S(x.rizika, 500), jistota: S(x.jistota, 20), ocekavany_dopad: S(x.ocekavany_dopad, 300), narocnost: S(x.narocnost, 20), priorita: Number(x.priorita) || 9,
      dopad: Math.min(5, Math.max(1, Math.round(Number(x.dopad) || 3))), snadnost: Math.min(5, Math.max(1, Math.round(Number(x.snadnost) || 3))), oblast: S(x.oblast, 40), kpi: S(x.kpi, 200), cil: S(x.cil, 200) })).sort((a, b) => a.priorita - b.priorita),
    nekompletni: !!j._nekompletni,
    // Podklady pro grafy (stejná data, ze kterých AI vycházela)
    data: { trychtyr: data.trychtyr, udalosti: data.udalosti_za_30_dni.slice(0, 20), skupiny: data.chovani_podle_skupin, nakupy: data.nakupy_podle_druhu,
      median_minut: data.median_minut_ve_hre, median_dni_do_platby: data.median_dni_od_registrace_do_prvni_platby, reklama: data.reklama },
    experimenty: (Array.isArray(j.experimenty) ? j.experimenty : []).slice(0, 8).map((x) => S(x, 400)),
    chybi_data: (Array.isArray(j.chybi_data) ? j.chybi_data : []).slice(0, 8).map((x) => S(x, 300)),
  };
  try { const { setSetting } = require('../services/settings'); await setSetting(AI_KEY, rozbor, { type: 'json', description: 'Laundromat Tycoon — poslední rozbor AI analytika', scope: 'game', userId: uzivatelId }); } catch (e) { console.warn('[game-ai] uložení rozboru selhalo:', e.message); }
  await aiStavZapis({ bezi: false, zacalo, hotovo: rozbor.vytvoreno });
  return rozbor;
}

module.exports = router;

// ─── Dražby ──────────────────────────────────────────────────────────────────
// Audit dražeb: u každé celý rozpad na hráče, aby se dal výpis přepočítat
// ručně. Peníze se při vypořádání rozdávají jako doručenky bez vazby na
// dražbu, takže se tu počítají znovu ze stejných vstupů (vyvolávací cena,
// součet příhozů, kdo vedl). Kdyby se vzorec rozešel s vyporadejDrazbu(),
// kontrolní součet to ukáže.
const DRZ_A = require('../services/game/drazby');
router.get('/drazby', api(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const drazby = await prisma.gameDrazba.findMany({ orderBy: { id: 'desc' }, take: limit });
  if (!drazby.length) return res.json({ ok: true, drazby: [] });
  const prihozy = await prisma.gameDrazbaPrihoz.findMany({
    where: { drazba_id: { in: drazby.map((d) => d.id) } }, orderBy: { id: 'asc' },
    select: { id: true, drazba_id: true, player_id: true, nick: true, castka: true, created_at: true } });

  const ven = drazby.map((d) => {
    const moje = prihozy.filter((p) => p.drazba_id === d.id);
    // Cena vítěze: u hotové dražby to, co se opravdu zapsalo; u běžící
    // a u zneplatněné dopočítaná z aktuálního součtu.
    const cena = d.cena != null ? d.cena : DRZ_A.cenaZa(d.vyvolavaci, d.suma);
    const soucetPrihozu = moje.reduce((a, p) => a + p.castka, 0);
    const platil = d.stav === 'hotovo';     // jen hotová dražba hýbala penězi

    const hraci = new Map();
    const dej = (id, nick) => {
      if (!hraci.has(id)) hraci.set(id, { id, nick, prihozu: 0, prihozy: 0, prijal: 0, zaplatil: 0 });
      const h = hraci.get(id);
      if (nick) h.nick = nick;
      return h;
    };
    moje.forEach((p) => { const h = dej(p.player_id, p.nick); h.prihozu += 1; h.prihozy += p.castka; });
    // Prodávající patří do výpisu, i když sám nepřihodil.
    dej(d.prodavajici_id, d.prodavajici_nick);
    if (d.vitez_id) dej(d.vitez_id, d.vitez_nick);

    hraci.forEach((h) => {
      // 1. příhozy platí každý, kdo přihodil — i ten, kdo prohrál
      if (platil) h.zaplatil += h.prihozy;
      // 2. prodávajícímu padají všechny příhozy a od vítěze doplatek
      if (platil && h.id === d.prodavajici_id) h.prijal += d.suma + (d.vitez_id ? cena : 0);
      // 3. vítěz doplácí
      if (platil && d.vitez_id && h.id === d.vitez_id) h.zaplatil += cena;
      h.netto = h.prijal - h.zaplatil;
      h.prodavajici = h.id === d.prodavajici_id;
      h.vitez = !!d.vitez_id && h.id === d.vitez_id;
    });
    const radky = [...hraci.values()].sort((a, b) => b.prihozy - a.prihozy);

    return {
      id: d.id, nazev: d.nazev, predmet: d.predmet, stav: d.stav,
      vyvolavaci: d.vyvolavaci, suma: d.suma, prihozu: d.prihozu, cena,
      created_at: d.created_at, konec: d.konec, updated_at: d.updated_at,
      prodavajici: { id: d.prodavajici_id, nick: d.prodavajici_nick },
      vitez: d.vitez_id ? { id: d.vitez_id, nick: d.vitez_nick } : null,
      // Výnos prodávajícího hrubý (co mu přišlo) i čistý (po jeho vlastních příhozech).
      vynos_hruby: platil ? d.suma + (d.vitez_id ? cena : 0) : 0,
      vynos_cisty: platil ? (radky.find((h) => h.prodavajici) || { netto: 0 }).netto : 0,
      hraci: radky,
      prihozy: moje.map((p) => ({ id: p.id, nick: p.nick, player_id: p.player_id,
        castka: p.castka, kdy: p.created_at })),
      // Kontrola: co se rozdalo, se musí rovnat tomu, co se strhlo.
      kontrola: {
        soucet_prihozu: soucetPrihozu,
        suma_v_drazbe: d.suma,
        sedi_suma: soucetPrihozu === d.suma,
        netto_celkem: radky.reduce((a, h) => a + h.netto, 0),
        penize_sedi: radky.reduce((a, h) => a + h.netto, 0) === 0,
      },
    };
  });
  res.json({ ok: true, drazby: ven });
}));
