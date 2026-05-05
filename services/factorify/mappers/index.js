// =============================================================================
// HolyOS — Factorify mappers — souhrnný export
// =============================================================================

module.exports = {
  helpers: require('./_helpers'),
  suppliers: require('./suppliers.mapper'),
  warehouses: require('./warehouses.mapper'),
  projects: require('./projects.mapper'),
  costCenters: require('./cost-centers.mapper'),
  priceLists: require('./price-lists.mapper'),
  orders: require('./orders.mapper'),
  documents: require('./documents.mapper'),
  inventories: require('./inventories.mapper'),
  movements: require('./movements.mapper'),
  // materials: zatím přes scripts/dump-factorify.js
};
