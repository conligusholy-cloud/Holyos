#!/usr/bin/env node
// Dvojí doručení webhooku nesmí připsat zboží dvakrát.
// Jede proti opravdové funkci z routes/game-stripe.routes.js, jen s nastrčenou
// databází — skutečnou souběžnost drží zámek řádku v Postgresu, který tady
// napodobuje fronta: dovnitř transakce vleze vždycky jen jeden.
'use strict';
let chyb = 0;
const zkus = (co, p) => { console.log((p ? 'OK   ' : 'CHYBA') + '  ' + co); if (!p) chyb++; };

// Funkci vytáhneme ze zdroje, ať test neběží proti kopii. Require celého
// modulu by tahal prismu, express i Stripe — tohle potřebuje jen tu jednu věc.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../routes/game-stripe.routes.js', 'utf8');
const zac = src.indexOf('async function zaberAPripis');
const kon = src.indexOf('\n}\n', zac) + 3;
if (zac < 0 || kon < 3) { console.log('CHYBA  zaberAPripis se ve zdroji nenašla'); process.exit(1); }
const zaberAPripis = eval('(' + src.slice(zac, kon).replace('async function zaberAPripis', 'async function') + ')');

// ── nastrčená databáze ────────────────────────────────────────────────────
function fakeDb(pu) {
  const stav = { objednavka: Object.assign({}, pu), karty: [], transakci: 0, soubezne: 0, maxSoubezne: 0 };
  let fronta = Promise.resolve();
  const tx = {
    gamePurchase: {
      updateMany: async ({ where, data }) => {
        // podmínka status != 'paid' — přesně jak ji vyhodnotí databáze
        if (where.id !== stav.objednavka.id) return { count: 0 };
        if (where.status && where.status.not && stav.objednavka.status === where.status.not) return { count: 0 };
        Object.assign(stav.objednavka, data);
        return { count: 1 };
      },
    },
    gameCard: { createMany: async ({ data }) => { data.forEach((x) => stav.karty.push(x)); return { count: data.length }; } },
  };
  const db = {
    $transaction: (fn) => {
      // zámek řádku: další transakce čeká, než ta první doběhne
      const beh = fronta.then(async () => {
        stav.transakci++; stav.soubezne++;
        stav.maxSoubezne = Math.max(stav.maxSoubezne, stav.soubezne);
        try { return await fn(tx); } finally { stav.soubezne--; }
      });
      fronta = beh.catch(() => {});
      return beh;
    },
  };
  return { db, stav };
}

(async () => {
  const PU = { id: 7, player_id: 3, kind: 'rush', qty: 2, status: 'pending' };

  console.log('jedno doručení:');
  {
    const { db, stav } = fakeDb(PU);
    const a = await zaberAPripis(db, PU, 'pi_1');
    zkus('připsalo', a === true);
    zkus('dvě karty (qty 2)', stav.karty.length === 2);
    zkus('objednávka je zaplacená', stav.objednavka.status === 'paid');
    zkus('zapsalo se id platby', stav.objednavka.stripe_intent === 'pi_1');
  }

  console.log('\ndruhé doručení téhož (po sobě):');
  {
    const { db, stav } = fakeDb(PU);
    await zaberAPripis(db, PU, 'pi_1');
    const b = await zaberAPripis(db, PU, 'pi_1');
    zkus('podruhé nepřipsalo', b === false);
    zkus('karty zůstaly dvě, ne čtyři', stav.karty.length === 2);
  }

  console.log('\ntři doručení najednou:');
  {
    const { db, stav } = fakeDb(PU);
    const r = await Promise.all([
      zaberAPripis(db, PU, 'pi_1'), zaberAPripis(db, PU, 'pi_1'), zaberAPripis(db, PU, 'pi_1')]);
    zkus('připsalo právě jedno', r.filter(Boolean).length === 1);
    zkus('karty zůstaly dvě, ne šest', stav.karty.length === 2);
    zkus('transakce se nepřekrývaly (zámek řádku)', stav.maxSoubezne === 1);
    zkus('proběhly všechny tři pokusy', stav.transakci === 3);
  }

  console.log('\nkdyž připsání selže, objednávka nezůstane zaplacená:');
  {
    const { db, stav } = fakeDb(PU);
    const puzly = Object.assign({}, PU);
    // transakce se musí vrátit celá — napodobíme pád uvnitř
    db.$transaction = (fn) => fn({
      gamePurchase: { updateMany: async () => { stav.objednavka.status = 'paid'; return { count: 1 }; } },
      gameCard: { createMany: async () => { throw new Error('databáze spadla'); } },
    }).catch((e) => { stav.objednavka.status = puzly.status; throw e; });
    let spadlo = false;
    try { await zaberAPripis(db, puzly, 'pi_1'); } catch (e) { spadlo = true; }
    zkus('chyba se nespolkla', spadlo);
    zkus('objednávka se vrátila na nezaplacenou', stav.objednavka.status === 'pending');
    zkus('žádné karty nevznikly', stav.karty.length === 0);
  }

  console.log(chyb ? '\n' + chyb + ' CHYB' : '\nvšechno sedí');
  process.exit(chyb ? 1 : 0);
})();
