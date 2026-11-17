// =============================================================================
// Ukončení hry — vyrovnání se světem, teprve potom čistý štít
// =============================================================================
// „Začít znovu s čistým štítem" dřív jen smazalo zábory a vynulovalo stav.
// Všechno, co hráč dlužil ostatním nebo co u něj ostatní drželi, zůstalo viset:
// podíl v jeho firmě běžel napořád a vyplácel nulu, půjčka propadala splátku
// po splátce a zbytek dluhu nakonec přistál v nové hře. Šlo z toho udělat
// kolečko — prodej podíl, vezmi hotovost, resetni se, opakuj.
//
// Teď reset projde konkurzem. Z hotovosti se vyrovná to, co hráč dluží jiným
// hráčům, pak se z toho, co zbude, odkoupí podíly v jeho firmě. Co na to
// nestačí, se odepíše a protiúčtu přijde zpráva, proč jeho podíl skončil.
// Majetek jde na burzu, aby ostatním zůstal ve světě místo aby se vypařil —
// ale bez výplaty, jinak by liquidace byla výdělečná a kolečko by jelo dál.
'use strict';

const { prisma } = require('../../config/database');
const TEXTY = require('./texty');

const AUKCE_MESIC = 43200000;      // herní měsíc = 12 skutečných hodin
const MODELY = ['mini', 'flex', 'max'];
const CENY_STROJU = { mini: 35000, flex: 52000, max: 67000 };

const stavu = (p) => (p && p.state) || {};
const cele = (x) => Math.max(0, Math.round(Number(x) || 0));

// Zpráva protiúčtu. Jde přes doručenky, takže ji hráč najde ve zvonku i když
// zrovna nehraje.
function zprava(player_id, kod, data) {
  return {
    player_id, kind: 'zprava', text_kod: kod, text_data: data || null,
    popis: TEXTY.t(kod, data, 'cs'),
  };
}

// Co hráč v konkurzu nabídne ostatním. Bere se z jeho stavu — jiný zdroj
// pravdy o jeho majetku server nemá, hra žije v prohlížeči.
function polozkyZeStavu(st) {
  const out = [];
  (Array.isArray(st.units) ? st.units : []).forEach((u) => {
    const model = (u.eco && u.eco.model) || 'mini';
    out.push({ predmet: 'pradlomat', model, spot_id: u.spotId || null,
      popis: String(u.name || 'prádlomat').slice(0, 160),
      hodnota: cele((u.eco && u.eco.invest) || CENY_STROJU[model]) });
  });
  const sklad = st.stock || {};
  MODELY.forEach((k) => {
    for (let i = 0; i < cele(sklad[k]); i++) {
      out.push({ predmet: 'stroj', model: k, popis: 'stroj ' + k.toUpperCase(),
        hodnota: CENY_STROJU[k] });
    }
  });
  (Array.isArray(st.pobocky) ? st.pobocky : []).forEach((b) => {
    out.push({ predmet: 'pobocka', spot_id: b.name || null,
      popis: String('pobočka ' + (b.name || '')).slice(0, 160), hodnota: 300000 });
  });
  return out.slice(0, 60);
}

