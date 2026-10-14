// HolyOS — Centrum reklamy: přímé stahování leadů z Facebook Lead Ads (bez Make.com)
// =============================================================================
// Používá centrální System User token z Centra reklamy (AppSetting ads_center.meta).
// Z `me/accounts` si vezme page access tokeny stránek, které má systémový uživatel přiřazené,
// projde jejich rychlé formuláře ({page}/leadgen_forms) a stáhne nové leady ({form}/leads).
// Každý lead založí stejnou cestou jako webhook (_fbCreateLead v compounder.routes.js) → stejná
// idempotence (meta_lead_id), stejné přiřazení obchodníka podle compounder.fb_lead_forms, stejné notifikace.
// Nastavení: AppSetting ads_center.leads = { enabled, interval_min, since, last_run, last_result, pages:[...] }.
const { getSetting, setSetting } = require('../settings');

const KEY = 'ads_center.leads';
const META_KEY = 'ads_center.meta';
const GRAPH = 'https://graph.facebook.com/v19.0/';
let timer = null; let running = false;

async function cfg() { return (await getSetting(KEY, { type: 'json', defaultValue: {} })) || {}; }
async function saveCfg(v, userId) { await setSetting(KEY, v, { type: 'json', description: 'Centrum reklamy – přímé stahování leadů z FB Lead Ads', scope: 'marketing', userId }); }
async function token() { const m = (await getSetting(META_KEY, { type: 'json', defaultValue: {} })) || {}; return m.token || process.env.META_ADS_ACCESS_TOKEN || ''; }
async function graph(path, params, tok) { const u = new URL(GRAPH + path); Object.entries(params || {}).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, v); }); u.searchParams.set('access_token', tok); const r = await fetch(u, { signal: AbortSignal.timeout(25000) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error((j.error && j.error.message) || ('Meta ' + r.status)); return j; }

// Oprávnění tokenu (pro stav v nastavení) – leads_retrieval je nutné ke čtení leadů.
async function permissions() { const t = await token(); if (!t) return { ok: false, error: 'Chybí token' }; const j = await graph('me/permissions', {}, t); const granted = (j.data || []).filter((p) => p.status === 'granted').map((p) => p.permission); return { ok: true, granted, leads: granted.includes('leads_retrieval'), pages: granted.includes('pages_show_list'), manage_ads: granted.includes('pages_manage_ads') }; }

// Stránky dostupné systémovému uživateli (s page tokeny) + jejich formuláře.
async function pages(withForms) {
  const t = await token(); if (!t) throw new Error('Chybí token Centra reklamy');
  const j = await graph('me/accounts', { fields: 'id,name,access_token', limit: 100 }, t);
  const out = [];
  for (const p of j.data || []) {
    const row = { id: String(p.id), name: p.name, has_token: !!p.access_token, forms: [] };
    if (withForms && p.access_token) { try { const f = await graph(p.id + '/leadgen_forms', { fields: 'id,name,status,leads_count,created_time', limit: 200 }, p.access_token); row.forms = (f.data || []).map((x) => ({ id: String(x.id), name: x.name, status: x.status, leads_count: x.leads_count, created_time: x.created_time })); } catch (e) { row.forms_error = e.message; } }
    out.push(row);
  }
  return out;
}

// Stažení nových leadů. since = ISO/unix od kdy (default: cfg.since nebo poslední běh − 1 h). Vrací souhrn.
async function sync(opts = {}) {
  if (running) return { skipped: 'running' };
  running = true; const started = Date.now();
  const res = { pages: 0, forms: 0, fetched: 0, created: 0, duplicates: 0, errors: [] };
  try {
    const c = await cfg(); const t = await token(); if (!t) throw new Error('Chybí token Centra reklamy');
    const cmp = require('../../routes/compounder.routes');
    if (!cmp._fbCreateLead) throw new Error('compounder.routes neexportuje _fbCreateLead');
    const forms = await cmp._fbLoadForms(); const formById = {}; forms.forEach((f) => { formById[String(f.form_id)] = f; });
    const sinceRaw = opts.since || (c.last_run ? new Date(new Date(c.last_run).getTime() - 3600000).toISOString() : null) || c.since || new Date(Date.now() - 86400000).toISOString();
    const sinceUnix = Math.floor(new Date(sinceRaw).getTime() / 1000);
    const only = Array.isArray(c.pages) && c.pages.length ? new Set(c.pages.map(String)) : null;
    const pg = await graph('me/accounts', { fields: 'id,name,access_token', limit: 100 }, t);
    for (const p of pg.data || []) {
      if (only && !only.has(String(p.id))) continue; if (!p.access_token) continue; res.pages++;
      let fl; try { fl = await graph(p.id + '/leadgen_forms', { fields: 'id,name,status', limit: 200 }, p.access_token); } catch (e) { res.errors.push(p.name + ': ' + e.message); continue; }
      for (const f of fl.data || []) {
        const fcfg = formById[String(f.id)]; if (fcfg && fcfg.active === false) continue; res.forms++;
        let url = f.id + '/leads'; let params = { fields: 'id,created_time,ad_id,adset_id,campaign_id,campaign_name,ad_name,form_id,field_data,platform,is_organic', limit: 100, filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }]) };
        let guard = 0;
        while (url && guard++ < 50) {
          let j; try { j = await graph(url, params, p.access_token); } catch (e) { res.errors.push((f.name || f.id) + ': ' + e.message); break; }
          for (const ld of j.data || []) {
            res.fetched++;
            try {
              const fields = cmp._fbExtractFields(ld);
              const owner = await cmp._fbResolveOwner(fcfg || { form_id: String(f.id) });
              const out = await cmp._fbCreateLead(fields, { leadId: ld.id, formId: String(f.id), pageId: String(p.id), adId: ld.ad_id || null, raw: Object.assign({ page_name: p.name, form_name: f.name }, ld), source: 'facebook_ads', srcLabel: 'FB reklama (napřímo)', channelName: 'FB reklamy' }, Object.assign({ form_id: String(f.id), form_name: f.name }, fcfg || {}, owner));
              if (out.created) res.created++; else res.duplicates++;
            } catch (e) { res.errors.push('lead ' + ld.id + ': ' + e.message); }
          }
          const next = j.paging && j.paging.next; if (next) { const nu = new URL(next); url = nu.pathname.replace(/^\/v\d+\.\d+\//, ''); params = {}; nu.searchParams.forEach((v, k) => { if (k !== 'access_token') params[k] = v; }); } else url = null;
        }
      }
    }
    res.ms = Date.now() - started;
    const c2 = await cfg(); c2.last_run = new Date().toISOString(); c2.last_result = { at: c2.last_run, fetched: res.fetched, created: res.created, duplicates: res.duplicates, errors: res.errors.slice(0, 5), ms: res.ms }; await saveCfg(c2);
    console.log('[meta-leads] sync: ' + res.fetched + ' načteno, ' + res.created + ' nových, ' + res.duplicates + ' duplicit' + (res.errors.length ? ', chyby: ' + res.errors.length : ''));
    return res;
  } catch (e) { res.errors.push(e.message); try { const c3 = await cfg(); c3.last_result = { at: new Date().toISOString(), error: e.message }; await saveCfg(c3); } catch (_) { /* ignore */ } console.error('[meta-leads] sync selhal:', e.message); return res; }
  finally { running = false; }
}

