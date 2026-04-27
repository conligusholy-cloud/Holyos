// HolyOS — E-mail ingest pro faktury přes Microsoft Graph API.
// Nahradili jsme původní IMAP/imapflow implementaci, protože Microsoft 365 2026
// neumožňuje IMAP.AccessAsApp spolehlivě pro všechny tenanty (MAPI logon selhává
// s "AuthenticationContext has no rights on this session" i po udělení FullAccess).
// Graph REST funguje plynule, vyžaduje permission Mail.ReadWrite nebo Mail.Read.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { prisma } = require('../config/database');
const { runPipeline, CONFIDENCE_THRESHOLDS } = require('./ocr/pipeline');
const { sendMail: smtpSendMail } = require('./email');
const msGraph = require('./ms-graph-client');
const msOAuth2 = require('./ms-oauth2');
const { logAudit } = require('./audit');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');
const INVOICE_INGEST_SUBDIR = 'invoices-incoming';

function isImapConfigured() {
  // Ponecháváme název funkce kvůli zpětné kompatibilitě (email-ingest-worker)
  // ale ve skutečnosti kontroluje konfiguraci Graph API.
  return !!(process.env.INVOICE_IMAP_USER && msOAuth2.isConfigured());
}

// ────────────────────────────────────────────────────────────────────────────
// Storage pro přílohy
// ────────────────────────────────────────────────────────────────────────────

function ensureIngestDir() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const dir = path.join(STORAGE_DIR, INVOICE_INGEST_SUBDIR, String(y), m);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFilename(name) {
  return String(name || 'file').replace(/[^\w\-\.\s]/g, '_').slice(0, 120);
}

