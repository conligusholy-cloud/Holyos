// HolyOS — Log odeslaných e-mailů (EmailMessage) + zpracování událostí Amazon SES (SNS webhook) + auto-odhlášení.
const crypto = require('crypto');
const { prisma } = require('../../config/database');

// Záznam po každém odeslání (r = výsledek mailer.sendEmail)
async function logMessage(r, { to, subject, campaignId, leadId }) {
  try {
    return await prisma.emailMessage.create({ data: {
      to: String(to || '').slice(0, 255), subject: String(subject || '').slice(0, 500), campaignId: campaignId ? String(campaignId).slice(0, 80) : null, leadId: leadId != null ? Number(leadId) : null,
      status: r.ok ? (r.simulated ? 'odesláno (simulace)' : 'odesláno') : 'chyba',
      messageId: r.messageId || null, sesMessageId: r.sesMessageId || null,
      note: r.error ? String(r.error).slice(0, 500) : null,
    } });
  } catch (e) { console.warn('[email-log] zápis selhal:', e.message); return null; }
}

// Auto-odhlášení: adresa se zapíše na black list (neoslovovat) – automat i kampaně ji od té chvíle vynechají
async function autoUnsubscribe(email, reason) {
  const em = String(email || '').trim().toLowerCase(); if (!em) return;
  try {
    const ex = await prisma.compounderBlocklist.findFirst({ where: { email: { equals: em, mode: 'insensitive' } }, select: { id: true } });
    if (!ex) await prisma.compounderBlocklist.create({ data: { email: em, note: ('auto: ' + (reason || 'odhlášení')).slice(0, 255) } });
    await prisma.emailMessage.updateMany({ where: { to: { equals: em, mode: 'insensitive' } }, data: { unsubscribed: true } }).catch(() => {});
    await prisma.compounderLead.updateMany({ where: { email: { equals: em, mode: 'insensitive' } }, data: { status: 'nelze_pouzit' } }).catch(() => {});
  } catch (e) { console.warn('[email-log] autoUnsubscribe:', e.message); }
}

// Událost z SES (open/click/delivery/bounce/complaint) → aktualizace zprávy podle sesMessageId / Message-ID / příjemce
async function applySesEvent(ev) {
  const type = String(ev.eventType || ev.notificationType || '').toLowerCase();
  const mail = ev.mail || {};
  const sesId = String(mail.messageId || '').trim();
  const hdrId = (mail.commonHeaders && mail.commonHeaders.messageId) ? String(mail.commonHeaders.messageId).replace(/[<>]/g, '') : '';
  const dest = (Array.isArray(mail.destination) && mail.destination[0]) ? String(mail.destination[0]) : '';
  let msg = null;
  if (sesId) msg = await prisma.emailMessage.findFirst({ where: { sesMessageId: sesId } });
  if (!msg && hdrId) msg = await prisma.emailMessage.findFirst({ where: { messageId: { contains: hdrId } } });
  if (!msg && dest) msg = await prisma.emailMessage.findFirst({ where: { to: { equals: dest, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' } });
  if (!msg) return;
  const data = {};
  if (/open/.test(type)) { data.opened = true; data.openedAt = new Date(); }
  else if (/click/.test(type)) { data.clicked = true; data.opened = true; data.clickedAt = new Date(); }
  else if (/delivery/.test(type)) { data.delivered = true; }
  else if (/bounce/.test(type)) { data.bounced = true; if (ev.bounce && ev.bounce.bounceType === 'Permanent') await autoUnsubscribe(dest, 'trvalý bounce'); }
  else if (/complaint/.test(type)) { data.bounced = true; data.unsubscribed = true; await autoUnsubscribe(dest, 'stížnost (complaint)'); }
  if (Object.keys(data).length) await prisma.emailMessage.update({ where: { id: msg.id }, data });
  // propsat i do leada (otevření / klik z funelu) – best-effort
  try { if (msg.leadId && (data.opened || data.clicked)) { const lead = await prisma.compounderLead.findUnique({ where: { id: msg.leadId }, select: { activity_log: true } }); if (lead) { const line = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' · ' + (data.clicked ? 'Kliknul na odkaz v e-mailu' : 'Otevřel e-mail') + ' (SES)'; await prisma.compounderLead.update({ where: { id: msg.leadId }, data: { activity_log: line + (lead.activity_log ? '\n' + lead.activity_log : '') } }); } } } catch (e) { /* best-effort */ }
}

// Odhlašovací odkaz: HMAC podepsaný token z e-mailu (bez DB)
function unsubSecret() { return process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'holyos-unsub'; }
function unsubscribeToken(email) { const em = String(email || '').trim().toLowerCase(); const sig = crypto.createHmac('sha256', unsubSecret()).update(em).digest('base64url').slice(0, 24); return Buffer.from(em).toString('base64url') + '.' + sig; }
function parseUnsubscribeToken(token) { const [b, sig] = String(token || '').split('.'); if (!b || !sig) return null; let em; try { em = Buffer.from(b, 'base64url').toString('utf8'); } catch (e) { return null; } const ok = crypto.createHmac('sha256', unsubSecret()).update(em).digest('base64url').slice(0, 24) === sig; return ok ? em : null; }
function unsubscribeUrl(email) { const base = String(process.env.PUBLIC_BASE_URL || 'https://app.holyos.cz').replace(/\/+$/, ''); return base + '/u/' + unsubscribeToken(email); }

// Statistiky za období
async function stats(range) {
  const days = range === 'today' ? 0 : range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const since = new Date(); since.setHours(0, 0, 0, 0); if (days > 0) since.setDate(since.getDate() - days + 1);
  const rows = await prisma.emailMessage.findMany({ where: { createdAt: { gte: since } }, select: { to: true, status: true, delivered: true, opened: true, clicked: true, bounced: true, unsubscribed: true, createdAt: true } });
  const sent = rows.filter((r) => /^odesláno/.test(r.status)); const key = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const byDay = {}; for (let i = 0; i < Math.max(1, days); i++) { const d = new Date(since); d.setDate(since.getDate() + i); byDay[key(d)] = { d: key(d), sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 }; }
  rows.forEach((r) => { const k = key(r.createdAt); const o = byDay[k]; if (!o) return; if (/^odesláno/.test(r.status)) o.sent++; if (r.delivered) o.delivered++; if (r.opened) o.opened++; if (r.clicked) o.clicked++; if (r.bounced) o.bounced++; });
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);
  const opened = sent.filter((r) => r.opened).length, clicked = sent.filter((r) => r.clicked).length, delivered = sent.filter((r) => r.delivered).length, bounced = rows.filter((r) => r.bounced).length;
  return { range: range || '30d', since: since.toISOString(), sent: sent.length, delivered, opened, clicked, bounced, unsubscribed: rows.filter((r) => r.unsubscribed).length, errors: rows.filter((r) => r.status === 'chyba').length, simulated: rows.filter((r) => r.status === 'odesláno (simulace)').length, recipients: new Set(sent.map((r) => r.to.toLowerCase())).size, open_rate: pct(opened, sent.length), click_rate: pct(clicked, sent.length), bounce_rate: pct(bounced, sent.length), byDay: Object.values(byDay) };
}

module.exports = { logMessage, autoUnsubscribe, applySesEvent, unsubscribeUrl, unsubscribeToken, parseUnsubscribeToken, stats };
