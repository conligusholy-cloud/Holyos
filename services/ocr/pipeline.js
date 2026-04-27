// HolyOS — Multi-pass OCR pipeline pro faktury
// Orchestruje 6 průchodů:
//  1) Claude Vision — hlavička
//  2) Claude Vision — položky
//  3) ARES lookup — validace firmy
//  4) VAT math — matematika
//  5) Duplicate check — duplicita v DB
//  6) (fallback) Claude Opus re-read pokud composite < 0.85

const { extractHeader, extractItems, rereadWithOpus } = require('./claude-vision');
const { lookupByIco, crossCheck } = require('../ares-lookup');
const { validateInvoiceMath } = require('../vat-math');
const { checkDuplicate } = require('../invoice-duplicate');
const { prisma } = require('../../config/database');

const CONFIDENCE_THRESHOLDS = {
  ready: 0.85,       // automaticky vytvořit Invoice (status=draft, needs_human_review=false)
  review: 0.5,       // vytvořit Invoice (needs_human_review=true)
  unreadable: 0.0,   // neumíme přečíst — auto-reply odesílateli
};

// Rozpoznat direction (ap / ar) podle toho, jestli naše firma je supplier nebo customer.
// Placeholder — do budoucna vytáhnout z env nebo settings:
const OUR_COMPANY_ICOS = (process.env.OUR_COMPANY_ICOS || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * Vrátí objekt { direction, suspicious, reason } popisující výsledek detekce.
 *  - direction: 'ap' | 'ar' (vždy nějaký, abychom mohli pokračovat v pipeline)
 *  - suspicious: true pokud OCR výstup je vnitřně nekonzistentní → faktura by neměla
 *    vzniknout automaticky, ale měla by jít do `awaiting_review`/`needs_review`
 *  - reason: česká věta pro UI/audit log (proč je to podezřelé)
 *
 * Past z 2026-04-27 (BestDrive HROMADNÁ FAKTURA): atypický layout, kde dodavatel
 * je jen ve small-print hlavičce. OCR potom občas přiřadí naše IČO supplieru
 * a faktura se vytvoří jako AR z naší firmy → nesmysl. Sanity check to chytí.
 */
function detectDirection(headerData) {
  const supplierIco = headerData?.supplier?.ico || null;
  const customerIco = headerData?.customer?.ico || null;
  const ourIsSupplier = supplierIco && OUR_COMPANY_ICOS.includes(supplierIco);
  const ourIsCustomer = customerIco && OUR_COMPANY_ICOS.includes(customerIco);

  // 1) Naše IČO je v dodavateli I odběrateli současně — nemožné v praxi, OCR omyl
  if (ourIsSupplier && ourIsCustomer) {
    return {
      direction: 'ap',
      suspicious: true,
      reason: `Naše IČO ${supplierIco} se objevilo zároveň jako dodavatel i odběratel — OCR pravděpodobně přečetla pole špatně. Zkontroluj ručně.`,
    };
  }

  // 2) Standardní cesta: naše IČO v customer → AP
  if (ourIsCustomer) {
    return { direction: 'ap', suspicious: false, reason: null };
  }

  // 3) Standardní cesta: naše IČO v supplier → AR (my fakturujeme)
  //    Z mailboxu pro příchozí faktury je to atypické, ale legitimní use case
  //    (forward vlastní AR faktury). Necháme projít, jen mírně flag.
  if (ourIsSupplier) {
    return { direction: 'ar', suspicious: false, reason: null };
  }

  // 4) Naše IČO se na faktuře vůbec nenašlo. Buď OCR pole nepřečetla
  //    (atypický layout — BestDrive small-print bug), nebo je to faktura mezi
  //    3rd parties (raritní). Flagneme jako podezřelé.
  const t = headerData?.type || '';
  if (t.endsWith('_issued') || t === 'issued') {
    return {
      direction: 'ar',
      suspicious: true,
      reason: `OCR určila typ "vystavená", ale naše IČO (${OUR_COMPANY_ICOS.join(', ') || '—nenastaveno—'}) není v dodavateli (${supplierIco || '?'}) ani odběrateli (${customerIco || '?'}). Mohla být přečtena pole prohozeně. Schval ručně.`,
    };
  }

  return {
    direction: 'ap',
    suspicious: true,
    reason: `OCR nedokázala přiřadit naše IČO (${OUR_COMPANY_ICOS.join(', ') || '—nenastaveno—'}) k roli na faktuře (dodavatel: ${supplierIco || '?'}, odběratel: ${customerIco || '?'}). Layout je možná atypický — schval ručně.`,
  };
}

/**
 * Hlavní funkce — spustí celou pipeline nad souborem faktury.
 *
 * @param {string} filePath - cesta k PDF/obrázku
 * @param {object} ctx - { email_ingest_id?, attachment_id? } — pro uložení extrakcí
 * @returns {object} výsledek — viz na konci funkce
 */
async function updateProgress(ctx, fractionalConfidence, phase = null) {
  if (!ctx?.email_ingest_id) return;
  const offset = ctx.progress_offset || 0;
  const scale = ctx.progress_scale || 1;
  const overall = Math.min(1, offset + fractionalConfidence * scale);

  const data = { confidence: overall };
  if (phase) {
    const total = ctx.total_attachments || 1;
    const idx = ctx.attachment_idx || 1;
    data.note = total > 1 ? `${phase} · ${idx}/${total}` : phase;
  }
  try {
    await prisma.emailIngest.update({ where: { id: ctx.email_ingest_id }, data });
  } catch (e) {
    console.warn('[OCR pipeline] update progress selhal:', e.message);
  }
}

async function runPipeline(filePath, ctx = {}) {
  const passes = [];
  const warnings = [];
  const errors = [];

  await updateProgress(ctx, 0.05, 'Spouštím extrakci');

  // ─── Pass 1 + 2 — Claude Vision paralelně ──────────────────────────────
  let headerResult, itemsResult;
  try {
    [headerResult, itemsResult] = await Promise.all([
      extractHeader(filePath),
      extractItems(filePath),
    ]);
    passes.push(headerResult, itemsResult);
  } catch (err) {
    errors.push({ pass: 'vision', message: err.message });
    await updateProgress(ctx, 0);
    return {
      ok: false,
      composite_confidence: 0,
      recommendation: 'unreadable',
      reason: 'Claude Vision selhal: ' + err.message,
      passes, errors, warnings,
    };
  }
  await updateProgress(ctx, 0.40, 'Hlavička a položky přečteny');

  const header = headerResult.data;
  const items = itemsResult.data?.items || [];

  // ─── Pass 3 — ARES lookup ─────────────────────────────────────────────
  let aresResult = null, aresCross = null;
  const { direction, suspicious: directionSuspicious, reason: directionReason } = detectDirection(header);
  if (directionSuspicious) {
    warnings.push({ pass: 'direction_sanity', message: directionReason });
  }
  const partnerIco = direction === 'ap' ? header?.supplier?.ico : header?.customer?.ico;

  if (partnerIco) {
    try {
      aresResult = await lookupByIco(partnerIco);
      aresCross = crossCheck(
        direction === 'ap' ? header.supplier : header.customer,
        aresResult
      );
      passes.push({
        pass: 3,
        pass_type: 'ares_lookup',
        model: 'ares',
        data: { aresResult, aresCross, direction, partnerIco },
        confidence: aresCross.confidence,
        duration_ms: 0,
      });
      if (aresCross.mismatches.length) {
        warnings.push({ pass: 'ares', mismatches: aresCross.mismatches });
      }
    } catch (err) {
      warnings.push({ pass: 'ares', message: 'ARES lookup selhal: ' + err.message });
    }
  } else {
    warnings.push({ pass: 'ares', message: 'Nebylo extrahováno IČO protistrany' });
  }
  await updateProgress(ctx, 0.60, 'ARES lookup hotov');

  // ─── Pass 4 — VAT math ─────────────────────────────────────────────────
  const mathResult = validateInvoiceMath(header, items);
  passes.push({
    pass: 4,
    pass_type: 'vat_math_check',
    model: 'vat-math',
    data: mathResult,
    confidence: mathResult.confidence,
    duration_ms: 0,
  });
  if (!mathResult.ok) warnings.push({ pass: 'vat_math', issues: mathResult.issues });
  await updateProgress(ctx, 0.75, 'Kontrola DPH a součtů');

  // ─── Pass 5 — Duplicita ───────────────────────────────────────────────
  // Potřebujeme company_id z DB — hledáme Company podle IČO (z ARES nebo raw)
  let matchedCompanyId = null;
  if (partnerIco) {
    const canonicalName = aresResult?.name || (direction === 'ap' ? header.supplier?.name : header.customer?.name);
    const existing = await prisma.company.findFirst({ where: { ico: partnerIco } });
    if (existing) {
      matchedCompanyId = existing.id;
    } else if (canonicalName) {
      // Auto-create Company z ARES dat (user může později upravit)
      const newCompany = await prisma.company.create({
        data: {
          name: canonicalName,
          ico: partnerIco,
          dic: aresResult?.dic || header.supplier?.dic || null,
          address: aresResult?.address || null,
          city: aresResult?.city || null,
          zip: aresResult?.zip || null,
          country: aresResult?.country || 'CZ',
          type: direction === 'ap' ? 'supplier' : 'customer',
          email: null,
          notes: 'Auto-založeno z OCR faktury.',
          active: true,
        },
      });
      matchedCompanyId = newCompany.id;
      warnings.push({ pass: 'company', message: `Nová Company založena z ARES: ${canonicalName} (id=${newCompany.id})` });
    }
  }

  let dupResult = { isDuplicate: false, confidence: 1, matches: [] };
  if (matchedCompanyId && header.date_issued && header.total) {
    dupResult = await checkDuplicate({
      external_number: header.external_number,
      company_id: matchedCompanyId,
      date_issued: header.date_issued,
      total: header.total,
      direction,
      variable_symbol: header.variable_symbol,
    });
    passes.push({
      pass: 5,
      pass_type: 'duplicate_check',
      model: 'db',
      data: dupResult,
      // Pokud je duplicitní, "confidence" extrakce klesá, protože faktura by neměla být nová
      confidence: dupResult.isDuplicate ? 0.3 : 1.0,
      duration_ms: 0,
    });
    if (dupResult.isDuplicate) {
      warnings.push({ pass: 'duplicate', matches: dupResult.matches });
    }
  }
  await updateProgress(ctx, 0.90, 'Detekce duplicit');

  // ─── Composite confidence ─────────────────────────────────────────────
  // Vážený průměr — Vision má největší váhu
  const weights = {
    claude_vision_header: 0.3,
    claude_vision_lines: 0.2,
    ares_lookup: 0.2,
    vat_math_check: 0.2,
    duplicate_check: 0.1,
  };
  let totalWeight = 0;
  let weightedSum = 0;
  passes.forEach(p => {
    const w = weights[p.pass_type] || 0;
    if (w > 0) {
      weightedSum += (p.confidence || 0) * w;
      totalWeight += w;
    }
  });
  let composite = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // ─── Pass 6 — Opus re-read pokud composite < 0.85 ─────────────────────
  if (composite < CONFIDENCE_THRESHOLDS.ready && composite > CONFIDENCE_THRESHOLDS.unreadable) {
    try {
      const reread = await rereadWithOpus(filePath, { header, items });
      passes.push(reread);
      // Pokud Opus vrátil vyšší confidence, použij jeho data
      if (reread.confidence > headerResult.confidence) {
        Object.assign(header, reread.data.header || {});
        if (reread.data.items?.length) {
          items.length = 0;
          items.push(...reread.data.items);
        }
      }
      // Přepočti composite — dej Opusu váhu 0.4
      const opusContrib = reread.confidence * 0.4;
      composite = (composite * totalWeight + opusContrib) / (totalWeight + 0.4);
    } catch (err) {
      warnings.push({ pass: 'opus_reread', message: err.message });
    }
  }

  // ─── Rozhodnutí ────────────────────────────────────────────────────────
  let recommendation;
  if (composite >= CONFIDENCE_THRESHOLDS.ready) recommendation = 'ready';
  else if (composite >= CONFIDENCE_THRESHOLDS.review) recommendation = 'needs_review';
  else recommendation = 'unreadable';

  // Sanity override: i když má OCR vysokou důvěru, podezřelá direction-detekce
  // sráží recommendation na needs_review. Lepší obtěžovat uživatele schválením
  // než tiše vyrobit fakturu se špatně otočeným supplier ↔ customer (bug 2026-04-27).
  if (directionSuspicious && recommendation === 'ready') {
    recommendation = 'needs_review';
    warnings.push({
      pass: 'direction_sanity',
      message: 'Recommendation sníženo na needs_review kvůli podezřelé direction detekci.',
    });
  }

  // ─── Uložení OcrExtraction záznamů ────────────────────────────────────
  const savedExtractions = [];
  for (const p of passes) {
    try {
      const saved = await prisma.ocrExtraction.create({
        data: {
          email_ingest_id: ctx.email_ingest_id || null,
          attachment_id: ctx.attachment_id || null,
          invoice_id: ctx.invoice_id || null,
          pass_number: p.pass,
          pass_type: p.pass_type,
          model_used: p.model || null,
          extracted_data: p.data,
          confidence: p.confidence,
          warnings: p.warnings || null,
          errors: p.errors || null,
          input_tokens: p.input_tokens || null,
          output_tokens: p.output_tokens || null,
          duration_ms: p.duration_ms || null,
        },
      });
      savedExtractions.push(saved.id);
    } catch (err) {
      console.error('[OCR pipeline] Nelze uložit extraction:', err.message);
    }
  }

  return {
    ok: true,
    composite_confidence: +composite.toFixed(3),
    recommendation, // 'ready' | 'needs_review' | 'unreadable'
    direction,
    direction_suspicious: directionSuspicious,
    direction_reason: directionReason,
    matched_company_id: matchedCompanyId,
    header,
    items,
    ares: aresResult,
    math: mathResult,
    duplicate: dupResult,
    passes_count: passes.length,
    saved_extraction_ids: savedExtractions,
    warnings,
    errors,
  };
}

module.exports = { runPipeline, CONFIDENCE_THRESHOLDS };
