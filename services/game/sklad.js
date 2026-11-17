// =============================================================================
// Laundromat Tycoon — dopočet skladu ze stavu hry
// =============================================================================
// Nákup stroje se zapisuje na server až od jistého dne. Co si hráči koupili
// dřív, server nezná — a dokud to nezná, sklad serveru a hry se nikdy
// nesrovná a nejde ze skladu udělat podmínku stavby.
//
// Tohle to jednou dopočítá: vezme, co hráč podle svého uloženého stavu má
// ve skladu a na cestě, odečte, co už server eviduje, a rozdíl doplní.
// Nikomu nic nebere — doplňuje jen to, co hráči chybí.
//
// Běží to naprázdno, dokud se neřekne jinak. A je to idempotentní: druhé
// spuštění nic nepřidá, protože se pokaždé počítá rozdíl proti skutečnosti,
// ne přírůstek.
//
// Poprvé idempotentní nebylo a stálo to 21 strojů navíc. Rozdíl se počítal
// zvlášť pro sklad a zvlášť pro zásilky na cestě — jenže to, ve které
// přihrádce řádek je, se časem mění: zásilka doletí a stane se z ní sklad.
// Doplněné zásilce se navíc nastavoval čas dodání na „za chvíli", takže do
// minuty přeskočila do skladu, kdežto hra ji pořád vedla na cestě. Při
// druhém běhu tedy vyšlo, že na cestě chybí, a doplnila se znovu.
//
// Proto se teď porovnává součet na model, ne přihrádky. Kdy co doletí, je
// kosmetika; kolik toho hráč má, je to podstatné.
//
// Doplněné řádky nesou značku `doplneno`. U pozorovaných víme, že se opravdu
// kupovalo; u doplněných jen to, co tvrdí hra — a to je slabší důkaz, se
// kterým je potřeba počítat, až se sklad stane rozhodujícím.

'use strict';

const { prisma } = require('../../config/database');

const MODELY = ['mini', 'flex', 'max'];
// Musí sedět s CENY_STROJU v routes/game-account.routes.js.
const CENY_STROJU = {
  mini: Math.round(35000 * 24.35 * 1.25),
  flex: Math.round(52000 * 24.35 * 1.25),
  max: Math.round(67000 * 24.35 * 1.25),
};

// Co hráč podle svého stavu má: sklad po modelech a zásilky na cestě.
function zeStavu(st) {
  const sk = (st && st.stock && typeof st.stock === 'object') ? st.stock : {};
  const skladem = {};
  MODELY.forEach((m) => { skladem[m] = Math.max(0, Math.round(Number(sk[m]) || 0)); });
  const naceste = [];
  (Array.isArray(st && st.orders) ? st.orders : []).forEach((o) => {
    const model = o && MODELY.includes(o.model) ? o.model : null;
    if (!model) return;
    const dorazi = Number(o.arrivesAt) || Date.now();
    naceste.push({ model, dorazi });
  });
  return { skladem, naceste };
}

async function doplnit(opt) {
  const nanecisto = !(opt && opt.ostro === true);
  const hraci = await prisma.gamePlayer.findMany({
    where: { disabled: false }, select: { id: true, nick: true, state: true },
  });
  const ted = Date.now();
  const zprava = { hracu: 0, pridano: 0, podleModelu: {}, radky: [], nanecisto };

  for (const h of hraci) {
    const st = h.state || null;
    if (!st) continue;
    const ma = zeStavu(st);
    const serverove = await prisma.gameOrder.findMany({
      where: { player_id: h.id, postaveno_at: null, zruseno_at: null },
      select: { model: true, dorazi_at: true },
    });
    // Kolik má server na model dohromady — skladem i na cestě. Přihrádky
    // se časem přelévají, součet ne.
    const serverCelkem = {};
    MODELY.forEach((m) => { serverCelkem[m] = 0; });
    serverove.forEach((r) => { if (MODELY.includes(r.model)) serverCelkem[r.model]++; });

    const nacesteHry = ma.naceste.slice().sort((a, b) => a.dorazi - b.dorazi);
    const kVytvoreni = [];
    MODELY.forEach((m) => {
      const moje = nacesteHry.filter((x) => x.model === m);
      const hraCelkem = ma.skladem[m] + moje.length;
      const chybi = hraCelkem - serverCelkem[m];
      for (let i = 0; i < chybi; i++) {
        // Nejdřív doplníme to, co hra vede jako sklad; na zásilky dojde
        // potom a vezme se jejich vlastní čas dodání, ať je jakýkoli.
        const jeSklad = i < ma.skladem[m];
        const z = jeSklad ? null : moje[i - ma.skladem[m]];
        kVytvoreni.push({ model: m, dorazi: z ? z.dorazi : ted - 1000 });
      }
    });

    if (!kVytvoreni.length) continue;
    zprava.hracu++;
    zprava.pridano += kVytvoreni.length;
    kVytvoreni.forEach((x) => {
      zprava.podleModelu[x.model] = (zprava.podleModelu[x.model] || 0) + 1;
    });
    zprava.radky.push({ nick: h.nick, pridano: kVytvoreni.length,
      detail: kVytvoreni.map((x) => x.model + (x.dorazi > ted ? ' (na cestě)' : ' (skladem)')).join(', ') });

    if (!nanecisto) {
      await prisma.gameOrder.createMany({ data: kVytvoreni.map((x) => ({
        player_id: h.id, model: x.model, cena: CENY_STROJU[x.model] || 0,
        dorazi_at: new Date(x.dorazi), doplneno: true,
      })) });
    }
  }
  return zprava;
}

