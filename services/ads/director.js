// HolyOS — AI Marketingový ředitel nad Centrem reklamy
// =============================================================================
// Ředitel se NEKONFIGURUJE ručně. Při každém běhu si sám zjistí, co v Centru reklamy existuje
// (funely a jejich uzly, záchytné stránky, texty e-mailů/SMS, kanály, verze stránek, čísla),
// porovná to s předchozím stavem a o novinky/úpravy se postará:
//   • změnu poznají všechny nové uzly / stránky / texty bez zásahu do kódu ředitele,
//   • po ustálení změny (30 min bez další úpravy) automaticky udělá „revizi změn",
//   • jednou týdně sám udělá celkový audit,
//   • pamatuje si předchozí závěry (paměť), aby na sebe doporučení navazovala.
// Nic sám neodesílá ani nemění – jen navrhuje kroky ke schválení.
//
// CO SE ZACHYTÍ SAMO (bez úpravy tohoto souboru):
//   • funely a jejich kroky, záchytné stránky (PAGES) včetně cílů a verzí, texty e-mailů/SMS,
//   • KAŽDÉ nastavení uložené přes setSetting s klíčem začínajícím na ads_center. / compounder.aispec / bs2. … (viz SETTING_PREFIXES),
//     tj. i ekonomika, cíle stránek, kanály, synchronizace leadů a cokoli, co v Centru přibude – změna se pozná otiskem.
// CO SE PŘIDÁ JEDNÍM ŘÁDKEM: nový živý zdroj čísel → DIRECTOR.register('nazev', async (days) => data) (viz routes/ads-center.routes.js).
// Nový prefix klíčů nastavení → doplň do SETTING_PREFIXES.

const crypto = require('crypto');
const { prisma } = require('../../config/database');

const KEY_STATE = 'ads_director.state';       // { prev: kompaktní inventář, pending: {since, changes[]}, last_auto_at }
const KEY_REPORTS = 'ads_director.reports';   // posledních 12 zpráv
const KEY_MEMORY = 'ads_director.memory';     // poznámky ředitele a rozhodnutí (poslední ~30)
const DEBOUNCE_MS = 30 * 60 * 1000;           // změna se musí „ustálit"
const MIN_AUTO_GAP_MS = 6 * 3600 * 1000;      // automaticky nejvýš jednou za 6 h
const WEEKLY_MS = 7 * 24 * 3600 * 1000;

// ── Rozsah: ŘEDITEL ŘEŠÍ JEN PRÁDLOMATY (Best Series). Projekt Špagetka (Špageta) pro něj neexistuje – 100% se vyřazuje ze všech vstupů i výstupů. ──
const OUT_OF_SCOPE = /[sš]pagett?k|[sš]pagett?a\b/i;
const TAINT = Symbol('taint');
function _scrub(v) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return OUT_OF_SCOPE.test(v) ? TAINT : v;
  if (Array.isArray(v)) return v.map(_scrub).filter((x) => x !== TAINT);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { if (OUT_OF_SCOPE.test(k)) return TAINT; const x = _scrub(v[k]); if (x === TAINT) { if (typeof v[k] === 'string') return TAINT; continue; } o[k] = x; } return o; } // objekt s mimo-rozsahovým textem přímo v hodnotě se vyřadí celý z nadřazeného pole / mapy
  return v;
}
function scrub(v) { if (v && typeof v === 'object' && !Array.isArray(v)) { const o = {}; Object.keys(v).forEach((k) => { if (OUT_OF_SCOPE.test(k)) return; const x = _scrub(v[k]); if (x !== TAINT) o[k] = x; }); return o; } const r = _scrub(v); return r === TAINT ? [] : r; } // kořen: vyřadí jen mimo-rozsahové větve, ne celý objekt
let deps = null; // { loadFunnels, funnelReport, PAGES, loadGoals }
function init(d) { deps = d; }
// Registr živých zdrojů dat: register('nazev', async () => data). Ředitel je při každém běhu načte a předá AI (nesledují se jako změna – jde o čísla).
// Nový zdroj čísel v Centru reklamy = jedno volání register(); nastavení uložená přes setSetting pod níže uvedenými prefixy se zachytí SAMA.
const sources = {};
function register(name, fn) { sources[String(name)] = fn; }
// Nastavení, která ředitel sleduje automaticky (AppSetting podle prefixu klíče) – cokoli nového pod těmito prefixy uvidí bez úpravy kódu
const SETTING_PREFIXES = ['ads_center.', 'compounder.aispec', 'compounder.ads', 'compounder.mail', 'compounder.outreach', 'bs2.'];
const SETTING_SKIP = /(run_jobs|cursor|last_run|last_sync|token|secret|pass|credential|oauth|ads_director\.|ads_center\.funnels$|backfill)/i; // tajné / provozní / už řešené jinde
async function autoSettings() {
  const out = {};
  try {
    const rows = await prisma.appSetting.findMany({ where: { OR: SETTING_PREFIXES.map((p) => ({ key: { startsWith: p } })) }, select: { key: true, value: true, description: true } });
    rows.forEach((r) => { if (SETTING_SKIP.test(r.key)) return; out[r.key] = { desc: r.description || null, value: String(r.value == null ? '' : r.value).slice(0, 900) }; });
  } catch (e) { /* bez nastavení */ }
  return out;
}
const S = () => require('../settings');
const h = (o) => crypto.createHash('sha1').update(JSON.stringify(o == null ? null : o)).digest('hex').slice(0, 12);
async function getJ(key, def) { try { const v = await S().getSetting(key, { type: 'json', defaultValue: def }); return v == null ? def : v; } catch (e) { return def; } }
async function setJ(key, v, desc) { await S().setSetting(key, v, { type: 'json', description: desc, scope: 'marketing' }); }

// ── 1) Inventář: co v Centru reklamy právě je (zjišťuje se dynamicky, nic není zadrátované) ──
async function inventory() {
  const funnels = (await deps.loadFunnels()).map((f) => ({
    id: f.id, name: f.name,
    nodes: (f.nodes || []).map((nd) => ({ id: nd.id, kind: nd.kind, label: nd.label || null, page: nd.page || null, variant: nd.variant || null, activated_at: nd.activated_at || null, cond: nd.cond || undefined, groups: nd.groups ? nd.groups.length : undefined })),
    edges: (f.edges || []).map((e) => e.from + '>' + e.to + (e.port ? '#' + e.port : '')),
  }));
  const PW = require('./page-watch'); const pages = []; let goalsAll = {}; try { goalsAll = deps.loadGoals ? await deps.loadGoals() : {}; } catch (e) { goalsAll = {}; }
  for (const p of (deps.PAGES || [])) { let v = []; try { v = await PW.versions(p.key); } catch (e) { v = []; } const last = v[v.length - 1] || null; pages.push({ key: p.key, name: p.name, url: p.url, desc: p.desc || null, goals: goalsAll[p.key] ? { summary: goalsAll[p.key].summary, source: goalsAll[p.key].source, goals: (goalsAll[p.key].goals || []).map((g) => ({ type: g.type, label: g.label, primary: g.primary })) } : null, version_at: last ? last.at : null, version_note: last ? (last.note || null) : null, recent_diffs: v.slice(-3).map((x) => ({ at: x.at, diff: x.diff, note: x.note })) }); }
  const outreach = await getJ('compounder.aispec_autosend', {});
  const messages = { email_specialist: { subject: outreach.specialistEmailSubject || null, body: outreach.specialistEmailBody || null, link_label: outreach.specialistEmailLinkLabel || null, from: outreach.specialistEmailFrom || null, enabled: !!outreach.emailEnabled }, email_schuzka: { subject: outreach.schuzkaEmailSubject || null, body: outreach.schuzkaEmailBody || null, enabled: !!outreach.schuzkaEmailEnabled }, sms: { text: outreach.text || null, enabled: !!outreach.enabled } };
  const settings = await autoSettings();
  return scrub({ funnels, pages, messages, settings });
}
// Kompaktní otisk pro porovnání (per uzel / stránka / zpráva)
function fingerprint(inv) {
  const fp = { funnels: {}, nodes: {}, pages: {}, messages: {}, settings: {} };
  Object.keys(inv.settings || {}).forEach((k) => { fp.settings[k] = { desc: inv.settings[k].desc || k, hash: h(inv.settings[k].value) }; });
  inv.funnels.forEach((f) => { fp.funnels[f.id] = { name: f.name, edges: h(f.edges) }; f.nodes.forEach((nd) => { fp.nodes[f.id + '/' + nd.id] = { funnel: f.name, kind: nd.kind, label: nd.label || nd.page || nd.kind, hash: h(nd) }; }); });
  inv.pages.forEach((p) => { fp.pages[p.key] = { name: p.name, hash: h([p.version_at, p.url, p.goals]) }; });
  Object.keys(inv.messages).forEach((k) => { fp.messages[k] = h(inv.messages[k]); });
  return fp;
}
function diff(prev, cur) {
  const out = []; if (!prev) return out; // první běh = nic „nového", jen výchozí stav
  Object.keys(cur.funnels).forEach((id) => { if (!prev.funnels[id]) out.push('Nový funel „' + cur.funnels[id].name + '"'); else if (prev.funnels[id].edges !== cur.funnels[id].edges) out.push('Změněno propojení kroků ve funelu „' + cur.funnels[id].name + '"'); });
  Object.keys(prev.funnels).forEach((id) => { if (!cur.funnels[id]) out.push('Smazán funel „' + prev.funnels[id].name + '"'); });
  Object.keys(cur.nodes).forEach((k) => { const n = cur.nodes[k], o = prev.nodes[k]; if (!o) out.push('Nový krok „' + n.label + '" (' + n.kind + ') ve funelu „' + n.funnel + '"'); else if (o.hash !== n.hash) out.push('Upraven krok „' + n.label + '" (' + n.kind + ') ve funelu „' + n.funnel + '"'); });
  Object.keys(prev.nodes).forEach((k) => { if (!cur.nodes[k]) out.push('Odstraněn krok „' + prev.nodes[k].label + '" z funelu „' + prev.nodes[k].funnel + '"'); });
  Object.keys(cur.pages).forEach((k) => { const n = cur.pages[k], o = prev.pages[k]; if (!o) out.push('Nová záchytná stránka „' + n.name + '"'); else if (o.hash !== n.hash) out.push('Upravena záchytná stránka „' + n.name + '"'); });
  const ps = prev.settings || {}; // starší otisk bez nastavení → nic „nového" nehlásit
  if (prev.settings) {
    Object.keys(cur.settings || {}).forEach((k) => { const n = cur.settings[k], o = ps[k]; if (!o) out.push('Nové nastavení: ' + n.desc); else if (o.hash !== n.hash) out.push('Změněno nastavení: ' + n.desc); });
    Object.keys(ps).forEach((k) => { if (!(cur.settings || {})[k]) out.push('Odstraněno nastavení: ' + ps[k].desc); });
  }
  Object.keys(cur.messages).forEach((k) => { if (prev.messages[k] != null && prev.messages[k] !== cur.messages[k]) out.push('Změněn text / nastavení zprávy: ' + k); else if (prev.messages[k] == null) out.push('Nová zpráva: ' + k); });
  return out;
}

// ── 2) Čísla: pro každý funel report za období (kanály, stránky, objednávky – co funel obsahuje) ──
async function metrics(days) {
  const out = [];
  for (const f of await deps.loadFunnels()) {
    try { const r = await deps.funnelReport({}, days, 0, f); out.push({ funnel: f.name, kpi: r.kpi, ads: r.ads ? { spend: r.ads.spend, impressions: r.ads.impressions, reach: r.ads.reach, link_clicks: r.ads.link_clicks, campaigns: r.ads.campaigns } : null, sms: r.sms, email: r.email, clickers: r.clickers, landing: r.landing, orders: r.orders, daily: (r.daily || []).slice(-14), forms: r.forms }); }
    catch (e) { out.push({ funnel: f.name, error: e.message }); }
  }
  let ses = null; try { ses = await require('../ses/email-log').stats(days >= 90 ? '90d' : days >= 30 ? '30d' : days >= 7 ? '7d' : 'today'); delete ses.byDay; } catch (e) { ses = null; }
  const extra = {}; for (const name of Object.keys(sources)) { try { extra[name] = await sources[name](days); } catch (e) { extra[name] = { error: e.message }; } }
  return scrub({ funnels: out, ses_email: ses, extra });
}

