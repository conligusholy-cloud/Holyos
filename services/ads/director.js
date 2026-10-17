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
function start() { if (start._on) return; start._on = true; setTimeout(tick, 90 * 1000); setInterval(tick, 20 * 60 * 1000); }


// ── 5) VYMYSLET NOVÝ FUNNEL: kreativní ředitel navrhne celý systém od nuly podle cílů majitele ──
const KEY_GOALS = 'ads_director.goals';
const KEY_INVENT = 'ads_director.invent';
const GOALS_DEFAULT = { machines_per_week: 3, online_net_czk: 5000000, online_days: 14, budget_czk_day: 0, note: '' };
async function getGoals() { return Object.assign({}, GOALS_DEFAULT, await getJ(KEY_GOALS, {})); }
async function setGoals(g) {
  const v = { machines_per_week: Math.max(0, Number(g.machines_per_week) || 0), online_net_czk: Math.max(0, Number(g.online_net_czk) || 0), online_days: Math.max(1, parseInt(g.online_days, 10) || 14), budget_czk_day: Math.max(0, Number(g.budget_czk_day) || 0), note: String(g.note || '').slice(0, 1500) };
  await setJ(KEY_GOALS, v, 'Marketingový ředitel – cíle majitele'); return v;
}
async function getInvent() { return scrub(await getJ(KEY_INVENT, null)); }

const INVENT_SYSTEM = 'Jsi kreativní marketingový ředitel a špičkový direct-response marketér (úroveň Russell Brunson / Alex Hormozi / Dan Kennedy, ale na český trh). Stavíš FUNNELY, které prodávají: silná velká myšlenka (big idea), neodolatelná nabídka (value stack, bonusy, garance, omezení), háčky do reklam, copywriting, který zastaví palec, a následné sekvence, které dovedou člověka k nákupu. Nejsi úředník, který popisuje stav – jsi stratég, který VYMÝŠLÍ a ROZHODUJE. Píšeš hotové texty (reklamy, stránky, SMS, e-maily) připravené k použití, ne osnovy. Firma: Best Series – prádlomaty (samoobslužné prádelny v kontejneru / v prostoru; prodej strojů, financování/leasing, servis, díly) a online aplikace Prověření lokality a Vyhledávač míst; weby bestseries2.cz, pradlomaty.info, compounder.world. Jiný projekt Špagetka/Špageta pro tebe neexistuje. Buď ale POCTIVÝ v číslech: kreativní v nabídce, realistický v matematice. Když je cíl v daném čase nereálný, řekni to rovnou, spočítej proč a navrhni, co by ho reálně splnilo (jiná cena, jiný produkt, jiné publikum, jiný čas). Vše česky.';

