// HolyOS — Chytré vyhledání dokladů pro podklad k nájmu kiosku.
// Z PŘIJATÝCH faktur za měsíc (kandidáti) nechá AI přečíst obsah dokladu (dodavatel, popis položek, poznámka)
// a určit: (1) o jaký náklad jde — nájem lokality / energie a média / pozáruční servis a díly / nesouvisí,
// (2) zda patří právě k tomuto kiosku (kód stroje, adresa/název lokality, provozovatel).
// Doklady nalezené podle pravidel (dodavatel + klíčové slovo) se sem nedostanou — pravidla mají přednost.
'use strict';

const { prisma } = require('../../config/database');
const { periodVsMonth } = require('./rent-period');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MODEL = process.env.RENT_MATCH_MODEL || 'claude-haiku-4-5-20251001';
const CAT_MAP = { rent: 'D', energy: 'E', parts_service: 'F' };
const CAT_NAME = { rent: 'nájem lokality', energy: 'energie / média', parts_service: 'pozáruční servis / díly' };

// Kontext stroje ze SIS (štítek, adresa, provozovatel) — pomáhá AI poznat, že doklad patří k této lokalitě. Chyba = bez kontextu.
async function kioskContext(code) {
  try {
    const key = process.env.SIS_KIOSK_API_KEY; if (!key) return {};
    const url = process.env.SIS_KIOSK_API_URL || 'https://sis-test.infinitygrid.cloud/api/public/kiosk-values';
    const r = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return {};
    const j = await r.json(); const list = Array.isArray(j) ? j : (j.kiosks || j.data || []);
    const k = list.find((x) => String(x.code).toUpperCase() === String(code).toUpperCase());
    return k ? { label: k.label || k.name || null, address: k.address || null, companyName: k.companyName || null } : {};
  } catch (e) { return {}; }
}

function invoiceBrief(inv) {
  return {
    id: inv.id, supplier: inv.company && inv.company.name, supplier_ico: inv.company && inv.company.ico,
    number: inv.external_number || inv.invoice_number, duzp: inv.date_taxable ? new Date(inv.date_taxable).toISOString().slice(0, 10) : null,
    total: Number(inv.total), currency: inv.currency, note: inv.note ? String(inv.note).slice(0, 300) : null,
    items: (inv.items || []).slice(0, 8).map((it) => String(it.description || '').slice(0, 160)),
  };
}

async function askAi(contract, ctx, batch) {
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) return [];
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const prompt = 'Jsi účetní asistent. U každé PŘIJATÉ faktury rozhodni, zda je to náklad související s provozem konkrétního prádlomatu (kiosku), a jaký.\n\n'
    + 'KIOSK: kód ' + contract.kiosk_code + (ctx.label ? ', název/lokalita: ' + ctx.label : '') + (ctx.address ? ', adresa: ' + ctx.address : '') + (ctx.companyName ? ', provozovatel: ' + ctx.companyName : '')
    + (contract.customer_name ? ', subjekt (nájemce): ' + contract.customer_name : '') + '\n\n'
    + 'KATEGORIE: "rent" = nájem místa/prostoru/lokality, kde stojí kiosk; "energy" = elektřina, plyn, voda, teplo, odpad a další provozní média spotřebovaná provozem; "parts_service" = pozáruční servis, opravy a náhradní díly stroje; "other" = nesouvisí (zboží, mzdy, marketing, jiné lokality…).\n'
    + 'PATŘÍ K TOMUTO KIOSKU: "yes" pouze pokud z dokladu plyne vazba (kód stroje, adresa/název lokality, provozovatel); "no" pokud doklad zjevně patří jinam (jiná adresa/lokalita); "unknown" pokud je doklad obecný a vazbu nelze určit.\n'
    + 'Nevymýšlej si: když si nejsi jistý, dej nižší confidence (0–1).\n\n'
    + 'FAKTURY (JSON): ' + JSON.stringify(batch.map(invoiceBrief)) + '\n\n'
    + 'Odpověz POUZE JSON polem bez dalšího textu: [{"id":číslo,"category":"rent|energy|parts_service|other","belongs":"yes|no|unknown","confidence":0.0,"reason":"max 120 znaků česky"}]';
  const r = await client.messages.create({ model: MODEL, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] });
  const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = text.match(/\[[\s\S]*\]/); if (!m) return [];
  try { return JSON.parse(m[0]); } catch (e) { return []; }
}