// ── 3) Ředitel ──
const SYSTEM = 'Jsi marketingový ředitel (CMO) a zároveň špičkový performance marketér, CRO specialista a direct-response copywriter firmy Best Series (prádlomaty – samoobslužné prádelny, prodej strojů, aplikace Prověření lokality a Vyhledávač míst; web compounder.world, bestseries2.cz). ROZSAH: řešíš VÝHRADNĚ prádlomaty (Best Series – Prádlomaty, Compounder, Prověření lokality, Vyhledávač míst). Jiný projekt zvaný Špagetka (Špageta) pro tebe NEEXISTUJE – nikdy ho nezmiňuj, nehodnoť, nezahrnuj do čísel ani doporučení; kdyby se ve vstupu objevil, ignoruj ho. HLAVNÍ POSLÁNÍ: prodat PRÁDLOMAT (hlavní produkt, vysoká hodnota) a kolem něj koordinovaně prodávat doprovodné věci – aplikaci Prověření lokality a Vyhledávač míst (vstupní placené produkty), dokumenty a smlouvy, servis, náhradní díly (e-shop), financování/leasing, aplikace a další služby. Měř vše vůči tomuto cíli: každý krok marketingu musí buď přivést KVALIFIKOVANÉHO leada (někoho, kdo má reálné místo, rozpočet a záměr postavit prádelnu), nebo ho posunout blíž k nákupu prádlomatu, nebo zvýšit hodnotu zákazníka doprovodným prodejem. Aktivně vymýšlej doprovodné prodeje (cross-sell, upsell, balíčky, navazující nabídky po nákupu, reaktivace), nastav kritéria kvalifikace leadů a hlídej jejich počet a kvalitu. Řídíš CELÉ Centrum reklamy prádlomatů, ne jen funel: záchytné stránky (jejich cíle, verze, texty, návštěvnost, objednávky), funely, oslovení (e-mail, SMS), reklamní kampaně, ziskovost a ekonomiku, nastavení kanálů a vše ostatní, co je v inventáři a nastaveních. Tvoje práce: aby online marketing tvořil JEDEN koordinovaný systém (reklama → lead → e-mail / SMS → záchytná stránka → platba → další péče), každý krok navazoval na předchozí slibem i tónem a celek vedl k prodeji. Pravidla: (1) opírej se jen o dodaná data, každé tvrzení doplň číslem; chybí-li data, řekni to a navrhni, co měřit; (2) u malých vzorků mluv o „signálu", ne o jistotě; (3) hlídej soulad slibu v e-mailu / SMS / reklamě s tím, co člověk vidí na stránce; (4) hledej největší únik v celém řetězci, ne jen v jednom kroku; (5) navrhuj konkrétní kroky s dopadem, náročností a metrikou – nic nepředstírej, že jsi sám provedl; (6) vše, co je v inventáři nové nebo změněné, výslovně zhodnoť – nové věci zapoj do celku; (7) navazuj na předchozí závěry a poznámky z paměti, neopakuj je, hodnoť jejich dopad. Piš česky, stručně a prakticky.\n\nPŘESNOST STATISTIK JE PRIORITA. Než z čísla vyvodíš závěr, ověř, že mu lze věřit: (a) porovnej čísla mezi zdroji (funel vs. SES vs. BS2 vs. Meta) a upozorni na nesoulad; (b) znáš tyto slabiny měření: otevření e-mailu (SES) je nadhodnocené automatickým načtením obrázků (Apple Mail, skenery), prokliky mohou obsahovat boty, „oslovení" může počítat opakované kontakty jednoho leada (hodnoty nad 100 % jsou signál chyby), odeslané e-maily mohou zahrnovat testovací a jiné kampaně, počty „leadů" se mohou lišit podle zdroje (Meta vs. HolyOS), údaje před aktivací uzlu funelu se nepočítají, malé vzorky (desítky) jsou jen signál; (c) co nelze spolehlivě tvrdit, tak netvrď – označ jako nejisté a navrhni, jak měření opravit; (d) vždy vyplň data_quality: odhad spolehlivosti 0–100, a konkrétní problémy měření s dopadem a opravou. Doporučení nestav na číslech, kterým nevěříš.\n\nTYPY KROKŮ (pole kind): „fb" = úprava v nastavení Facebook/Meta reklam (kampaň, cílení, rozpočet, kreativa, formulář, pixel) – napiš přesný postup v krocích (steps) klik po kliku s konkrétními hodnotami; „centrum" = úprava v Centru reklamy / HolyOS / BS2 (funel, stránka, e-mail, měření, report) – vygeneruj hotové ZADÁNÍ PRO PROGRAMÁTORA-AI (claude_prompt): česky, přesné, samostatně srozumitelné; uveď cíl, kde v kódu (HolyOS: routes/ads-center.routes.js, services/ads/funnel-events.js, services/ads/director.js, modules/centrum-reklamy/*, routes/compounder.routes.js, services/email.js; BS2: apps/bs2/*), konkrétní požadované chování a přijatelnost (jak poznáme, že je hotovo), a pravidla projektu (vždy Prisma, žádný raw SQL, texty česky, ověřit node --check); „web" = úprava textů/designu záchytné stránky; „jine" = ostatní. U fb a jine uveď steps, u centrum uveď claude_prompt.';

async function run(opts) {
  if (!deps) throw new Error('Ředitel není inicializovaný');
  const o = opts || {}; const mode = o.mode === 'changes' ? 'changes' : 'audit'; const days = Math.min(90, Math.max(1, parseInt(o.days, 10) || 30));
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const inv = await inventory(); const fp = fingerprint(inv);
  const state = await getJ(KEY_STATE, {}); const changes = ((o.changes && o.changes.length) ? o.changes : [...new Set([...(state.pending ? state.pending.changes : []), ...diff(state.prev, fp)])]).filter((c) => !OUT_OF_SCOPE.test(c));
  const m = await metrics(days); let reports = await getJ(KEY_REPORTS, []); let memory = await getJ(KEY_MEMORY, []);
  reports = scrub(reports); memory = scrub(memory); // paměť i staré zprávy očištěné od mimo-rozsahových projektů
  const prevSummary = reports.slice(0, 3).map((r) => ({ at: r.at, mode: r.mode, summary: r.summary, actions: (r.actions || []).map((a) => a.title) }));
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const ask = mode === 'changes'
    ? 'Udělej REVIZI ZMĚN. Zhodnoť každou novou / upravenou věc ze sekce ZMĚNY: zda dává smysl, zda navazuje na zbytek řetězce (slib – kanál – stránka – platba), co v ní chybí a co zapojit. Na konec 3 nejdůležitější další kroky.'
    : 'Udělej CELKOVÝ TÝDENNÍ AUDIT: (1) Verdikt na 3–4 věty a „kde teď unikají peníze" jedním číslem; (2) průchod řetězcem krok po kroku s čísly a propady; (3) soulad sdělení napříč kanály a stránkou; (4) zhodnocení všeho nového ze sekce ZMĚNY; (5) TOP 5 kroků seřazených podle dopad/náročnost; (6) A/B testy; (7) co dál měřit.';
  const prompt = ask + '\n\nOBDOBÍ DAT: posledních ' + days + ' dní.\n\nZMĚNY od posledního běhu (nové / upravené věci):\n' + (changes.length ? changes.map((c) => '- ' + c).join('\n') : '(žádné)') + '\n\nINVENTÁŘ (co v Centru reklamy právě existuje – funely, uzly, stránky, texty zpráv):\n' + JSON.stringify(inv).slice(0, 24000) + '\n\nČÍSLA (funely, SES a živé zdroje z celého Centra reklamy – stránky, ziskovost…):\n' + JSON.stringify(m).slice(0, 22000) + '\n\nPAMĚŤ (předchozí závěry a poznámky):\n' + JSON.stringify({ reports: prevSummary, notes: memory.slice(-15) }).slice(0, 6000) + '\n\nVÝSTUP: odpověz POUZE jedním JSON objektem (žádný text okolo, žádný Markdown, žádné tabulky). Je určený pro přehledné zobrazení v kartách pro rychlou orientaci – piš STRUČNĚ: věty max. ~20 slov, čísla v samostatných polích. Struktura:\n{"headline":"jedna věta – hlavní verdikt","health":"zdravé|pozor|kritické","leak":{"label":"kde unikají peníze (krátce)","value":"jedno číslo, např. 73 %","note":"proč, 1 věta"},"kpis":[{"label":"…","value":"…","status":"ok|warn|bad","note":"max 12 slov"}],"chain":[{"step":"např. Reklama → Lead","status":"ok|warn|bad","metric":"klíčové číslo","finding":"1–2 věty"}],"alignment":["max 4 krátké postřehy o souladu sdělení napříč kanály"],"changes_review":[{"item":"nová/upravená věc","verdict":"ok|warn|bad","comment":"1–2 věty"}],"data_quality":{"score":0,"verdict":"1 věta o důvěryhodnosti čísel","issues":[{"metric":"…","problem":"co je podezřelé/nepřesné","impact":"jak to zkresluje závěry","fix":"jak měření opravit"}]},"actions":[{"title":"…","why":"…","kind":"fb|centrum|web|jine","area":"reklama|e-mail|sms|stránka|funel|měření","impact":"vysoký|střední|nízký","effort":"nízká|střední|vysoká","metric":"podle čeho poznáme úspěch","steps":["u kind fb/jine: přesné kroky klik po kliku s hodnotami"],"claude_prompt":"u kind centrum: hotové zadání pro programátora-AI (viz pravidla)"}],"qualified_leads":{"definition":"kdo je kvalifikovaný lead pro prodej prádlomatu","count":"kolik jich dnes je / odhad","note":"co zlepšit"},"sales_ideas":[{"title":"nápad na doprovodný prodej","product":"…","why":"…","expected":"přínos opřený o data"}],"tests":[{"hypothesis":"Pokud …, pak …, protože …","metric":"…"}],"measure":["co dál měřit, max 4"],"summary":"max 2 věty pro paměť"}\nLimity: data_quality.issues max 5, kpis max 8, chain max 7, actions max 6 (seřazeno podle dopad/náročnost; steps max 8 kroků; claude_prompt do ~1200 znaků), tests max 3, alignment max 4. U revize změn vyplň hlavně changes_review a actions (chain/kpis mohou být krátké nebo prázdné).';
  const r = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 9000, system: SYSTEM, messages: [{ role: 'user', content: prompt }] });
  const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let report = null; try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a >= 0 && b > a) report = JSON.parse(raw.slice(a, b + 1)); } catch (e) { report = null; }
  if (report) report = scrub(report); // pojistka: cokoli o mimo-rozsahovém projektu z odpovědi vypadne
  const actions = report && Array.isArray(report.actions) ? report.actions : []; const summary = report && report.summary ? String(report.summary) : '';
  const text = report ? '' : raw.trim(); // když AI nevrátí JSON, zobrazí se aspoň text
  const rep = { id: Date.now().toString(36), at: new Date().toISOString(), mode, days, changes, report, text, actions: actions.slice(0, 6), summary };
  await setJ(KEY_REPORTS, [rep, ...reports].slice(0, 12), 'Marketingový ředitel – zprávy');
  if (summary) await setJ(KEY_MEMORY, [...memory, { at: rep.at, note: summary }].slice(-30), 'Marketingový ředitel – paměť');
  await setJ(KEY_STATE, Object.assign({}, state, { prev: fp, pending: null, last_run_at: rep.at, last_auto_at: o.auto ? rep.at : state.last_auto_at, last_audit_at: mode === 'audit' ? rep.at : state.last_audit_at }), 'Marketingový ředitel – stav');
  return rep;
}

