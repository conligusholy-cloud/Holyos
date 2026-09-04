// =============================================================================
// HolyOS — Sales: založení události do kalendáře obchodníka (+ M365 sync)
// =============================================================================
// Sdílené pro ruční zakládání (sales.routes) i automatické z hlasového AI hovoru
// (relay-ws). Vytvoří SalesEvent přiřazený obchodníkovi (organizer) a k leadu,
// nasynchronizuje ho do M365/Outlook kalendáře a „poslední domluva vyhrává"
// zruší starší otevřené kroky u téhož leada.

'use strict';

const { prisma } = require('../../config/database');
const graph = require('../ms-graph-client');

const CONSUMER_MAIL_DOMAINS = new Set(['icloud.com', 'me.com', 'seznam.cz', 'gmail.com', 'email.cz', 'centrum.cz', 'post.cz', 'volny.cz', 'atlas.cz', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.cz', 'proton.me', 'protonmail.com']);
function isOrgMailbox(email) {
  const domain = (String(email || '').split('@')[1] || '').toLowerCase();
  if (!domain) return false;
  const allow = String(process.env.M365_MAIL_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length) return allow.indexOf(domain) >= 0;
  return !CONSUMER_MAIL_DOMAINS.has(domain);
}

async function pushToGraph(ev) {
  try {
    if (!(graph.isConfigured && graph.isConfigured())) return { graph_sync_error: 'M365 není nakonfigurováno' };
    if (!ev.organizer_id) return { graph_sync_error: 'Událost nemá obchodníka (organizer)' };
    const person = await prisma.person.findUnique({ where: { id: ev.organizer_id }, select: { email: true } });
    const upn = person && person.email;
    if (!upn) return { graph_sync_error: 'Obchodník nemá e-mail (M365 schránku)' };
    if (!isOrgMailbox(upn)) return { graph_sync_error: null, graph_calendar_user: null };
    const payload = { subject: ev.title, body: ev.description || '', start: ev.start_at, end: ev.end_at || ev.start_at, location: ev.location, allDay: ev.all_day };
    const created = await graph.createCalendarEvent(upn, payload);
    return { graph_event_id: (created && created.id) || null, graph_calendar_user: upn, graph_sync_error: null };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/ErrorInvalidUser|MailboxNotEnabledForRESTAPI|does not exist|is invalid/i.test(msg)) {
      return { graph_sync_error: null, graph_calendar_user: null };
    }
    return { graph_sync_error: msg.slice(0, 500) };
  }
}

// Vytvoří událost pro leada. Vrací vytvořený SalesEvent (nebo null při chybě).
// { leadId, organizerId, title, description, startAt, endAt, eventType, location }
async function createLeadCalendarEvent(opts) {
  const o = opts || {};
  if (!o.startAt) return null;
  try {
    const created = await prisma.salesEvent.create({
      data: {
        organizer_id: o.organizerId || null,
        compounder_lead_id: o.leadId || null,
        title: String(o.title || 'Hovor').slice(0, 490),
        description: o.description || null,
        event_type: o.eventType || 'call',
        location: o.location || null,
        start_at: new Date(o.startAt),
        end_at: o.endAt ? new Date(o.endAt) : null,
        all_day: false,
        status: 'planned',
        reminder_min: 15,
      },
    });
    const g = await pushToGraph(created);
    const synced = await prisma.salesEvent.update({ where: { id: created.id }, data: g });
    // Poslední domluva vyhrává — zruš starší otevřené kroky u téhož leada.
    if (created.compounder_lead_id) {
      try {
        await prisma.salesEvent.updateMany({
          where: { compounder_lead_id: created.compounder_lead_id, status: 'planned', id: { not: created.id } },
          data: { status: 'cancelled' },
        });
        if (prisma.salesTask) {
          await prisma.salesTask.updateMany({
            where: { lead_id: created.compounder_lead_id, status: 'open', kind: { in: ['call', 'followup'] } },
            data: { status: 'skipped', skipped_reason: 'Nahrazeno novou domluvou z AI hovoru' },
          }).catch(() => {});
        }
      } catch (_) { /* best-effort */ }
    }
    return synced;
  } catch (e) {
    console.warn('[sales/events] createLeadCalendarEvent selhal:', e.message);
    return null;
  }
}

module.exports = { createLeadCalendarEvent };
