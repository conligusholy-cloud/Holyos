// HolyOS — AI kontrola nabídky dodavatele: přečte přiloženou nabídku (PDF / obrázek z jejich systému)
// a porovná ji s hodnotami, které dodavatel vyplnil v poptávkovém listu (cena, termín, lhůta, min. odběr).
// Výsledek se ukládá do PurchaseInquiry.offer_check — nákupčí vidí rozdíly před souhlasem.
'use strict';

const fs = require('fs');
const path = require('path');
const { prisma } = require('../../config/database');

const MODEL = process.env.OFFER_CHECK_MODEL || process.env.OCR_MODEL_FIRST || 'claude-sonnet-4-6';
const MEDIA = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function extractJson(text) {
  const t = String(text || '');
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI nevrátila JSON');
  return JSON.parse(t.slice(s, e + 1));
}
const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Spustí kontrolu pro poptávku (podle id). Bezpečné volat opakovaně — přepíše předchozí výsledek.
 */
async function checkInquiryOffer(inquiryId) {
  const inq = await prisma.purchaseInquiry.findUnique({ where: { id: inquiryId }, include: { items: { orderBy: { line_order: 'asc' } } } });
  if (!inq || !inq.offer_file_path) return null;
  const ext = path.extname(inq.offer_file_path).toLowerCase();
  const media = MEDIA[ext];
  const save = (check) => prisma.purchaseInquiry.update({ where: { id: inq.id }, data: { offer_check: check, offer_checked_at: new Date() } });
  if (!media) return save({ status: 'unsupported', summary: 'Formát přílohy (' + ext + ') neumím automaticky přečíst — zkontroluj nabídku ručně.' });
  if (!process.env.ANTHROPIC_API_KEY) return save({ status: 'error', summary: 'Chybí ANTHROPIC_API_KEY — automatická kontrola nabídky není dostupná.' });

  let buf;
  try { buf = fs.readFileSync(inq.offer_file_path); } catch (e) { return save({ status: 'error', summary: 'Soubor nabídky se nepodařilo načíst.' }); }
  const items = inq.items.map((it) => ({ id: it.id, name: it.name, code: it.code, quantity: Number(it.quantity), unit: it.unit }));
  const prompt = 'Jsi kontrolor nákupu. V příloze je cenová nabídka dodavatele (z jeho systému). ' +
    'Pro každou poptávanou položku níže najdi v nabídce odpovídající řádek a vypiš hodnoty PŘESNĚ podle nabídky. ' +
    'Cenu uváděj za 1 jednotku BEZ DPH v měně nabídky. Když nabídka uvádí cenu za jinou jednotku (např. za kus místo za metr) nebo jen celkem za řádek, přepočti ji na jednotku poptávky a napiš to do note. ' +
    'Pokud položku v nabídce nenajdeš, dej found:false.\n\n' +
    'Poptávané položky (JSON):\n' + JSON.stringify(items) + '\n\n' +
    'Odpověz POUZE JSON objektem: {"currency":"CZK|EUR|…","offer_number":string|null,"valid_until":"YYYY-MM-DD"|null,"total_without_vat":number|null,' +
    '"items":[{"id":number,"found":boolean,"unit_price":number|null,"delivery_date":"YYYY-MM-DD"|null,"lead_time_days":number|null,"min_order_qty":number|null,"note":string|null}],"notes":string|null}';

  let ai;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const block = media === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: media, data: buf.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } };
    const resp = await client.messages.create({ model: MODEL, max_tokens: 2500, messages: [{ role: 'user', content: [block, { type: 'text', text: prompt }] }] });
    ai = extractJson((resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
  } catch (e) {
    console.warn('[offer-check] AI selhala:', e.message);
    return save({ status: 'error', summary: 'Nabídku se nepodařilo automaticky přečíst (' + String(e.message).slice(0, 120) + ').' });
  }

  // Porovnání s tím, co dodavatel vyplnil v poptávkovém listu
  const out = []; let diffs = 0; let missing = 0;
  for (const it of inq.items) {
    const a = (ai.items || []).find((x) => Number(x.id) === it.id) || { found: false };
    const filled = { unit_price: n(it.offered_price), delivery_date: ymd(it.offered_delivery), lead_time_days: it.lead_time_days, min_order_qty: n(it.min_order_qty) };
    const doc = { unit_price: n(a.unit_price), delivery_date: a.delivery_date || null, lead_time_days: n(a.lead_time_days), min_order_qty: n(a.min_order_qty) };
    const problems = [];
    if (!a.found) { problems.push('položka v nabídce chybí'); missing++; }
    else {
      if (filled.unit_price != null && doc.unit_price != null && Math.abs(filled.unit_price - doc.unit_price) > Math.max(0.01, Math.abs(doc.unit_price) * 0.005)) problems.push('cena: vyplněno ' + filled.unit_price + ', v nabídce ' + doc.unit_price);
      if (filled.unit_price == null && doc.unit_price != null) problems.push('cena vyplněná není, v nabídce ' + doc.unit_price);
      if (filled.delivery_date && doc.delivery_date && filled.delivery_date !== doc.delivery_date) problems.push('termín: vyplněno ' + filled.delivery_date + ', v nabídce ' + doc.delivery_date);
      if (filled.lead_time_days != null && doc.lead_time_days != null && Number(filled.lead_time_days) !== Number(doc.lead_time_days)) problems.push('lhůta: vyplněno ' + filled.lead_time_days + ' d, v nabídce ' + doc.lead_time_days + ' d');
      if (filled.min_order_qty != null && doc.min_order_qty != null && filled.min_order_qty !== doc.min_order_qty) problems.push('min. odběr: vyplněno ' + filled.min_order_qty + ', v nabídce ' + doc.min_order_qty);
    }
    if (problems.length && a.found) diffs++;
    out.push({ id: it.id, name: it.name, ok: !problems.length, problems, filled, doc, note: a.note || null });
  }
  const curDiff = ai.currency && inq.currency && String(ai.currency).toUpperCase() !== inq.currency ? 'Nabídka je v měně ' + ai.currency + ', poptávka v ' + inq.currency + '.' : null;
  const status = (diffs || missing || curDiff) ? 'differences' : 'ok';
  const summary = status === 'ok'
    ? '✅ Přiložená nabídka odpovídá vyplněným hodnotám.'
    : '⚠️ ' + [diffs ? diffs + ' položek se liší' : null, missing ? missing + ' položek v nabídce chybí' : null, curDiff].filter(Boolean).join(' · ');
  return save({ status, summary, currency: ai.currency || null, offer_number: ai.offer_number || null, valid_until: ai.valid_until || null, total_without_vat: n(ai.total_without_vat), notes: ai.notes || null, items: out, model: MODEL });
}

module.exports = { checkInquiryOffer };