async function tick() { try { const c = await cfg(); if (!c.enabled) return; const iv = Math.max(2, Number(c.interval_min) || 5) * 60000; if (c.last_run && Date.now() - new Date(c.last_run).getTime() < iv - 30000) return; await sync(); } catch (e) { console.error('[meta-leads] tick:', e.message); } }
function start() { if (timer) return; timer = setInterval(tick, 60000); setTimeout(tick, 20000); console.log('[meta-leads] worker spuštěn (kontrola každou minutu, interval dle nastavení)'); }
function stop() { if (timer) clearInterval(timer); timer = null; }

// Page access token konkrétní stránky (pro webhook bez env META_PAGE_ACCESS_TOKEN). Cache 10 min.
let ptCache = { at: 0, map: {} };
async function pageToken(pageId) { if (Date.now() - ptCache.at > 600000) { const t = await token(); if (!t) return null; const j = await graph('me/accounts', { fields: 'id,access_token', limit: 100 }, t); ptCache = { at: Date.now(), map: {} }; (j.data || []).forEach((p) => { ptCache.map[String(p.id)] = p.access_token || null; }); } if (pageId && ptCache.map[String(pageId)]) return ptCache.map[String(pageId)]; const vals = Object.values(ptCache.map).filter(Boolean); return vals.length === 1 ? vals[0] : null; }

module.exports = { start, stop, sync, pages, permissions, pageToken, cfg, saveCfg, KEY };
