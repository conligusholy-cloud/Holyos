// BS2 — statistiky chování uživatelů: sběr událostí (klient) + dotazy pro admin stránku Statistiky.
'use strict';
const { q } = require('./db');

const { TRACK_JS } = require('./stats-track');

const deviceOf = (ua) => /iPad|Tablet/i.test(ua || '') ? 'tablet' : /Mobi|Android|iPhone/i.test(ua || '') ? 'mobile' : 'desktop';

async function track(req, supporterId, type, o = {}) {
  try {
    const ua = String(req.get('user-agent') || '').slice(0, 300);
    await q('INSERT INTO user_events (supporter_id, sid, type, path, label, meta, ip, ua, device) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [supporterId || null, o.sid ? String(o.sid).slice(0, 40) : null, type, o.path ? String(o.path).slice(0, 200) : null,
        o.label ? String(o.label).slice(0, 200) : null, o.meta ? JSON.stringify(o.meta) : null, req.ip || null, ua, deviceOf(ua)]);
  } catch (e) { /* statistika nesmí shodit aplikaci */ }
}

const PERIOD = "e.created_at > now() - make_interval(days => $1::int)";

async function loadOverview(days) {
  const d = Math.max(1, Math.min(Number(days) || 30, 3650));
  const chartDays = Math.min(d, 90);
  const one = async (sql, p) => (await q(sql, p)).rows;
  const [users, active, totals, daily, hours, devices, pages, clicks, sections, interacts, logins, topUsers, transfers, credits, orders, funnel, regs] = await Promise.all([
    one(`SELECT count(*)::int total, count(*) FILTER (WHERE status='active' AND password_hash IS NOT NULL)::int activated,
           count(*) FILTER (WHERE last_login_at IS NOT NULL)::int ever_login, count(*) FILTER (WHERE vop_consent_at IS NOT NULL)::int consented,
           count(*) FILTER (WHERE status='blocked')::int blocked FROM supporters`),
    one(`SELECT count(DISTINCT supporter_id) FILTER (WHERE created_at > now() - interval '1 day')::int d1,
           count(DISTINCT supporter_id) FILTER (WHERE created_at > now() - interval '7 days')::int d7,
           count(DISTINCT supporter_id)::int d30 FROM user_events WHERE type IN ('pageview','login') AND created_at > now() - interval '30 days'`),
    one(`SELECT count(*) FILTER (WHERE type='login')::int logins, count(DISTINCT supporter_id) FILTER (WHERE type='login')::int login_users,
           count(*) FILTER (WHERE type='login_fail')::int fails, count(*) FILTER (WHERE type='pageview')::int views,
           count(*) FILTER (WHERE type='click')::int clicks, count(DISTINCT supporter_id) FILTER (WHERE type IN ('pageview','click'))::int active_users,
           COALESCE(sum((meta->>'secs')::int) FILTER (WHERE type='time'),0)::int secs, count(DISTINCT sid) FILTER (WHERE type='pageview')::int sessions
         FROM user_events e WHERE ${PERIOD}`, [d]),
    one(`SELECT dd::date AS day, count(e.id) FILTER (WHERE e.type='login')::int logins,
           count(DISTINCT e.supporter_id) FILTER (WHERE e.type IN ('pageview','login'))::int users, count(e.id) FILTER (WHERE e.type='pageview')::int views
         FROM generate_series((now() AT TIME ZONE 'Europe/Prague')::date - ($1::int - 1), (now() AT TIME ZONE 'Europe/Prague')::date, interval '1 day') dd
         LEFT JOIN user_events e ON (e.created_at AT TIME ZONE 'Europe/Prague')::date = dd::date GROUP BY dd ORDER BY dd`, [chartDays]),
    one(`SELECT extract(hour FROM e.created_at AT TIME ZONE 'Europe/Prague')::int h, count(*)::int n FROM user_events e
         WHERE e.type IN ('pageview','click') AND ${PERIOD} GROUP BY 1 ORDER BY 1`, [d]),
    one(`SELECT COALESCE(device,'?') device, count(DISTINCT supporter_id)::int users, count(*) FILTER (WHERE type='pageview')::int views
         FROM user_events e WHERE ${PERIOD} GROUP BY 1 ORDER BY 3 DESC`, [d]),
    one(`SELECT path, count(*) FILTER (WHERE type='pageview')::int views, count(DISTINCT supporter_id) FILTER (WHERE type='pageview')::int users,
           COALESCE(sum((meta->>'secs')::int) FILTER (WHERE type='time'),0)::int secs,
           round(avg((meta->>'pct')::numeric) FILTER (WHERE type='scroll'))::int scroll
         FROM user_events e WHERE type IN ('pageview','time','scroll') AND path IS NOT NULL AND ${PERIOD} GROUP BY path ORDER BY views DESC LIMIT 30`, [d]),
    one(`SELECT path, label, count(*)::int n, count(DISTINCT supporter_id)::int users FROM user_events e
         WHERE type='click' AND ${PERIOD} GROUP BY path, label ORDER BY n DESC LIMIT 40`, [d]),
    one(`SELECT path, label, count(*)::int n, count(DISTINCT supporter_id)::int users FROM user_events e
         WHERE type='section' AND ${PERIOD} GROUP BY path, label ORDER BY n DESC LIMIT 30`, [d]),
    one(`SELECT path, label, count(*)::int n, count(DISTINCT supporter_id)::int users FROM user_events e
         WHERE type='interact' AND ${PERIOD} GROUP BY path, label ORDER BY n DESC LIMIT 15`, [d]),
    one(`SELECT e.created_at, e.type, e.ip, e.device, e.meta, s.id, s.email, s.nick, s.first_name, s.last_name
         FROM user_events e LEFT JOIN supporters s ON s.id = e.supporter_id
         WHERE e.type IN ('login','login_fail','logout','consent','reset_request') ORDER BY e.created_at DESC LIMIT 40`),
    one(`SELECT s.id, s.email, s.nick, s.first_name, s.last_name, s.user_type, s.last_login_at,
           count(*) FILTER (WHERE e.type='pageview')::int pv, count(*) FILTER (WHERE e.type='click')::int cl,
           count(*) FILTER (WHERE e.type='login')::int logins,
           COALESCE(sum((e.meta->>'secs')::int) FILTER (WHERE e.type='time'),0)::int secs, max(e.created_at) last_seen
         FROM user_events e JOIN supporters s ON s.id = e.supporter_id WHERE ${PERIOD}
         GROUP BY s.id ORDER BY secs DESC, pv DESC LIMIT 30`, [d]),
    one(`SELECT status, kind, count(*)::int n, COALESCE(sum(dc_amount),0)::float dc, count(DISTINCT supporter_id)::int users FROM support_transfers GROUP BY status, kind ORDER BY status, kind`),
    one(`SELECT count(DISTINCT supporter_id) FILTER (WHERE amount_czk > 0)::int holders, COALESCE(sum(amount_czk) FILTER (WHERE amount_czk > 0),0)::float issued,
           COALESCE(-sum(amount_czk) FILTER (WHERE amount_czk < 0),0)::float used, COALESCE(sum(amount_czk),0)::float balance FROM credits`),
    one(`SELECT status, count(*)::int n, COALESCE(sum(final_net),0)::float net, COALESCE(sum(dc_used),0)::float dc_used, count(DISTINCT supporter_id)::int users FROM orders GROUP BY status`),
    one(`SELECT
           (SELECT count(DISTINCT supporter_id)::int FROM user_events WHERE type='pageview' AND path='/pradlomaty') viewed_products,
           (SELECT count(DISTINCT supporter_id)::int FROM user_events WHERE type='pageview' AND path='/discount-credit') viewed_dc,
           (SELECT count(DISTINCT supporter_id)::int FROM user_events WHERE type='pageview' AND path='/team') viewed_team,
           (SELECT count(DISTINCT supporter_id)::int FROM orders) ordered,
           (SELECT count(DISTINCT supporter_id)::int FROM support_transfers) transferred`),
    one(`SELECT COALESCE(source,'?') source, count(*)::int n FROM supporters e WHERE ${PERIOD.replace('e.created_at', 'e.created_at')} GROUP BY 1 ORDER BY 2 DESC`, [d]),
  ]);
  return { days: d, chartDays, users: users[0], active: active[0], totals: totals[0], daily, hours, devices, pages, clicks, sections, interacts, logins, topUsers, transfers, credits: credits[0], orders, funnel: funnel[0], regs };
}

