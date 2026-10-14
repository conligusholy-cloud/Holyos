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
  statuses: { label: 'Stav v CRM', options: [['new', 'Nový'], ['nedovolano', 'Nedovoláno'], ['volat_pristi', 'Volat příště'], ['contacted', 'Kontaktován'], ['access_sent', 'Přístup odeslán'], ['odeslan_specialista', 'Odeslán specialista'], ['odeslana_schuzka', 'Odeslána schůzka'], ['qualified', 'Kvalifikován'], ['nezajem', 'Nezájem'], ['nelze_pouzit', 'Nelze použít'], ['rejected', 'Odmítnut'], ['won', 'Vyhráno']] },
};

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - Number(n)); return d; }

// Prisma where z podmínek (co jde do DB) – zbytek se dofiltruje v paměti
function whereOf(cond, baseWhere) {
  const w = Object.assign({}, baseWhere || {}); const c = cond || {};
  if (Array.isArray(c.sources) && c.sources.length) w.source = { in: c.sources };
  if (Array.isArray(c.statuses) && c.statuses.length) w.status = { in: c.statuses };
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
const SEL = { id: true, name: true, email: true, phone: true, status: true, source: true, city: true, created_at: true, owner_person_id: true, external_rep_id: true, outreach_variant: true, schuzka_sms_sent_at: true, ai_specialist_sms_sent_at: true, schuzka_email_sent_at: true, ai_specialist_email_sent_at: true, schuzka_opened_at: true, ai_specialist_opened_at: true };

// Základní množina uzlu: všechny kontakty v HolyOS, nebo jen z formuláře (form = { form_id, ad_ids })
function baseWhere(nd, form) {
  const seg = nd.seg || {};
  if (seg.base === 'form' && form && form.form_id) { const ads = (form.ad_ids || []).map(String).filter(Boolean); return { OR: ads.length ? [{ meta_ad_id: { in: ads } }] : [{ meta_form_id: String(form.form_id) }] }; }
  return {};
}
// Leady seznamu (port = index seznamu + 1; port 0 / null = celá základní množina)
async function leadsFor(nd, port, form, limit) {
  const seg = nd.seg || {}; const lists = Array.isArray(seg.lists) ? seg.lists : []; const bw = baseWhere(nd, form);
  const list = port > 0 ? lists[port - 1] : null; const cond = list ? list.cond : {};
  const rows = await prisma.compounderLead.findMany({ where: whereOf(cond, bw), select: SEL, orderBy: { created_at: 'desc' }, take: limit || 5000 });
  return rows.filter((l) => passMem(l, cond));
}
async function counts(nd, form) {
  const seg = nd.seg || {}; const lists = Array.isArray(seg.lists) ? seg.lists : [];
  const total = (await leadsFor(nd, 0, form)).length; const out = [];
  for (let i = 0; i < lists.length; i++) out.push((await leadsFor(nd, i + 1, form)).length);
  return { total, lists: out };
}
module.exports = { FIELDS, leadsFor, counts, whereOf, passMem };
