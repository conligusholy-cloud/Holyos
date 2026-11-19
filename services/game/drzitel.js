// =============================================================================
// Laundromat Tycoon — kdo drží podíl
// =============================================================================
// Podíl ve firmě patřil vždycky hráči. Od chvíle, kdy do firem investuje
// i fond aliance, může patřit dvěma různým druhům držitelů — a to je přesně
// ten druh změny, po které se někde potichu sečte něco jiného.
//
// Proto se držitel nikde nečte přímo z investor_id. Odpovědí je KLÍČ: 'h:17'
// pro hráče, 'f:3' pro fond. Dvě různá id se tím nemůžou potkat a součet po
// držitelích vyjde správně, i když ve firmě sedí hráč i fond vedle sebe.
//
// Podíl bez držitele neexistuje: hlídá to CHECK v databázi. Kdyby se přesto
// objevil, klic() vrátí null a volající ho má vynechat — nikdy ho nesmí
// přičíst k nule, protože nula je platné id.
'use strict';

function klic(e) {
  if (!e) return null;
  if (e.fond_id != null) return 'f:' + e.fond_id;
  if (e.investor_id != null) return 'h:' + e.investor_id;
  return null;
}
const jeFond = (e) => !!e && e.fond_id != null;
const jeHrac = (e) => !!e && e.fond_id == null && e.investor_id != null;

// Zpátky z klíče. Hodí se tam, kde se po součtu musí zase zjistit, komu
// vlastně výsledek patří.
function zKlice(k) {
  const s = String(k || '');
  const id = parseInt(s.slice(2), 10);
  if (!/^[hf]:/.test(s) || !Number.isFinite(id)) return null;
  return { typ: s[0] === 'f' ? 'fond' : 'hrac', id };
}

// Součet podílů po držitelích. Jeden člověk může mít ve firmě víc řádků a
// pořád je to jeden držitel — na tom stojí každá většina ve hře.
function soucet(podily) {
  const m = new Map();
  (podily || []).forEach((e) => {
    const k = klic(e);
    if (k == null) return;
    m.set(k, (m.get(k) || 0) + (Number(e.podil) || 0));
  });
  return m;
}

// Seznam ve tvaru, na který jsou zvyklé prava.js a prevzeti.js: drzitel je
// klíč, takže se hráč a fond nemůžou slít dohromady.
function seznam(podily) {
  return Array.from(soucet(podily), ([drzitel, podil]) => ({ drzitel, podil }));
}

module.exports = { klic, zKlice, jeFond, jeHrac, soucet, seznam };
