// HolyOS — Detekce duplicitních faktur
// Identifikační signature: external_number + company_id + date_issued + total (+ direction)

const { prisma } = require('../config/database');

/**
 * Hledá potenciální duplicitní Invoice v DB.
 * @param {object} candidate - { external_number, company_id, date_issued, total, direction, variable_symbol }
 * @returns { isDuplicate: bool, confidence: 0-1, matches: [...] }
 *    matches obsahuje id a invoice_number nalezených duplicit.
 */
async function checkDuplicate(candidate) {
  const { external_number, company_id, date_issued, total, direction, variable_symbol } = candidate;

  const or = [];

  // Silné signatury (pokud sedí VŠE z kombinace)
  if (external_number && company_id) {
    or.push({
      external_number,
      company_id: Number(company_id),
      direction: direction || undefined,
    });
  }
  if (variable_symbol && company_id) {
    or.push({
      variable_symbol,
      company_id: Number(company_id),
      direction: direction || undefined,
    });
  }

  // Slabší — same company, same date, same total
  if (company_id && date_issued && total) {
    or.push({
      company_id: Number(company_id),
      date_issued: new Date(date_issued),
      total: Number(total).toFixed(2),
      direction: direction || undefined,
    });
  }

  if (or.length === 0) {
    return { isDuplicate: false, confidence: 1, matches: [] };
  }

  const matches = await prisma.invoice.findMany({
    where: {
      OR: or,
      status: { not: 'cancelled' },
    },
    select: {
      id: true, invoice_number: true, external_number: true,
      date_issued: true, total: true, status: true,
      variable_symbol: true,
    },
    take: 5,
  });

  // Silná shoda = same external_number + same company
  const strongMatch = matches.some(m =>
    external_number && m.external_number === external_number
  );

  return {
    isDuplicate: matches.length > 0,
    confidence: strongMatch ? 1.0 : (matches.length > 0 ? 0.7 : 0),
    matches,
    strongMatch,
  };
}

module.exports = { checkDuplicate };
