// HolyOS — Podpora Laundromats (chat uživatel laundromats.eu ↔ podpora). Nezávislé na podpoře BS2:
// vlastní tabulka lm_support_messages, vlastní nastavení (AppSetting lm_support.*), vlastní notifikace (type lm_support).
// Používá servisní API pro server Laundromats (routes/lm-support.routes.js) i Velín (routes/velin.routes.js /lm-support/*).
const { prisma } = require('../config/database');
const settings = require('./settings');

const COLS = { id: true, account_id: true, sender: true, agent_name: true, body: true, created_at: true, file_name: true, file_type: true, file_size: true, read_by_user: true, read_by_agent: true };
const MAX_FILE = 10 * 1024 * 1024;

const out = (m) => Object.assign({}, m, { supporter_id: m.account_id, order_id: null }); // tvar jako BS2 (Velín obrazovky sdílí typy)

async function getOnline() { return String(await settings.getSetting('lm_support.online', { type: 'string', defaultValue: '0' }).catch(() => '0')) === '1'; }
async function getAgent() { return String(await settings.getSetting('lm_support.agent', { type: 'string', defaultValue: '' }).catch(() => '') || ''); }
async function setOnline(on, agent) {
  if (on && agent !== undefined) await settings.setSetting('lm_support.agent', String(agent || '').slice(0, 60), { type: 'string', description: 'Podpora Laundromats – jméno podpory', scope: 'laundromats' });
  await settings.setSetting('lm_support.online', on ? '1' : '0', { type: 'string', description: 'Podpora Laundromats – online', scope: 'laundromats' });
  return { ok: true, online: !!on };
}

