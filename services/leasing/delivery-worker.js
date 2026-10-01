// =============================================================================
// HolyOS — Leasing: sledování doručení e-mailů s poptávkou (doručenky + NDR)
// =============================================================================
// E-maily leasingovkám odcházejí s isDeliveryReceiptRequested. Exchange pak do
// schránky odesílatele (LEASING_MAIL_FROM / COMPOUNDER_SPECIALIST_MAIL_FROM) vrací:
//   - „Delivered: …" / „Relayed: …" / „Doručeno: …" → e-mail předán serveru příjemce
//   - „Undeliverable: …" / „Nedoručitelné: …"       → NDR, e-mail nedošel
// Worker každých N minut přečte nepřečtené zprávy ve schránce, rozpozná reporty,
// spáruje je s poptávkou (podle adresy příjemce + předmětu) a zapíše
// email_delivery = delivered | bounced. Reporty označí jako přečtené; ostatní
// zprávy ve schránce NEMĚNÍ. Při NDR pošle notifikaci do Velína.
// =============================================================================

'use strict';

const { prisma } = require('../../config/database');
let msGraph = null, msOAuth2 = null;
try { msGraph = require('../ms-graph-client'); } catch (e) { /* volitelné */ }
try { msOAuth2 = require('../ms-oauth2'); } catch (e) { /* volitelné */ }

function readUser() { return process.env.LEASING_MAIL_FROM || process.env.COMPOUNDER_SPECIALIST_MAIL_FROM || process.env.COMPOUNDER_MAIL_FROM || null; }
function intervalMs() { return Math.max(1, Number(process.env.LEASING_DELIVERY_POLL_MINUTES || 5)) * 60 * 1000; }
function isConfigured() { return !!(readUser() && msGraph && msOAuth2 && typeof msOAuth2.isConfigured === 'function' && msOAuth2.isConfigured()); }

const DELIVERED_RE = /^(delivered|relayed|doručeno|předáno|zpráva byla doručena|successful delivery|delivery status notification \(relayed\)|delivery status notification \(success\))/i;
const BOUNCED_RE = /^(undeliverable|undelivered|nedoručitelné|nedoručeno|mail delivery failed|delivery status notification \(failure\)|delivery has failed|zprávu nelze doručit)/i;

function htmlToText(s) {
  return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function classify(msg) {
  const subj = String(msg.subject || '').trim();
  const cls = String(msg.classification || '');
  if (BOUNCED_RE.test(subj) || /NDR/i.test(cls)) return 'bounced';
  if (DELIVERED_RE.test(subj)) return 'delivered';
  // postmaster bez známého předmětu — podle těla
  const from = ((msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '').toLowerCase();
  if (/postmaster|mailer-daemon|microsoftexchange/.test(from)) {
    const body = htmlToText(msg.body && msg.body.content).toLowerCase();
    if (/couldn't be delivered|wasn't delivered|could not be delivered|nebylo možné doručit|nepodařilo se doručit|delivery failed/.test(body)) return 'bounced';
    if (/was delivered|has been delivered|successfully delivered|relayed to|byla doručena/.test(body)) return 'delivered';
  }
  return null;
}

// Z reportu vytáhni e-mailové adresy (příjemce původní zprávy) a text původního předmětu.
function extractInfo(msg) {
  const text = htmlToText(msg.body && msg.body.content) + ' ' + String(msg.subject || '');
  const emails = Array.from(new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase())));
  // Původní předmět bývá za dvojtečkou v předmětu reportu: „Undeliverable: Poptávka financování – Jan Novák – MINI"
  const origSubject = String(msg.subject || '').replace(/^[^:]+:\s*/, '').trim();
  const reason = (text.match(/(?:reason|důvod|diagnostic|remote server returned)[^.]{0,200}/i) || [''])[0].trim();
  return { emails, origSubject, reason: reason.slice(0, 450), text };
}

async function matchInquiry(info, since) {
  if (!info.emails.length) return null;
  const cands = await prisma.leasingInquiry.findMany({
    where: { email_sent: true, sent_at: { gte: since }, company: { email: { in: info.emails, mode: 'insensitive' } } },
    include: { company: { select: { email: true, name: true } } },
    orderBy: { sent_at: 'desc' }, take: 50,
  });
  if (!cands.length) return null;
  // Nejlepší shoda: předmět reportu obsahuje jméno klienta (Poptávka financování – <klient> – <předmět>)
  const subj = info.origSubject.toLowerCase();
  const byName = cands.find((c) => subj.includes((c.client_first_name + ' ' + c.client_last_name).toLowerCase()) || info.text.toLowerCase().includes((c.client_first_name + ' ' + c.client_last_name).toLowerCase()));
  return byName || (cands.length === 1 ? cands[0] : null) || cands[0];
}

async function processMessage(user, msg) {
  const kind = classify(msg);
  if (!kind) return false; // není report → nesahat
  const info = extractInfo(msg);
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const inq = await matchInquiry(info, since);
  if (inq) {
    const data = { email_delivery: kind, email_delivery_at: new Date(msg.receivedDateTime || Date.now()) };
    if (kind === 'bounced') data.email_delivery_note = (info.reason || 'Nedoručitelné (NDR)').slice(0, 500);
    else if (inq.email_delivery !== 'delivered') data.email_delivery_note = 'doručenka serveru';
    // nedegraduj: pokud už máme "delivered" (např. z pixelu) a přijde "relayed", jen potvrď
    if (!(inq.email_delivery === 'bounced' && kind === 'delivered')) {
      const upd = await prisma.leasingInquiry.update({ where: { id: inq.id }, data });
      console.log(`[leasing-delivery] poptávka #${inq.id} → ${kind} (${inq.company.name}, ${inq.company.email})`);
      if (kind === 'bounced') { try { require('./notify').notifyLeasingInquiry(prisma, upd, 'bounced', { note: data.email_delivery_note }); } catch (e) { /* */ } }
    }
  } else {
    console.log('[leasing-delivery] report bez shody s poptávkou:', String(msg.subject || '').slice(0, 120));
  }
  try { await msGraph.markAsRead(user, msg.id); } catch (e) { /* best-effort */ }
  return true;
}

let running = false;
async function tick() {
  if (running || !isConfigured()) return;
  running = true;
  const user = readUser();
  try {
    const msgs = await msGraph.listUnreadMessages(user, { top: 50, includeAttachments: false });
    let n = 0;
    for (const m of msgs) { try { if (await processMessage(user, m)) n++; } catch (e) { console.warn('[leasing-delivery] zpráva selhala:', e.message); } }
    if (n) console.log(`[leasing-delivery] zpracováno reportů: ${n}`);
  } catch (e) {
    console.warn('[leasing-delivery] tick selhal:', e.message);
  } finally { running = false; }
}

let timer = null;
function start() {
  if (timer) return;
  if (!isConfigured()) { console.log('[leasing-delivery] worker neběží — chybí LEASING_MAIL_FROM/COMPOUNDER_SPECIALIST_MAIL_FROM nebo Graph OAuth'); return; }
  const ms = intervalMs();
  timer = setInterval(tick, ms);
  setTimeout(tick, 50 * 1000);
  console.log(`[leasing-delivery] worker spuštěn — schránka ${readUser()}, interval ${Math.round(ms / 60000)} min`);
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick, classify, isConfigured };
