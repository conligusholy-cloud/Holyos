// =============================================================================
// HolyOS — Compounder: čtení příchozích ODPOVĚDÍ leadů z e-mailu (přes Graph)
// =============================================================================
// Periodicky čte NEpřečtené zprávy v Compounder schránce (COMPOUNDER_MAIL_READ_USER
// nebo COMPOUNDER_MAIL_FROM), spáruje odesílatele s Compounder leadem, uloží odpověď
// jako příchozí LeadMessage (direction 'in') a pošle push + zvonek do Velína majitelům
// (Jan + Tomáš, resp. dle compounder.velin_notify_person_ids). Zprávu pak označí jako
// přečtenou. Cizí poštu (bez leada) nechá být.
//
// Předpoklad: Azure app má Mail.Read (application) na tu schránku.
// Env: COMPOUNDER_MAIL_READ_USER (fallback COMPOUNDER_MAIL_FROM), COMPOUNDER_REPLY_POLL_MINUTES (default 5).

'use strict';

const { prisma } = require('../../config/database');
let msGraph = null, msOAuth2 = null, notify = null;
try { msGraph = require('../ms-graph-client'); } catch (e) { /* volitelné */ }
try { msOAuth2 = require('../ms-oauth2'); } catch (e) { /* volitelné */ }
try { notify = require('./notify'); } catch (e) { /* volitelné */ }

let timer = null, running = false, lastRun = null, lastResult = null;

function readUser() { return process.env.COMPOUNDER_MAIL_READ_USER || process.env.COMPOUNDER_MAIL_FROM || null; }
function intervalMs() { return Math.max(1, Number(process.env.COMPOUNDER_REPLY_POLL_MINUTES || 5)) * 60 * 1000; }
function isConfigured() { return !!(readUser() && msGraph && msOAuth2 && typeof msOAuth2.isConfigured === 'function' && msOAuth2.isConfigured()); }

function htmlToText(s, isHtml) {
  s = String(s || '');
  if (isHtml) {
    s = s.replace(/<\s*(br|\/p|\/div|\/tr)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
    s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  }
  return s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

async function markRead(user, id) { try { await msGraph.markAsRead(user, id); } catch (e) { /* best-effort */ } }

async function processMessage(user, msg) {
  const fromEmail = String((msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '').trim().toLowerCase();
  if (!fromEmail) return { skipped: 'no-from' };
  const extId = msg.internetMessageId || ('graph:' + msg.id);
  const existing = await prisma.leadMessage.findUnique({ where: { ext_message_id: extId } }).catch(() => null);
  if (existing) { await markRead(user, msg.id); return { skipped: 'dup' }; }
  // Spáruj s leadem podle e-mailu odesílatele (nejnovější, když je jich víc se stejným e-mailem).
  const lead = await prisma.compounderLead.findFirst({
    where: { email: { equals: fromEmail, mode: 'insensitive' } },
    orderBy: { updated_at: 'desc' }, select: { id: true, name: true },
  });
  if (!lead) return { skipped: 'no-lead' }; // cizí pošta — nemarkujeme, ať nezasahujeme do jiné agendy
  const isHtml = !!(msg.body && msg.body.contentType && String(msg.body.contentType).toLowerCase() === 'html');
  const bodyText = htmlToText((msg.body && msg.body.content) || msg.bodyPreview || '', isHtml).slice(0, 4000);
  const subject = String(msg.subject || '').slice(0, 300);
  let created = null;
  try {
    created = await prisma.leadMessage.create({ data: {
      lead_id: lead.id, channel: 'email', direction: 'in',
      subject: subject || null, body: bodyText || '(prázdná zpráva)', status: 'sent',
      ext_message_id: extId, sent_at: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    } });
  } catch (e) { if (e.code !== 'P2002') throw e; } // P2002 = souběžně už uloženo
  await markRead(user, msg.id);
  if (created && notify && notify.notifyLeadReply) {
    const preview = bodyText.replace(/\n+/g, ' ').slice(0, 140);
    notify.notifyLeadReply(prisma, { lead, preview }).catch(() => {});
  }
  return { created: !!created };
}

async function tick() {
  if (running || !isConfigured()) return;
  running = true;
  try {
    lastRun = new Date();
    const user = readUser();
    const msgs = await msGraph.listUnreadMessages(user, { top: 50, includeAttachments: false });
    let created = 0, skipped = 0;
    for (const m of msgs) {
      try { const r = await processMessage(user, m); if (r && r.created) created++; else skipped++; }
      catch (e) { console.error('[compounder-reply] zpráva selhala:', e.message); }
    }
    lastResult = { ok: true, fetched: msgs.length, created, skipped, at: lastRun };
    if (created) console.log(`[compounder-reply] Nové odpovědi leadů: ${created} (z ${msgs.length} nepřečtených).`);
  } catch (e) {
    lastResult = { ok: false, error: e.message };
    console.error('[compounder-reply] tick selhal:', e.message);
  } finally { running = false; }
}

function start() {
  if (timer) return;
  if (!isConfigured()) { console.log('[compounder-reply] Neběží — chybí COMPOUNDER_MAIL_READ_USER/COMPOUNDER_MAIL_FROM nebo Azure Graph konfigurace.'); return; }
  const ms = intervalMs();
  console.log(`[compounder-reply] Start, poll každých ${ms / 60000} min (schránka ${readUser()}).`);
  timer = setInterval(tick, ms);
  setTimeout(tick, 35 * 1000); // po startu serveru
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }
async function triggerNow() { await tick(); return lastResult; }

module.exports = { start, stop, triggerNow, status: () => ({ configured: isConfigured(), running, last_run: lastRun, last_result: lastResult, mailbox: readUser() }) };
