// HolyOS — Krátké shrnutí „za co platím" u přijatého dokladu (1–3 slova, např. „Nájem Brno", „Spojovací materiál")
// Generuje Claude z položek dokladu, ukládá do Invoice.payment_note. Používá se v QR platbě (poznámka pro mě)
// a u plateb v platebním příkazu. Bez API klíče → jednoduchý odhad z první položky.
'use strict';
const { prisma } = require('../../config/database');

const MODEL = process.env.PAYMENT_NOTE_MODEL || 'claude-haiku-4-5';

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

/** Vrátí (a případně vygeneruje a uloží) poznámku k platbě dokladu. */
async function ensurePaymentNote(invoiceId) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, payment_note: true, internal_note: true, company: { select: { name: true } }, items: { select: { description: true, quantity: true, unit: true }, orderBy: { line_order: 'asc' } } },
  });
  if (!inv) return null;
  if (inv.payment_note) return inv.payment_note;
  let note = null;
  try { note = await aiSummary(inv); } catch (e) { console.warn('[payment-note] AI selhalo:', e.message); }
  if (!note) note = heuristic(inv);
  if (note) await prisma.invoice.update({ where: { id: invoiceId }, data: { payment_note: note.slice(0, 60) } }).catch(() => {});
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

module.exports = { ensurePaymentNote, ensureMany };
