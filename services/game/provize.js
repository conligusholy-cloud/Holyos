// Dorovnání provizí všem distributorům najednou.
//
// Provize se běžně doplácejí, až když si zvoucí otevře hru. Jenže když se
// opraví chyba ve vazbách, nikdo se nemá doprošovat ani čekat, až někoho
// napadne otevřít správnou záložku — tohle to projde za všechny hned po
// startu serveru.
//
// Je to idempotentní: každá provize má svůj klíč, takže opakovaný běh
// nic nepřiplatí. Proto může běžet při každém startu.
const { prisma } = require('../../config/database');
const acct = require('../../routes/game-account.routes');

async function dorovnejVsem() {
  // Platí se jen tomu, kdo má distribuci zapnutou — stejné pravidlo jako ve hře.
  const zvouci = await prisma.gamePlayer.findMany({
    where: { disabled: false, distributor_do: { gt: new Date() } },
    select: { id: true, nick: true, ref_id: true, distributor_do: true },
  });
  let celkem = 0, komu = 0;
  for (const z of zvouci) {
    try {
      const castka = await acct._dorovnejProvize(z);
      if (castka > 0) { celkem += castka; komu++; }
    } catch (e) {
      console.warn('[game] dorovnani provizi pro ' + z.nick + ':', e.message);
    }
  }
  if (celkem) console.log('[game] dorovnano ' + celkem + ' L$ provizi pro ' + komu + ' distributoru');
  return { celkem, komu, distributoru: zvouci.length };
}

module.exports = { dorovnejVsem };