// Vrátí { lines: [automaticky přidané řádky D/E/F], suggestions: [k potvrzení], missing: [] }.
// skipInvoiceIds = doklady už zachycené pravidly nebo použité jinde; haveCats = kategorie už pokryté (pro hlášení „chybí").
async function match(contract, rev, opts) {
  opts = opts || {};
  const skip = new Set(opts.skipInvoiceIds || []);
  if (contract.ai_match === false || !process.env.ANTHROPIC_API_KEY) return { lines: [], suggestions: [], used: 0 };
  const ymFrom = new Date(rev.prevMonthYm + '-01T00:00:00Z');
  const ymTo = new Date(Date.UTC(ymFrom.getUTCFullYear(), ymFrom.getUTCMonth() + 1, 0));
  const cands = await prisma.invoice.findMany({
    where: { type: 'received', status: { notIn: ['cancelled', 'written_off'] }, id: { notIn: Array.from(skip) },
      OR: [{ date_taxable: { gte: ymFrom, lte: ymTo } }, { date_taxable: null, date_issued: { gte: ymFrom, lte: ymTo } }] },
    include: { items: true, company: { select: { name: true, ico: true } } }, orderBy: { id: 'desc' }, take: 80,
  });
  // doklady už použité v jiných podkladech za stejný měsíc (nepočítat dvakrát)
  const others = await prisma.kioskRentStatement.findMany({ where: { period_ym: rev.prevMonthYm, NOT: { contract_id: contract.id } }, select: { lines: true } });
  const usedElsewhere = new Set(); others.forEach((s) => (Array.isArray(s.lines) ? s.lines : []).forEach((l) => l && l.invoice_id && usedElsewhere.add(l.invoice_id)));
  const list = cands.filter((i) => !usedElsewhere.has(i.id));
  if (!list.length) return { lines: [], suggestions: [], used: 0 };
  const ctx = await kioskContext(contract.kiosk_code);
  const factor = rev.partial && rev.month_days ? rev.days / rev.month_days : 1;
  const lines = [], suggestions = [];
  for (let i = 0; i < list.length; i += 25) {
    const batch = list.slice(i, i + 25); let res = [];
    try { res = await askAi(contract, ctx, batch); } catch (e) { console.warn('[rent-ai] dávka selhala:', e.message); continue; }
    for (const a of res) {
      const inv = batch.find((x) => x.id === a.id); const cat = CAT_MAP[a.category];
      if (!inv || !cat || a.belongs === 'no') continue;
      const conf = Number(a.confidence) || 0; if (conf < 0.5) continue;
      const okItems = (inv.items || []).filter((it) => periodVsMonth(it.description, rev.prevMonthYm) !== 'no'); // jiné období na dokladu = nepatří
      if (!okItems.length) continue;
      const certain = okItems.every((it) => periodVsMonth(it.description, rev.prevMonthYm) === 'yes');
      const byRate = {}; okItems.forEach((it) => { const k = Number(it.vat_rate) || 0; byRate[k] = (byRate[k] || 0) + Number(it.total || 0); });
      for (const [rate, total] of Object.entries(byRate)) {
        const amount = r2(total * factor); if (!(amount > 0)) continue;
        const line = { cat, label: 'Faktura ' + (inv.external_number || inv.invoice_number) + ' — ' + ((inv.company && inv.company.name) || '') + ' (AI: ' + CAT_NAME[a.category] + (factor < 1 ? ', poměrně ' + rev.days + '/' + rev.month_days + ' dní' : '') + ')', amount, vat_rate: Number(rate), deductible: true, invoice_id: inv.id, confidence: conf, reason: String(a.reason || '').slice(0, 160), belongs: a.belongs };
        if (conf >= 0.8 && a.belongs === 'yes' && certain) lines.push(Object.assign(line, { source: 'ai' })); else suggestions.push(line);
      }
    }
  }
  return { lines, suggestions, used: list.length };
}

module.exports = { match };