// ── Strategie: celá marketingová strategie jako graf (plátno) s očekávanými výsledky ──
const KEY_STRATEGY = 'ads_director.strategy';
async function getStrategy() { const s = await getJ(KEY_STRATEGY, null); return s ? scrub(s) : null; }
async function strategy(opts) {
  if (!deps) throw new Error('Ředitel není inicializovaný');
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const days = Math.min(90, Math.max(7, parseInt((opts || {}).days, 10) || 30));
  const inv = await inventory(); const fp = fingerprint(inv); const m = await metrics(days);
  const reports = scrub(await getJ(KEY_REPORTS, [])); const memory = scrub(await getJ(KEY_MEMORY, []));
  const last = reports[0] && reports[0].report ? { headline: reports[0].report.headline, leak: reports[0].report.leak, data_quality: reports[0].report.data_quality, actions: (reports[0].report.actions || []).map((a) => ({ title: a.title, kind: a.kind, impact: a.impact })) } : null;
  const prompt = 'ÚKOL: Navrhni marketingový SYSTÉM prádlomatů OD ZAČÁTKU DO KONCE jako seniorní performance marketér (direct response, B2B/high-ticket, Meta Ads, CRO, e-mail/SMS automatizace). Nepopisuj jen to, co existuje – rozhodni, jak to MÁ být, a u každé existující věci jednoznačně řekni, jestli ji ponechat, upravit, vypnout nebo nahradit, a PROČ (opři o čísla).\n\n'
    + 'FAKTA O BYZNYSU: hlavní produkt prádlomat (cena stroje řádově statisíce až 2 mil. Kč); ~90 % prodejů se uzavírá na OSOBNÍ SCHŮZCE nebo NÁVŠTĚVĚ VE VÝROBĚ → hlavní konverzí marketingu je domluvená a uskutečněná schůzka/prohlídka výroby s kvalifikovaným zájemcem. Online produkty (Prověření lokality, Vyhledávač míst, dokumenty, servis, díly, leasing) mají vydělávat UŽ CESTOU – cílem je SAMOFINANCOVÁNÍ reklamy: tržby z online produktů ≥ útrata za reklamu (front-end ROAS ≥ 1), prodej prádlomatu je pak čistý zisk. Majitel zatím nikdy nedělal remarketing ani vlastní publika na Facebooku – vysvětli je prakticky.\n\n'
    + 'POVINNĚ VYŘEŠ:\n'
    + '(A) VERDIKT DNEŠNÍ CESTY: dnes = FB reklama → nativní rychlý formulář (Lead Form) → e-mail/SMS s odkazem na stránku. Zhodnoť čísly (CPL, % leadů, které kliknou na odkaz, % plateb, kvalita) a rozhodni: ponechat Lead Form, nahradit ho reklamou na novou záchytnou stránku, nebo kombinovat (a jak rozdělit rozpočet a testovat). Vysvětli kompromis: Lead Form = levný a hodně leadů, ale nízký záměr; stránka = dražší lead, vyšší záměr + Pixel data pro remarketing.\n'
    + '(B) JEDNA JEDNOZNAČNÁ CESTA ZÁKAZNÍKA: očíslované kroky od první reklamy až po prodej prádlomatu a péči po prodeji; u každého kroku: co zákazník vidí, jaký je jeho další krok, kanál, a cílová konverze.\n'
    + '(C) NOVÁ ZÁCHYTNÁ STRÁNKA (navrhni ji, i když neexistuje): URL návrh, cíl, nadpis, podnadpis, sekce shora dolů (obsah každé), lead magnet výměnou za kontakt, pole formuláře (minimum: jméno, e-mail, telefon + 1–2 kvalifikační otázky, např. „máte místo?", „kdy chcete začít?"), hlavní CTA, důkazy důvěry, a co se stane HNED po odeslání (děkovací stránka s nabídkou levného placeného produktu = tripwire / samolikvidační nabídka).\n'
    + '(D) ČASOVÁ OSA FOLLOW-UPU po získání kontaktu: konkrétní e-maily a SMS (den 0, 0+1 h, 1, 2, 3, 5, 7, 10, 14, 21, 30…), u každého: kanál, podmínka (komu – např. jen kdo nekoupil / kdo otevřel / kdo má místo), cíl, předmět, krátký text, CTA. Zakomponuj prodej online produktů, pozvánku na schůzku/prohlídku výroby, reaktivaci a ukončení.\n'
    + '(E) META PUBLIKA A REMARKETING: jaká vlastní publika založit (návštěvníci webu přes Pixel + Conversions API, kdo otevřel/odeslal formulář, kdo sledoval video 50 %, kdo interagoval s FB/IG, seznam leadů/zákazníků), jaká podobná publika (lookalike 1–3 %), co vyloučit (zákazníci, kdo už koupil), a remarketingové okruhy podle okna (1–3 dny, 4–14, 15–60 dní): pro každé reklama, sdělení, cíl a rozpočet. Uveď i co je pro to technicky potřeba nasadit (Pixel, CAPI, události Lead/Purchase/Schedule).\n'
    + '(F) EKONOMIKA: max. přípustná cena za lead a za schůzku tak, aby online tržby pokryly reklamu; výpočet bodu zvratu (CPL × počet leadů vs. konverze na online produkt × cena); kolik schůzek a prodaných prádlomatů z toho vyjde. Pokud dnešní čísla samofinancování nedovolují, řekni přesně, co musí změnit (cena produktu, konverze stránky, upsell, bundle) a o kolik.\n'
    + '(G) Reklamy (ads): existující kampaně s verdiktem + nové (zejména na novou záchytnou stránku a remarketing). Žebřík nabídky, kvalifikace leadů, doprovodné prodeje, graf systému (nodes/edges), plán zavedení po týdnech.\n'
    + 'Nevymýšlej čísla bez opory – odhady odvozuj z naměřených dat a nejistotu přiznej.\n\nOBDOBÍ DAT: ' + days + ' dní.\n\nINVENTÁŘ:\n' + JSON.stringify(inv).slice(0, 22000) + '\n\nČÍSLA:\n' + JSON.stringify(m).slice(0, 20000) + '\n\nPOSLEDNÍ AUDIT:\n' + JSON.stringify(last).slice(0, 4000) + '\n\nPAMĚŤ:\n' + JSON.stringify(memory.slice(-10)).slice(0, 3000) +
    '\n\nVÝSTUP: pouze jeden JSON objekt (bez Markdownu):\n{"goal":{"title":"hlavní cíl","target":"měřitelný cíl (schůzky / prodané prádlomaty / front-end ROAS)","horizon":"např. 90 dní"},"positioning":"1–2 věty","verdict":{"today":"1–2 věty: jak dnešní cesta funguje v číslech","decision":"jednoznačné rozhodnutí, co s ní (ponechat / nahradit / kombinovat a v jakém poměru)","why":"zdůvodnění čísly","test":"jak rozhodnutí ověříme (A/B test, rozpočet, doba, metrika výhry)"},"keep_kill":[{"asset":"existující věc (kampaň, formulář, stránka, e-mail, SMS, funel)","decision":"ponechat|upravit|vypnout|nahradit","why":"proč (čísla)","replacement":"čím nahradit / co upravit"}],"journey":[{"step":1,"name":"krok","customer_sees":"co zákazník vidí","next_action":"co má udělat","channel":"Meta|stránka|e-mail|SMS|telefon|osobně","target_rate":"cílová konverze kroku"}],"landing_page":{"url":"navržená URL","goal":"cíl stránky","headline":"…","subheadline":"…","lead_magnet":"co člověk dostane za kontakt","sections":[{"name":"sekce","content":"co v ní je"}],"form_fields":["…"],"cta":"text tlačítka","trust":["důkaz důvěry"],"after_submit":"děkovací stránka + tripwire nabídka (co, za kolik)","expected_cvr":"očekávaná konverze návštěva→lead"},"nurture":[{"day":"D0 / D0+1h / D1 …","channel":"e-mail|SMS|remarketing|telefon","condition":"komu","goal":"cíl","subject":"předmět / první věta","message":"krátký text","cta":"výzva"}],"meta_audiences":[{"name":"název publika","type":"vlastní|podobné|vyloučení","source":"zdroj (Pixel, formulář, video, IG/FB, seznam)","window":"okno dní","use":"k čemu"}],"remarketing":[{"audience":"publikum","window":"1–3 dny","ad":"jaká reklama","message":"sdělení","goal":"cíl","budget_czk_month":0}],"tech_setup":["co technicky nasadit (Pixel, CAPI, události…)"],"economics":{"max_cpl_czk":0,"max_cost_per_meeting_czk":0,"breakeven":"výpočet bodu zvratu slovy s čísly","online_aov_czk":0,"needed_changes":["co musí platit pro samofinancování"]},"ads":[{"name":"…","status":"existuje|navrženo|problém","objective":"…","audience":"…","hook":"…","destination":"…","budget_czk_month":0,"current":{"spend_czk":0,"impressions":0,"clicks":0,"leads":0,"cpl_czk":0,"ctr":"…"},"expected":{"ctr":"…","cpl_czk":0,"leads_month":0,"qualified_pct":"…","note":"…"},"verdict":"ponechat / upravit / vypnout / nahradit a proč"}],"offer_ladder":[{"step":"1","name":"…","kind":"vstup|schůzka|hlavní|doprovodný","price":"…","role":"…","status":"existuje|navrženo|problém"}],"qualification":{"criteria":["…"],"stages":[{"name":"…","definition":"…","count_now":"…","action":"…"}],"note":"…"},"sales_ideas":[{"title":"…","product":"…","trigger":"…","why":"…","expected":"…","effort":"nízká|střední|vysoká"}],"audiences":[{"name":"…","need":"…"}],"nodes":[{"id":"n1","stage":0,"kind":"goal|source|outreach|page|conversion|retention|measure","title":"…","desc":"…","status":"existuje|navrženo|problém","owner":"…","expected":{"metric":"…","current":"…","target":"…","note":"…"}}],"edges":[{"from":"n1","to":"n2","label":"…","current_rate":"…","target_rate":"…"}],"results":{"horizon":"…","scenarios":[{"name":"konzervativní|realistický|optimistický","spend_czk":0,"leads":0,"online_orders":0,"online_revenue_czk":0,"front_roas":0,"meetings":0,"machines_sold":0,"machine_revenue_czk":0,"note":"předpoklady"}],"assumptions":["…"],"risks":["…"]},"timeline":[{"when":"týden 1","what":"…","owner":"…"}],"data_quality_note":"…"}\n'
    + 'Pravidla: keep_kill pokryj VŠECHNY existující kampaně, formuláře, stránky a zprávy z inventáře; journey 7–12 kroků; nurture 10–16 zpráv; meta_audiences 5–9; remarketing 3–5; ads 3–7; offer_ladder 4–7; qualification.stages 4–6; sales_ideas 4–7; 10–14 uzlů, max 16 hran, souvislý graf; čísla v results a economics jsou čísla; front_roas = online_revenue_czk / spend_czk; vše česky, konkrétně a stručně.';
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const r = await client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: 32000, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }).finalMessage(); // stream: dlouhá odpověď (minuty) bez timeoutu SDK
  const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'); let S = null;
  try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); S = scrub(JSON.parse(raw.slice(a, b + 1))); } catch (e) { throw new Error(r.stop_reason === 'max_tokens' ? 'Strategie byla příliš dlouhá a usekla se – zkus to znovu.' : 'Strategie se nepodařila sestavit (neplatná odpověď AI), zkus to znovu.'); }
  S.generated_at = new Date().toISOString(); S.days = days; S.fp = h(fp);
  await setJ(KEY_STRATEGY, S, 'Marketingový ředitel – strategie');
  return S;
}

async function reports() { return scrub(await getJ(KEY_REPORTS, [])); }
// Stav pro UI: kolik nových / upravených věcí ředitel ještě nezhodnotil
async function status() {
  const state = await getJ(KEY_STATE, {}); let pending = []; try { const inv = await inventory(); pending = [...new Set([...(state.pending ? state.pending.changes : []), ...diff(state.prev, fingerprint(inv))])].filter((c) => !OUT_OF_SCOPE.test(c)); } catch (e) { pending = []; }
  return { pending_changes: pending, last_run_at: state.last_run_at || null, last_audit_at: state.last_audit_at || null, first_run: !state.prev };
}

