// =============================================================================
// HolyOS — Druhy nákupních objednávek
// =============================================================================
// Jeden zdroj pravdy pro frontend i backend: čtyři druhy nákupní objednávky
// a pravidla, která z nich plynou. Druh se volí jako první krok v „Nová objednávka".
//
//   kooperace, vyroba   — zboží PROCHÁZÍ skladem
//                         → položky jen ze zboží (skladová karta), vyžaduje se příjemka
//   spotreba, sluzba    — skladem NEPROCHÁZÍ
//                         → položka smí být jen text; i když se vybere ze zboží,
//                           příjemka se nevyžaduje a na sklad se nic nepřijímá
//
// `Order.type` zůstává 'cooperation' u kooperace a 'purchase' u zbylých tří,
// aby stávající přehledy a vazby (`type in ['purchase','cooperation']`) fungovaly dál.

'use strict';

const KINDS = {
  kooperace: {
    key: 'kooperace', label: 'Kooperace', icon: '🤝', orderType: 'cooperation',
    stock: true, requiresReceipt: true, allowFreeText: false,
    hint: 'Díly od kooperanta. Prochází skladem — položky se vybírají ze zboží a čeká se příjemka.',
  },
  vyroba: {
    key: 'vyroba', label: 'Do výroby', icon: '🏭', orderType: 'purchase',
    stock: true, requiresReceipt: true, allowFreeText: false,
    hint: 'Materiál a díly pro výrobu. Prochází skladem — položky se vybírají ze zboží a čeká se příjemka.',
  },
  spotreba: {
    key: 'spotreba', label: 'Spotřeba', icon: '🧴', orderType: 'purchase',
    stock: false, requiresReceipt: false, allowFreeText: true,
    hint: 'Spotřební materiál, který se rovnou spotřebuje. Skladem neprochází, příjemka se nevyžaduje.',
  },
  sluzba: {
    key: 'sluzba', label: 'Služba', icon: '🛠️', orderType: 'purchase',
    stock: false, requiresReceipt: false, allowFreeText: true,
    hint: 'Práce, servis, revize. Skladem neprochází, příjemka se nevyžaduje.',
  },
};
const KIND_KEYS = Object.keys(KINDS);

// Vedlejší pořizovací náklady — smí být i na skladové objednávce, přestože nejde o zboží.
// Na sklad se nepřijímají; jejich hodnota se při příjmu rozpustí do ceny zboží.
const COST_KINDS = {
  shipping: { key: 'shipping', label: 'Doprava', icon: '🚚' },
  recycling: { key: 'recycling', label: 'Recyklační poplatek', icon: '♻️' },
  cod: { key: 'cod', label: 'Dobírka', icon: '💰' },
};
const COST_KEYS = Object.keys(COST_KINDS);

const kind = (k) => KINDS[String(k || '').toLowerCase()] || null;
const isCostLine = (it) => !!(it && it.cost_kind && COST_KINDS[it.cost_kind]);

/** Druh objednávky — z uloženého `purchase_kind`, u starých dokladů odhad z `type`. */
function orderKind(order) {
  if (!order) return null;
  return kind(order.purchase_kind) || (order.type === 'cooperation' ? KINDS.kooperace : (order.type === 'purchase' ? KINDS.vyroba : null));
}

/** Čeká se u téhle objednávky příjemka? (Spotřeba a Služba skladem neprochází.) */
function requiresReceipt(order) {
  const k = orderKind(order);
  return k ? k.requiresReceipt : true; // neznámý druh raději hlídáme
}

/**
 * Rozpuštění vedlejších nákladů do skladové ceny (váženě podle hodnoty položky).
 *
 * Doprava, recyklační poplatek a dobírka nejsou zboží — na sklad se nepřijímají,
 * ale zaplatili jsme je a patří do pořizovací ceny. Rozpočítají se poměrem hodnoty:
 * položka za 8 000 Kč z celkových 10 000 Kč nese 80 % dopravy.
 *
 * @param {Array} items položky objednávky ({ id, quantity, unit_price, confirmed_price, cost_kind })
 * @returns {{ overhead, base, ratio, byItem, unitPrice }} `unitPrice(item)` = cena vč. podílu
 */
function spreadOverhead(items) {
  const list = Array.isArray(items) ? items : [];
  const cena = (it) => {
    const p = it && it.confirmed_price != null ? Number(it.confirmed_price) : Number((it && it.unit_price) || 0);
    return Number.isFinite(p) ? p : 0;
  };
  const mnozstvi = (it) => { const q = Number((it && it.quantity) || 0); return Number.isFinite(q) ? q : 0; };

  const naklady = list.filter(isCostLine);
  const zbozi = list.filter((it) => !isCostLine(it));
  const overhead = naklady.reduce((a, it) => a + cena(it) * mnozstvi(it), 0);
  const base = zbozi.reduce((a, it) => a + cena(it) * mnozstvi(it), 0);
  // Bez zboží (nebo s nulovou hodnotou) není do čeho rozpouštět — ceny necháme být.
  const ratio = (overhead > 0 && base > 0) ? overhead / base : 0;

  const byItem = {};
  zbozi.forEach((it) => {
    const zaklad = cena(it);
    const navic = Math.round(zaklad * ratio * 10000) / 10000;
    byItem[it.id] = { base: zaklad, surcharge: navic, total: Math.round((zaklad + navic) * 10000) / 10000 };
  });

  return {
    overhead, base, ratio, byItem,
    unitPrice: (it) => {
      if (!it || isCostLine(it)) return cena(it);
      const z = byItem[it.id];
      return z ? z.total : cena(it);
    },
  };
}

module.exports = { KINDS, KIND_KEYS, COST_KINDS, COST_KEYS, kind, orderKind, requiresReceipt, isCostLine, spreadOverhead };