// Generování po částech: 1) jádro (myšlenka, nabídka, čísla) ~1 min, 2) souběžně reklamy / stránky / sekvence.
// Každá hotová část se hned uloží (status 'generating') → UI ukazuje průběžný výsledek a po restartu serveru se pozná přerušení.
async function aiJson(client, system, prompt, maxTokens, label) {
  const r = await client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }).finalMessage();
  const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); return scrub(JSON.parse(raw.slice(a, b + 1))); }
  catch (e) { throw new Error(label + ': ' + (r.stop_reason === 'max_tokens' ? 'odpověď AI se usekla' : 'neplatná odpověď AI')); }
}
async function invent(opts) {
  if (!deps) throw new Error('Ředitel není inicializovaný');
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const goals = await getGoals(); const brief = String((opts || {}).brief || '').slice(0, 2000);
  const inv = await inventory(); const m = await metrics(30);
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const GOALS = 'CÍLE MAJITELE (závazné):\n- prodávat stabilně ' + goals.machines_per_week + ' prádlomaty TÝDNĚ (90 % prodejů se uzavírá na osobní schůzce nebo prohlídce výroby),\n- během ' + goals.online_days + ' dní vydělat na doplňkovém prodeji ONLINE produktů ' + Number(goals.online_net_czk).toLocaleString('cs-CZ') + ' Kč ČISTÉHO (po odečtení reklamy),\n' + (goals.budget_czk_day ? '- rozpočet na reklamu: ' + goals.budget_czk_day + ' Kč/den,\n' : '- rozpočet na reklamu navrhni sám (dnes ~5 800 Kč/den),\n') + (goals.note ? '- poznámka majitele: ' + goals.note + '\n' : '') + (brief ? '- doplňující zadání: ' + brief + '\n' : '');
  const F = { status: 'generating', parts: {}, part_errors: {}, started_at: new Date().toISOString(), goals, brief: brief || null };
  const save = () => setJ(KEY_INVENT, F, 'Marketingový ředitel – vymyšlený funnel');
  await save();

  // 1) Jádro
  const core = await aiJson(client, INVENT_SYSTEM, GOALS
    + '\nDNEŠNÍ STAV (jen pro poučení – NEKOPÍRUJ ho; dnešní cesta „FB reklama → rychlý formulář → e-mail/SMS s odkazem" je prodělečná):\nINVENTÁŘ: ' + JSON.stringify(inv).slice(0, 12000) + '\nČÍSLA ZA 30 DNÍ: ' + JSON.stringify(m).slice(0, 10000)
    + '\n\nÚKOL (krok 1 ze 2): vymysli JÁDRO nového funnelu od nuly: velkou myšlenku, háček, nabídkový žebřík online produktů s cenami (i produkty, které dnes neexistují – tak, aby se cíl čistého zisku dal reálně spočítat: vstupní produkt, order bump, upsell, prémiová služba, rezervace prádlomatu se zálohou, VIP prohlídka výroby…), cestu zákazníka (jaké stránky funnel potřebuje), poctivou proveditelnost a projekci čísel.\n'
    + 'VÝSTUP: pouze JSON bez Markdownu:\n{"name":"krátký název","big_idea":"1–2 věty","hook":"hlavní háček / slib","feasibility":{"verdict":"realné|náročné|nereálné v daném čase","math":"výpočet s čísly","what_it_takes":[""],"adjusted_goal":""},"offer_stack":[{"name":"","type":"vstupní|bump|upsell|prémiový|rezervace|schůzka|prádlomat","price_czk":0,"promise":"","contents":[""],"why_buy":"","expected_take_rate":""}],"page_plan":[{"id":"p1","type":"záchytná|prodejní|důvěra|děkovací|rezervace","name":"","purpose":"","next":"p2"}],"channel_decision":"rychlý formulář vs. záchytná stránka – rozhodnutí a proč","projection":{"days":' + goals.online_days + ',"spend_czk":0,"visitors":0,"leads":0,"online_orders":0,"online_revenue_czk":0,"online_net_czk":0,"meetings_per_week":0,"machines_per_week":0,"calc":"výpočet krok za krokem","assumptions":[""]},"kpis":[{"metric":"","target":"","why":""}],"risks":[""]}\nČísla jsou čísla. Česky.', 8000, 'Jádro');
  Object.assign(F, core); F.parts.core = true; await save();

  const CTX = GOALS + '\nJÁDRO FUNNELU (už rozhodnuto, drž se ho):\n' + JSON.stringify({ name: core.name, big_idea: core.big_idea, hook: core.hook, offer_stack: core.offer_stack, page_plan: core.page_plan, channel_decision: core.channel_decision, projection: core.projection }).slice(0, 9000) + '\n\n';
  const pageIds = (core.page_plan || []).map((p) => p.id).join(', ');
  const parts = [
    ['ads', 'Reklamy', 8000, CTX + 'ÚKOL (krok 2a): napiš 3–5 FB reklam s HOTOVÝM textem a remarketing (3–4 okruhy). destination/link_page = id stránky z page_plan (' + pageIds + ') nebo "leadform".\nVÝSTUP: pouze JSON:\n{"ads":[{"id":"ad1","name":"","angle":"","audience":"cílení","format":"video|obrázek|carousel","creative_brief":"scéna po scéně / co je na obrázku","primary_text":"plný text","headline":"","description":"","cta_button":"","destination":"p1","why_destination":"","budget_czk_day":0}],"leadform":{"use":false,"why":"","questions":[]},"remarketing":[{"audience":"","window":"","angle":"","text":"","link_page":"p1","budget_czk_day":0}]}'],
    ['pages', 'Stránky', 14000, CTX + 'ÚKOL (krok 2b): pro KAŽDOU stránku z page_plan napiš, jak přesně má vypadat – hotové texty všech sekcí shora dolů (prodejní copywriting: hero, problém, řešení, důkazy, nabídka s value stackem, garance, FAQ, výzva), formulář, CTA, vizuální styl. Zachovej id stránek.\nVÝSTUP: pouze JSON:\n{"pages":[{"id":"p1","type":"","slug":"/navrh-url","name":"","purpose":"","headline":"","subheadline":"","sections":[{"name":"","copy":"hotový text"}],"form_fields":[],"cta":"","offer":"","design":"","next":"p2","success_metric":""}]}'],
    ['sequence', 'SMS a e-maily', 10000, CTX + 'ÚKOL (krok 2c): napiš sekvenci 12–18 SMS a e-mailů po získání kontaktu s HOTOVÝMI texty (SMS max 300 znaků), podmínkami komu, odkazem na stránku z page_plan (' + pageIds + '); dál prodejní proces na schůzce/prohlídce výroby a plán spuštění po dnech.\nVÝSTUP: pouze JSON:\n{"sequence":[{"id":"m1","day":"D0 +5 min","channel":"sms|email","condition":"","subject":"","text":"","link_page":"p2","goal":""}],"sales_process":{"meeting":"","closing":"","follow_up":"","capacity":""},"launch_plan":[{"when":"den 1","what":""}]}'],
  ];
  await Promise.all(parts.map(([key, label, max, prompt]) => aiJson(client, INVENT_SYSTEM, prompt, max, label)
    .then(async (res) => { Object.assign(F, res); F.parts[key] = true; await save(); })
    .catch(async (e) => { F.part_errors[key] = e.message; await save(); })));
  if (!F.pages || !F.pages.length) F.pages = (core.page_plan || []).map((p) => Object.assign({}, p));
  F.status = Object.keys(F.part_errors).length ? 'partial' : 'done'; F.generated_at = new Date().toISOString();
  await save();
  if (F.status === 'partial') throw new Error('Část se nepovedla: ' + Object.values(F.part_errors).join('; ') + ' – zbytek je uložený, zkus „Vymyslet" znovu.');
  return F;
}