// ── 4) Hlídač změn: každých 20 min zjistí novinky; po ustálení spustí revizi, jednou týdně audit ──
let _busy = false;
async function tick() {
  if (_busy || !deps || !process.env.ANTHROPIC_API_KEY) return; _busy = true;
  try {
    const state = await getJ(KEY_STATE, {}); const inv = await inventory(); const fp = fingerprint(inv);
    if (!state.prev) { await setJ(KEY_STATE, Object.assign({}, state, { prev: fp }), 'Marketingový ředitel – stav'); return; } // výchozí stav, bez zbytečného běhu
    const fresh = diff(state.prev, fp).filter((c) => !OUT_OF_SCOPE.test(c)); const nowMs = Date.now();
    let pending = state.pending || null;
    if (fresh.length) { const merged = [...new Set([...(pending ? pending.changes : []), ...fresh])]; pending = { since: nowMs, changes: merged }; await setJ(KEY_STATE, Object.assign({}, state, { prev: fp, pending }), 'Marketingový ředitel – stav'); return; } // změna běží dál → čekej na ustálení
    const lastAuto = state.last_auto_at ? Date.parse(state.last_auto_at) : 0;
    if (pending && pending.changes.length && nowMs - pending.since >= DEBOUNCE_MS && nowMs - lastAuto >= MIN_AUTO_GAP_MS) { console.log('[ads-director] revize změn:', pending.changes.length); await run({ mode: 'changes', changes: pending.changes, auto: true, days: 30 }); return; }
    const lastAudit = state.last_audit_at ? Date.parse(state.last_audit_at) : 0;
    if (nowMs - lastAudit >= WEEKLY_MS && nowMs - lastAuto >= MIN_AUTO_GAP_MS) { console.log('[ads-director] týdenní audit'); await run({ mode: 'audit', auto: true, days: 30 }); }
  } catch (e) { console.warn('[ads-director] tick:', e.message); }
  finally { _busy = false; }
}
function start() {
  if (start._on) return; start._on = true; setTimeout(tick, 90 * 1000); setInterval(tick, 20 * 60 * 1000);
  // Healthcheck napojení FB Lead Ads každé 2 hodiny (první za 3 min po startu). Je celý asynchronní (fetch s timeouty) → event loop neblokuje.
  // Při problému odejde alert e-mail (viz services/ads/fb-health.js). Vypnutí: FB_HEALTH_DISABLED=1.
  if (process.env.FB_HEALTH_DISABLED !== '1') {
    const fbRun = () => { require('./fb-health').run().catch((e) => console.warn('[fb-health] cron:', e.message)); };
    setTimeout(fbRun, 3 * 60 * 1000); setInterval(fbRun, 2 * 3600 * 1000);
  }
}


