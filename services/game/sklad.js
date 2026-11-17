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
    const serverSkladem = {}, serverNaceste = {};
    MODELY.forEach((m) => { serverSkladem[m] = 0; serverNaceste[m] = 0; });
    serverove.forEach((r) => {
      if (!MODELY.includes(r.model)) return;
      if (new Date(r.dorazi_at).getTime() <= ted) serverSkladem[r.model]++;
      else serverNaceste[r.model]++;
    });

    const kVytvoreni = [];
    // Sklad: co hra tvrdí, že leží doma, a server o tom neví.
    MODELY.forEach((m) => {
      const chybi = ma.skladem[m] - serverSkladem[m];
      for (let i = 0; i < chybi; i++) {
        kVytvoreni.push({ model: m, dorazi: ted - 1000 });
      }
    });
    // Na cestě: zásilky bereme od té, která dorazí nejdřív.
    const nacesteHry = ma.naceste.slice().sort((a, b) => a.dorazi - b.dorazi);
    MODELY.forEach((m) => {
      const moje = nacesteHry.filter((x) => x.model === m);
      const chybi = moje.length - serverNaceste[m];
      for (let i = 0; i < chybi; i++) {
        const z = moje[i] || { dorazi: ted + 1000 };
        kVytvoreni.push({ model: m, dorazi: Math.max(ted + 1000, z.dorazi) });
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

module.exports = { doplnit, tisk, zeStavu, MODELY, CENY_STROJU };
