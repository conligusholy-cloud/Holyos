// HolyOS — Segmenty kontaktů pro funel (uzel „Segment"): ze všech kontaktů v HolyOS (nebo jen z připojeného
// formuláře) vytvoří pojmenované seznamy podle podmínek. Každý seznam = jedna tečka na oušku uzlu, odkud
// vede vlákno na další akci (SMS / e-mail = kampaň).
//
// Definice uzlu: nd.seg = { base: 'all' | 'form', lists: [{ name, cond }] }
// cond (všechny vyplněné podmínky musí platit – AND):
//   sources: ['facebook_ads', ...]      zdroj leada
//   statuses: ['new', ...]              stav v CRM
//   owners: ['i:12', 'e:3', 'none']     obchodník
//   created_min_days / created_max_days stáří leada ve dnech (od – do)
//   phone: 'yes'|'no', email: 'yes'|'no'
//   contacted: 'any'|'sms'|'email'|'both'|'none'   oslovení automatem (SMS / e-mail)
//   clicked: 'yes'|'no'                 otevřel odkaz ze zprávy (kterýkoli)
//   noreact_days: N                     osloven před ≥ N dny a neklikl
//   variant: 'specialist'|'schuzka'     varianta oslovení
//   city_contains: 'Praha'
const { prisma } = require('../../config/database');

const FIELDS = {
  sources: { label: 'Zdroj', options: [['facebook_ads', 'FB reklama'], ['google_ads', 'Google Ads'], ['web', 'Web'], ['misto', 'Prověř místo'], ['compounder', 'Compounder'], ['crm_import', 'Import CRM'], ['manual', 'Ručně']] },
  marketing_statuses: { label: 'Marketingový stav (Centrum reklamy)', options: [['none', 'Dosud neosloveno'], ['osloven_specialista', 'Osloven – specialista'], ['osloven_schuzka', 'Osloven – schůzka'], ['blokovan', 'Blokován (odhlášen / bounce)']] },
  statuses: { label: 'Stav v CRM', options: [['new', 'Nový'], ['nedovolano', 'Nedovoláno'], ['volat_pristi', 'Volat příště'], ['contacted', 'Kontaktován'], ['access_sent', 'Přístup odeslán'], ['odeslan_specialista', 'Odeslán specialista'], ['odeslana_schuzka', 'Odeslána schůzka'], ['qualified', 'Kvalifikován'], ['nezajem', 'Nezájem'], ['nelze_pouzit', 'Nelze použít'], ['rejected', 'Odmítnut'], ['won', 'Vyhráno']] },
};

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - Number(n)); return d; }

// Prisma where z podmínek (co jde do DB) – zbytek se dofiltruje v paměti
function whereOf(cond, baseWhere) {
  const w = Object.assign({}, baseWhere || {}); const c = cond || {};
  if (Array.isArray(c.sources) && c.sources.length) w.source = { in: c.sources };
  if (Array.isArray(c.statuses) && c.statuses.length) w.status = { in: c.statuses };
  if (Array.isArray(c.marketing_statuses) && c.marketing_statuses.length) {
    const ms = c.marketing_statuses.filter((x) => x !== 'none'); const or = [];
    if (ms.length) or.push({ marketing_status: { in: ms } });
    if (c.marketing_statuses.includes('none')) or.push({ marketing_status: null });
    w.AND = (Array.isArray(w.AND) ? w.AND : []).concat([{ OR: or }]);
  }
  if (Array.isArray(c.ad_ids) && c.ad_ids.length) w.meta_ad_id = { in: c.ad_ids.map(String) };
  if (c.created_min_days != null && c.created_min_days !== '') w.created_at = Object.assign({}, w.created_at || {}, { lte: daysAgo(c.created_min_days) });
  if (c.created_max_days != null && c.created_max_days !== '') w.created_at = Object.assign({}, w.created_at || {}, { gte: daysAgo(c.created_max_days) });
  if (c.phone === 'yes') w.phone = { not: null }; if (c.phone === 'no') w.phone = null;
  if (c.email === 'yes') w.email = { not: null }; if (c.email === 'no') w.email = null;
  if (c.city_contains) w.city = { contains: String(c.city_contains), mode: 'insensitive' };
  if (c.variant === 'specialist' || c.variant === 'schuzka') w.outreach_variant = c.variant;
  return w;
}
function ownerKey(l) { return l.owner_person_id ? 'i:' + l.owner_person_id : (l.external_rep_id ? 'e:' + l.external_rep_id : 'none'); }
function sentSms(l) { return l.schuzka_sms_sent_at || l.ai_specialist_sms_sent_at; }
function sentEmail(l) { return l.schuzka_email_sent_at || l.ai_specialist_email_sent_at; }
function clickedAny(l) { return l.schuzka_opened_at || l.ai_specialist_opened_at; }
function passMem(l, cond) {
  const c = cond || {};
  if (Array.isArray(c.owners) && c.owners.length && !c.owners.includes(ownerKey(l))) return false;
  const s = !!sentSms(l), e = !!sentEmail(l);
  if (c.contacted === 'any' && !(s || e)) return false; if (c.contacted === 'sms' && !s) return false; if (c.contacted === 'email' && !e) return false; if (c.contacted === 'both' && !(s && e)) return false; if (c.contacted === 'none' && (s || e)) return false;
  if (c.clicked === 'yes' && !clickedAny(l)) return false; if (c.clicked === 'no' && clickedAny(l)) return false;
  if (c.noreact_days != null && c.noreact_days !== '') { const t = [sentSms(l), sentEmail(l)].filter(Boolean).map((x) => new Date(x).getTime()); if (!t.length) return false; if (Math.max(...t) > daysAgo(c.noreact_days).getTime()) return false; if (clickedAny(l)) return false; }
  return true;
}
const SEL = { id: true, name: true, email: true, phone: true, status: true, marketing_status: true, source: true, city: true, created_at: true, owner_person_id: true, external_rep_id: true, outreach_variant: true, meta_ad_id: true, schuzka_sms_sent_at: true, ai_specialist_sms_sent_at: true, schuzka_email_sent_at: true, ai_specialist_email_sent_at: true, schuzka_opened_at: true, ai_specialist_opened_at: true };