// ── 5) VYMYSLET NOVÝ FUNNEL: kreativní ředitel navrhne celý systém od nuly podle cílů majitele ──
const KEY_GOALS = 'ads_director.goals';
const KEY_INVENT = 'ads_director.invent';
const GOALS_DEFAULT = { machines_per_week: 3, online_net_czk: 5000000, online_days: 14, budget_czk_day: 0, note: '', machine_types: null }; // machine_types: null = zatím nevybráno
async function getGoals() { return Object.assign({}, GOALS_DEFAULT, await getJ(KEY_GOALS, {})); }
async function setGoals(g) {
  const v = { machines_per_week: Math.max(0, Number(g.machines_per_week) || 0), online_net_czk: Math.max(0, Number(g.online_net_czk) || 0), online_days: Math.max(1, parseInt(g.online_days, 10) || 14), budget_czk_day: Math.max(0, Number(g.budget_czk_day) || 0), note: String(g.note || '').slice(0, 1500), machine_types: Array.isArray(g.machine_types) ? g.machine_types.map((x) => String(x).slice(0, 80)).slice(0, 30) : null };
  await setJ(KEY_GOALS, v, 'Marketingový ředitel – cíle majitele'); return v;
}
function normalizeFunnel(F) {
  if (!F || typeof F !== 'object') return F;
  const A = (x) => Array.isArray(x) ? x : (x == null || x === '') ? [] : (typeof x === 'object' ? Object.values(x) : [x]);
  const O = (x, key) => (x && typeof x === 'object') ? x : { [key]: String(x == null ? '' : x) };
  ['offer_stack', 'new_products', 'ads', 'pages', 'sequence', 'remarketing', 'tasks', 'owner_questions', 'kpis', 'risks', 'launch_plan', 'page_plan', 'revisions'].forEach((k) => { if (F[k] !== undefined) F[k] = A(F[k]); });
  F.offer_stack = (F.offer_stack || []).map((o) => { o = O(o, 'name'); o.contents = A(o.contents); return o; });
  F.new_products = (F.new_products || []).map((p) => { p = O(p, 'name'); p.what_customer_gets = A(p.what_customer_gets); p.packages = A(p.packages).map((x) => O(x, 'name')); return p; });
  F.ads = (F.ads || []).map((a) => { a = O(a, 'name'); if (a.media_brief && typeof a.media_brief === 'object') a.media_brief.shots = A(a.media_brief.shots).map((x) => O(x, 'shot')); return a; });
  F.pages = (F.pages || []).map((p) => { p = O(p, 'name'); p.sections = A(p.sections).map((x) => O(x, 'copy')); p.form_fields = A(p.form_fields); return p; });
  ['sequence', 'remarketing', 'kpis', 'launch_plan'].forEach((k) => { F[k] = (F[k] || []).map((x) => O(x, k === 'sequence' || k === 'remarketing' ? 'text' : k === 'kpis' ? 'metric' : 'what')); });
  F.tasks = (F.tasks || []).map((x) => O(x, 'title')); F.owner_questions = (F.owner_questions || []).map((x) => O(x, 'question'));
  if (F.feasibility && typeof F.feasibility === 'object') F.feasibility.what_it_takes = A(F.feasibility.what_it_takes);
  if (F.projection && typeof F.projection === 'object') F.projection.assumptions = A(F.projection.assumptions);
  if (F.leadform && typeof F.leadform === 'object') F.leadform.questions = A(F.leadform.questions);
  // Poškozené sekce (AI vrátila celé pole jako jeden text) → vyprázdnit a nahlásit
  F.broken = [];
  ['ads', 'remarketing', 'sequence', 'tasks', 'pages', 'offer_stack', 'new_products', 'launch_plan'].forEach((k) => { const v = F[k]; if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === 'object' && Object.keys(v[0]).some((f) => typeof v[0][f] === 'string' && v[0][f].length > 300 && /^\s*[\[{]/.test(v[0][f]))) { F[k] = []; F.broken.push(k); } });
  return F;
}
async function getInvent() { return normalizeFunnel(scrub(await getJ(KEY_INVENT, null))); }

const INVENT_SYSTEM = 'Jsi kreativní marketingový ředitel a špičkový direct-response marketér (úroveň Russell Brunson / Alex Hormozi / Dan Kennedy, ale na český trh). Stavíš FUNNELY, které prodávají: silná velká myšlenka (big idea), neodolatelná nabídka (value stack, bonusy, garance, omezení), háčky do reklam, copywriting, který zastaví palec, a následné sekvence, které dovedou člověka k nákupu. Nejsi úředník, který popisuje stav – jsi stratég, který VYMÝŠLÍ a ROZHODUJE. Píšeš hotové texty (reklamy, stránky, SMS, e-maily) připravené k použití, ne osnovy. Firma: Best Series – prádlomaty (samoobslužné prádelny v kontejneru / v prostoru; prodej strojů, financování/leasing, servis, díly) a online aplikace Prověření lokality a Vyhledávač míst; weby bestseries2.cz, pradlomaty.info, compounder.world. Jiný projekt Špagetka/Špageta pro tebe neexistuje. Buď ale POCTIVÝ v číslech: kreativní v nabídce, realistický v matematice. Když je cíl v daném čase nereálný, řekni to rovnou, spočítej proč a navrhni, co by ho reálně splnilo (jiná cena, jiný produkt, jiné publikum, jiný čas). Vše česky.';

const machineType = (name) => String(name || '').replace(/\s+(CZ|SK)$/i, '').trim();
// Typy prádlomatů z Prodejního ceníku (pro výběr v cílech)
async function machineTypes() { const rows = await prisma.salesPricelistItem.findMany({ where: { active: true, kind: 'machine' }, select: { name_cs: true, price_czk: true }, orderBy: { price_czk: 'asc' } }); const m = new Map(); rows.forEach((r) => { const t = machineType(r.name_cs); if (!m.has(t)) m.set(t, { type: t, price_czk: r.price_czk != null ? Number(r.price_czk) : null }); }); return [...m.values()]; }
// Skutečný ceník: stroje z Prodejního ceníku HolyOS + online produkty z BS2 (aktuální ceny z admin → Online produkty)
async function catalog(types) {
  const out = { machines: [], online: null, source_note: '' };
  try {
    const rows = await prisma.salesPricelistItem.findMany({ where: { active: true, kind: 'machine' }, orderBy: [{ price_czk: 'asc' }], take: 80,
      select: { name_cs: true, price_czk: true, price_eur: true, model_version: true, model_variant: true, machine_code: true, config_options: true, note: true } });
    out.machines = rows.filter((r) => !Array.isArray(types) || !types.length || types.includes(machineType(r.name_cs))).map((r) => ({ name: r.name_cs, price_czk_bez_dph: r.price_czk != null ? Number(r.price_czk) : null, price_eur_bez_dph: r.price_eur != null ? Number(r.price_eur) : null, model: [r.model_version, r.model_variant].filter(Boolean).join(' ') || null, code: r.machine_code || null,
      options: Array.isArray(r.config_options) ? r.config_options.map((g) => g && g.name + ': ' + (Array.isArray(g.options) ? g.options.map((o) => o && o.name).filter(Boolean).join(' / ') : '')).filter(Boolean).slice(0, 8) : undefined }));
  } catch (e) { out.source_note += 'Ceník strojů nenačten (' + e.message + '). '; }
  try {
    const jwt = require('jsonwebtoken'); const secret = process.env.BS2_SSO_SECRET; const base = String(process.env.BS2_URL || 'https://www.bestseries2.cz').replace(/\/$/, '');
    if (secret) { const r = await fetch(base + '/api/holyos/catalog', { headers: { Authorization: 'Bearer ' + jwt.sign({ aud: 'bs2-api', iss: 'holyos' }, secret, { expiresIn: '1m' }) }, signal: AbortSignal.timeout(10000) }); if (r.ok) out.online = await r.json(); }
  } catch (e) { /* fallback níže */ }
  if (!out.online) { // výchozí ceny z kódu BS2 (bez případných úprav v adminu)
    try { const L = require('../../apps/bs2/location'); const kc = (a) => Math.round(Number(a || 0)) / 100;
      out.online = { location: Object.entries(L.PACKAGES).map(([k, v]) => ({ key: k, name: v.name, desc: v.desc, price_czk: kc(v.amount) })), finder: Object.entries(L.FINDER_PRICES).map(([k, a]) => ({ key: k, name: 'Vyhledávač míst – ' + k, price_czk: kc(a) })), addons: Object.entries(L.EVAL_PACKS).map(([k, v]) => ({ key: k, name: v.name, price_czk: kc(v.amount) })) };
      out.source_note += 'Online ceny = výchozí z kódu BS2 (živý ceník nedostupný). ';
    } catch (e) { out.source_note += 'Online ceník nenačten. '; }
  }
  return out;
}

const BS2_HUB = 'BEST SERIES 2.0 (www.bestseries2.cz) JE STŘEDOBOD: každý zájemce si tam zakládá ÚČET a přihlašuje se – v účtu kupuje a používá online produkty (Prověření lokality, Vyhledávač míst, dokupy vyhodnocení/vyhledání), vidí své lokality a výsledky, komunikuje s podporou (chat s Best Series), rezervuje schůzku / prohlídku výroby a postupně dojde k nákupu prádlomatu. Funnel proto MUSÍ vést k vytvoření účtu v BS2 jako klíčové konverzi (účet = vlastní kontakt + souhlas + místo, kam se zákazník vrací) a e-maily/SMS mají zvát zpět do účtu. Záchytné stránky mohou být na bestseries2.cz (/location, /findlocation, nové stránky navrhni s URL na bestseries2.cz).';

// Generování po částech: 1) jádro (myšlenka, nabídka, čísla) ~1 min, 2) souběžně reklamy / stránky / sekvence.
// Každá hotová část se hned uloží (status 'generating') → UI ukazuje průběžný výsledek a po restartu serveru se pozná přerušení.
// Které klíče MUSÍ být pole / objekt (podle části) – model pak nevrací seznam jako jeden řetězec
const AI_SHAPES = {
  'Jádro': { arr: ['offer_stack', 'new_products', 'page_plan', 'kpis', 'risks'], obj: ['feasibility', 'projection'], str: ['name', 'big_idea', 'hook', 'channel_decision'] },
  'Reklamy': { arr: ['ads', 'remarketing'], obj: ['leadform'] },
  'SMS a e-maily': { arr: ['sequence', 'launch_plan'], obj: ['sales_process'] },
  'Úkoly': { arr: ['tasks', 'owner_questions'], obj: [] },
  'Stránka': { arr: ['sections', 'form_fields'], obj: [], str: ['name', 'headline', 'subheadline', 'cta'] },
  'Úprava': { arr: ['changed_sections'], obj: ['patch'], str: ['answer'] },
};
function shapeFor(label) { const k = Object.keys(AI_SHAPES).find((x) => String(label).indexOf(x) === 0); return k ? AI_SHAPES[k] : null; }
function toolFor(label) {
  const sh = shapeFor(label); if (!sh) return OUT_TOOL;
  const props = {}; sh.arr.forEach((k) => { props[k] = { type: 'array', items: { type: 'object', additionalProperties: true } }; }); sh.obj.forEach((k) => { props[k] = { type: 'object', additionalProperties: true }; });
  ['risks', 'form_fields', 'changed_sections'].forEach((k) => { if (props[k]) props[k] = { type: 'array', items: {} }; }); // pole textů
  (sh.str || []).forEach((k) => { props[k] = { type: 'string' }; });
  return Object.assign({}, OUT_TOOL, { input_schema: { type: 'object', properties: props, required: sh.arr.concat(sh.obj).concat(sh.str || []).filter((k) => !['leadform', 'form_fields', 'changed_sections', 'subheadline', 'channel_decision'].includes(k)), additionalProperties: true } });
}
// Oprava JSONu od AI: neescapovaná uvozovka uvnitř textu (za ní nenásleduje , : } ]) se escapuje; holé konce řádků v textu → \n
function repairJson(txt) {
  const t = String(txt || ''); let out = '', inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (c === '\\') { out += c + (t[i + 1] || ''); i++; continue; }
    if (c === '\n') { out += '\\n'; continue; } if (c === '\r') continue; if (c === '\t') { out += '\\t'; continue; }
    if (c === '"') { let j = i + 1; while (j < t.length && /\s/.test(t[j])) j++; const nx = t[j]; if (nx === undefined || nx === ',' || nx === ':' || nx === '}' || nx === ']') { out += c; inStr = false; } else out += '\\"'; continue; }
    out += c;
  }
  return out;
}
function parseLoose(txt) { try { return JSON.parse(txt); } catch (e) { return JSON.parse(repairJson(txt)); } }
// Záchrana poškozeného JSON textu (neescapované uvozovky v copy): vytáhne objekty {…} a v nich "klíč": "hodnota" / číslo
function salvageArray(txt) {
  const out = []; const t = String(txt || '');
  const chunks = t.split(/\}\s*,\s*\{/);
  chunks.forEach((c) => {
    const o = {}; const re = /"([A-Za-z_][\w]*)"\s*:\s*(?:"((?:[^"\\]|\\.|"(?!\s*[,}\]]))*)"|(-?\d+(?:\.\d+)?)|(\[[^\]]*\]))/g; let m;
    while ((m = re.exec(c))) { if (m[2] !== undefined) o[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"'); else if (m[3] !== undefined) o[m[1]] = Number(m[3]); else { try { o[m[1]] = JSON.parse(m[4]); } catch (e) { o[m[1]] = m[4]; } } }
    if (Object.keys(o).length) out.push(o);
  });
  return out;
}
// Kontrola tvaru: pole musí být pole (řetězec s platným JSONem se rozparsuje, jinak = chyba → nový pokus)
function checkShape(out, label) {
  const sh = shapeFor(label); if (!sh || !out) return out;
  if (label === 'Jádro' && !String(out.big_idea || '').trim()) throw Object.assign(new Error('Jádro: chybí velká myšlenka'), { parse: true });
  sh.arr.concat(sh.obj).forEach((k) => {
    let v = out[k]; if (typeof v === 'string') { try { v = parseLoose(v); out[k] = v; } catch (e) { const sv = sh.arr.includes(k) ? salvageArray(v) : []; if (sv.length) { v = sv; out[k] = sv; out.__salvaged = (out.__salvaged || []).concat([k]); } else throw Object.assign(new Error(label + ': pole „' + k + '" přišlo jako poškozený text'), { parse: true }); } }
    if (v != null && sh.arr.includes(k) && !Array.isArray(v)) out[k] = typeof v === 'object' ? Object.values(v) : [v];
    if (Array.isArray(out[k]) && out[k].length === 1 && typeof out[k][0] === 'string' && /^\s*[\[{]/.test(out[k][0])) { try { const x = parseLoose(out[k][0]); out[k] = Array.isArray(x) ? x : [x]; } catch (e) { const sv = salvageArray(out[k][0]); if (sv.length) out[k] = sv; else throw Object.assign(new Error(label + ': pole „' + k + '" přišlo jako poškozený text'), { parse: true }); } }
  });
  return out;
}
// Živý náhled toho, co AI právě píše (pro UI během připomínky): key → { text, at }
const LIVE = {};
function liveSet(key, chunk) { const L = LIVE[key] || (LIVE[key] = { text: '', at: 0 }); L.text = (L.text + chunk).slice(-4000); L.at = Date.now(); }
function liveGet() { const out = {}; Object.keys(LIVE).forEach((k) => { if (Date.now() - LIVE[k].at < 120000) out[k] = LIVE[k].text.slice(-700); }); return out; }
function liveClear(prefix) { Object.keys(LIVE).forEach((k) => { if (!prefix || k.indexOf(prefix) === 0) delete LIVE[k]; }); }
async function aiJson(client, system, prompt, maxTokens, label, liveKey) {
  try { return await aiJsonOnce(client, system, prompt, maxTokens, label, liveKey); }
  catch (e) { if (!e.parse) throw e; return aiJsonOnce(client, system, prompt + (e.truncated ? '\n\nPIŠ STRUČNĚJI – předchozí odpověď byla příliš dlouhá.' : '\n\nPOZOR: vrať STRIKTNĚ platný JSON – uvozovky uvnitř textů piš jako „ “ nebo escapuj \\", žádné komentáře ani text mimo JSON.'), e.truncated ? Math.min(maxTokens * 2, 48000) : maxTokens, label, liveKey); } // usekla se / neplatný JSON → 1× znovu // usekla se → 1× znovu s vyšším limitem
}
// Výstup jako volání nástroje „vystup" → API vrátí hotový objekt (žádné ruční parsování JSONu z textu, který rozbíjejí uvozovky v copy)
// Model občas vloží pole/objekt jako řetězec s JSONem → rozparsovat (rekurzivně)
function deepParse(v, d) {
  d = d || 0; if (d > 8) return v;
  if (typeof v === 'string') { const t = v.trim(); if ((t[0] === '[' && t.endsWith(']')) || (t[0] === '{' && t.endsWith('}'))) { try { return deepParse(parseLoose(t), d + 1); } catch (e) { return v; } } return v; }
  if (Array.isArray(v)) return v.map((x) => deepParse(x, d + 1));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = deepParse(v[k], d + 1); }); return o; }
  return v;
}
const OUT_TOOL = { name: 'vystup', description: 'Odevzdej výsledek jako jeden objekt přesně podle struktury popsané v zadání (sekce VÝSTUP).', input_schema: { type: 'object', additionalProperties: true } };
async function aiJsonOnce(client, system, prompt, maxTokens, label, liveKey) {
  let r; try { const st = client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, tools: [toolFor(label)], tool_choice: { type: 'tool', name: 'vystup' }, messages: [{ role: 'user', content: prompt + '\n\nVýsledek odevzdej voláním nástroje „vystup" (objekt se strukturou ze sekce VÝSTUP).' }] }); if (liveKey) { liveSet(liveKey, ''); st.on('streamEvent', (ev) => { if (ev && ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'input_json_delta') liveSet(liveKey, ev.delta.partial_json || ''); }); } r = await st.finalMessage(); }
  catch (e) { throw new Error(label + ': chyba AI – ' + String(e.message || e).slice(0, 200)); }
  const tu = (r.content || []).find((c) => c.type === 'tool_use' && c.input && typeof c.input === 'object');
  if (tu && Object.keys(tu.input).length) return scrub(checkShape(deepParse(tu.input), label));
  // záloha: kdyby model přece jen napsal text
  const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); return scrub(checkShape(parseLoose(raw.slice(a, b + 1)), label)); }
  catch (e) {
    console.warn('[ads-director] ' + label + ' – neplatný výstup (stop=' + r.stop_reason + '):', raw.slice(0, 300).replace(/\s+/g, ' '));
    throw Object.assign(new Error(label + ': ' + (r.stop_reason === 'max_tokens' ? 'odpověď AI se usekla' : 'neplatná odpověď AI')), { truncated: r.stop_reason === 'max_tokens', parse: true });
  }
}
async function invent(opts) {
  if (!deps) throw new Error('Ředitel není inicializovaný');
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const goals = await getGoals(); const brief = String((opts || {}).brief || '').slice(0, 2000);
  const inv = await inventory(); const m = await metrics(30);
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const GOALS = 'CÍLE MAJITELE (závazné):\n- prodávat stabilně ' + goals.machines_per_week + ' prádlomaty TÝDNĚ (90 % prodejů se uzavírá na osobní schůzce nebo prohlídce výroby),\n- během ' + goals.online_days + ' dní vydělat na doplňkovém prodeji ONLINE produktů ' + Number(goals.online_net_czk).toLocaleString('cs-CZ') + ' Kč ČISTÉHO (po odečtení reklamy),\n' + (goals.budget_czk_day ? '- rozpočet na reklamu: ' + goals.budget_czk_day + ' Kč/den,\n' : '- rozpočet na reklamu navrhni sám (dnes ~5 800 Kč/den),\n') + (goals.note ? '- poznámka majitele: ' + goals.note + '\n' : '') + (brief ? '- doplňující zadání: ' + brief + '\n' : '');
  const CAT = await catalog(goals.machine_types);
  const PRICES = '\n\nCENÍK:\nPRÁDLOMATY – v nabídce jsou PŘESNĚ tyto typy (CZ/SK = stejný stroj pro dva trhy). V nabídkovém žebříku nabídni VŠECHNY tyto typy (každý jako možnost pro jiného zákazníka) a ŽÁDNÝ JINÝ. Ceny jsou STRIKTNĚ ZÁVAZNÉ (Kč bez DPH), nic nezaokrouhluj, žádné slevy na stroj: ' + JSON.stringify(CAT.machines).slice(0, 7000) + '\nONLINE PRODUKTY – dnes existují DVA: (1) Prověření / zhodnocení místa (aplikace Prověření lokality) a (2) Vyhledání místa (aplikace Vyhledávač míst); dnešní balíčky a ceny v BS2 (Kč vč. DPH) jsou jen VÝCHOZÍ STAV: ' + JSON.stringify(CAT.online || {}).slice(0, 4000) + '\nU ONLINE PRODUKTŮ máš VOLNOU RUKU: nastav ceny, balíčky, order bumpy, upselly a bonusy tak, aby se co nejlépe prodávaly a splnily cíl (cenu zdůvodni). DALŠÍ ONLINE PRODUKTY MUSÍŠ NAVRHNOUT A VYMYSLET: kromě těchto dvou navrhni 2–4 NOVÉ online produkty / služby, které dávají smysl zájemcům o prádlomat (a vydělávají ještě před prodejem stroje), a každý detailně vymysli – co přesně zákazník dostane, jak to funguje v jeho účtu v BS2, z jakých dat/nástrojů to vzniká, cenu a balíčky, proč to koupí a co je potřeba vyvinout (zadání pro programátora). V offer_stack je označ „(NOVÝ)". Když měníš cenu existujícího balíčku, uveď v promise/why_buy „dnes X Kč → navrhuji Y Kč".' + (CAT.source_note ? '\nPozn.: ' + CAT.source_note : '') + '\n\nCENA PRÁDLOMATU SE ZÁKAZNÍKOVI NEŘÍKÁ PŘED OSOBNÍ SCHŮZKOU: v reklamách, na stránkách, v SMS ani e-mailech NIKDY neuváděj cenu stroje (ani „od X Kč“, ani rozmezí). Místo toho: „cenu, konfiguraci a financování připravíme na osobní schůzce / prohlídce výroby“. Ceny strojů používej JEN interně (projekce, výpočty, offer_stack pro majitele s poznámkou „interní – sděluje se na schůzce“). Online produkty se svými cenami komunikovat smíš.\n\n' + BS2_HUB + '\n';
  const F = { status: 'generating', parts: {}, part_errors: {}, started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), goals, brief: brief || null, catalog: CAT };
  const save = () => { F.heartbeat_at = new Date().toISOString(); return setJ(KEY_INVENT, F, 'Marketingový ředitel – vymyšlený funnel'); };
  await save();
  // Tep: dokud úloha žije, každých 20 s obnoví heartbeat_at → UI pozná skutečný restart serveru (tep přestane)
  const beat = setInterval(() => { save().catch(() => {}); }, 20000);
  try {

  // 1) Jádro
  const core = await aiJson(client, INVENT_SYSTEM, GOALS + PRICES
    + '\nDNEŠNÍ STAV (jen pro poučení – NEKOPÍRUJ ho; dnešní cesta „FB reklama → rychlý formulář → e-mail/SMS s odkazem" je prodělečná):\nINVENTÁŘ: ' + JSON.stringify(inv).slice(0, 12000) + '\nČÍSLA ZA 30 DNÍ: ' + JSON.stringify(m).slice(0, 10000)
    + '\n\nÚKOL (krok 1 ze 2): vymysli JÁDRO nového funnelu od nuly: velkou myšlenku, háček, nabídkový žebřík online produktů s cenami (online produkty = zhodnocení místa a vyhledání místa – ceny a balíčky navrhni volně, aby prodávaly; navrhni a vymysli i 2–4 NOVÉ online produkty (pole new_products) a zařaď je do žebříku s označením „(NOVÝ)"; prádlomaty VÝHRADNĚ s cenami z ceníku), cestu zákazníka (jaké stránky funnel potřebuje), poctivou proveditelnost a projekci čísel.\n'
    + 'VÝSTUP: pouze JSON bez Markdownu:\n{"name":"krátký název","big_idea":"1–2 věty","hook":"hlavní háček / slib","feasibility":{"verdict":"realné|náročné|nereálné v daném čase","math":"výpočet s čísly","what_it_takes":[""],"adjusted_goal":""},"offer_stack":[{"name":"","type":"vstupní|bump|upsell|prémiový|rezervace|schůzka|prádlomat","price_czk":0,"promise":"","contents":[""],"why_buy":"","expected_take_rate":""}],"new_products":[{"name":"název (NOVÝ)","for_whom":"komu","problem":"jaký problém řeší","what_customer_gets":["co přesně dostane"],"how_it_works":"jak funguje v účtu BS2 krok za krokem","data_sources":"z čeho vzniká (data, nástroje, člověk)","packages":[{"name":"","price_czk":0,"includes":""}],"why_sells":"proč se bude prodávat","role_in_funnel":"kde v cestě k prádlomatu ho nabídnout","build_effort":"nízká|střední|vysoká","build_spec":"zadání pro programátora (co vyvinout v BS2/HolyOS)"}],"page_plan":[{"id":"p1","type":"záchytná|prodejní|důvěra|děkovací|rezervace","name":"","purpose":"","next":"p2"}],"channel_decision":"rychlý formulář vs. záchytná stránka – rozhodnutí a proč","projection":{"days":' + goals.online_days + ',"spend_czk":0,"visitors":0,"leads":0,"online_orders":0,"online_revenue_czk":0,"online_net_czk":0,"meetings_per_week":0,"machines_per_week":0,"calc":"výpočet krok za krokem","assumptions":[""]},"kpis":[{"metric":"","target":"","why":""}],"risks":[""]}\nČísla jsou čísla. Texty stručné a úderné (calc max ~8 řádků, ostatní pole 1–3 věty; u new_products how_it_works a build_spec klidně 3–6 vět). Česky.', 20000, 'Jádro');
  Object.assign(F, core); F.parts.core = true; await save();

  const CTX = GOALS + PRICES + '\nJÁDRO FUNNELU (už rozhodnuto, drž se ho):\n' + JSON.stringify({ name: core.name, big_idea: core.big_idea, hook: core.hook, offer_stack: core.offer_stack, new_products: (core.new_products || []).map((x) => ({ name: x.name, what_customer_gets: x.what_customer_gets, packages: x.packages, why_sells: x.why_sells })), page_plan: core.page_plan, channel_decision: core.channel_decision, projection: core.projection }).slice(0, 9000) + '\n\n';
  const pageIds = (core.page_plan || []).map((p) => p.id).join(', ');
  const parts = [
    ['ads', 'Reklamy', 14000, CTX + 'ÚKOL (krok 2a): napiš 3–5 FB reklam s HOTOVÝM textem a remarketing (3–4 okruhy). U každé reklamy rozhodni, jestli má být s VLASTNÍM fotem/videem majitele (výroba, stroje, reální provozovatelé, majitel mluví do kamery – výrazně důvěryhodnější) nebo stačí grafika, a napiš media_brief jako přesný natáčecí/fotografický scénář (záběr po záběru), aby to majitel natočil telefonem bez agentury. destination/link_page = id stránky z page_plan (' + pageIds + ') nebo "leadform".\nVÝSTUP: pouze JSON:\n{"ads":[{"id":"ad1","name":"","angle":"","audience":"cílení","format":"video|obrázek|carousel","creative_brief":"scéna po scéně / co je na obrázku","primary_text":"plný text","headline":"","description":"","cta_button":"","destination":"p1","why_destination":"","budget_czk_day":0,"media_brief":{"who_makes":"majitel (vlastní foto/video – důvěryhodnější) | ředitel/grafik (stačí grafika)","type":"video|foto|carousel","format":"9:16 Reels/Stories | 4:5 feed | 1:1","duration_s":0,"goal":"co má záběr vyvolat","shots":[{"time":"0–3 s","shot":"co je v záběru (kde, kdo, detail/celek)","text_on_screen":"titulek","voice":"co se říká"}],"location":"kde natáčet/fotit","people":"kdo v záběru","props":"co připravit","style":"světlo, kamera z ruky/stativ, hudba, titulky","tips":"na co si dát pozor"}}],"leadform":{"use":false,"why":"","questions":[]},"remarketing":[{"audience":"","window":"","angle":"","text":"","link_page":"p1","budget_czk_day":0}]}'],
    ['sequence', 'SMS a e-maily', 16000, CTX + 'ÚKOL (krok 2c): napiš sekvenci 12–18 SMS a e-mailů po získání kontaktu s HOTOVÝMI texty (SMS max 300 znaků), podmínkami komu, odkazem na stránku z page_plan (' + pageIds + '); dál prodejní proces na schůzce/prohlídce výroby a plán spuštění po dnech.\nVÝSTUP: pouze JSON:\n{"sequence":[{"id":"m1","day":"D0 +5 min","channel":"sms|email","condition":"","subject":"","text":"","link_page":"p2","goal":""}],"sales_process":{"meeting":"","closing":"","follow_up":"","capacity":""},"launch_plan":[{"when":"den 1","what":""}]}'],
    ['tasks', 'Úkoly', 10000, CTX + 'ÚKOL (krok 2d): rozděl práci na spuštění a provoz funnelu na ÚKOLY. CO UMÍ ŘEDITEL SÁM (v HolyOS): napsat a upravit texty reklam, stránek, SMS a e-mailů; vygenerovat náhledy stránek (HTML); založit koncept funnelu v Centru reklamy; založit POZASTAVENÉ reklamy na FB (text, odkaz, rozpočet; s nahranými fotkami/videi majitele); vyhodnocovat čísla, navrhovat úpravy, připravit zadání pro programátora. CO MUSÍ MAJITEL (ředitel to neumí/nesmí): natočit videa a nafotit fotky (výroba, stroje, provozovny, reference), dodat reference a čísla provozovatelů, schválit ceny a nabídky, zapnout reklamy a rozesílky, nastavit Pixel/CAPI a oprávnění, rozhodnout o rozpočtu, vést schůzky a prohlídky výroby, právní věci (souhlasy, podmínky), dát programátorovi pokyn k vývoji nových produktů. Úkoly seřaď podle priority a návaznosti. Dál vypiš OTÁZKY na majitele – informace, které ředitel potřebuje, aby funnel byl co nejpřesnější (reference, skutečné tržby provozoven, kapacita schůzek, marže, garance…).\nVÝSTUP: pouze JSON:\n{"tasks":[{"who":"ředitel|majitel","priority":1,"title":"","why":"","how":"jak přesně (kroky)","when":"den 1","output":"co má vzniknout","depends_on":"na čem závisí"}],"owner_questions":[{"question":"","why":"k čemu to ředitel potřebuje"}]}'],
  ];
  // Stránky: každá zvlášť (menší JSON = spolehlivější a rychlejší, běží souběžně)
  const plan = (core.page_plan || []).slice(0, 7); F.pages = plan.map((p) => Object.assign({}, p, { pending: true }));
  const pageJobs = plan.map((pp, i) => aiJson(client, INVENT_SYSTEM, CTX + 'ÚKOL (krok 2b): napiš JEDNU stránku funnelu – id "' + pp.id + '" (' + (pp.type || '') + ': ' + (pp.name || '') + ' – ' + (pp.purpose || '') + '). Přesně jak má vypadat: hotové prodejní texty všech sekcí shora dolů (hero, problém, řešení, důkazy, nabídka s value stackem a SKUTEČNÝMI cenami z ceníku, garance, FAQ, výzva), formulář (u registrace účet v BS2), CTA, vizuální styl.\nVÝSTUP: pouze JSON:\n{"id":"' + pp.id + '","type":"","slug":"https://www.bestseries2.cz/…","name":"","purpose":"","headline":"","subheadline":"","sections":[{"name":"","copy":"hotový text"}],"form_fields":[],"cta":"","offer":"","design":"","next":"' + (pp.next || '') + '","success_metric":""}', 9000, 'Stránka ' + (pp.name || pp.id))
    .then(async (res) => { F.pages[i] = Object.assign({}, pp, res, { id: pp.id }); await save(); })
    .catch(async (e) => { F.pages[i] = Object.assign({}, pp, { error: e.message }); F.part_errors['page_' + pp.id] = e.message; await save(); }));
  await Promise.all(parts.map(([key, label, max, prompt]) => aiJson(client, INVENT_SYSTEM, prompt, max, label)
    .then(async (res) => { Object.assign(F, res); F.parts[key] = true; await save(); })
    .catch(async (e) => { F.part_errors[key] = e.message; await save(); })).concat(pageJobs));
  F.pages = (F.pages || []).map((p) => { const { pending, ...rest } = p; return rest; });
  if (plan.length && !plan.some((pp) => F.part_errors['page_' + pp.id])) F.parts.pages = true;
  F.status = Object.keys(F.part_errors).length ? 'partial' : 'done'; F.generated_at = new Date().toISOString();
  const leaks = findPriceLeaks(F); F.price_leaks = leaks.length;
  await save();
  // Automatická oprava: cena stroje ve veřejných textech → ředitel ji odstraní (zapíše se do historie úprav)
  if (leaks.length) {
    try { await revise({ section: 'kontrola', auto: true, comment: 'AUTOMATICKÁ KONTROLA – ve veřejných textech je CENA PRÁDLOMATU, která se zákazníkovi smí říct až na osobní schůzce. Nalezeno:\n' + leaks.map((l) => '- [' + l.where + '] …' + l.snippet + '…').join('\n') + '\n\nOdstraň z reklam, stránek, SMS, e-mailů a remarketingu VŠECHNY ceny prádlomatů – i rozmezí, i v příkladech, kalkulačkách a referencích (např. „investice do prádlomatu“, „cenu a financování připravíme na osobní schůzce“). Ceny online produktů ponech. Interní projekci a offer_stack neměň. Nic jiného neměň.' }); }
    catch (e) { console.warn('[ads-director] autokontrola cen:', e.message); }
  }
  if (F.status === 'partial') throw new Error('Část se nepovedla: ' + Object.values(F.part_errors).join('; ') + ' – zbytek je uložený, zkus „Vymyslet" znovu.');
  return F;
  } catch (e) {
    if (F.status === 'generating') { F.status = 'failed'; F.error = e.message; await save().catch(() => {}); }
    throw e;
  } finally { clearInterval(beat); }
}