function isInvoiceCandidate(filename, contentType) {
  const n = (filename || '').toLowerCase();
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/pdf')) return true;
  if (ct.startsWith('image/')) return true;
  if (n.endsWith('.pdf') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.webp')) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Hlavní fetch loop
// ────────────────────────────────────────────────────────────────────────────

async function fetchNew({ markSeen = true } = {}) {
  if (!isImapConfigured()) {
    return { ok: false, reason: 'Microsoft Graph není nakonfigurovaný (chybí INVOICE_IMAP_USER nebo AZURE_* v .env)' };
  }

  const user = process.env.INVOICE_IMAP_USER;
  const stats = {
    fetched: 0, parsed: 0, saved_ingests: 0, invoices_created: 0,
    skipped: 0, errors: [], auth_mode: 'graph',
  };

  let messages;
  try {
    messages = await msGraph.listUnreadMessages(user, { top: 50, includeAttachments: true });
  } catch (err) {
    console.error('[email-ingest] Graph listUnreadMessages selhal:', err.message);
    return { ok: false, error: err.message, ...stats };
  }

  stats.fetched = messages.length;
  if (messages.length === 0) {
    return { ok: true, ...stats };
  }

  for (const msg of messages) {
    try {
      await processMessage(user, msg);
      stats.parsed++;
      if (markSeen) {
        await msGraph.markAsRead(user, msg.id);
      }
    } catch (err) {
      console.error('[email-ingest] Chyba zpracování zprávy', msg.id, err);
      stats.errors.push({ id: msg.id, message: err.message });
    }
  }

  return { ok: true, ...stats };
}

// ────────────────────────────────────────────────────────────────────────────
// Zpracování jedné zprávy
// ────────────────────────────────────────────────────────────────────────────

async function processMessage(userPrincipalName, msg) {
  const messageId = msg.internetMessageId || `graph:${msg.id}`;

  // Check duplikace podle messageId
  const existing = await prisma.emailIngest.findUnique({ where: { message_id: messageId } });
  if (existing) return existing;

  const fromAddr = msg.from?.emailAddress?.address || 'unknown';
  const fromName = msg.from?.emailAddress?.name || null;
  const toAddr = msg.toRecipients?.[0]?.emailAddress?.address || userPrincipalName;

  // Vytvořit EmailIngest
  const ingest = await prisma.emailIngest.create({
    data: {
      mailbox: userPrincipalName,
      message_id: messageId,
      thread_id: msg.conversationId || null,
      from_email: fromAddr,
      from_name: fromName,
      to_email: toAddr,
      subject: msg.subject || '(bez předmětu)',
      body_text: msg.body?.contentType === 'text' ? String(msg.body.content).slice(0, 50000) : (msg.bodyPreview || null),
      body_html: msg.body?.contentType === 'html' ? String(msg.body.content).slice(0, 100000) : null,
      received_at: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
      status: 'parsing',
      attempts: 0,
    },
  });

  // Stáhnout a uložit přílohy
  const targetDir = ensureIngestDir();
  const savedAttachments = [];

  const rawAttachments = (msg.attachments || []).filter(a =>
    a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline
  );

  for (const att of rawAttachments) {
    try {
      const file = await msGraph.downloadAttachment(userPrincipalName, msg.id, att.id);
      if (!file) continue;

      const candidate = isInvoiceCandidate(file.name, file.contentType);
      const filename = `${ingest.id}-${Date.now()}-${sanitizeFilename(file.name || 'attachment')}`;
      const filePath = path.join(targetDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

      const rec = await prisma.emailAttachment.create({
        data: {
          email_ingest_id: ingest.id,
          filename: file.name || filename,
          content_type: file.contentType || 'application/octet-stream',
          size_bytes: file.buffer.length,
          file_path: filePath,
          source: 'attachment',
          sha256,
          is_invoice_candidate: candidate,
        },
      });
      savedAttachments.push(rec);
    } catch (err) {
      console.error('[email-ingest] Download attachment selhal:', err.message);
    }
  }

  const candidates = savedAttachments.filter(a => a.is_invoice_candidate);
  if (candidates.length === 0) {
    await prisma.emailIngest.update({
      where: { id: ingest.id },
      data: { status: 'unreadable', confidence: 0, sender_notify_reason: 'Žádná čitelná příloha' },
    });
    await notifySenderUnreadable(
      userPrincipalName, fromAddr, msg,
      'V e-mailu nebyla nalezena čitelná příloha s fakturou (PDF / obrázek).'
    );
    return ingest;
  }

  await prisma.emailIngest.update({ where: { id: ingest.id }, data: { status: 'extracting' } });
  return await runPipelineAndFinalize(ingest, candidates, {
    notifyContext: { userPrincipalName, fromAddr, msg },
  });
}

/**
 * Společná logika: pro každou přílohu spustí OCR pipeline, vytvoří Invoice
 * pro každý platný kandidát (s duplicate prevention), zaktualizuje EmailIngest status.
 *
 * Používá se z processMessage (fetchNew flow) i z reprocessIngest (manual retry).
 */
async function runPipelineAndFinalize(ingest, candidates, opts = {}) {
  const { notifyContext = null } = opts;

  const results = [];
  const total = candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const att = candidates[i];
    try {
      const result = await runPipeline(att.file_path, {
        email_ingest_id: ingest.id,
        attachment_id: att.id,
        progress_offset: i / total,         // 0, 0.5 (pro 2 přílohy)
        progress_scale: 1 / total,           // 0.5 (pro 2 přílohy)
        attachment_idx: i + 1,
        total_attachments: total,
      });
      results.push({ ...result, attachment: att });
    } catch (err) {
      console.error('[email-ingest] OCR selhalo na', att.file_path, err);
    }
  }

  if (results.length === 0) {
    await prisma.emailIngest.update({
      where: { id: ingest.id },
      data: { status: 'unreadable', confidence: 0, sender_notify_reason: 'OCR selhalo na všech přílohách' },
    });
    if (notifyContext) {
      await notifySenderUnreadable(notifyContext.userPrincipalName, notifyContext.fromAddr, notifyContext.msg, 'Přílohy se nepodařilo přečíst.');
    }
    return { ingest, invoices: [], skippedDuplicates: [], results };
  }

  const createdInvoices = [];
  const skippedDuplicates = [];
  const lowConfidenceResults = [];
  const awaitingReviewResults = [];

  for (const result of results) {
    if (result.recommendation === 'unreadable') {
      lowConfidenceResults.push(result);
      continue;
    }
    if (result.duplicate?.strongMatch) {
      skippedDuplicates.push({
        attachment_id: result.attachment.id,
        attachment_name: result.attachment.filename,
        existing_invoice_ids: (result.duplicate.matches || []).map(m => m.id),
      });
      console.log(`[email-ingest] Duplikát z přílohy ${result.attachment.filename} (existuje invoice ${result.duplicate.matches[0]?.invoice_number}). Přeskakuji.`);
      continue;
    }
    // Bezpečnostní brzda: OCR direction-detekce je podezřelá → fakturu nevyrobíme
    // automaticky. EmailIngest skončí v `awaiting_review` (tab Aktivní) a uživatel
    // musí v UI ručně schválit směr a založit fakturu. Past z 2026-04-27 (BestDrive
    // HROMADNÁ FAKTURA, atypický small-print layout dodavatele).
    if (result.direction_suspicious) {
      awaitingReviewResults.push(result);
      console.log(`[email-ingest] Direction sanity check selhal pro ${result.attachment.filename}: ${result.direction_reason}. Posílám do awaiting_review.`);
      continue;
    }
    try {
      const invoice = await createInvoiceFromResult(result, ingest);
      createdInvoices.push(invoice);
      await prisma.ocrExtraction.updateMany({
        where: {
          email_ingest_id: ingest.id,
          attachment_id: result.attachment.id,
          invoice_id: null,
        },
        data: { invoice_id: invoice.id },
      });
    } catch (err) {
      console.error('[email-ingest] Vytvoření Invoice selhalo:', err);
      lowConfidenceResults.push(result);
    }
  }

  const avgConfidence = results.reduce((s, r) => s + (r.composite_confidence || 0), 0) / results.length;

  if (createdInvoices.length > 0) {
    const note = skippedDuplicates.length > 0
      ? `Vytvořeno ${createdInvoices.length} faktur, přeskočeno ${skippedDuplicates.length} duplikátů.`
      : null;
    await prisma.emailIngest.update({
      where: { id: ingest.id },
      data: { status: 'linked_to_invoice', confidence: avgConfidence, note },
    });
    logAudit({
      action: 'create', entity: 'email_ingest', entity_id: ingest.id,
      description: `📧 ${ingest.subject?.slice(0, 60) || ''} → vytvořeno ${createdInvoices.length} faktur (${createdInvoices.map(i => i.invoice_number).join(', ')}), přeskočeno ${skippedDuplicates.length} duplikátů`,
      user: { username: 'system', display_name: 'Email ingest' },
    }).catch(() => {});
    return { ingest, invoices: createdInvoices, skippedDuplicates, results };
  }

  if (skippedDuplicates.length > 0 && lowConfidenceResults.length === 0 && awaitingReviewResults.length === 0) {
    await prisma.emailIngest.update({
      where: { id: ingest.id },
      data: {
        status: 'duplicate',
        confidence: avgConfidence,
        note: `Všechny faktury (${skippedDuplicates.length}) jsou duplikáty existujících záznamů.`,
      },
    });
    logAudit({
      action: 'update', entity: 'email_ingest', entity_id: ingest.id,
      description: `🔁 ${ingest.subject?.slice(0, 60) || ''} → duplikát ${skippedDuplicates.length} faktur (existují v systému)`,
      user: { username: 'system', display_name: 'Email ingest' },
    }).catch(() => {});
    return { ingest, invoices: [], skippedDuplicates, results };
  }

  // Direction-suspicious větev — OCR si není jistá směrem (AP/AR), čekáme na manual review.
  // Toto je MEZIstav: faktura není vytvořená, ale e-mail není ani "nečitelný" — Tomáš
  // ho v UI Aktivní tabu otevře, schválí směr a založí fakturu ručně.
  if (awaitingReviewResults.length > 0 && lowConfidenceResults.length === 0) {
    const reasons = awaitingReviewResults
      .map(r => r.direction_reason || 'OCR si není jistá směrem')
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(' | ');
    await prisma.emailIngest.update({
      where: { id: ingest.id },
      data: {
        status: 'awaiting_review',
        confidence: avgConfidence,
        note: `Vyžaduje ruční ověření směru (AP/AR): ${reasons}`,
        sender_notify_reason: null,
      },
    });
    logAudit({
      action: 'update', entity: 'email_ingest', entity_id: ingest.id,
      description: `⚠️ ${ingest.subject?.slice(0, 60) || ''} → čeká na manuální schválení směru (${awaitingReviewResults.length} příloh): ${reasons.slice(0, 200)}`,
      user: { username: 'system', display_name: 'Email ingest' },
    }).catch(() => {});
    return { ingest, invoices: [], skippedDuplicates, results };
  }

  await prisma.emailIngest.update({
    where: { id: ingest.id },
    data: {
      status: 'unreadable',
      confidence: avgConfidence,
      sender_notify_reason: `Nízká důvěra extrakce (${Math.round(avgConfidence * 100)} %)`,
    },
  });
  logAudit({
    action: 'update', entity: 'email_ingest', entity_id: ingest.id,
    description: `❌ ${ingest.subject?.slice(0, 60) || ''} → nečitelné (${results.length} příloh, průměrná důvěra ${Math.round(avgConfidence * 100)}%)`,
    user: { username: 'system', display_name: 'Email ingest' },
  }).catch(() => {});
  if (notifyContext) {
    await notifySenderUnreadable(
      notifyContext.userPrincipalName, notifyContext.fromAddr, notifyContext.msg,
      `Žádný z ${results.length} příloh jsme nemohli spolehlivě přečíst (průměrná důvěra ${Math.round(avgConfidence * 100)} %).`
    );
  }
  return { ingest, invoices: [], skippedDuplicates, results };
}

// ────────────────────────────────────────────────────────────────────────────
// Vytvořit Invoice z výsledku pipeline
// ────────────────────────────────────────────────────────────────────────────

async function createInvoiceFromResult(result, ingest) {
  const h = result.header || {};
  const direction = result.direction;
  const needsReview = result.recommendation === 'needs_review';

  const year = new Date().getFullYear();
  const prefix = direction === 'ap' ? 'FP' : 'FV';
  const prefix2 = (h.type || '').startsWith('credit_note') ? (direction === 'ap' ? 'DP' : 'DV')
    : (h.type || '').startsWith('proforma') ? (direction === 'ap' ? 'ZP' : 'ZV')
    : prefix;
  const yearPart = `${prefix2}-${year}-`;
  const last = await prisma.invoice.findFirst({
    where: { invoice_number: { startsWith: yearPart } },
    orderBy: { invoice_number: 'desc' },
    select: { invoice_number: true },
  });
  let nextSeq = 1;
  if (last) {
    const m = last.invoice_number.match(/(\d+)$/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  const invoice_number = `${yearPart}${String(nextSeq).padStart(5, '0')}`;

  const items = (result.items || []).map((it, idx) => ({
    line_order: it.line_order || idx + 1,
    description: it.description || 'Bez popisu',
    quantity: Number(it.quantity) || 1,
    unit: it.unit || 'ks',
    unit_price: Number(it.unit_price) || 0,
    vat_rate: Number(it.vat_rate) || 0,
    subtotal: Number(it.subtotal || 0).toFixed(2),
    vat_amount: Number(it.vat_amount || 0).toFixed(2),
    total: Number(it.total || 0).toFixed(2),
  }));

  const invoice = await prisma.invoice.create({
    data: {
      invoice_number,
      external_number: h.external_number || null,
      type: h.type || (direction === 'ap' ? 'received' : 'issued'),
      direction,
      company_id: result.matched_company_id || await getPlaceholderCompanyId(),
      currency: h.currency || 'CZK',
      exchange_rate: 1,
      subtotal: Number(h.subtotal || 0).toFixed(2),
      vat_amount: Number(h.vat_amount || 0).toFixed(2),
      total: Number(h.total || 0).toFixed(2),
      rounding: Number(h.rounding || 0).toFixed(2),
      vat_regime: h.vat_regime || 'standard',
      date_issued: h.date_issued ? new Date(h.date_issued) : new Date(),
      date_taxable: h.date_taxable ? new Date(h.date_taxable) : null,
      date_received: ingest.received_at || new Date(),
      date_due: h.date_due ? new Date(h.date_due) : new Date(Date.now() + 14 * 86400 * 1000),
      payment_method: h.payment_method || 'bank_transfer',
      variable_symbol: h.variable_symbol || null,
      constant_symbol: h.constant_symbol || null,
      specific_symbol: h.specific_symbol || null,
      partner_bank_account: h.partner_bank_account || null,
      partner_iban: h.partner_iban || null,
      partner_bic: h.partner_bic || null,
      status: 'draft',
      source: 'email',
      email_ingest_id: ingest.id,
      ocr_confidence: result.composite_confidence,
      ocr_passes_done: result.passes_count,
      needs_human_review: needsReview,
      source_file_path: result.attachment?.file_path || null,
      note: needsReview ? 'OCR vyhodnotilo středí důvěru — zkontrolovat údaje.' : null,
      items: { create: items },
    },
  });

  return invoice;
}

async function getPlaceholderCompanyId() {
  let c = await prisma.company.findFirst({ where: { name: 'Neznámý dodavatel (OCR fallback)' } });
  if (!c) {
    c = await prisma.company.create({
      data: { name: 'Neznámý dodavatel (OCR fallback)', type: 'supplier', active: true, notes: 'Fallback pro OCR bez IČO' },
    });
  }
  return c.id;
}

// ────────────────────────────────────────────────────────────────────────────
// Auto-reply při nečitelné faktuře
// ────────────────────────────────────────────────────────────────────────────

async function notifySenderUnreadable(userPrincipalName, toAddress, originalMsg, reason) {
  if (!toAddress) return;
  const subject = 'Automatická odpověď: faktura nebyla čitelná';
  const body = `Dobrý den,

obdrželi jsme Váš e-mail "${originalMsg.subject || '(bez předmětu)'}".

Bohužel, ${reason}

Prosím pošlete nám fakturu znovu — ideálně jako strojově čitelný PDF soubor (ne foto, ne sken papíru). Pokud jste nám zaslali odkaz ke stažení, ověřte prosím, že je platný a dostupný bez přihlášení.

Děkujeme za pochopení.

— Automatický systém HolyOS`;

  try {
    // Preferovaně přes Graph sendMail (z mailboxu faktury@). Fallback na SMTP (services/email.js).
    await msGraph.sendReply(userPrincipalName, { to: toAddress, subject, body });
  } catch (err) {
    console.warn('[email-ingest] Graph sendReply selhal, zkouším SMTP:', err.message);
    try {
      await smtpSendMail({ to: toAddress, subject, body });
    } catch (e) {
      console.error('[email-ingest] Auto-reply SMTP taky selhal:', e.message);
    }
  }

  const ingest = await prisma.emailIngest.findFirst({
    where: { message_id: originalMsg.internetMessageId || `graph:${originalMsg.id}` },
  });
  if (ingest) {
    await prisma.emailIngest.update({
      where: { id: ingest.id },
      data: { sender_notified_at: new Date() },
    });
  }
}

module.exports = { fetchNew, isImapConfigured, runPipelineAndFinalize };