// Bezpečný typ přílohy podle obsahu (ne podle hlavičky od klienta)
function sniff(buf) {
  if (!buf || buf.length < 4) return 'application/octet-stream';
  const h = buf.slice(0, 12).toString('hex');
  if (h.startsWith('89504e47')) return 'image/png';
  if (h.startsWith('ffd8ff')) return 'image/jpeg';
  if (h.startsWith('47494638')) return 'image/gif';
  if (h.startsWith('52494646') && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (h.startsWith('25504446')) return 'application/pdf';
  return 'application/octet-stream';
}
function fileFrom(f) {
  if (!f || !f.data) return null;
  const buf = Buffer.from(String(f.data), 'base64');
  if (!buf.length) return null;
  if (buf.length > MAX_FILE) { const e = new Error('Příloha je větší než 10 MB.'); e.status = 400; throw e; }
  return { name: String(f.name || 'priloha').replace(/[\r\n"\\/]/g, '_').slice(0, 200), type: sniff(buf), size: buf.length, data: buf };
}

// ── Uživatel ──
async function userState(accountId, after) {
  const where = { account_id: accountId };
  if (Number.isFinite(after)) where.id = { gt: after };
  const msgs = await prisma.lmSupportMessage.findMany({ where, select: COLS, orderBy: { id: 'asc' }, take: Number.isFinite(after) ? 200 : undefined });
  const last = Number.isFinite(after) ? msgs : msgs.slice(-200);
  await prisma.lmSupportMessage.updateMany({ where: { account_id: accountId, sender: 'agent', read_by_user: false }, data: { read_by_user: true } });
  return { online: await getOnline(), agent: await getAgent(), msgs: last.map(out) };
}
async function userUnread(accountId) {
  return prisma.lmSupportMessage.count({ where: { account_id: accountId, sender: 'agent', read_by_user: false } });
}
async function userSend(accountId, body, file) {
  const acc = await prisma.lmAccount.findUnique({ where: { id: accountId }, select: { id: true, name: true, email: true, disabled: true } });
  if (!acc || acc.disabled) { const e = new Error('Účet neexistuje.'); e.status = 404; throw e; }
  const text = String(body || '').trim().slice(0, 4000);
  const f = fileFrom(file);
  if (!text && !f) { const e = new Error('Napište zprávu.'); e.status = 400; throw e; }
  const recent = await prisma.lmSupportMessage.count({ where: { account_id: accountId, sender: 'user', created_at: { gt: new Date(Date.now() - 10 * 60e3) } } });
  if (recent >= 30) { const e = new Error('Příliš mnoho zpráv, zkuste to za chvíli.'); e.status = 429; throw e; }
  const row = await prisma.lmSupportMessage.create({ data: { account_id: accountId, sender: 'user', body: text || ('📎 ' + f.name), file_name: f ? f.name : null, file_type: f ? f.type : null, file_size: f ? f.size : null, file_data: f ? f.data : null }, select: COLS });
  notifyAgents(acc, text || ('📎 ' + f.name)).catch((e) => console.warn('[lm-support] push:', e.message));
  return out(row);
}
async function userFile(accountId, id) {
  const r = await prisma.lmSupportMessage.findFirst({ where: { id, account_id: accountId }, select: { file_name: true, file_type: true, file_data: true } });
  return r && r.file_data ? r : null;
}

// ── Podpora (administrace Laundromats + Velín) ──
async function threads() {
  const grp = await prisma.lmSupportMessage.groupBy({ by: ['account_id'], _max: { created_at: true, id: true } });
  if (!grp.length) return [];
  const ids = grp.map((g) => g.account_id);
  const [accs, unreadRows, lastMsgs] = await Promise.all([
    prisma.lmAccount.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, phone: true, compounder_lead_id: true } }),
    prisma.lmSupportMessage.groupBy({ by: ['account_id'], where: { sender: 'user', read_by_agent: false }, _count: { _all: true } }),
    prisma.lmSupportMessage.findMany({ where: { id: { in: grp.map((g) => g._max.id) } }, select: { account_id: true, body: true, sender: true } }),
  ]);
  const am = new Map(accs.map((a) => [a.id, a])), um = new Map(unreadRows.map((u) => [u.account_id, u._count._all])), lm = new Map(lastMsgs.map((m) => [m.account_id, m]));
  return grp.map((g) => {
    const a = am.get(g.account_id) || {}; const parts = String(a.name || '').trim().split(/\s+/);
    const l = lm.get(g.account_id) || {};
    return { id: g.account_id, nick: null, first_name: parts[0] || null, last_name: parts.slice(1).join(' ') || null, email: a.email || null, phone: a.phone || null, lead_id: a.compounder_lead_id || null,
      unread: um.get(g.account_id) || 0, last_at: g._max.created_at, last_body: l.body || null, last_sender: l.sender || null };
  }).sort((x, y) => (y.unread > 0) - (x.unread > 0) || new Date(y.last_at) - new Date(x.last_at)).slice(0, 300);
}
async function threadsResponse() {
  return { online: await getOnline(), agent: await getAgent(), agents: [], threads: await threads() };
}
async function thread(accountId, after) {
  const a = await prisma.lmAccount.findUnique({ where: { id: accountId }, select: { id: true, name: true, email: true, phone: true, company: true, compounder_lead_id: true, created_at: true } });
  if (!a) { const e = new Error('Účet neexistuje'); e.status = 404; throw e; }
  const where = { account_id: accountId }; if (Number.isFinite(after)) where.id = { gt: after };
  let msgs = await prisma.lmSupportMessage.findMany({ where, select: COLS, orderBy: { id: 'asc' } });
  if (!Number.isFinite(after)) msgs = msgs.slice(-200);
  await prisma.lmSupportMessage.updateMany({ where: { account_id: accountId, sender: 'user', read_by_agent: false }, data: { read_by_agent: true } });
  const parts = String(a.name || '').trim().split(/\s+/);
  return { who: { id: a.id, nick: null, first_name: parts[0] || null, last_name: parts.slice(1).join(' ') || null, email: a.email, phone: a.phone, company: a.company, lead_id: a.compounder_lead_id }, msgs: msgs.map(out), orders: 0, online: false, supportOnline: await getOnline(), agent: await getAgent() };
}
async function agentSend(accountId, body, file, fallbackName) {
  const acc = await prisma.lmAccount.findUnique({ where: { id: accountId }, select: { id: true, name: true, email: true } });
  if (!acc) { const e = new Error('Účet neexistuje'); e.status = 404; throw e; }
  const text = String(body || '').trim().slice(0, 4000); const f = fileFrom(file);
  if (!text && !f) { const e = new Error('Napiš zprávu.'); e.status = 400; throw e; }
  const name = (await getAgent()) || fallbackName || 'Podpora Laundromats';
  const recentAgent = await prisma.lmSupportMessage.count({ where: { account_id: accountId, sender: 'agent', created_at: { gt: new Date(Date.now() - 10 * 60e3) } } });
  const row = await prisma.lmSupportMessage.create({ data: { account_id: accountId, sender: 'agent', agent_name: name.slice(0, 80), body: text || ('📎 ' + f.name), read_by_agent: true, file_name: f ? f.name : null, file_type: f ? f.type : null, file_size: f ? f.size : null, file_data: f ? f.data : null }, select: COLS });
  // E-mail uživateli o odpovědi — nejvýš 1× za 10 min (ať se nespamuje během živé konverzace)
  if (!recentAgent && acc.email) {
    const base = String(process.env.LM_URL || 'https://laundromats.eu').replace(/\/$/, '');
    const first = String(acc.name || '').trim().split(/\s+/)[0];
    require('./email').sendMail({ to: acc.email, from: process.env.COMPOUNDER_MAIL_FROM || undefined, brand: 'pradlomaty', fromName: 'Laundromats', subject: 'Nová zpráva z podpory — Laundromats',
      body: (first ? 'Dobrý den ' + first + ',' : 'Dobrý den,') + '\n\nmáte novou zprávu od podpory Laundromats.\n\nPřihlaste se a odpovězte v chatu.\n\nTým Laundromats', link: base + '/cesta/podpora', linkLabel: 'Otevřít chat' })
      .catch((e) => console.warn('[lm-support] mail:', e.message));
  }
  return out(row);
}
async function agentFile(id) {
  const r = await prisma.lmSupportMessage.findUnique({ where: { id }, select: { file_name: true, file_type: true, file_data: true } });
  return r && r.file_data ? r : null;
}
async function unreadTotal() { return prisma.lmSupportMessage.count({ where: { sender: 'user', read_by_agent: false } }); }

// Upozornění Tomášovi a Janovi (Velín push + zvonek) — nová zpráva od uživatele
async function notifyAgents(acc, text) {
  const { notifyPerson } = require('./push/expo-push');
  const { createNotification } = require('../routes/notifications.routes');
  const ps = await prisma.person.findMany({ where: { active: true, last_name: { equals: 'Holý', mode: 'insensitive' }, first_name: { in: ['Jan', 'Tomáš'], mode: 'insensitive' } }, select: { id: true, user_id: true } });
  const title = '💬 LM podpora — nová zpráva';
  const body = (acc.name || acc.email || 'Uživatel') + ': ' + String(text).slice(0, 140);
  const badge = await unreadTotal().catch(() => undefined);
  for (const p of ps) {
    notifyPerson(prisma, p.id, { title, body, data: { type: 'lm_support', account_id: acc.id, link: 'lm-support://' + acc.id }, sound: 'default', badge }).catch(() => {});
    if (p.user_id) createNotification({ userId: p.user_id, type: 'system', title, body, meta: { kind: 'lm_support', account_id: acc.id } }).catch(() => {});
  }
}

module.exports = { getOnline, getAgent, setOnline, userState, userUnread, userSend, userFile, threads, threadsResponse, thread, agentSend, agentFile, unreadTotal };