// Kontrola: cena prádlomatu nesmí být ve veřejných textech (reklamy, stránky, SMS/e-maily, remarketing)
function findPriceLeaks(F) {
  const prices = [...new Set(((F.catalog || {}).machines || []).map((m) => Number(m.price_czk_bez_dph)).filter((n) => n > 50000))];
  if (!prices.length) return [];
  const sep = '[\\s.\\u00a0]?';
  const pats = prices.map((n) => { const d = String(Math.round(n)); const g = d.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return g.split(',').join(sep); });
  pats.push('\\d+(?:[,.]\\d+)?\\s*mil(?:\\.|ion[ůuy]?)?\\s*(?:Kč|korun)'); // „1,25 mil. Kč“
  const re = new RegExp('(' + pats.join('|') + ')', 'gi');
  const out = [];
  const scan = (where, v) => { const t = typeof v === 'string' ? v : JSON.stringify(v || ''); let m; re.lastIndex = 0; while ((m = re.exec(t)) && out.length < 25) out.push({ where, snippet: t.slice(Math.max(0, m.index - 70), m.index + m[0].length + 30).replace(/\s+/g, ' ') }); };
  (F.ads || []).forEach((a) => scan('reklama ' + (a.name || a.id), [a.primary_text, a.headline, a.description, a.media_brief]));
  (F.pages || []).forEach((p) => scan('stránka ' + (p.name || p.id), [p.headline, p.subheadline, p.sections, p.offer, p.cta]));
  (F.sequence || []).forEach((m) => scan((m.channel || 'zpráva') + ' ' + (m.day || ''), [m.subject, m.text]));
  (F.remarketing || []).forEach((r) => scan('remarketing ' + (r.window || ''), [r.text, r.angle]));
  return out;
}

