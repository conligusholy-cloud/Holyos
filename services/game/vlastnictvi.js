// =============================================================================
// Laundromat Tycoon — jmění podle toho, co hráč opravdu vlastní
// =============================================================================
// services/game/jmeni.js počítá HODNOTU FIRMY: stroje na místech, koupenou
// zem, sklad a zboží na cestě, plus hotovost mínus dluh. To je provozní
// číslo a tak má zůstat — ceníme jím podíly na burze, počítá se z něj
// minimální cena převzetí a oceňuje se jím to, co drží fond.
//
// Jenže žebříček a hodnosti tím měří HRÁČE, a to je něco jiného. Hráči,
// který vložil 52,7 M do fondu, spadlo jmění o celých 52,7 M a vypadalo to,
// jako by o ty peníze přišel. Stejně tak: kdo si koupil třetinu cizí firmy,
// nemá ji ve jmění vůbec, a kdo prodal polovinu té svojí, pořád se mu počítá
// celá. Jmění zná jen to, co stojí na místech, a o vlastnictví neví nic.
//
// Tenhle modul to dopočítá nad hotovými hodnotami firem:
//
//   jmění hráče = hodnota jeho firmy
//               − cizí podíly v jeho firmě (drží je hráči i fondy)
//               + podíly, které drží v cizích firmách
//               + jeho podíl na hodnotě fondů, kam vložil
//
// PROČ TO NENÍ V jmeni.js: kruh. Fond se oceňuje jměním firem, které drží.
// Kdyby jmění firmy zahrnovalo i podíl jejího majitele ve fondu, točilo by
// se to dokola. Dvě čísla proto zůstávají oddělená: hodnota firmy se počítá
// bez vlastnictví a vlastnictví se dopočítává až nad ní.
//
// Součet přes všechny hráče se nemění — co se jednomu odečte, druhému se
// přičte. Žebříček tím nenafoukne celkové bohatství hry.
'use strict';

const cislo = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const dej = (m, k) => (m && typeof m.get === 'function' ? m.get(k) : (m || {})[k]);

// Co je pro držitele podíl ve firmě. Záporná firma je pro podílníka nula —
// podíl nemůže být míň než nic, dluh nese majitel. Neznámou firmu oceníme
// tím, co se za podíl zaplatilo; cena je cena celého podílu, nenásobí se.
function hodnotaPodilu(hodnotaFirmy, e) {
  const jm = dej(hodnotaFirmy, e.firma_id);
  if (!Number.isFinite(Number(jm))) return Math.max(0, cislo(e.cena));
  return Math.max(0, cislo(jm)) * Math.max(0, Math.min(1, cislo(e.podil)));
}

// Hodnota fondů: pokladna plus to, co fond drží. Vrací Mapu aliance_id →
// hodnota. Je to totéž ocenění jako v FOND.zebricek, jen bez obalu.
function hodnotyFondu(hodnotaFirmy, fondy, equity) {
  const out = new Map();
  (fondy || []).forEach((a) => out.set(a.id, Math.max(0, Math.round(cislo(a.pokladna)))));
  (equity || []).forEach((e) => {
    if (!e || e.fond_id == null) return;
    if (!out.has(e.fond_id)) out.set(e.fond_id, 0);
    out.set(e.fond_id, out.get(e.fond_id) + hodnotaPodilu(hodnotaFirmy, e));
  });
  return out;
}

// Jmění všech hráčů. hodnotaFirmy je Mapa id → provozní hodnota firmy
// (z jmeni.js); equity jsou běžící podíly, fondy aliance s pokladnou,
// vklady řádky gameFondVklad.
function spocti(hodnotaFirmy, data) {
  const equity = (data && data.equity) || [];
  const fondy = (data && data.fondy) || [];
  const vklady = (data && data.vklady) || [];

  const fondHodnota = hodnotyFondu(hodnotaFirmy, fondy, equity);

  // Součet vkladů v každé alianci — z toho je podíl člena na fondu.
  const vkladCelkem = new Map();
  (vklady || []).forEach((v) => {
    const c = Math.max(0, cislo(v.castka));
    vkladCelkem.set(v.aliance_id, (vkladCelkem.get(v.aliance_id) || 0) + c);
  });

  const out = new Map();
  const pridej = (id, kolik) => {
    if (id == null) return;
    out.set(id, (out.get(id) || 0) + kolik);
  };

  // Základ: hodnota vlastní firmy.
  const klice = (hodnotaFirmy && typeof hodnotaFirmy.forEach === 'function')
    ? hodnotaFirmy : new Map(Object.entries(hodnotaFirmy || {}));
  klice.forEach((v, id) => out.set(Number(id), cislo(v)));

  equity.forEach((e) => {
    if (!e) return;
    const hod = hodnotaPodilu(hodnotaFirmy, e);
    // Majiteli se odečte přesně to, co se držiteli přičte — jinak by se
    // tentýž podíl počítal dvakrát a žebříček by lhal oběma.
    if (out.has(e.firma_id)) pridej(e.firma_id, -hod);
    if (e.investor_id != null) pridej(e.investor_id, hod);
    // Podíl držený fondem se majiteli odečetl a členům fondu se přičte níž,
    // v jeho hodnotě — proto se tady už nikam nepřidává.
  });

  (vklady || []).forEach((v) => {
    const celkem = vkladCelkem.get(v.aliance_id) || 0;
    if (!(celkem > 0)) return;
    const hod = fondHodnota.get(v.aliance_id);
    if (!Number.isFinite(Number(hod))) return;
    pridej(v.clen_id, cislo(hod) * (Math.max(0, cislo(v.castka)) / celkem));
  });

  const hotovo = new Map();
  out.forEach((v, id) => hotovo.set(id, Math.round(v)));
  return hotovo;
}

// ─── Poslední spočtené jmění ────────────────────────────────────
// Hodnost se počítá při každém uložení hry, tedy u aktívního hráče jednou za
// patnáct vteřin. Vlastnictví se kvůli tomu počítat znovu nemůže — je na to
// potřeba stav všech hráčů. Žebříček si ho ale počítá stějře, jednou za
// třicet vteřin, takže si ho tady odloží a hodnost si ho jen přečte.
//
// Když je šuplatka prázdná nebo stará, nestane se nic zlého: hodnost se spočte
// z provozní hodnoty firmy jako dřív a ta vyšší přijde, až někdo otevře
// žebříček. Jednou dosažená meta se neztrácí, takže opoždění nic nerozbíje.
let _odlozeno = { kdy: 0, mapa: new Map() };
function odloz(mapa) {
  if (mapa && typeof mapa.get === 'function') _odlozeno = { kdy: Date.now(), mapa };
}
// Jmění hráče z odloženého výpočtu, nebo null. maxStari je v milisekundách.
function odlozene(id, maxStari) {
  if (!_odlozeno.kdy) return null;
  if (Date.now() - _odlozeno.kdy > Math.max(0, cislo(maxStari))) return null;
  const v = _odlozeno.mapa.get(id);
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

module.exports = { spocti, hodnotyFondu, hodnotaPodilu, odloz, odlozene };
