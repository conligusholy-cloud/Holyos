// HolyOS — Centrum reklamy: healthcheck napojení Facebook Lead Ads
// =============================================================================
// Ověřuje všechno, na čem stojí příchod leadů z Facebooku:
//   1) platnost tokenů (System User token, dlouhodobý token OAuth účtu, page tokeny) – Graph /me + /debug_token (expirace),
//   2) odběr webhooku `leadgen` u každé sledované stránky (GET /{page}/subscribed_apps),
//   3) stav automatického stahování leadů (meta-leads-sync: poslední běh / chyba),
//   4) čas posledního leadu z FB (CompounderLead.meta_lead_id) a zda běží aspoň jedna aktivní kampaň.
// Výsledek se loguje do SystemLog (type = 'fb_health'); při problému odejde alert e-mail (max. 1× za 12 h pro stejný důvod).
// Spouští ho cron v director.js (každé 2 hodiny); běží celý asynchronně (fetch s timeouty), event loop neblokuje.

const { prisma } = require('../../config/database');
const { getSetting, setSetting } = require('../settings');

const GRAPH = 'https://graph.facebook.com/v19.0/';
const META_KEY = 'ads_center.meta';
const ALERT_STATE_KEY = 'ads_center.fb_health_alert';
const STALE_LEAD_MS = 4 * 3600 * 1000;
const ALERT_REPEAT_MS = 12 * 3600 * 1000;
const ALERT_TO = process.env.FB_HEALTH_ALERT_TO || 'info@bestseries2.cz';

async function graph(path, params, tok) {
  const u = new URL(GRAPH + path);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, v); });
  if (tok) u.searchParams.set('access_token', tok);
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error((j.error && j.error.message) || ('Meta ' + r.status)); e.code = j.error && j.error.code; throw e; }
  return j;
}

// Ověření jednoho tokenu: /me?fields=id (platnost) + /debug_token (expirace, pokud známe appku)
async function checkToken(label, tok, storedExpiry) {
  const out = { label, ok: false, expires_at: storedExpiry || null, error: null };
  try {
    const me = await graph('me', { fields: 'id' }, tok);
    out.ok = !!me.id;
  } catch (e) { out.error = e.message; return out; }
  const appId = process.env.META_LEADS_APP_ID || process.env.META_APP_ID || '';
  const appSecret = process.env.META_LEADS_APP_SECRET || process.env.META_APP_SECRET || '';
  if (appId && appSecret) {
    try {
      const d = await graph('debug_token', { input_token: tok }, appId + '|' + appSecret);
      const dd = d.data || {};
      if (dd.is_valid === false) { out.ok = false; out.error = (dd.error && dd.error.message) || 'Token není platný'; }
      out.expires_at = dd.expires_at ? new Date(dd.expires_at * 1000).toISOString() : (dd.expires_at === 0 ? null : out.expires_at); // 0 = bez expirace
      out.data_access_expires_at = dd.data_access_expires_at ? new Date(dd.data_access_expires_at * 1000).toISOString() : null;
    } catch (e) { out.debug_error = e.message; }
  }
  return out;
}