// ── Připomínka majitele k sekci → ředitel ji zapracuje a upraví i navazující sekce (vrací jen změněné klíče) ──
const SECTION_KEYS = { kontrola: 'reklamy, stránky, SMS/e-maily, remarketing (veřejné texty)', celek: 'celý funnel', jadro: 'big_idea, hook, feasibility', projekce: 'projection', nabidka: 'offer_stack', nove: 'new_products', ukoly: 'tasks, owner_questions', reklamy: 'ads, leadform', media: 'ads[].media_brief', stranky: 'pages', sekvence: 'sequence', remarketing: 'remarketing', prodej: 'sales_process', plan: 'launch_plan, kpis, risks', diagram: 'celý tok (ads → pages → sequence → schůzka)' };
const REVISABLE = ['name', 'big_idea', 'hook', 'feasibility', 'offer_stack', 'new_products', 'page_plan', 'channel_decision', 'projection', 'kpis', 'risks', 'ads', 'leadform', 'remarketing', 'pages', 'sequence', 'sales_process', 'launch_plan', 'tasks', 'owner_questions'];
async function revise(opts) {
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const section = String((opts || {}).section || 'celek'); const comment = String((opts || {}).comment || '').trim().slice(0, 4000);
  const item = (opts || {}).item && typeof opts.item === 'object' ? { key: String(opts.item.key || ''), id: String(opts.item.id || ''), label: String(opts.item.label || '').slice(0, 120) } : null;
  const itemOf = (F, it) => { const arr = Array.isArray(F[it.key]) ? F[it.key] : []; const ix = /^i\d+$/.test(it.id) ? parseInt(it.id.slice(1), 10) : -1; return arr.find((x) => x && String(x.id) === it.id) || (ix >= 0 ? arr[ix] : null); };
  if (!comment) throw new Error('Chybí připomínka');
  const F = await getJ(KEY_INVENT, null); if (!F || F.status === 'generating') throw new Error('Funnel ještě není hotový');
  const cur = {}; REVISABLE.forEach((k) => { if (F[k] !== undefined) cur[k] = k === 'pages' ? (F.pages || []).map((p) => { const { html, job, ...rest } = p; return rest; }) : F[k]; });
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  liveClear('rev');
  // Stránky: každá zvlášť a souběžně – hotová stránka se hned uloží (UI ji zobrazí bez obnovení)
  if ((section === 'stranky' || (item && item.key === 'pages')) && (F.pages || []).length) {
    const prevPages = cur.pages; const targetPages = item && item.key === 'pages' ? prevPages.filter((p) => String(p.id) === item.id) : prevPages; if (!targetPages.length) throw new Error('Stránka nenalezena'); const ctx = JSON.stringify({ name: F.name, big_idea: F.big_idea, hook: F.hook, offer_stack: F.offer_stack, page_plan: (F.pages || []).map((p) => ({ id: p.id, type: p.type, name: p.name, next: p.next })) }).slice(0, 12000);
    const done = []; const failed = [];
    const store = async (fn) => { const F3 = await getJ(KEY_INVENT, null); if (!F3) return; fn(F3); F3.rev_progress = { at: new Date().toISOString(), done: done.slice(), failed: failed.slice(), total: targetPages.length, only: item ? item.id : null }; await setJ(KEY_INVENT, F3, 'Marketingový ředitel – vymyšlený funnel'); };
    await store(() => {});
    await Promise.all(targetPages.map((pg) => aiJson(client, INVENT_SYSTEM, 'MAJITEL MÁ PŘIPOMÍNKU KE STRÁNKÁM FUNNELU:\n"""' + comment + '"""\n\nKONTEXT FUNNELU: ' + ctx + '\n\nPravidla: cenu prádlomatu NIKDY neuváděj (sděluje se až na osobní schůzce); online produkty smí mít ceny; BS2 je středobod.\n\nAKTUÁLNÍ STRÁNKA (JSON):\n' + JSON.stringify(pg).slice(0, 30000) + '\n\nÚKOL: připomínku zapracuj do TÉTO stránky (pokud se jí netýká, vrať ji beze změny). Pokud jde o VZHLED (barvy, rozložení, obrázky, animace…), obsah měň jen je-li třeba a požadavek stručně zapiš do pole „design“ – vizualizaci podle něj upraví další krok. Zachovej id „' + pg.id + '“. Texty sekcí piš čitelně (lze Markdown: ## nadpis, **tučně**, odrážky „- “).\nVÝSTUP: celá stránka {"id","type","slug","name","purpose","headline","subheadline","sections":[{"name","copy"}],"form_fields":[],"cta","offer","design","next","success_metric"}', 12000, 'Stránka ' + (pg.name || pg.id), 'rev:' + pg.id)
      .then(async (np) => { const oldPg = (F.pages || []).find((x) => x.id === pg.id) || {}; const hadHtml = !!oldPg.html; const same = JSON.stringify(np) === JSON.stringify(pg); np.design_notes = (pg.design_notes || []).concat([comment]).slice(-10); await store((F3) => { F3.pages = (F3.pages || []).map((p) => p.id === pg.id ? Object.assign({}, p, np, { id: pg.id }, same && p.html ? { html: p.html, html_at: p.html_at } : { html: undefined, html_at: undefined }) : p); }); delete LIVE['rev:' + pg.id];
        if (hadHtml) { try { liveSet('rev:' + pg.id, ' upravuji vzhled a vizualizaci stránky…'); await pagePreview(pg.id, { feedback: comment, base: oldPg.html }); } catch (e) { console.warn('[ads-director] vizualizace po úpravě:', e.message); } delete LIVE['rev:' + pg.id]; } // vizualizace se sama přegeneruje
        done.push(pg.id); await store(() => {}); })
      .catch(async (e) => { failed.push(pg.id + ': ' + e.message); await store(() => {}); delete LIVE['rev:' + pg.id]; })));
    const F4 = await getJ(KEY_INVENT, null);
    const answer = (item ? 'Stránku „' + (item.label || item.id) + '“ jsem upravil podle připomínky.' : 'Připomínku jsem zapracoval do ' + done.length + ' z ' + targetPages.length + ' stránek.') + (failed.length ? ' Nepovedlo se: ' + failed.join('; ') : '');
    F4.revisions = (F4.revisions || []).concat([{ at: new Date().toISOString(), section: item ? 'stránka: ' + (item.label || item.id) : section, comment, answer, changed: ['pages'] }]).slice(-50);
    F4.revised_at = new Date().toISOString(); F4.last_revision = { at: F4.revised_at, section, changed: ['pages'], prev: { pages: prevPages } }; delete F4.rev_progress;
    await setJ(KEY_INVENT, F4, 'Marketingový ředitel – vymyšlený funnel');
    return { answer, changed: ['pages'] };
  }
  const itemTxt = item ? '\n\nPŘIPOMÍNKA SE TÝKÁ KONKRÉTNÍ POLOŽKY v „' + item.key + '“ (id/pořadí ' + item.id + ', „' + item.label + '“):\n' + JSON.stringify(itemOf(cur, item) || {}).slice(0, 12000) + '\nUprav hlavně TUTO položku (zachovej její id); ostatní měň jen tam, kde to změna nutně vyžaduje (přesah).' : '';
  const prompt = 'MAJITEL MÁ PŘIPOMÍNKU K SEKCI „' + section + '" (' + (SECTION_KEYS[section] || section) + '):\n"""' + comment + '"""' + itemTxt + '\n\nAKTUÁLNÍ FUNNEL (JSON):\n' + JSON.stringify(cur).slice(0, 150000)
    + '\n\nCENÍK: ' + JSON.stringify(F.catalog || {}).slice(0, 8000) + '\nPravidla: ceny prádlomatů STRIKTNĚ z ceníku a jen typy z ceníku; cenu prádlomatu NIKDY neuváděj v reklamách, na stránkách, v SMS ani e-mailech (sděluje se až na osobní schůzce); online produkty lze naceňovat volně; BS2 je středobod (účet v BS2 = klíčová konverze).'
    + '\n\nÚKOL: Připomínku POCTIVĚ zapracuj. Když jde o otázku, odpověz na ni v poli "answer" a případně uprav obsah. Projdi i OSTATNÍ sekce – pokud změna má přesah (např. nová cena → projekce, texty reklam, stránky, SMS/e-maily, úkoly), uprav je také, aby celek zůstal konzistentní. Zachovej id položek (ad1, p1, m1…), ať navazují odkazy.\n'
    + 'VÝSTUP (nástroj vystup): {"answer":"stručná odpověď majiteli / co jsi změnil a proč (2–6 vět)","changed_sections":["seznam klíčů, které měníš"],"patch":{ "<klíč z funnelu>": <CELÁ nová hodnota toho klíče> }} – do patch dej JEN změněné klíče (vždy celou hodnotu klíče, ne kousek).';
  const out = await aiJson(client, INVENT_SYSTEM, prompt, 32000, 'Úprava', 'rev:all');
  delete LIVE['rev:all'];
  const patch = out && typeof out.patch === 'object' && out.patch ? out.patch : {};
  const F2 = await getJ(KEY_INVENT, null); if (!F2) throw new Error('Funnel zmizel');
  const changed = []; const prev = {};
  Object.keys(patch).forEach((k) => { if (!REVISABLE.includes(k)) return;
    prev[k] = k === 'pages' ? (F2.pages || []).map((p) => { const { html, job, ...rest } = p; return rest; }) : F2[k];
    if (k === 'pages' && Array.isArray(patch.pages)) { const old = {}; (F2.pages || []).forEach((p) => { old[p.id] = p; }); F2.pages = patch.pages.map((p) => { const o = old[p.id]; const same = o && JSON.stringify(Object.assign({}, o, { html: undefined, html_at: undefined, job: undefined })) === JSON.stringify(Object.assign({}, o, p, { html: undefined, html_at: undefined, job: undefined })); return Object.assign({}, p, o && same && o.html ? { html: o.html, html_at: o.html_at } : {}); }); }
    else if (k === 'ads' && Array.isArray(patch.ads)) { const old = {}; (F2.ads || []).forEach((a) => { old[a.id] = a; }); F2.ads = patch.ads.map((a) => Object.assign({}, a, old[a.id] && old[a.id].media ? { media: old[a.id].media } : {})); }
    else F2[k] = patch[k];
    changed.push(k); });
  F2.revisions = (F2.revisions || []).concat([{ at: new Date().toISOString(), section: item ? section + ': ' + (item.label || item.id) : section, comment: (opts && opts.auto) ? '🤖 Automatická kontrola: cena prádlomatu ve veřejných textech' : comment, answer: String(out.answer || '').slice(0, 3000), changed }]).slice(-50);
  if (opts && opts.auto) F2.price_leaks_after = findPriceLeaks(F2).length;
  F2.revised_at = new Date().toISOString();
  F2.last_revision = { at: F2.revised_at, section, changed, prev }; // pro zvýraznění změn v UI
  await setJ(KEY_INVENT, F2, 'Marketingový ředitel – vymyšlený funnel');
  return { answer: out.answer, changed };
}