async function loadUser(id, days) {
  const d = Math.max(1, Math.min(Number(days) || 90, 3650));
  const s = (await q('SELECT id, email, nick, first_name, last_name, user_type, status, created_at, activated_at, last_login_at, currency FROM supporters WHERE id=$1', [id])).rows[0];
  if (!s) return null;
  const [tot, pages, clicks, events, tr, ord, cr] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE type='login')::int logins, count(*) FILTER (WHERE type='pageview')::int views, count(*) FILTER (WHERE type='click')::int clicks,
         COALESCE(sum((meta->>'secs')::int) FILTER (WHERE type='time'),0)::int secs, count(DISTINCT sid)::int sessions, min(created_at) first_seen, max(created_at) last_seen
       FROM user_events e WHERE supporter_id=$2 AND ${PERIOD}`, [d, id]),
    q(`SELECT path, count(*) FILTER (WHERE type='pageview')::int views, COALESCE(sum((meta->>'secs')::int) FILTER (WHERE type='time'),0)::int secs,
         max((meta->>'pct')::int) FILTER (WHERE type='scroll') scroll FROM user_events e WHERE supporter_id=$2 AND ${PERIOD} AND path IS NOT NULL AND type IN ('pageview','time','scroll')
       GROUP BY path ORDER BY views DESC`, [d, id]),
    q(`SELECT path, label, count(*)::int n FROM user_events e WHERE supporter_id=$2 AND type='click' AND ${PERIOD} GROUP BY path, label ORDER BY n DESC LIMIT 25`, [d, id]),
    q(`SELECT created_at, type, path, label, meta, ip, device FROM user_events e WHERE supporter_id=$2 AND type <> 'time' AND ${PERIOD} ORDER BY created_at DESC LIMIT 300`, [d, id]),
    q('SELECT created_at, kind, amount, currency, dc_amount, status FROM support_transfers WHERE supporter_id=$1 ORDER BY created_at DESC', [id]),
    q('SELECT created_at, product_name, currency, final_net, dc_used, status FROM orders WHERE supporter_id=$1 ORDER BY created_at DESC', [id]),
    q('SELECT COALESCE(sum(amount_czk),0)::float balance FROM credits WHERE supporter_id=$1', [id]),
  ]);
  return { days: d, s, tot: tot.rows[0], pages: pages.rows, clicks: clicks.rows, events: events.rows, transfers: tr.rows, orders: ord.rows, balance: cr.rows[0].balance };
}

module.exports = { TRACK_JS, track, deviceOf, loadOverview, loadUser };