async function check(opts = {}) {
  const reasons = [];
  const m = (await getSetting(META_KEY, { type: 'json', defaultValue: {} })) || {};
  const leads = require('./meta-leads-sync');
  const lc = await leads.cfg();

  // 1) tokeny
  const tokens = [];
  if (m.user_token) tokens.push(['OAuth účet (dlouhodobý token)', m.user_token, m.user_token_expires]);
  if (m.token) tokens.push(['System User token', m.token, null]);
  if (process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCESS_TOKEN !== m.token) tokens.push(['Env META_ADS_ACCESS_TOKEN', process.env.META_ADS_ACCESS_TOKEN, null]);
  if (process.env.META_PAGE_ACCESS_TOKEN) tokens.push(['Env META_PAGE_ACCESS_TOKEN (webhook)', process.env.META_PAGE_ACCESS_TOKEN, null]);
  const tokenResults = [];
  for (const [label, tok, exp] of tokens) tokenResults.push(await checkToken(label, tok, exp));
  let tokenOk = tokenResults.length > 0 && tokenResults.every((t) => t.ok);
  if (!tokenResults.length) reasons.push('Není nastaven žádný Facebook token (OAuth ani System User).');
  tokenResults.forEach((t) => { if (!t.ok) reasons.push('Token „' + t.label + '“ je neplatný: ' + (t.error || 'neznámá chyba')); });
  // nejbližší expirace
  const exps = tokenResults.map((t) => t.expires_at).filter(Boolean).map((x) => new Date(x).getTime()).filter((x) => !isNaN(x));
  const tokenExpiresAt = exps.length ? new Date(Math.min(...exps)).toISOString() : null;
  if (tokenExpiresAt) {
    const left = new Date(tokenExpiresAt).getTime() - Date.now();
    if (left < 0) { tokenOk = false; reasons.push('Token vypršel ' + tokenExpiresAt.slice(0, 10) + ' – znovu připoj Facebook účet v Centru reklamy.'); }
    else if (left < 7 * 86400000) reasons.push('Token vyprší za ' + Math.ceil(left / 86400000) + ' dní (' + tokenExpiresAt.slice(0, 10) + ') – brzy znovu připoj Facebook účet.');
  }

  // 2) webhook subscription (leadgen) u sledovaných stránek
  const webhook = { ok: false, pages: [] };
  try {
    const only = Array.isArray(lc.pages) && lc.pages.length ? new Set(lc.pages.map(String)) : null;
    const list = [];
    // page tokeny z OAuth napojení (nastavení) nebo přes me/accounts System User tokenu
    const withTok = Array.isArray(m.pages) && m.pages.length ? m.pages : null;
    const src = withTok || (await (async () => { const t = m.token || process.env.META_ADS_ACCESS_TOKEN; if (!t) return []; try { const j = await graph('me/accounts', { fields: 'id,name,access_token', limit: 100 }, t); return j.data || []; } catch (e) { return []; } })());
    for (const p of src) { if (only && !only.has(String(p.id))) continue; list.push(p); }
    if (!list.length) reasons.push('Nenalezena žádná Facebook stránka s tokenem – webhook nelze ověřit.');
    for (const p of list) {
      const row = { id: String(p.id), name: p.name || '', subscribed: false, error: null };
      if (!p.access_token) { row.error = 'chybí page token'; webhook.pages.push(row); continue; }
      try {
        const j = await graph(p.id + '/subscribed_apps', { fields: 'id,name,subscribed_fields' }, p.access_token);
        row.subscribed = (j.data || []).some((a) => (a.subscribed_fields || []).includes('leadgen'));
        row.apps = (j.data || []).map((a) => a.name || a.id).slice(0, 5);
      } catch (e) { row.error = e.message; }
      webhook.pages.push(row);
    }
    webhook.ok = webhook.pages.length > 0 && webhook.pages.every((p) => p.subscribed);
    webhook.pages.filter((p) => !p.subscribed).forEach((p) => reasons.push('Stránka „' + (p.name || p.id) + '“ nemá odběr webhooku leadgen' + (p.error ? ' (' + p.error + ')' : '') + '.'));
  } catch (e) { reasons.push('Kontrola webhooku selhala: ' + e.message); }

  // 3) automatické stahování leadů (záloha k webhooku)
  const lr = lc.last_result || null;
  const syncOk = !(lr && lr.error) && !(lr && lr.errors && lr.errors.length && !lr.created && !lr.fetched && lr.errors.some((x) => /token|expired|OAuth|permission/i.test(x)));
  if (lr && lr.error) reasons.push('Automatické stahování leadů selhalo: ' + lr.error);
  else if (lr && lr.errors && lr.errors.length) reasons.push('Stahování leadů hlásí chyby: ' + lr.errors.slice(0, 2).join(' | '));
  if (lc.enabled !== false && lc.last_run && Date.now() - new Date(lc.last_run).getTime() > 3 * 3600 * 1000) reasons.push('Automatické stahování leadů neběželo od ' + lc.last_run + '.');

  // 4) poslední lead z FB + aktivní kampaně
  let lastLeadAt = null;
  try { const l = await prisma.compounderLead.findFirst({ where: { meta_lead_id: { not: null } }, orderBy: { created_at: 'desc' }, select: { created_at: true } }); lastLeadAt = l ? l.created_at.toISOString() : null; } catch (e) { /* tabulka je jistá */ }
  let activeCampaigns = null;
  try {
    const tok = m.token || process.env.META_ADS_ACCESS_TOKEN || m.user_token;
    const acc = String(m.account || process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
    if (tok && acc) {
      const j = await graph('act_' + acc + '/campaigns', { fields: 'id', effective_status: JSON.stringify(['ACTIVE']), limit: 50 }, tok);
      activeCampaigns = (j.data || []).length;
    }
  } catch (e) { activeCampaigns = null; }

  // Dlouho bez leadu při aktivní kampani = podezření (v noci 22–07 h se neposuzuje, to je běžný klid)
  const hourPrague = Number(new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).format(new Date()));
  const night = hourPrague >= 22 || hourPrague < 7;
  const staleMs = lastLeadAt ? Date.now() - new Date(lastLeadAt).getTime() : null;
  const stale = (staleMs == null || staleMs > STALE_LEAD_MS) && activeCampaigns > 0 && !night;
  if (stale) reasons.push('Poslední lead z Facebooku ' + (lastLeadAt ? 'přišel před ' + Math.floor(staleMs / 3600000) + ' h (' + lastLeadAt + ')' : 'nebyl nikdy zaznamenán') + ', přitom běží ' + activeCampaigns + ' aktivních kampaní.');

  const ok = tokenOk && webhook.ok && syncOk;
  const result = {
    ok, token_ok: tokenOk, token_expires_at: tokenExpiresAt, webhook_ok: webhook.ok, sync_ok: syncOk, last_lead_at: lastLeadAt,
    active_campaigns: activeCampaigns, stale_leads: stale, reasons, tokens: tokenResults.map((t) => ({ label: t.label, ok: t.ok, expires_at: t.expires_at, error: t.error })), pages: webhook.pages,
    checked_at: new Date().toISOString(),
  };
  if (opts.log !== false) await logResult(result);
  return result;
}