// Náhled stránky funnelu: AI napíše kompletní HTML podle návrhu (uloží se k funnelu)
const DESIGN_SYSTEM_ROLE = 'Jsi špičkový webdesignér a front-end developer (úroveň Awwwards / Apple / Linear / Stripe). Tvoříš nádherné, moderní, konverzní landing pages v jednom HTML souboru: výrazná typografie, velkorysé mezery, vrstvené pozadí, jemné stíny a záře, precizní detaily, plynulé mikroanimace. Nikdy nevytváříš wireframe ani prázdné bloky – každá sekce je plně navržená s reálným obsahem. Vracíš jen čisté HTML bez Markdownu a bez ``` značek.';
// Očištění HTML od AI: ```html obal, text před/za dokumentem
function cleanHtml(t) {
  let h = String(t || '').replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const a = h.search(/<!doctype html|<html[\s>]/i); const b = h.toLowerCase().lastIndexOf('</html>');
  if (a >= 0) h = h.slice(a, b > a ? b + 7 : undefined);
  return h.trim();
}
// Průběžné HTML náhledu stránky (UI ukazuje, jak stránka vzniká)
const PV_LIVE = {};
function pvLive(pid) { const L = PV_LIVE[pid]; if (!L) return null; return { started: L.started, chars: L.html.length, done: !!L.done, model: L.model || null, html: cleanHtml(L.html) }; }
async function pagePreview(pageId, opts) {
  opts = opts || {};
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const F = await getJ(KEY_INVENT, null); if (!F) throw new Error('Funnel ještě není vymyšlený');
  const p = (F.pages || []).find((x) => x.id === pageId); if (!p) throw new Error('Stránka nenalezena');
  const offers = (F.offer_stack || []).map((o) => ({ name: o.name, price_czk: o.price_czk, promise: o.promise, contents: o.contents }));
  let logo = ''; try { logo = require('../../apps/bs2/logo').logoSvg(40, 'bsl'); } catch (e) { logo = ''; }
  const BS2_DESIGN = 'DESIGN SYSTÉM BEST SERIES 2.0 (drž se ho přesně – stránka musí vypadat jako součást www.bestseries2.cz):\n'
    + '- Tmavé futuristické „vesmírné“ téma. CSS proměnné: --bg:#04060c; --card:rgba(14,22,40,.72); --card2:rgba(8,13,26,.85); --border:rgba(120,160,255,.14); --border2:rgba(120,160,255,.28); --text:#eaf2ff; --text2:#8ea2c2; --text3:#58698a; --accent:#1e86e0; --accent2:#4fd1ff (azurová); --vio:#7c5cff; --ok:#2fe3a0; --err:#ff5d6c; zlatý akcent #fbbf24 jen střídmě.\n'
    + '- Písmo Inter (Google Fonts, váhy 400–800), body 15px/1.5, velké tučné nadpisy (clamp 32–56px, 800, letter-spacing -.02em), gradientový text u klíčových slov (linear-gradient(90deg,#4fd1ff,#3a6cf5,#7c5cff) + background-clip:text).\n'
    + '- Pozadí: --bg + jemné aurory (radial-gradient azurová/fialová s nízkou opacitou, pomalu se pohybující animací) + decentní hvězdné pole/mřížka.\n'
    + '- Karty: background var(--card); border 1px solid var(--border); border-radius 16–24px; backdrop-filter: blur(14px); box-shadow 0 20px 60px rgba(0,0,0,.35); při hoveru jemné zvednutí a zářící okraj (--border2 + glow azurová).\n'
    + '- Hlavní tlačítko: background linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff); color #fff; border-radius 12px; padding 14px 22px; font-weight 700; box-shadow 0 10px 28px rgba(58,108,245,.35); jemně pulzující záře; sekundární tlačítko průhledné s okrajem --border2.\n'
    + '- Pilulky/štítky: border-radius 999px, tmavé pozadí, azurový text, malé ikonky.\n'
    + '- Hlavička: logo Best Series 2.0 (SVG níže) + „Best Series 2.0“ + vpravo „Přihlásit se“ a tlačítko „Vytvořit účet“; patička tmavá s odkazy (Prověření lokality, Vyhledávač míst, Podpora, Obchodní podmínky).\n'
    + 'LOGO (vlož přesně toto SVG): ' + logo.replace(/\s+/g, ' ') + '\n'
    + 'SKUTEČNÉ OBRÁZKY, které smíš použít (absolutní URL): https://www.bestseries2.cz/img/pradlomat.webp (prádlomat – samoobslužná prádelna v kontejneru), https://www.bestseries2.cz/img/pradlomat-mini.webp (prádlomat MINI). Dej jim „glow“ podsvícení, plovoucí animaci a odlesk.\n'
    + 'Další vizuály vytvoř JAKO INLINE SVG ILUSTRACE (žádné cizí URL): mapa s piny a pulzujícím kruhem spádové oblasti, semafor lokality (zelená/oranžová/červená), graf návratnosti, ikonky (pračka, mince, lokalita, kalendář, štít/garance), mockup telefonu/notebooku s aplikací BS2 (skóre lokality, mapa). Fotky lidí a provozoven, které natočí majitel, zobraz jako elegantní rámeček s gradientem, ikonou a popisem „Foto: …“; video jako přehrávač s velkým tlačítkem ▶ a popisem scény.\n'
    + 'DŮLEŽITÉ: veškerý obsah MUSÍ být viditelný i bez JavaScriptu – animace náběhu dělej tak, že prvky skryje až skript (např. přidá html třídu .js a teprve pak .reveal{opacity:0}); žádný obsah nesmí zůstat neviditelný.\n'
    + 'ANIMACE (CSS + malý inline JS, žádné knihovny): náběh sekcí při scrollu (IntersectionObserver, fade+slide), počítadla čísel, pulzující CTA, plovoucí prvky, animované kreslení SVG čar (stroke-dashoffset), jemný parallax aurory, hover efekty karet; respektuj prefers-reduced-motion.\n'
    + 'Formuláře jen vizuálně (action="#", submit zobrazí ukázkovou hlášku). Sticky CTA lišta na mobilu. Plně responzivní (mobil 390px i desktop 1440px), max-width obsahu ~1120px.\n';
  const notes = (p.design_notes || []).filter(Boolean);
  const NOTES = notes.length ? '\nTRVALÉ POŽADAVKY MAJITELE NA TUTO STRÁNKU (vzhled i obsah – vždy dodrž):\n' + notes.map((n, i) => (i + 1) + '. ' + String(n).slice(0, 800)).join('\n') + '\n' : '';
  const base = opts.base && /<html/i.test(opts.base) ? String(opts.base) : '';
  if (base && opts.feedback) {
    var editPrompt = 'UPRAV EXISTUJÍCÍ HTML STRÁNKU podle připomínky majitele. Připomínka může mířit na VZHLED (barvy, rozložení, velikosti, obrázky, ilustrace, animace, pořadí sekcí, styl tlačítek…) i na TEXTY. Proveď ji přesně a viditelně; co připomínka nežádá, NEMĚŇ (zachovej design system Best Series 2.0, strukturu a animace). Texty sjednoť s aktuální verzí stránky (JSON níže).\n\nPŘIPOMÍNKA:\n"""' + String(opts.feedback).slice(0, 3000) + '"""\n' + NOTES + '\n' + BS2_DESIGN + '\nPRAVIDLO: cenu prádlomatu NIKDY neuváděj.\n\nAKTUÁLNÍ OBSAH STRÁNKY (JSON): ' + JSON.stringify(p).slice(0, 12000) + '\n\nSTÁVAJÍCÍ HTML:\n' + base.slice(0, 90000) + '\n\nVrať POUZE celé upravené HTML od <!DOCTYPE html> po </html>.';
  }
  const prompt = editPrompt || 'Vytvoř KOMPLETNÍ, produkčně vypadající a REALISTICKOU HTML stránku (jeden soubor, inline CSS a JS, Google Fonts smí). Musí vypadat jako hotový web od špičkového studia – ne wireframe. Texty z návrhu převeď do skutečného designu (Markdown značky jako ## nebo ** nesmí být vidět). Česky.\n\n' + BS2_DESIGN + '\nPRAVIDLO: cenu prádlomatu (stroje) NIKDY neuváděj – sděluje se až na osobní schůzce; ceny online produktů uvádět smíš.\n\nFUNNEL: ' + F.name + ' — ' + (F.big_idea || '') + '\nHÁČEK: ' + (F.hook || '') + '\nNABÍDKY (online produkty): ' + JSON.stringify(offers.filter((o) => !/prádlomat/i.test(o.name || ''))).slice(0, 4000) + NOTES + '\n\nSTRÁNKA: ' + JSON.stringify(p).slice(0, 14000) + '\n\nVrať POUZE HTML od <!DOCTYPE html> po </html>.';
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const PV = PV_LIVE[pageId] = { html: '', started: Date.now(), done: false };
  // Vizualizace kreslí nejsilnější model (kvalita jako v chatu s Claude); když ho API klíč nemá, záloha Sonnet
  const models = [process.env.DIRECTOR_DESIGN_MODEL || 'claude-opus-5-5', 'claude-opus-4-6', 'claude-sonnet-4-6'].filter((m, i, a) => a.indexOf(m) === i);
  let r = null, lastErr = null;
  try {
    for (const model of models) {
      try { PV.html = ''; PV.model = model; const st = client.messages.stream({ model, max_tokens: 32000, system: DESIGN_SYSTEM_ROLE, messages: [{ role: 'user', content: prompt }] }); st.on('text', (t) => { PV.html += t; }); r = await st.finalMessage(); break; }
      catch (e) { lastErr = e; const m = String(e && (e.message || e.status || '')); if (!/model|not[_ ]found|404|permission|access/i.test(m)) throw e; console.warn('[ads-director] model ' + model + ' nedostupný, zkouším další'); }
    }
    if (!r) throw lastErr || new Error('Žádný model není dostupný');
  } finally { PV.done = true; setTimeout(() => { if (PV_LIVE[pageId] === PV) delete PV_LIVE[pageId]; }, 120000); }
  let html = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  html = cleanHtml(html);
  if (!/<html/i.test(html)) throw new Error('AI nevrátila HTML');
  const F2 = await getJ(KEY_INVENT, null); const p2 = F2 && (F2.pages || []).find((x) => x.id === pageId); if (!p2) throw new Error('Funnel se mezitím změnil');
  p2.html = html; p2.html_at = new Date().toISOString();
  await setJ(KEY_INVENT, F2, 'Marketingový ředitel – vymyšlený funnel');
  return { ok: true, html_at: p2.html_at };
}

module.exports = { init, register, strategy, getStrategy, run, reports, status, start, inventory, fingerprint, diff, invent, getInvent, getGoals, setGoals, pagePreview, revise, machineTypes, liveGet, pvLive, KEY_INVENT };
