#!/usr/bin/env node
// =============================================================================
// Milionář — ruční připsání pozvánek
// =============================================================================
// Pozvánky dřív žily jen v paměti serveru, takže je každé nasazení smazalo.
// Tenhle skript dorovná, co se ztratilo: zapíše N „otevření" na dané ref id.
//
//   node scripts/game-add-refs.js <ref-id> <pocet>
//   node scripts/game-add-refs.js abc123def456 3
//
// Záznamy mají vymyšlený otisk návštěvníka (ruc-…), aby se nepletly se
// skutečnými a aby se daly kdykoli poznat a smazat.
// =============================================================================

'use strict';

const { prisma } = require('../config/database');

async function main() {
  const id = String(process.argv[2] || '').toLowerCase();
  const kolik = parseInt(process.argv[3], 10);
  if (!/^[a-z0-9]{6,24}$/.test(id) || !(kolik > 0) || kolik > 500) {
    console.error('Použití: node scripts/game-add-refs.js <ref-id> <pocet 1-500>');
    process.exit(1);
  }
  const data = Array.from({ length: kolik }, (_, i) => ({
    ref_id: id,
    visitor: 'ruc-' + Date.now().toString(36) + '-' + i
  }));
  const r = await prisma.gameRef.createMany({ data, skipDuplicates: true });
  const celkem = await prisma.gameRef.count({ where: { ref_id: id } });
  console.log('Připsáno ' + r.count + ' pozvánek. Hráč ' + id + ' jich má teď ' + celkem + '.');
}

main()
  .catch((e) => { console.error('Chyba:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