async function logResult(result) {
  try { await prisma.systemLog.create({ data: { type: 'fb_health', payload: result } }); } catch (e) { console.warn('[fb-health] log do SystemLog selhal:', e.message); }
}

async function lastResult() {
  try { const r = await prisma.systemLog.findFirst({ where: { type: 'fb_health' }, orderBy: { created_at: 'desc' } }); return r ? Object.assign({}, r.payload, { logged_at: r.created_at }) : null; } catch (e) { return null; }
}

// Alert e-mailem – jen při problému (ok=false NEBO dlouho bez leadu při aktivní kampani), stejný důvod max. 1× za 12 h
async function maybeAlert(result) {
  const problem = !result.ok || result.stale_leads;
  if (!problem) { try { await setSetting(ALERT_STATE_KEY, { sig: null, at: null }, { type: 'json', description: 'FB healthcheck – stav posledního alertu' }); } catch (e) { /* ignore */ } return { sent: false, reason: 'ok' }; }
  const sig = (result.reasons || []).join('|').slice(0, 500);
  const st = (await getSetting(ALERT_STATE_KEY, { type: 'json', defaultValue: {} })) || {};
  if (st.sig === sig && st.at && Date.now() - new Date(st.at).getTime() < ALERT_REPEAT_MS) return { sent: false, reason: 'duplicate' };
  const body = 'Kontrola napojení Facebook Lead Ads (' + result.checked_at + ') našla problém:\n\n' + (result.reasons || ['Neznámý důvod']).map((r) => '• ' + r).join('\n') +
    '\n\nStav: token ' + (result.token_ok ? 'OK' : 'CHYBA') + ', webhook ' + (result.webhook_ok ? 'OK' : 'CHYBA') + ', stahování leadů ' + (result.sync_ok ? 'OK' : 'CHYBA') +
    '\nPoslední lead z FB: ' + (result.last_lead_at || '—') + ' · aktivních kampaní: ' + (result.active_campaigns == null ? 'neznámo' : result.active_campaigns) +
    '\nExpirace tokenu: ' + (result.token_expires_at || 'neznámá / bez expirace') + '\n\nCo s tím: v Centru reklamy → Nastavení znovu připoj Facebook účet (OAuth) a zkontroluj odběr webhooku leadgen u stránky.';
  let our = null; try { our = await require('../settings').getOurCompany(); } catch (e) { our = null; }
  const from = process.env.FB_HEALTH_ALERT_FROM || process.env.COMPOUNDER_MAIL_FROM || process.env.SERVICE_BILLING_MAIL_FROM || (our && our.email) || undefined;
  const r = await require('../email').sendMail({ to: ALERT_TO, from, subject: 'ALERT: FB napojení selhalo', body, brand: 'bs2' });
  if (r && r.sent) { await setSetting(ALERT_STATE_KEY, { sig, at: new Date().toISOString() }, { type: 'json', description: 'FB healthcheck – stav posledního alertu' }); return { sent: true }; }
  console.warn('[fb-health] alert e-mail se neodeslal:', r && (r.error || r.skipped));
  return { sent: false, reason: (r && (r.error || r.skipped)) || 'chyba odeslání' };
}

let _busy = false;
async function run() {
  if (_busy) return null;
  _busy = true;
  try {
    const result = await check();
    result.alert = await maybeAlert(result).catch((e) => ({ sent: false, reason: e.message }));
    console.log('[fb-health] ' + (result.ok ? 'OK' : 'PROBLÉM') + (result.reasons.length ? ' — ' + result.reasons.join(' ; ') : '') + (result.alert && result.alert.sent ? ' (alert odeslán)' : ''));
    return result;
  } catch (e) { console.warn('[fb-health] kontrola selhala:', e.message); return null; }
  finally { _busy = false; }
}

module.exports = { check, run, lastResult, maybeAlert };
