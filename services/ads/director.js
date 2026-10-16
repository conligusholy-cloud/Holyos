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
  const prompt = 'Sestav KOMPLETNÍ MARKETINGOVOU STRATEGII prádlomatů jako graf (plátno), aby majitel měl 100% reálnou představu, jak je celý online marketing vymyšlený a co od něj čekat. Vycházej z aktuálního stavu (INVENTÁŘ, ČÍSLA, poslední audit) – co už existuje označ „existuje", co navrhuješ nově „navrženo", co je rozbité nebo chybí „problém". Očekávané výsledky ODVOZUJ z naměřených konverzí a cílených zlepšení (u každého přechodu uveď současnou a cílovou konverzi); nevymýšlej čísla bez opory a u nejistých to řekni. STRATEGIE ZAČÍNÁ REKLAMOU: nejdřív popiš každou reklamní kampaň (ads) – jaká to je (kampaň z dat Mety, její útrata, zobrazení, kliky, leady, CPL), komu míří, jaké sdělení nese, KAM přesně vede (formulář, záchytná stránka) a CO od ní očekáváš (CTR, cena za lead, leadů za měsíc, podíl kvalifikovaných). Navrhni i nové reklamy, pokud chybí (např. na Vyhledávač míst nebo na prodej prádlomatu). Každá reklama je v grafu uzel typu source ve sloupci 0 s hranou na cílovou stránku nebo formulář. HLAVNÍ CÍL STRATEGIE: prodej prádlomatů; doprovodně prodej aplikací Prověření lokality / Vyhledávač míst, dokumentů, servisu, dílů, leasingu a dalšího. Strategie musí obsahovat: (1) žebřík nabídky – od vstupního produktu (lead magnet / levný placený produkt) přes konzultaci/schůzku až k prodeji prádlomatu a doprovodným prodejům po něm; (2) systém KVALIFIKACE leadů – kritéria (místo, rozpočet, záměr, rychlost), fáze (nový → kvalifikovaný → schůzka → nabídka → prodej), kolik leadů je v každé fázi dnes a co je potřeba, aby se jich víc posunulo; (3) nápady na doprovodný prodej (cross-sell, upsell, balíčky, reaktivace, doporučení) s odhadem přínosu; (4) jeden navazující celek: cíl → zdroje návštěvnosti → oslovení → záchytné stránky → kvalifikace → platba/schůzka → prodej prádlomatu → péče a doprovodný prodej, včetně měření.\n\nOBDOBÍ DAT: ' + days + ' dní.\n\nINVENTÁŘ:\n' + JSON.stringify(inv).slice(0, 22000) + '\n\nČÍSLA:\n' + JSON.stringify(m).slice(0, 20000) + '\n\nPOSLEDNÍ AUDIT:\n' + JSON.stringify(last).slice(0, 4000) + '\n\nPAMĚŤ:\n' + JSON.stringify(memory.slice(-10)).slice(0, 3000) +
    '\n\nVÝSTUP: pouze jeden JSON objekt (bez Markdownu):\n{"goal":{"title":"hlavní cíl","target":"měřitelný cíl, např. 20 plateb / měsíc","horizon":"např. 90 dní"},"positioning":"1–2 věty: komu, co a čím se lišíme","ads":[{"name":"název reklamní kampaně / reklamy (z dat Mety) nebo navržené","status":"existuje|navrženo|problém","objective":"co reklama má udělat (např. sběr leadů z formuláře)","audience":"komu míří (cílení)","hook":"hlavní sdělení / nabídka v reklamě","destination":"kam přesně vede (formulář / záchytná stránka) a proč tam","budget_czk_month":0,"current":{"spend_czk":0,"impressions":0,"clicks":0,"leads":0,"cpl_czk":0,"ctr":"…"},"expected":{"ctr":"…","cpl_czk":0,"leads_month":0,"qualified_pct":"podíl kvalifikovaných leadů v %","note":"na čem je očekávání postavené"},"verdict":"1 věta – drží, upravit, nebo vyměnit a proč"}],"offer_ladder":[{"step":"1","name":"název nabídky","kind":"vstup|schůzka|hlavní|doprovodný","price":"cena nebo rozsah","role":"jakou roli hraje v cestě k prodeji prádlomatu","status":"existuje|navrženo|problém"}],"qualification":{"criteria":["kritérium kvalifikovaného leada"],"stages":[{"name":"např. Nový lead","definition":"…","count_now":"číslo nebo odhad","action":"co ho posune dál"}],"note":"jak se bude kvalifikovat v praxi"},"sales_ideas":[{"title":"nápad na doprovodný prodej","product":"co se prodává","trigger":"kdy / komu nabídnout","why":"proč to zabere","expected":"očekávaný přínos (číslo, opřené o data)","effort":"nízká|střední|vysoká"}],"audiences":[{"name":"…","need":"…"}],"nodes":[{"id":"n1","stage":0,"kind":"goal|source|outreach|page|conversion|retention|measure","title":"krátký název","desc":"1–2 věty co se tam děje a proč","status":"existuje|navrženo|problém","owner":"Facebook ručně|Centrum reklamy|Záchytná stránka|Ručně","expected":{"metric":"např. kliky","current":"dnes","target":"cíl","note":"na čem je odhad postaven"}}],"edges":[{"from":"n1","to":"n2","label":"např. lead → klik","current_rate":"např. 4,4 %","target_rate":"např. 8 %"}],"results":{"horizon":"…","scenarios":[{"name":"konzervativní|realistický|optimistický","leads":0,"clicks":0,"orders":0,"revenue_czk":0,"spend_czk":0,"roas":0,"note":"předpoklady"}],"assumptions":["…"],"risks":["…"]},"timeline":[{"when":"týden 1","what":"…","owner":"…"}],"data_quality_note":"jak moc se dá odhadům věřit (1 věta)"}\nPravidla: stage = sloupec zleva doprava (0 cíl/zdroje, 1 oslovení, 2 stránky, 3 konverze/platba, 4 péče, 5 měření); ads 2–6 položek (existující kampaně + případné nové); 10–14 uzlů, hrany jen hlavní toky (max 16) a tvoří souvislý graf; offer_ladder 4–7 kroků, qualification.stages 4–6 fází, sales_ideas 5–8 nápadů; čísla v results jsou čísla (ne texty); ve scénářích vycházej z reálných dnešních hodnot a zlepšení rozumně odstupňuj; vše česky a stručně.';
  const Anthropic = require('@anthropic-ai/sdk'); const client = new Anthropic({ apiKey });
  const r = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: prompt }] });
  const raw = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'); let S = null;
  try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); S = scrub(JSON.parse(raw.slice(a, b + 1))); } catch (e) { throw new Error('Strategie se nepodařila sestavit (neplatná odpověď AI), zkus to znovu.'); }
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

module.exports = { init, register, strategy, getStrategy, run, reports, status, start, inventory, fingerprint, diff };
