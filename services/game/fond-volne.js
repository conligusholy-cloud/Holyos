// =============================================================================
// Laundromat Tycoon — kolik má fond doopravdy volných peněz
// =============================================================================
// Pokladna není totéž co volné peníze. Co fond slíbil ve vyvěšené nabídce na
// odkup podílu, to už rozdat nemůže — jinak by jedněmi penězi zaplatil dvakrát
// a druhému podílníkovi by se muselo říct, že se to „nějak nepovedlo".
//
// Počítá se to na dvou místech (obchod s akciemi, nabíhající dividenda) a obě
// musí dostat stejné číslo, proto to stojí tady a ne v routě.
'use strict';

const { prisma } = require('../../config/database');

// Kolik z pokladny drží běžící nabídky fondu.
async function zamceno(alianceId) {
  const REZ = require('./rezervace');
  const rows = await prisma.gameTender.findMany({
    where: { fond_id: alianceId, stav: 'bezi' } }).catch(() => []);
  const ted = new Date();
  return rows.filter((t) => !t.do || new Date(t.do) > ted)
    .reduce((a, t) => a + REZ.zbyvaZNabidky(t), 0);
}

// Pokladna mínus zamčené. Aliance se dá předat už načtená — volající ji
// obvykle má a druhý dotaz na totéž je zbytečný.
async function volne(alianceId, alianceHotova) {
  const al = alianceHotova
    || await prisma.gameAliance.findUnique({ where: { id: alianceId } }).catch(() => null);
  if (!al) return { al: null, volne: 0, zamceno: 0 };
  const z = Math.round(await zamceno(alianceId));
  return { al, zamceno: z, volne: Math.round((al.pokladna || 0) - z) };
}

module.exports = { zamceno, volne };
