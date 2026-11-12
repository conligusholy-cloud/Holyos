// HolyOS — Krátké shrnutí „za co platím" u přijatého dokladu (1–3 slova, např. „Nájem Brno", „Spojovací materiál")
// Generuje Claude z položek dokladu, ukládá do Invoice.payment_note. Používá se v QR platbě (poznámka pro mě)
// a u plateb v platebním příkazu. Bez API klíče → jednoduchý odhad z první položky.
//
// PRAVIDLA PODLE DODAVATELE (požadavek #149): u firmy se dá natvrdo nastavit text
// (např. Tesco → „Potraviny"). Pravidlo má přednost před AI — u dokladů té firmy
// se doplní rovnou, takže se „za co platím" nehádá u každé faktury znovu.
// Uloženo v AppSetting accounting.payment_note_rules jako { "<company_id>": "text" }.
'use strict';
const { prisma } = require('../../config/database');

const MODEL = process.env.PAYMENT_NOTE_MODEL || 'claude-haiku-4-5';
const RULES_KEY = 'accounting.payment_note_rules';
const NOTE_MAX = 60; // odpovídá Invoice.payment_note @db.VarChar(60)

// Ořez a normalizace textu poznámky (jedna řádka, max 60 znaků).
function normNote(v) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, NOTE_MAX) : null;
}

function heuristic(inv) {
  const items = (inv.items || []).map((i) => String(i.description || '').trim()).filter(Boolean);
  if (!items.length) return null;
  const words = items[0].replace(/[\d.,;:()\[\]/\\_-]+/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : null;
}

async function aiSummary(inv) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const items = (inv.items || []).slice(0, 25).map((i) => '- ' + String(i.description || '').slice(0, 160) + (i.quantity ? ' (' + Number(i.quantity) + ' ' + (i.unit || '') + ')' : '')).join('\n');
  if (!items && !inv.company?.name) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = 'Shrň jedním až třemi slovy česky, ZA CO se platí tato přijatá faktura (co se nakoupilo / jaká služba). ' +
    'Příklady dobrých odpovědí: „Nájem Brno", „Spojovací materiál", „Pohonné hmoty", „Elektřina", „Software licence", „Doprava". ' +
    'Bez názvu dodavatele, bez čísel faktur, bez uvozovek a tečky. Max 30 znaků.\n\n' +
    'Dodavatel: ' + (inv.company?.name || '?') + '\nPoložky:\n' + (items || '(bez položek)') +
    (inv.internal_note ? '\nPoznámka: ' + String(inv.internal_note).slice(0, 200) : '');
  const resp = await client.messages.create({ model: MODEL, max_tokens: 40, messages: [{ role: 'user', content: prompt }] });
  const txt = (resp.content || []).map((c) => c.text || '').join('').replace(/["„“”'.]/g, '').replace(/\s+/g, ' ').trim();
  return txt ? txt.slice(0, 30) : null;
}

/** Všechna pravidla „za co platím" podle dodavatele: { "<company_id>": "text" }. */
async function getRules() {
  try {
    const { getSetting } = require('../settings');
    const r = await getSetting(RULES_KEY, { type: 'json', defaultValue: {} });
    return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
  } catch (e) {
    console.warn('[payment-note] načtení pravidel selhalo:', e.message);
    return {};
  }
}

/** Text z pravidla pro daného dodavatele, nebo null. */
async function ruleFor(companyId) {
  if (!companyId) return null;
  const rules = await getRules();
  return normNote(rules[String(companyId)]);
}

/**
 * Uloží/zruší pravidlo pro dodavatele. note = null nebo prázdné → pravidlo se smaže.
 * Vrací celou mapu pravidel po změně.
 */
async function setRule(companyId, note, userId) {
  const { getSetting, setSetting } = require('../settings');
  const cur = (await getSetting(RULES_KEY, { type: 'json', defaultValue: {} })) || {};
  const rules = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? { ...cur } : {};
  const clean = normNote(note);
  if (clean) rules[String(companyId)] = clean; else delete rules[String(companyId)];
  await setSetting(RULES_KEY, rules, {
    type: 'json',
    description: 'Účetní doklady — „za co platím" podle dodavatele (pravidla pro přijaté doklady)',
    scope: 'accounting',
    userId: userId || null,
  });
  return rules;
}

/**
 * Propíše pravidlo do přijatých dokladů dodavatele.
 * overwrite=false (výchozí) → doplní jen doklady s prázdným polem, ruční texty nechá být.
 * Vrací počet upravených dokladů.
 */
async function applyRuleToInvoices(companyId, note, opts = {}) {
  const clean = normNote(note);
  if (!companyId || !clean) return 0;
  const where = { company_id: parseInt(companyId, 10), direction: 'ap' };
  if (!opts.overwrite) where.OR = [{ payment_note: null }, { payment_note: '' }];
  const r = await prisma.invoice.updateMany({ where, data: { payment_note: clean } });
  return r.count;
}

/** Vrátí (a případně vygeneruje a uloží) poznámku k platbě dokladu. */
async function ensurePaymentNote(invoiceId) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, payment_note: true, internal_note: true, company_id: true, company: { select: { name: true } }, items: { select: { description: true, quantity: true, unit: true }, orderBy: { line_order: 'asc' } } },
  });
  if (!inv) return null;
  if (inv.payment_note) return inv.payment_note;
  // Pravidlo dodavatele má přednost před AI — ušetří dotaz a drží jednotný text.
  const fromRule = await ruleFor(inv.company_id);
  if (fromRule) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { payment_note: fromRule } }).catch(() => {});
    return fromRule;
  }
  let note = null;
  try { note = await aiSummary(inv); } catch (e) { console.warn('[payment-note] AI selhalo:', e.message); }
  if (!note) note = heuristic(inv);
  if (note) await prisma.invoice.update({ where: { id: invoiceId }, data: { payment_note: note.slice(0, NOTE_MAX) } }).catch(() => {});
  return note;
}

/** Doplní poznámky u více dokladů (po 4 souběžně). */
async function ensureMany(ids, limit = 4) {
  const out = {};
  const queue = [...ids];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) { const id = queue.shift(); try { out[id] = await ensurePaymentNote(id); } catch (e) { out[id] = null; } }
  }));
  return out;
}

module.exports = { ensurePaymentNote, ensureMany, getRules, ruleFor, setRule, applyRuleToInvoices, normNote, RULES_KEY };
