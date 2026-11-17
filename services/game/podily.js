// =============================================================================
// Laundromat Tycoon — ředění podílů při kapitálovém vstupu
// =============================================================================
// Prodej podílu a kapitálový vstup vypadají zvenčí stejně — investor dá
// peníze a dostane kus firmy — ale krájí se u toho jiný koláč.
//
// Prodej:  majitel pustí kus ze svého. Ostatní podílníci se nehnou.
// Vstup:   firma vydá nový podíl. Ředí se všichni, protože po vstupu je
//          koláč větší, ale každý starý kousek je z něj menší částí.
//
//   před:  majitel 60 %, investor A 40 %
//   vstup: nový investor bere 25 %
//   po:    majitel 45 %, investor A 30 %, nový 25 %
//
// Každý dosavadní podíl se vynásobí (1 − nový podíl). Součet proto nikdy
// nepřeroste sto procent, ať se vstupuje kolikrát chce. Bez toho přepočtu by
// se buď přerostl strop, nebo by se někomu potichu ubralo — a protože podíl
// rozhoduje o výplatách ze zisku, byla by to krádež na splátky.
//
// Majitelův podíl se nikde neukládá: je to zbytek do sta procent. Ředí se
// tedy sám, což je správně — kdo vydá nové podíly, platí to ze svého.

'use strict';

// Nové podíly po vstupu. Vrací jen to, co se mění, ať je na jednom místě
// vidět, že se nic jiného nesahá: pořizovací cena a vyplacené dividendy jsou
// historie a ředěním se nemění.
function redeni(stavajici, f) {
  const n = Math.max(0, Math.min(1, Number(f) || 0));
  return (stavajici || []).map((e) => ({
    id: e.id,
    investor_id: e.investor_id,
    podil_pred: Number(e.podil) || 0,
    podil: Math.max(0, (Number(e.podil) || 0) * (1 - n)),
  }));
}

// Kolik drží majitel: zbytek do sta procent.
function majitel(podily) {
  const soucet = (podily || []).reduce((a, e) => a + (Number(e.podil) || 0), 0);
  return Math.max(0, 1 - soucet);
}

// Kontrola, že se koláč po vstupu pořád rovná jedné. Vrací odchylku —
// nulu u všeho, co je v pořádku.
function odchylka(stavajiciPo, f) {
  const n = Math.max(0, Math.min(1, Number(f) || 0));
  const soucet = (stavajiciPo || []).reduce((a, e) => a + (Number(e.podil) || 0), 0) + n;
  return soucet - 1 + majitelPo(stavajiciPo, n);
}
function majitelPo(stavajiciPo, f) {
  const soucet = (stavajiciPo || []).reduce((a, e) => a + (Number(e.podil) || 0), 0);
  return Math.max(0, 1 - soucet - f);
}

// Jaký podíl odpovídá vloženým penězům. Hodnota firmy před vstupem plus
// vklad dá hodnotu po vstupu; vklad z ní je podíl investora. Je to jen
// vodítko do nabídky — kolik si strany doopravdy plácnou, je na nich.
function podilDleCeny(hodnotaPred, vklad) {
  const pred = Math.max(0, Number(hodnotaPred) || 0);
  const v = Math.max(0, Number(vklad) || 0);
  const po = pred + v;
  return po > 0 ? v / po : 0;
}

module.exports = { redeni, majitel, majitelPo, odchylka, podilDleCeny };