// Náhled stránky funnelu: AI napíše kompletní HTML podle návrhu (uloží se k funnelu)
async function pagePreview(pageId) {
  const apiKey = process.env.ANTHROPIC_API_KEY; if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nastavený');
  const F = await getJ(KEY_INVENT, null); if (!F) throw new Error('Funnel ještě není vymyšlený');
  const p = (F.pages || []).find((x) => x.id === pageId); if (!p) throw new Error('Stránka nenalezena');
  const offers = (F.offer_stack || []).map((o) => ({ name: o.name, price_czk: o.price_czk, promise: o.promise, contents: o.contents }));
  const prompt = 'Vytvoř KOMPLETNÍ, produkčně vypadající HTML stránku (jeden soubor, inline CSS, žádné externí skripty ani obrázky z cizích URL – fotky nahraď stylovými placeholdery s popisem, co na fotce má být; může být Google Fonts link). Mobile-first, rychlá, konverzní (jasná hierarchie, kontrast CTA, sociální důkaz, odrážky, FAQ, garance, sticky CTA na mobilu). Česky. Formuláře jen vizuálně (action="#").\n\nFUNNEL: ' + F.name + ' — ' + (F.big_idea || '') + '\nHÁČEK: ' + (F.hook || '') + '\nNABÍDKY: ' + JSON.stringify(offers).slice(0, 4000) + '\n\nSTRÁNKA: ' + JSON.stringify(p).slice(0, 12000) + '\n\nVrať POUZE HTML od <!DOCTYPE html> po </html>.';
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const r = await client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }).finalMessage();
  let html = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const a = html.indexOf('<!DOCTYPE'), b = html.lastIndexOf('</html>'); if (a >= 0 && b > a) html = html.slice(a, b + 7);
  if (!/<html/i.test(html)) throw new Error('AI nevrátila HTML');
  const F2 = await getJ(KEY_INVENT, null); const p2 = F2 && (F2.pages || []).find((x) => x.id === pageId); if (!p2) throw new Error('Funnel se mezitím změnil');
  p2.html = html; p2.html_at = new Date().toISOString();
  await setJ(KEY_INVENT, F2, 'Marketingový ředitel – vymyšlený funnel');
  return { ok: true, html_at: p2.html_at };
}

module.exports = { init, register, strategy, getStrategy, run, reports, status, start, inventory, fingerprint, diff, invent, getInvent, getGoals, setGoals, pagePreview, KEY_INVENT };