// -----------------------------------------------------------------------------
// Hlavní práce. Vrací přehled, co se komu vyrovnalo.
// -----------------------------------------------------------------------------
async function ukonciHru(playerId) {
  const hrac = await prisma.gamePlayer.findUnique({ where: { id: playerId } });
  if (!hrac) throw new Error('Hráč nenalezen.');
  const st = stavu(hrac);

  const [pujckyDluzim, pujckyPujcil, podilyVeMne, podilyMoje, nabidky, drazby] = await Promise.all([
    prisma.gameLoan.findMany({ where: { borrower_id: playerId, stav: 'bezi' }, orderBy: { id: 'asc' } }),
    prisma.gameLoan.findMany({ where: { lender_id: playerId, stav: 'bezi' } }),
    prisma.gameEquity.findMany({ where: { firma_id: playerId, stav: 'bezi' } }),
    prisma.gameEquity.findMany({ where: { investor_id: playerId, stav: 'bezi' } }),
    prisma.gameTrade.findMany({ where: { stav: 'ceka', OR: [{ from_id: playerId }, { to_id: playerId }] } }),
    prisma.gameDrazba.findMany({ where: { prodavajici_id: playerId, stav: 'bezi' } }),
  ]);

  let hotovost = cele(st.cash);
  const dorucenky = [];
  const prehled = { splaceno: 0, odepsano: 0, odkoupeno: 0, nevyplaceno: 0 };

  // ── 1. Nejdřív to, co dluží jiným hráčům ───────────────────────────────────
  // Banka až po nich: bankovní dluh je čísílko ve stavu, který se stejně maže,
  // kdežto za půjčkou od hráče stojí jeho skutečné peníze.
  const pujckyHotovo = [];
  for (const p of pujckyDluzim) {
    const zbyva = cele(p.splatka * Math.max(0, p.mesicu - p.splaceno));
    const dam = Math.min(hotovost, zbyva);
    hotovost -= dam;
    const chybi = zbyva - dam;
    if (dam > 0) {
      dorucenky.push({ player_id: p.lender_id, kind: 'cash', amount: dam,
        text_kod: 'dor.konec_splatka_pujcky', text_data: { p1: hrac.nick, penize: dam },
        popis: TEXTY.t('dor.konec_splatka_pujcky', { p1: hrac.nick, penize: dam }, 'cs') });
      prehled.splaceno += dam;
    }
    if (chybi > 0) {
      dorucenky.push(zprava(p.lender_id, 'dor.konec_pujcka_odepsana',
        { p1: hrac.nick, penize: chybi }));
      prehled.odepsano += chybi;
    }
    pujckyHotovo.push({ id: p.id, stav: chybi > 0 ? 'odepsano' : 'splaceno' });
  }

  // ── 2. Pak podíly, které v jeho firmě někdo drží ───────────────────────────
  // Investor dostane zpátky, co do podílu dal a ještě se mu nevrátilo —
  // poměrně z toho, co po půjčkách zbylo. Zbytek se odepíše, ale podíl se
  // uzavře, aby nezůstal navždycky běžet a vyplácet nulu.
  const nevraceno = podilyVeMne.map((e) => ({ e, dluh: Math.max(0, cele(e.cena) - cele(e.vyplaceno)) }));
  const suma = nevraceno.reduce((a, x) => a + x.dluh, 0);
  const kDeleni = suma > 0 ? Math.min(hotovost, suma) : 0;
  hotovost -= kDeleni;
  nevraceno.forEach(({ e, dluh }) => {
    const dam = suma > 0 ? Math.round(kDeleni * (dluh / suma)) : 0;
    if (dam > 0) {
      dorucenky.push({ player_id: e.investor_id, kind: 'cash', amount: dam,
        text_kod: 'dor.konec_odkup_podilu', text_data: { p1: hrac.nick, penize: dam },
        popis: TEXTY.t('dor.konec_odkup_podilu', { p1: hrac.nick, penize: dam }, 'cs') });
      prehled.odkoupeno += dam;
    }
    const chybi = dluh - dam;
    if (chybi > 0) prehled.nevyplaceno += chybi;
    dorucenky.push(zprava(e.investor_id, 'dor.konec_podil_zanikl',
      { p1: hrac.nick, p2: Math.round(e.podil * 100), penize: chybi }));
  });

  // ── 3. Co měl u ostatních on ──────────────────────────────────────────────
  // Jeho nároky zanikají spolu s firmou. Dlužníkovi i firmě to řekneme —
  // je to pro ně dobrá zpráva a nemají jak se to jinak dozvědět.
  pujckyPujcil.forEach((p) => {
    dorucenky.push(zprava(p.borrower_id, 'dor.konec_veritel_skoncil', { p1: hrac.nick }));
  });
  podilyMoje.forEach((e) => {
    dorucenky.push(zprava(e.firma_id, 'dor.konec_podilnik_skoncil',
      { p1: hrac.nick, p2: Math.round(e.podil * 100) }));
  });

  // ── 4. Majetek na burzu ───────────────────────────────────────────────────
  // Bez výplaty: kdyby z konkurzu kapaly peníze zpátky, bylo by výhodné
  // resetovat se opakovaně. Takhle je to pro svět zisk a pro něj ne.
  const polozky = polozkyZeStavu(st);
  const konec = new Date(Date.now() + AUKCE_MESIC);
  const aukce = polozky.map((x) => ({
    player_id: hrac.id, nick: hrac.nick, predmet: x.predmet, model: x.model || null,
    spot_id: x.spot_id, card_kind: null, popis: x.popis,
    hodnota: Math.max(1000, x.hodnota), data: { bez_vyplaty: true }, do: konec,
  }));

  // ── 5. Zápis ──────────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    for (const p of pujckyHotovo) {
      await tx.gameLoan.update({ where: { id: p.id }, data: { stav: p.stav } });
    }
    for (const p of pujckyPujcil) {
      await tx.gameLoan.update({ where: { id: p.id }, data: { stav: 'odepsano' } });
    }
    for (const e of podilyVeMne.concat(podilyMoje)) {
      await tx.gameEquity.update({ where: { id: e.id }, data: { stav: 'odkoupeno' } });
    }
    for (const n of nabidky) {
      await tx.gameTrade.update({ where: { id: n.id },
        data: { stav: 'zruseno', resolved_at: new Date() } });
    }
    for (const d of drazby) {
      // Příhozy se platí až při vypořádání, takže zrušením nikdo o nic nepřijde.
      await tx.gameDrazba.update({ where: { id: d.id },
        data: { stav: 'zruseno', konec: new Date() } });
    }
    // Nevyzvednuté následky patří starému životu, do nového nesmí.
    await tx.gameDelivery.deleteMany({ where: { player_id: playerId, claimed_at: null } });
    if (aukce.length) await tx.gameAuction.createMany({ data: aukce });
    if (dorucenky.length) await tx.gameDelivery.createMany({ data: dorucenky });
    await tx.gameSpotClaim.deleteMany({ where: { player_id: playerId } });
    await tx.gamePlayer.update({ where: { id: playerId },
      data: { state: null, state_at: null, state_rev: { increment: 1 } } });
  }, { timeout: 60000 });

  const souhrn = {
    pujcek: pujckyDluzim.length, podilu: podilyVeMne.length,
    naBurzu: aukce.length, zprav: dorucenky.length,
  };
  console.log('[game] konec hry ' + hrac.nick + ': splaceno ' + prehled.splaceno
    + ', odepsáno ' + prehled.odepsano + ', odkoupeno ' + prehled.odkoupeno
    + ', nevyplaceno ' + prehled.nevyplaceno + ', na burzu ' + aukce.length);
  return Object.assign({}, prehled, souhrn);
}

module.exports = { ukonciHru };
