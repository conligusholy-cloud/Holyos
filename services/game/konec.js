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
// Rozdělí, co je k dispozici, mezi nároky — poměrně a tak, aby se nikdy
// nerozdalo víc, než na co je. Zaokrouhlení poměrné části umí přes součet
// přestřelit, a vyplatit o korunu víc, než firma má, znamená vyrobit peníze
// z ničeho. Poslední proto dostane přesně to, co zbylo, a nikdo víc, než
// kolik mu chybí.
//
// Je to schválně jedna funkce pro obě cesty (ukončení hry i úklid mrtvých
// podílů). Dva stejné výpočty vedle sebe se dřív nebo později rozejdou.
function rozdel(kDeleni, naroky) {
  const suma = naroky.reduce((a, b) => a + b, 0);
  let rozdano = 0;
  return naroky.map((dluh, i) => {
    const posledni = i === naroky.length - 1;
    const navrh = suma <= 0 ? 0
      : (posledni ? (kDeleni - rozdano) : Math.round(kDeleni * (dluh / suma)));
    const dam = Math.max(0, Math.min(navrh, dluh, kDeleni - rozdano));
    rozdano += dam;
    return dam;
  });
}

// Podíl může držet hráč, nebo fond aliance. Peníze za fondový podíl nejdou
// doručenkou — žádný takový hráč neexistuje a sloupec na to ani není, je
// NOT NULL — ale do pokladny fondu. Zprávu dostanou členové, protože fond
// žádný zvonek nemá. Bez tohohle vyrovnání celé firmy padalo na chybě databáze
// a podíly zůstávaly viset.
async function fondyPodilu(radky) {
  const ids = [...new Set((radky || []).map((e) => e && e.fond_id).filter((x) => x != null))];
  const m = new Map();
  if (!ids.length) return m;
  const [aliance, vklady] = await Promise.all([
    prisma.gameAliance.findMany({ where: { id: { in: ids } }, select: { id: true, nazev: true } }),
    prisma.gameFondVklad.findMany({ where: { aliance_id: { in: ids }, castka: { gt: 0 } },
      select: { aliance_id: true, clen_id: true } }),
  ]);
  aliance.forEach((a) => m.set(a.id, { nazev: a.nazev, clenove: [] }));
  vklady.forEach((v) => { const f = m.get(v.aliance_id); if (f) f.clenove.push(v.clen_id); });
  return m;
}

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
  // Co se má připsat pokladnám fondů místo doručenky hráči.
  const fondy = await fondyPodilu(podilyVeMne);
  const fondKredit = new Map();
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
  const dily = rozdel(kDeleni, nevraceno.map((x) => x.dluh));
  nevraceno.forEach(({ e, dluh }, i) => {
    const dam = dily[i];
    const fond = e.fond_id != null ? fondy.get(e.fond_id) : null;
    if (dam > 0) {
      if (e.fond_id != null) {
        // Když už fond mezitím není, nemá se to komu připsat ani komu říct.
        if (fond) {
          fondKredit.set(e.fond_id, (fondKredit.get(e.fond_id) || 0) + dam);
          prehled.odkoupeno += dam;
        }
      } else {
        dorucenky.push({ player_id: e.investor_id, kind: 'cash', amount: dam,
          text_kod: 'dor.konec_odkup_podilu', text_data: { p1: hrac.nick, penize: dam },
          popis: TEXTY.t('dor.konec_odkup_podilu', { p1: hrac.nick, penize: dam }, 'cs') });
        prehled.odkoupeno += dam;
      }
    }
    const chybi = dluh - dam;
    if (chybi > 0) prehled.nevyplaceno += chybi;
    if (e.fond_id != null) {
      if (fond) {
        fond.clenove.forEach((pid) => dorucenky.push(zprava(pid, 'dor.fond_podil_zanikl',
          { p1: hrac.nick, p2: fond.nazev, p3: dam, penize: chybi })));
      }
    } else {
      dorucenky.push(zprava(e.investor_id, 'dor.konec_podil_zanikl',
        { p1: hrac.nick, p2: Math.round(e.podil * 100), penize: chybi }));
    }
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
    for (const [alianceId, castka] of fondKredit) {
      await tx.gameAliance.update({ where: { id: alianceId },
        data: { pokladna: { increment: castka } } });
    }
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

// -----------------------------------------------------------------------------
// Podíly ve firmách, které už nikdo nehraje
// -----------------------------------------------------------------------------
// Když hráč odejde nebo si dá novou hru, jeho firma zůstane prázdná a podíl
// v ní běží dál — výplata se počítá z jejího stavu, ten je nula, takže se
// investorovi donekonečna vyplácí nic a termín další výplaty se jen posouvá.
// V seznamu to pak vypadá jako majetek, který se co nevidět vyplatí, a nikdy
// nevyplatí.
//
// Tohle takové podíly uzavře. Z toho, co firmě zbylo, se investorům poměrně
// vrátí, co do podílu dali a ještě nedostali; zbytek se odepíše. Pravidla jsou
// stejná jako při ukončení hry, jen se spouštějí sama.
const NEAKTIVNI_DNU_VYCHOZI = 30;

async function neaktivniDnu() {
  try {
    const r = await prisma.gameSetting.findUnique({ where: { klic: 'podil_neaktivni_dnu' } });
    const n = Number(r && r.hodnota);
    if (isFinite(n) && n > 0) return n;
  } catch (e) { /* bez nastavení jede výchozí */ }
  return NEAKTIVNI_DNU_VYCHOZI;
}

// Vyrovná podíly v jedné firmě a uzavře je. Vrací, co se komu poslalo.
async function vyrovnejPodilyFirmy(firma, duvod) {
  const podily = await prisma.gameEquity.findMany({
    where: { firma_id: firma.id, stav: 'bezi' } });
  if (!podily.length) return null;

  const st = stavu(firma);
  let hotovost = cele(st.cash);
  const dorucenky = [];
  const fondy = await fondyPodilu(podily);
  const fondKredit = new Map();
  const nevraceno = podily.map((e) => ({ e, dluh: Math.max(0, cele(e.cena) - cele(e.vyplaceno)) }));
  const suma = nevraceno.reduce((a, x) => a + x.dluh, 0);
  const kDeleni = suma > 0 ? Math.min(hotovost, suma) : 0;
  const dily = rozdel(kDeleni, nevraceno.map((x) => x.dluh));
  // Sečte se, co se opravdu vyplatilo — ne co se napočítalo. Podíl fondu,
  // který už neexistuje, nemá komu dojít, a firmě se za něj nesmí stržit
  // hotovost: jinak by peníze zmizely ze světa.
  let rozdano = 0;
  nevraceno.forEach(({ e, dluh }, i) => {
    const dam = dily[i];
    const fond = e.fond_id != null ? fondy.get(e.fond_id) : null;
    if (dam > 0 && e.fond_id == null) {
      dorucenky.push({ player_id: e.investor_id, kind: 'cash', amount: dam,
        text_kod: 'dor.konec_odkup_podilu', text_data: { p1: firma.nick, penize: dam },
        popis: TEXTY.t('dor.konec_odkup_podilu', { p1: firma.nick, penize: dam }, 'cs') });
      rozdano += dam;
    }
    if (dam > 0 && fond) {
      fondKredit.set(e.fond_id, (fondKredit.get(e.fond_id) || 0) + dam);
      rozdano += dam;
    }
    if (e.fond_id != null) {
      if (fond) {
        fond.clenove.forEach((pid) => dorucenky.push(zprava(pid, 'dor.fond_podil_nehraje',
          { p1: firma.nick, p2: fond.nazev, p3: dam, penize: dluh - dam })));
      }
    } else {
      dorucenky.push(zprava(e.investor_id, 'dor.podil_firma_nehraje',
        { p1: firma.nick, p2: Math.round(e.podil * 100), penize: dluh - dam }));
    }
  });
  // Majiteli taky — vrátí se po měsíci a jinak by nechápal, kam se poděly
  // peníze a proč mu ve firmě zmizeli podílníci.
  dorucenky.push(zprava(firma.id, 'dor.podilnici_vyplaceni',
    { p1: podily.length, penize: rozdano }));

  await prisma.$transaction(async (tx) => {
    for (const { e } of nevraceno) {
      await tx.gameEquity.update({ where: { id: e.id }, data: { stav: 'odkoupeno' } });
    }
    for (const [alianceId, castka] of fondKredit) {
      await tx.gameAliance.update({ where: { id: alianceId },
        data: { pokladna: { increment: castka } } });
    }
    if (dorucenky.length) await tx.gameDelivery.createMany({ data: dorucenky });
    // Hotovost firmy se tím zmenšila. Když stav vůbec není, není co upravovat.
    if (st && typeof st === 'object' && rozdano > 0) {
      await tx.gamePlayer.update({ where: { id: firma.id },
        data: { state: Object.assign({}, st, { cash: Math.max(0, cele(st.cash) - rozdano) }),
          state_rev: { increment: 1 } } });
    }
  }, { timeout: 60000 });

  console.log('[game] podíly ve firmě ' + firma.nick + ' uzavřeny (' + duvod + '): '
    + podily.length + ', vráceno ' + rozdano);
  return { podilu: podily.length, vraceno: rozdano };
}

// Projde podíly a uzavře ty, jejichž firma už nehraje. Pouští se z tepu financí.
async function uklidMrtvePodily() {
  const bezici = await prisma.gameEquity.findMany({
    where: { stav: 'bezi' }, select: { firma_id: true }, take: 2000 });
  if (!bezici.length) return 0;
  const firmy = [...new Set(bezici.map((x) => x.firma_id))];
  const dnu = await neaktivniDnu();
  const mez = new Date(Date.now() - dnu * 86400000);
  let hotovo = 0;
  for (const id of firmy) {
    try {
      const p = await prisma.gamePlayer.findUnique({ where: { id } });
      if (!p) continue;                       // firma zmizela úplně, řeší výplaty
      // Bez stavu hráč buď začal znovu, nebo hru nikdy nerozehrál. Čekat na
      // lhůtu nemá smysl — vyplácet se stejně nemá z čeho.
      const bezStavu = !p.state;
      const davno = !p.state_at || new Date(p.state_at) < mez;
      if (!bezStavu && !davno) continue;
      const v = await vyrovnejPodilyFirmy(p, bezStavu ? 'začal znovu' : 'nehraje ' + dnu + ' dnů');
      if (v) hotovo += v.podilu;
    } catch (e) {
      console.warn('[game] úklid podílů firmy #' + id + ':', e && e.message);
    }
  }
  return hotovo;
}

// =============================================================================
// Smazání účtu
// =============================================================================
// Právo na výmaz. Napřed konkurz — co hráč dluží jiným hráčům a co u něj drží,
// se musí vypořádat stejně jako při čistém štítu, jinak by odchodem jednoho
// přišli o svoje ostatní. Teprve pak se z účtu smažou osobní údaje.
//
// Dvě věci se nemažou a je to tak schválně:
//  • Doklady o zaplacených nákupech. Fakturu musí firma ze zákona držet roky;
//    co z ní jde pryč, je e-mail, zbytek je účetnictví, ne osobní profil.
//  • Řádek hráče jako takový. Zůstane prázdná schránka se zamčeným přístupem —
//    aby cizí obchody a půjčky nezůstaly ukazovat do prázdna. Jméno, firma,
//    e-mail, heslo ani stav hry v ní nezbydou.
//
// Běžící předplatné se zruší k datu konce období: zaplacené dojede, dál se už
// nic nestrhne. Nevracíme peníze — na to je potřeba člověk, ne tlačítko.
async function smazUcet(playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id)) throw new Error('smazUcet: chybí hráč');
  const hrac = await prisma.gamePlayer.findUnique({ where: { id } });
  if (!hrac) return { ok: false, duvod: 'neexistuje' };

  // 1. Konkurz: vyrovnat se se světem, dokud ještě víme, co hráč má.
  const vyrovnani = await ukonciHru(id);

  // 2. Předplatné zrušit u Stripu, ať se po smazaném účtu dál nestrhává.
  const predplatne = await prisma.gameSubscription.findMany({
    where: { player_id: id, status: { in: ['active', 'past_due'] }, stripe_sub: { not: null } },
  });
  let zruseno = 0;
  for (const row of predplatne) {
    try {
      const { _stripePost } = require('../../routes/game-stripe.routes');
      await _stripePost('subscriptions/' + row.stripe_sub, { cancel_at_period_end: 'true' });
      await prisma.gameSubscription.update({ where: { id: row.id }, data: { obnovi_se: false } });
      zruseno++;
    } catch (e) {
      // Stripe neodpověděl. Mazání kvůli tomu nezastavíme — hráč má právo
      // odejít — ale musí to být vidět v logu, ať se to dá dorovnat ručně.
      console.error('[game-smazani] předplatné ' + row.stripe_sub + ' se nepodařilo zrušit:', e && e.message);
    }
  }

  // 3. Jméno, pod kterým hráč vystupoval, zmizí i z cizích záznamů. Nick je
  //    pseudonym, který si zvolil sám, a může ho prozradit — v obchodech,
  //    půjčkách a podílech ostatních ho proto přepíšeme na neutrální.
  const anonym = 'smazaný hráč';
  const klic = 'smazany-' + id;
  await prisma.$transaction([
    prisma.gameTrade.updateMany({ where: { from_id: id }, data: { from_nick: anonym } }),
    prisma.gameTrade.updateMany({ where: { to_id: id }, data: { to_nick: anonym } }),
    prisma.gameLoan.updateMany({ where: { lender_id: id }, data: { lender_nick: anonym } }),
    prisma.gameLoan.updateMany({ where: { borrower_id: id }, data: { borrower_nick: anonym } }),
    prisma.gameEquity.updateMany({ where: { investor_id: id }, data: { investor_nick: anonym } }),
    prisma.gameEquity.updateMany({ where: { firma_id: id }, data: { firma_nick: anonym } }),
    // E-mail u dokladů je osobní údaj; částky a data jsou účetnictví a zůstávají.
    prisma.gamePurchase.updateMany({ where: { player_id: id }, data: { email: null } }),
    // Co patřilo jen jemu, mizí celé.
    prisma.gameDelivery.deleteMany({ where: { player_id: id } }),
    prisma.gameOdmena.deleteMany({ where: { player_id: id } }),
    prisma.gameCard.deleteMany({ where: { player_id: id } }),
    // 4. Samotná schránka: prázdná, zamčená, bez osobních údajů.
    prisma.gamePlayer.update({
      where: { id },
      data: {
        nick: anonym, nick_lower: klic, company: null, emblem: null,
        email: null, first_name: null, last_name: null, password_hash: null,
        state: null, state_at: null, state_rev: { increment: 1 },
        zdroj: null, ref_id: null, hodnost: null, jazyk: null,
        disabled: true, token_version: { increment: 1 },
      },
    }),
  ]);
  console.log('[game-smazani] účet #' + id + ' smazán · předplatných zrušeno: ' + zruseno);
  return { ok: true, vyrovnani, predplatne_zruseno: zruseno };
}

module.exports = { ukonciHru, uklidMrtvePodily, vyrovnejPodilyFirmy, smazUcet };
