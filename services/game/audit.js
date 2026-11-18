// =============================================================================
// Laundromat Tycoon — kdo kdy přišel o kus firmy a proč
// =============================================================================
// Podíly se dnes mění na deseti místech: prodej, odkup, převod na třetího,
// kapitálový vstup, konverze půjčky, propadlá zástava, veřejná nabídka,
// dražba. Po každé takové změně zůstane v databázi jen nový stav — ne to,
// co bylo předtím. Když se hráč zeptá, kam se poděla pětina jeho firmy,
// nemáme co otevřít.
//
// Tenhle modul to zapisuje. Ne po jednotlivých řádcích, ale OTISKEM před
// a po: na začátku transakce se sejme, kdo ve firmě kolik drží, na konci
// znovu, a rozdíl se zapíše. Důvod, proč takhle:
//
//   Ředění se jinak neuhlídá. Kapitálový vstup sáhne na podíly všech
//   dosavadních investorů najednou — kdyby se zapisovalo u každého
//   update zvlášť, stačilo by na jeden zapomenout a chyběl by právě tam,
//   kde se někomu ubralo bez jeho vědomí.
//
//   Nové způsoby změny se nemusí dopisovat. Kdo příště přidá další cestu,
//   jak podíl převést, dostane zápis zadarmo — pokud otisk obalí kolem
//   své transakce.
//
// Zapisuje se UVNITŘ transakce schválně: buď se převod i jeho záznam
// stanou oba, nebo ani jeden. Audit, který může chybět, není audit.

'use strict';

// Kdo ve firmě kolik drží. Mapa investor → podíl, sečtená na člověka,
// protože jeden investor může mít víc řádek.
async function otisk(tx, firmaId) {
  const rows = await tx.gameEquity.findMany({
    where: { firma_id: firmaId, stav: 'bezi' },
    select: { investor_id: true, podil: true },
  });
  const m = new Map();
  rows.forEach((r) => m.set(r.investor_id, (m.get(r.investor_id) || 0) + (Number(r.podil) || 0)));
  return m;
}

// Rozdíl dvou otisků. Vrací jen to, co se doopravdy pohnulo — drobné
// odchylky z plovoucí čárky nejsou změna vlastnictví.
const PRAH = 1e-9;
function zmeny(pred, po) {
  const out = [];
  const vsichni = new Set(Array.from(pred.keys()).concat(Array.from(po.keys())));
  vsichni.forEach((id) => {
    const a = pred.get(id) || 0;
    const b = po.get(id) || 0;
    if (Math.abs(b - a) > PRAH) out.push({ investor_id: id, pred: a, po: b });
  });
  return out.sort((x, y) => x.investor_id - y.investor_id);
}

// Zápis rozdílu. Volá se na konci transakce, se stejným tx.
async function zapis(tx, firmaId, pred, info) {
  const po = await otisk(tx, firmaId);
  const l = zmeny(pred, po);
  if (!l.length) return 0;
  await tx.gameVlastnictvi.createMany({
    data: l.map((z) => ({
      firma_id: firmaId,
      investor_id: z.investor_id,
      podil_pred: z.pred,
      podil_po: z.po,
      duvod: String((info && info.duvod) || '?').slice(0, 16),
      trade_id: (info && info.trade_id) || null,
      protistrana_id: (info && info.protistrana_id) || null,
    })),
  });
  return l.length;
}

module.exports = { otisk, zmeny, zapis, PRAH };
