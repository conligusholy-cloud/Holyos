// HolyOS — Warehouse Documents service
//
// Zastřešující dokumenty (dodací list, výdejka, přesunka, pickovací list,
// inventurní protokol). Generuje čísla řad, uzavírá dokumenty.

const { prisma } = require('../../config/database');

// Prefix pro číselnou řadu podle typu dokumentu
const DOC_PREFIX = {
  receipt_doc:   'PR',  // příjemka
  issue_doc:     'VY',  // výdejka
  transfer_doc:  'PS',  // přesunka
  pick_list:     'PI',  // pickovací list
  inventory_doc: 'IN',  // inventurní protokol
};

const DOC_TYPES = Object.keys(DOC_PREFIX);

/**
 * Vygeneruje číslo dokumentu typu {PREFIX}-{YEAR}-{00001}.
 * Najde nejvyšší existující číslo v daném prefixu + aktuálním roce a inkrementuje.
 */
async function generateDocumentNumber(type, tx = prisma) {
  const prefix = DOC_PREFIX[type];
  if (!prefix) throw new Error(`Neznámý typ dokumentu: ${type}`);

  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;

  const latest = await tx.warehouseDocument.findFirst({
    where: { number: { startsWith: `${prefix}-${year}-` } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  let nextSeq = 1;
  if (latest) {
    const parts = latest.number.split('-');
    const seq = Number(parts[2]);
    if (Number.isFinite(seq)) nextSeq = seq + 1;
  }
  return `${prefix}-${year}-${String(nextSeq).padStart(5, '0')}`;
}

/**
 * Vytvoří nový draft dokument.
 */
async function createDocument({ type, partner_id, reference, note, created_by }) {
  if (!DOC_TYPES.includes(type)) throw new Error(`Neznámý typ dokumentu: ${type}`);

  return prisma.$transaction(async (tx) => {
    const number = await generateDocumentNumber(type, tx);
    const doc = await tx.warehouseDocument.create({
      data: {
        type,
        number,
        status: 'draft',
        partner_id: partner_id ?? null,
        reference: reference ?? null,
        note: note ?? null,
        created_by: created_by ?? null,
      },
    });
    return doc;
  });
}

/**
 * Uzavře dokument (draft / in_progress → completed).
 */
async function completeDocument(id, completed_by) {
  const doc = await prisma.warehouseDocument.findUnique({ where: { id } });
  if (!doc) throw new Error('Dokument neexistuje');
  if (doc.status === 'completed') return doc;
  if (doc.status === 'cancelled') throw new Error('Dokument je zrušen, nelze jej uzavřít');

  return prisma.warehouseDocument.update({
    where: { id },
    data: {
      status: 'completed',
      completed_at: new Date(),
      completed_by: completed_by ?? null,
    },
  });
}

/**
 * Zruší dokument (status → cancelled). Nemaže pohyby — jen příznak.
 */
async function cancelDocument(id) {
  const doc = await prisma.warehouseDocument.findUnique({ where: { id } });
  if (!doc) throw new Error('Dokument neexistuje');
  if (doc.status === 'completed') throw new Error('Uzavřený dokument nelze zrušit (udělej opačný)');
  return prisma.warehouseDocument.update({
    where: { id },
    data: { status: 'cancelled' },
  });
}

module.exports = { createDocument, completeDocument, cancelDocument, generateDocumentNumber, DOC_TYPES, DOC_PREFIX };