// Základní množina uzlu: všechny kontakty v HolyOS, nebo jen z formuláře (form = { form_id, ad_ids })
function baseWhere(nd, form) {
  const seg = nd.seg || {};
  if (seg.base === 'form' && form && form.form_id) { const ads = (form.ad_ids || []).map(String).filter(Boolean); return { OR: [{ meta_form_id: String(form.form_id) }].concat(ads.length ? [{ meta_ad_id: { in: ads } }] : []) }; }
  return {};
}
// Black list (neoslovovat): normalizované e-maily a posledních 9 číslic telefonu – stejně jako _isBlocked v Compounderu
async function blocklist() { const rows = await prisma.compounderBlocklist.findMany({ select: { email: true, phone: true } }); /* chyba čtení black listu NESMÍ projít potichu – radši výjimka než kontakty navíc */ const em = new Set(), ph = new Set(); rows.forEach((r) => { const e = String(r.email || '').trim().toLowerCase(); if (e) em.add(e); const p = String(r.phone || '').replace(/\D/g, '').slice(-9); if (p && p.length >= 6) ph.add(p); }); return { em, ph }; }
function isBlocked(l, bl) { const e = String(l.email || '').trim().toLowerCase(); if (e && bl.em.has(e)) return true; const p = String(l.phone || '').replace(/\D/g, '').slice(-9); return !!(p && p.length >= 6 && bl.ph.has(p)); }
// Leady seznamu (port = index seznamu + 1; port 0 / null = celá základní množina). Kontakty z black listu se VŽDY vyřadí.
async function leadsFor(nd, port, form, limit) {
  const seg = nd.seg || {}; const lists = Array.isArray(seg.lists) ? seg.lists : []; const bw = baseWhere(nd, form);
  const list = port > 0 ? lists[port - 1] : null; const cond = list ? list.cond : {};
  const [rows, bl] = await Promise.all([prisma.compounderLead.findMany({ where: whereOf(cond, bw), select: SEL, orderBy: { created_at: 'desc' }, take: limit || 50000 }), blocklist()]);
  return rows.filter((l) => passMem(l, cond) && !isBlocked(l, bl));
}
// Podmínky vyhodnocené čistě v paměti (pro řetězení uzlů Seznam → Seznam = AND)
function passAll(l, cond) {
  const c = cond || {};
  if (Array.isArray(c.sources) && c.sources.length && !c.sources.includes(l.source)) return false;
  if (Array.isArray(c.statuses) && c.statuses.length && !c.statuses.includes(l.status)) return false;
  if (Array.isArray(c.marketing_statuses) && c.marketing_statuses.length && !c.marketing_statuses.includes(l.marketing_status || 'none')) return false;
  if (Array.isArray(c.ad_ids) && c.ad_ids.length && !c.ad_ids.map(String).includes(String(l.meta_ad_id))) return false;
  if (c.created_min_days != null && c.created_min_days !== '' && new Date(l.created_at) > daysAgo(c.created_min_days)) return false;
  if (c.created_max_days != null && c.created_max_days !== '' && new Date(l.created_at) < daysAgo(c.created_max_days)) return false;
  if (c.phone === 'yes' && !l.phone) return false; if (c.phone === 'no' && l.phone) return false;
  if (c.email === 'yes' && !l.email) return false; if (c.email === 'no' && l.email) return false;
  if (c.city_contains && !String(l.city || '').toLowerCase().includes(String(c.city_contains).toLowerCase())) return false;
  if ((c.variant === 'specialist' || c.variant === 'schuzka') && l.outreach_variant !== c.variant) return false;
  return passMem(l, c);
}
// Uzel „Seznam": základ (vše v HolyOS / formulář) + řetězec podmínek z předchozích uzlů Seznam (AND); black list vždy pryč
async function leadsForChain(conds, form, base, limit) {
  const bw = base === 'form' && form && form.form_id ? baseWhere({ seg: { base: 'form' } }, form) : {};
  const [rows, bl] = await Promise.all([prisma.compounderLead.findMany({ where: bw, select: SEL, orderBy: { created_at: 'desc' }, take: limit || 500000 }), blocklist()]);
  return rows.filter((l) => !isBlocked(l, bl) && (conds || []).every((c) => passAll(l, c)));
}
async function counts(nd, form) {
  const seg = nd.seg || {}; const lists = Array.isArray(seg.lists) ? seg.lists : [];
  const total = (await leadsFor(nd, 0, form)).length; const out = []; let blocked = null; try { blocked = Math.max(0, (await prisma.compounderLead.count({ where: baseWhere(nd, form) })) - total); } catch (e) { blocked = null; }
  for (let i = 0; i < lists.length; i++) out.push((await leadsFor(nd, i + 1, form)).length);
  return { total, lists: out, blocked };
}
module.exports = { FIELDS, leadsFor, leadsForChain, counts, whereOf, passMem, passAll };