function tisk(z) {
  const out = [];
  out.push(z.nanecisto ? 'NANEČISTO — nic se nezapsalo' : 'OSTRO — zapsáno do evidence');
  out.push('');
  out.push('Hráčů, kterým se doplňuje: ' + z.hracu);
  out.push('Strojů celkem: ' + z.pridano);
  Object.keys(z.podleModelu).forEach((m) => {
    out.push('  ' + m + ': ' + z.podleModelu[m]);
  });
  out.push('');
  z.radky.slice(0, 80).forEach((r) => {
    out.push(String(r.nick || '').padEnd(20).slice(0, 20) + String(r.pridano).padStart(4)
      + '  ' + r.detail);
  });
  if (z.radky.length > 80) out.push('… a dalších ' + (z.radky.length - 80));
  out.push('');
  if (z.nanecisto) {
    out.push('Nic se nezměnilo. Ostrý běh: POST na stejnou adresu.');
  } else {
    out.push('Hotovo. Sklad serveru a hry by se teď měl shodovat — zkontroluj');
    out.push('to na /api/game-admin/sklad-rozdily.');
  }
  return out.join('\n');
}

// Úklid po nepovedeném dopočtu. Maže jen řádky, které vznikly dopočtem a
// na kterých zatím nic nestojí — koupené stroje a postavené prádlomaty se
// nikdy nedotkne. Po úklidu se dá dopočet spustit znovu načisto.
async function uklid(opt) {
  const nanecisto = !(opt && opt.ostro === true);
  const kSmazani = await prisma.gameOrder.findMany({
    where: { doplneno: true, postaveno_at: null, zruseno_at: null },
    select: { id: true, player_id: true, model: true },
  });
  if (!nanecisto && kSmazani.length) {
    await prisma.gameOrder.deleteMany({ where: { id: { in: kSmazani.map((x) => x.id) } } });
  }
  const podleModelu = {};
  kSmazani.forEach((x) => { podleModelu[x.model] = (podleModelu[x.model] || 0) + 1; });
  return { nanecisto, smazano: kSmazani.length, podleModelu,
    hracu: new Set(kSmazani.map((x) => x.player_id)).size };
}

function tiskUklid(z) {
  const out = [];
  out.push(z.nanecisto ? 'NANEČISTO — nic se nesmazalo' : 'OSTRO — smazáno');
  out.push('');
  out.push('Doplněných strojů, na kterých nic nestojí: ' + z.smazano
    + ' u ' + z.hracu + ' hráčů');
  Object.keys(z.podleModelu).forEach((m) => out.push('  ' + m + ': ' + z.podleModelu[m]));
  out.push('');
  out.push('Koupené stroje a postavené prádlomaty zůstávají nedotčené.');
  if (z.nanecisto) out.push('Ostrý běh: POST na stejnou adresu.');
  else out.push('Teď spusť dopočet znovu: GET /api/game-admin/sklad-doplnit');
  return out.join('\n');
}

module.exports = { doplnit, tisk, uklid, tiskUklid, zeStavu, MODELY, CENY_STROJU };
