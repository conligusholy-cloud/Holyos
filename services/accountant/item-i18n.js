// HolyOS — překlad popisů položek dokladů z češtiny do angličtiny (glosář pro běžné položky Best Series).
// Použití: u dokladu v angličtině se jako název zobrazí anglická verze a pod ní malým písmem český originál.
// Má-li položka vlastní description_en, použije se přednostně.
'use strict';

// Pořadí je důležité: delší / specifičtější výrazy dřív.
const GLOSSARY = [
  [/Přijatá záloha/gi, 'Advance payment received'],
  [/Zálohová faktura/gi, 'Proforma invoice'],
  [/Záloha/gi, 'Advance payment'],
  [/Dobropis/gi, 'Credit note'],
  [/Doprava a montáž/gi, 'Transport and installation'],
  [/Doprava/gi, 'Transport'],
  [/Montáž/gi, 'Installation'],
  [/sleva na dopravu/gi, 'discount on transport'],
  [/Sleva/gi, 'Discount'],
  [/Přípojky \(voda, odpad, elektřina\)/gi, 'Utility connections (water, sewage, electricity)'],
  [/Přípojky/gi, 'Utility connections'],
  [/Najít místo/gi, 'Site search'],
  [/Servisní poplatek/gi, 'Service fee'],
  [/Servisní smlouva/gi, 'Service contract'],
  [/Softwarová podpora/gi, 'Software support'],
  [/Prodloužená záruka/gi, 'Extended warranty'],
  [/Záruka/gi, 'Warranty'],
  [/Prádlomaty/gi, 'Laundromats'],
  [/Prádlomat/gi, 'Laundromat'],
  [/tři pračky/gi, 'three washers'],
  [/\b3 pračky\b/gi, '3 washers'],
  [/pračky/gi, 'washers'],
  [/pračka/gi, 'washer'],
  [/sušička/gi, 'dryer'],
  [/sušičky/gi, 'dryers'],
  [/\bs\b(?=\s+sušičkou)/gi, 'with'],
  [/výrobní číslo/gi, 'serial no.'],
  [/výr\. ?č\./gi, 'serial no.'],
  [/\btypu?\b/gi, 'type'],
  [/\btyp\b/gi, 'type'],
  [/\bza měsíc\b/gi, 'for month'],
  [/\bza\b(?=\s+\d{1,2}\/\d{4})/gi, 'for'],
  [/\bměsíčně\b/gi, 'monthly'],
  [/\bpoplatek\b/gi, 'fee'],
  [/\bsmlouva\b/gi, 'contract'],
  [/\bzákazník\b/gi, 'customer'],
];
const MONTHS = { ledna: 'January', února: 'February', března: 'March', dubna: 'April', května: 'May', června: 'June', července: 'July', srpna: 'August', září: 'September', října: 'October', listopadu: 'November', prosince: 'December' };
const UNITS = { ks: 'pcs', 'ks.': 'pcs', hod: 'h', 'hod.': 'h', měs: 'month', 'měs.': 'month', kg: 'kg', m: 'm', sada: 'set', služba: 'service', paušál: 'flat fee' };

function translateItem(cs) {
  let s = String(cs || '');
  GLOSSARY.forEach(([re, en]) => { s = s.replace(re, en); });
  Object.keys(MONTHS).forEach((cz) => { s = s.replace(new RegExp('\\b' + cz + '\\b', 'gi'), MONTHS[cz]); });
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function translateUnit(u) {
  const k = String(u || 'ks').trim().toLowerCase();
  return UNITS[k] || u || 'pcs';
}

module.exports = { translateItem, translateUnit };
