// BS2 — Administrace „Online produkty": správa online produktu Prověření lokality + Vyhledávač míst
// (přehled tržeb, objednávky, zákazníci s balíčkem, ceník a limity). Ceník se ukládá do app_settings
// (klíč location_pricing) a za běhu přepisuje výchozí hodnoty v location.js / location-app.js.
const { esc } = require('./views');
const LOC = require('./location');
const LAPP = require('./location-app');

const PRICING_KEY = 'location_pricing';
const fmtDT = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };
const fmtD = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' }); } catch (e) { return '—'; } };
const kc = (n) => Number(n || 0).toLocaleString('cs-CZ') + ' Kč';

// Výchozí ceník (haléře) + limity – zdroj pravdy pro reset
const DEFAULTS = {
  packages: { basic: 490000, plus: 990000, premium: 1590000 },
  finder_packages: { basic: 490000, plus: 990000, premium: 1590000 }, // ceny balíčků na /findlocation
  evals: { eval1: 99900, eval3: 199900, eval10: 499900 },
  searches: { search1: 49900, search3: 99900, search10: 299900 },
  limits: { basic: 3, plus: 10, premium: 10 },
  search_limits: { basic: 1, plus: 2, premium: 3 },
};
// Testovací režim cen: všechny položky za TEST_AMOUNT (Stripe má pro CZK minimum 15 Kč), uložený ceník zůstává
const TEST_AMOUNT = 1500;
let _testLoc = false, _testFind = false; // testovací ceny zvlášť pro Prověření lokality a Vyhledávač míst
const testMode = () => _testLoc; // upgrady balíčků patří k Prověření lokality
// Aplikuje uložený ceník do běžících konstant (volá se po startu a po uložení)
function applyPricing(p) {
  p = p || {};
  _testLoc = !!(p.test_loc || p.test_mode); _testFind = !!(p.test_find || p.test_mode); // starý společný příznak test_mode zapíná oba
  Object.keys(DEFAULTS.packages).forEach((k) => { LOC.PACKAGES[k].amount = Number((p.packages || {})[k]) > 0 ? Number(p.packages[k]) : DEFAULTS.packages[k]; });
  Object.keys(DEFAULTS.finder_packages).forEach((k) => { LOC.FINDER_PRICES[k] = Number((p.finder_packages || {})[k]) > 0 ? Number(p.finder_packages[k]) : DEFAULTS.finder_packages[k]; });
  Object.keys(DEFAULTS.evals).forEach((k) => { LOC.EVAL_PACKS[k].amount = Number((p.evals || {})[k]) > 0 ? Number(p.evals[k]) : DEFAULTS.evals[k]; });
  Object.keys(DEFAULTS.searches).forEach((k) => { LOC.EVAL_PACKS[k].amount = Number((p.searches || {})[k]) > 0 ? Number(p.searches[k]) : DEFAULTS.searches[k]; });
  Object.keys(DEFAULTS.limits).forEach((k) => { LAPP.LIMITS[k] = Number((p.limits || {})[k]) > 0 ? Number(p.limits[k]) : DEFAULTS.limits[k]; });
  Object.keys(DEFAULTS.search_limits).forEach((k) => { LAPP.SEARCH_LIMITS[k] = Number((p.search_limits || {})[k]) >= 0 && (p.search_limits || {})[k] !== undefined ? Number(p.search_limits[k]) : DEFAULTS.search_limits[k]; });
  if (_testLoc) { Object.keys(LOC.PACKAGES).forEach((k) => { LOC.PACKAGES[k].amount = TEST_AMOUNT; }); ['eval1', 'eval3', 'eval10'].forEach((k) => { if (LOC.EVAL_PACKS[k]) LOC.EVAL_PACKS[k].amount = TEST_AMOUNT; }); }
  if (_testFind) { Object.keys(LOC.FINDER_PRICES).forEach((k) => { LOC.FINDER_PRICES[k] = TEST_AMOUNT; }); ['search1', 'search3', 'search10'].forEach((k) => { if (LOC.EVAL_PACKS[k]) LOC.EVAL_PACKS[k].amount = TEST_AMOUNT; }); }
}
// Z formuláře ceníku → objekt (Kč → haléře)
function parsePricing(b) {
  const n = (v) => { const x = Math.round(Number(String(v || '').replace(/\s/g, '').replace(',', '.')) * 100); return Number.isFinite(x) && x > 0 ? x : null; };
  const i = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= 0 ? x : null; };
  const out = { packages: {}, finder_packages: {}, evals: {}, searches: {}, limits: {}, search_limits: {}, test_loc: b.test_loc_present !== undefined ? !!b.test_loc : _testLoc, test_find: b.test_find_present !== undefined ? !!b.test_find : _testFind };
  // v testovacím režimu běží konstanty na 15 Kč → chybějící pole doplnit z uloženého ceníku (cur), ne z konstant
  const cur = b._current || {};
  const curPkg = (k) => (cur.packages || {})[k] || (_testLoc ? DEFAULTS.packages[k] : LOC.PACKAGES[k].amount);
  const curEv = (k) => (cur.evals || {})[k] || (_testLoc ? DEFAULTS.evals[k] : LOC.EVAL_PACKS[k].amount);
  const curSe = (k) => (cur.searches || {})[k] || (_testFind ? DEFAULTS.searches[k] : LOC.EVAL_PACKS[k].amount);
  Object.keys(DEFAULTS.packages).forEach((k) => { out.packages[k] = b['pkg_' + k] !== undefined ? (n(b['pkg_' + k]) || DEFAULTS.packages[k]) : curPkg(k); });
  const curFp = (k) => (cur.finder_packages || {})[k] || (_testFind ? DEFAULTS.finder_packages[k] : LOC.FINDER_PRICES[k]);
  Object.keys(DEFAULTS.finder_packages).forEach((k) => { out.finder_packages[k] = b['fpkg_' + k] !== undefined ? (n(b['fpkg_' + k]) || DEFAULTS.finder_packages[k]) : curFp(k); });
  Object.keys(DEFAULTS.evals).forEach((k) => { out.evals[k] = b['ev_' + k] !== undefined ? (n(b['ev_' + k]) || DEFAULTS.evals[k]) : curEv(k); });
  Object.keys(DEFAULTS.searches).forEach((k) => { out.searches[k] = b['se_' + k] !== undefined ? (n(b['se_' + k]) || DEFAULTS.searches[k]) : curSe(k); });
  Object.keys(DEFAULTS.limits).forEach((k) => { out.limits[k] = b['lim_' + k] !== undefined ? (i(b['lim_' + k]) || DEFAULTS.limits[k]) : LAPP.LIMITS[k]; });
  Object.keys(DEFAULTS.search_limits).forEach((k) => { const v = i(b['slim_' + k]); out.search_limits[k] = b['slim_' + k] !== undefined ? (v == null ? DEFAULTS.search_limits[k] : v) : LAPP.SEARCH_LIMITS[k]; });
  return out;
}

const TABS = [['', 'Přehled'], ['orders', 'Objednávky'], ['customers', 'Zákazníci']];
// Jednotlivé online produkty (každý má vlastní stránku s popisem, ceníkem a statistikou); další se přidají sem
const PRODUCTS = [
  { key: 'location', label: 'Prověření lokality', icon: '🧠' },
  { key: 'finder', label: 'Vyhledávač míst', icon: '🔎' },
];
// Blikající červený štítek, dokud jsou zapnuté testovací ceny
function testBadge(kind) {
  if (!(kind === 'find' ? _testFind : _testLoc)) return '';
  return ` <span class="test-blink" title="Všechny položky se prodávají za ${TEST_AMOUNT / 100} Kč. Vypněte v sekci Ceny (odškrtnout Testovací ceny a Uložit).">● TESTOVACÍ CENY ZAPNUTY</span><style>.test-blink{display:inline-block;vertical-align:middle;margin-left:10px;padding:5px 12px;border-radius:999px;background:#e5222f;color:#fff;font-size:12px;font-weight:800;letter-spacing:.04em;animation:testBlink 1s infinite;box-shadow:0 0 0 0 rgba(229,34,47,.7)}@keyframes testBlink{0%,100%{opacity:1;box-shadow:0 0 14px 2px rgba(229,34,47,.8)}50%{opacity:.35;box-shadow:0 0 0 0 rgba(229,34,47,0)}}</style>`;
}
function shell(adminLayout, admin, holyosUrl, tab, msg, inner, counts) {
  return adminLayout('Online produkty', 'loc', admin, `
  <h1 style="margin:0 0 4px">Online produkty</h1>
  <p class="muted" style="margin:0 0 12px">${tab === 'product:finder' ? 'Vyhledávač míst – záchytná stránka <a href="/findlocation" target="_blank">/findlocation</a>' : tab === 'product:location' ? 'Prověření lokality – záchytná stránka <a href="/location" target="_blank">/location</a>' : 'Prověření lokality (<a href="/location" target="_blank">/location</a>) + Vyhledávač míst (<a href="/findlocation" target="_blank">/findlocation</a>)'}, platby Stripe, přístup 12 měsíců.</p>
  <div class="row" style="gap:8px;margin:0 0 14px;flex-wrap:wrap;align-items:center">${TABS.map(([k, l]) => `<a class="btn sm ${tab === k ? '' : 'sec'}" href="/admin/online${k ? '?tab=' + k : ''}">${l}${counts && counts[k] != null ? ` <span class="muted">${counts[k]}</span>` : ''}</a>`).join('')}<span class="muted small" style="margin:0 4px">│ Produkty:</span>${PRODUCTS.map((p) => `<a class="btn sm ${tab === 'product:' + p.key ? '' : 'sec'}" href="/admin/online?tab=product:${p.key}">${p.icon} ${p.label}</a>`).join('')}<a class="btn sec sm" href="#" title="Další online produkt – připravíme podle potřeby" style="opacity:.6">+ další</a></div>
  ${_testLoc ? `<div class="msg err" style="margin:0 0 12px"><b>⚠️ Testovací ceny jsou zapnuté u Prověření lokality</b> – balíčky i dokupy vyhodnocení se prodávají za ${TEST_AMOUNT / 100} Kč (minimum Stripe pro CZK). Vypněte je po testu v <a href="/admin/online?tab=product:location">ceníku</a>.</div>` : ''}${_testFind ? `<div class="msg err" style="margin:0 0 12px"><b>⚠️ Testovací ceny jsou zapnuté u Vyhledávače míst</b> – dokup vyhledání se prodává za ${TEST_AMOUNT / 100} Kč (minimum Stripe pro CZK). Vypněte je po testu v <a href="/admin/online?tab=product:finder">ceníku</a>.</div>` : ''}
  ${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
  ${inner}`, holyosUrl);
}

// ── Přehled ──
function overview({ adminLayout, admin, holyosUrl, msg, stats, stripeOn, termsVersion }) {
  const s = stats;
  const box = (n, l, c) => `<div class="card" style="margin:0"><div style="font-size:26px;font-weight:800;color:${c || 'inherit'}">${n}</div><div class="small muted">${l}</div></div>`;
  return shell(adminLayout, admin, holyosUrl, '', msg, `
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px">
    ${box(kc(s.revenue_total), 'tržby celkem (zaplaceno, s DPH)', 'var(--ok)')}${box(kc(s.revenue_30), 'tržby za 30 dnů')}${box(s.customers, 'zákazníků s balíčkem')}${box(s.active, 'aktivních přístupů')}${box(s.pending, 'objednávek čeká na platbu', s.pending ? '#ffd866' : 'inherit')}${box(s.sites_eval, 'vyhodnocených lokalit')}${box(s.searches, 'vyhledání')}
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
    <div class="card" style="margin:0"><h2 style="margin:0 0 8px">Prodeje podle položky</h2><table class="cards"><thead><tr><th>Položka</th><th>Ks</th><th>Tržba</th></tr></thead><tbody>${s.by_item.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.n}</td><td>${kc(r.sum)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Zatím nic zaplaceno.</td></tr>'}</tbody></table></div>
    <div class="card" style="margin:0"><h2 style="margin:0 0 8px">Stav</h2>
      <div class="list-item"><span class="muted">Platby Stripe</span>${stripeOn ? '<span class="badge active">zapnuto</span>' : '<span class="badge blocked">vypnuto – chybí STRIPE_SECRET_KEY</span>'}</div>
      <div class="list-item"><span class="muted">Obchodní podmínky</span><span>verze ${esc(termsVersion)} · <a href="/location/vop" target="_blank">VOP</a> · <a href="/location/gdpr" target="_blank">GDPR</a></span></div>
      <div class="list-item"><span class="muted">Balíčky (s DPH)</span><span>Základ ${kc(LOC.PACKAGES.basic.amount / 100)} · Plus ${kc(LOC.PACKAGES.plus.amount / 100)} · Premium ${kc(LOC.PACKAGES.premium.amount / 100)} · <a href="/admin/online?tab=product:location">upravit</a></span></div>
      <div class="list-item"><span class="muted">V balíčku (vyhodnocení / vyhledání)</span><span>Základ ${LAPP.LIMITS.basic}/${LAPP.SEARCH_LIMITS.basic} · Plus ${LAPP.LIMITS.plus}/${LAPP.SEARCH_LIMITS.plus} · Premium ${LAPP.LIMITS.premium}/${LAPP.SEARCH_LIMITS.premium}</span></div>
      <div class="list-item"><span class="muted">Produkty</span><span>${PRODUCTS.map((p) => `<a href="/admin/online?tab=product:${p.key}">${p.icon} ${p.label}</a>`).join(' · ')}</span></div>
      <div class="list-item"><span class="muted">Místní šetření (Premium)</span><span>${s.premium_pending} čeká na termín</span></div>
    </div>
  </div>`);
}

// ── Zákazníci ──
function customers({ adminLayout, admin, holyosUrl, msg, rows, q }) {
  const pc = (p) => p === 'premium' ? '#ffd866' : p === 'plus' ? '#a78bfa' : '#4fd1ff';
  return shell(adminLayout, admin, holyosUrl, 'customers', msg, `
  <form method="get" action="/admin/online" class="row" style="gap:8px;margin:0 0 12px"><input type="hidden" name="tab" value="customers"><input name="q" value="${esc(q || '')}" placeholder="hledat jméno, e-mail, nick" style="min-width:260px"><button class="btn sec sm" type="submit">Hledat</button></form>
  <div class="card tbl-wrap">${rows.length ? `<table class="cards"><thead><tr><th>Zákazník</th><th>Balíček</th><th>Platnost</th><th>Vyhodnocení</th><th>Vyhledání</th><th>Lokality</th><th>Zaplaceno</th><th>Správa</th></tr></thead><tbody>
    ${rows.map((u) => { const exp = u.location_expires_at ? new Date(u.location_expires_at) : null, expired = exp && exp < new Date(); return `<tr>
      <td data-l="Zákazník"><b>${esc([u.first_name, u.last_name].filter(Boolean).join(' ') || u.nick || u.email)}</b><div class="small"><a href="mailto:${esc(u.email)}">${esc(u.email)}</a>${u.phone ? ' · ' + esc(u.phone) : ''}</div><div class="small muted">${u.status === 'active' ? 'účet aktivní' : 'účet ' + esc(u.status)} · <a href="/admin/supporters/${u.id}">účet #${u.id}</a></div></td>
      <td data-l="Balíček"><span class="badge" style="color:${pc(u.location_package)};border-color:${pc(u.location_package)}66">${esc((LOC.PACKAGES[u.location_package] || {}).label || u.location_package)}</span></td>
      <td data-l="Platnost" class="small ${expired ? '' : ''}">${exp ? (expired ? '<span style="color:var(--err)">vypršelo ' + fmtD(exp) + '</span>' : 'do ' + fmtD(exp)) : '—'}</td>
      <td data-l="Vyhodnocení"><b>${u.evals_used}</b> / ${(LAPP.LIMITS[u.location_package] || 3) + Number(u.location_extra_evals || 0)}${Number(u.location_extra_evals) ? `<div class="small muted">+${u.location_extra_evals} dokoupeno</div>` : ''}</td>
      <td data-l="Vyhledání"><b>${u.searches_used}</b> / ${(LAPP.SEARCH_LIMITS[u.location_package] || 0) + Number(u.location_extra_searches || 0)}${Number(u.location_extra_searches) ? `<div class="small muted">+${u.location_extra_searches} dokoupeno</div>` : ''}</td>
      <td data-l="Lokality">${u.sites_count}</td>
      <td data-l="Zaplaceno">${kc(u.paid_sum)}<div class="small muted">${u.orders_count} obj.</div></td>
      <td data-l="Správa"><form method="post" action="/admin/online/customer/${u.id}" class="row" style="gap:6px;flex-wrap:wrap;margin:0;max-width:360px">
        <select name="package" style="font-size:12px;padding:5px 7px"><option value="">balíček…</option>${['basic', 'plus', 'premium'].map((k) => `<option value="${k}"${u.location_package === k ? ' selected' : ''}>${LOC.PACKAGES[k].label}</option>`).join('')}</select>
        <input name="add_evals" type="number" min="-100" max="100" placeholder="+vyhodn." style="width:92px;font-size:12px;padding:5px 7px"><input name="add_searches" type="number" min="-100" max="100" placeholder="+vyhled." style="width:92px;font-size:12px;padding:5px 7px">
        <select name="extend" style="font-size:12px;padding:5px 7px"><option value="">platnost…</option><option value="1">+1 měsíc</option><option value="3">+3 měsíce</option><option value="12">+12 měsíců</option><option value="expire">ukončit přístup</option></select>
        <button class="btn sm" type="submit">Uložit</button></form></td></tr>`; }).join('')}
  </tbody></table>` : '<p class="muted" style="margin:0">Žádný zákazník s balíčkem.</p>'}</div>`);
}

// ── Produkt: Prověření lokality ──
function productLocation({ adminLayout, admin, holyosUrl, msg, saved, stats, saved_prices }) {
  saved_prices = saved_prices || {};
  const czk = (h) => (h / 100).toLocaleString('cs-CZ', { useGrouping: false });
  const inp = (name, val, w) => `<input name="${name}" value="${czk(val)}" inputmode="decimal" style="width:${w || 110}px;text-align:right">`;
  const box = (n, l) => `<div class="card" style="margin:0"><div style="font-size:24px;font-weight:800">${n}</div><div class="small muted">${l}</div></div>`;
  return shell(adminLayout, admin, holyosUrl, 'product:location', msg, `
  <div class="card" style="margin:0 0 12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">🧠 Prověření lokality${testBadge('loc')}</h2><p class="muted" style="margin:0">Zákazník zakreslí prádlomat do letecké mapy, doplní nájem, přípojky a financování; aplikace sestaví AI studii s verdiktem, scénáři a PDF. Prodává se v balíčcích Základ / Plus / Premium (12 měsíců), vyhodnocení navíc se dokupují, přechod na vyšší balíček = doplatek rozdílu.</p></div><div class="row" style="gap:6px"><a class="btn sec sm" href="/location" target="_blank">Prodejní stránka ↗</a><a class="btn sec sm" href="/location/vop" target="_blank">VOP</a><a class="btn sec sm" href="/admin/location">Objednávky</a></div></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px">${box(stats.customers, 'zákazníků s balíčkem')}${box(stats.sites, 'lokalit v aplikaci')}${box(stats.sites_eval, 'vyhodnocených lokalit')}${box(stats.running, 'studií právě běží')}${box(stats.errors, 'studií s chybou')}${box(kc(stats.revenue), 'tržby (balíčky + dokupy + přechody)')}</div>
  <form method="post" action="/admin/online/pricing?back=product:location">
  <div class="card" style="margin:0"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">Ceny balíčků</h2><p class="small muted" style="margin:0">Ceny s DPH v Kč. Vyhodnocení = kolik lokalit lze v balíčku vyhodnotit; přechod na vyšší balíček = rozdíl cen. Vyhledání v balíčku a dokup vyhledání se nastavují u Vyhledávače míst.</p></div>
    <label class="row" style="gap:8px;align-items:center;padding:8px 12px;border:1px solid ${_testLoc ? 'rgba(255,93,108,.6)' : 'var(--border)'};border-radius:12px;background:${_testLoc ? 'rgba(255,93,108,.1)' : 'rgba(4,8,16,.4)'};cursor:pointer;white-space:nowrap"><input type="hidden" name="test_loc_present" value="1"><input type="checkbox" name="test_loc" value="1"${_testLoc ? ' checked' : ''} style="width:auto;margin:0"><span><b>Testovací ceny</b> <span class="small muted">– balíčky a dokup vyhodnocení za ${TEST_AMOUNT / 100} Kč pro test platební brány</span></span></label></div>
    <div class="grid" style="grid-template-columns:1.3fr 1fr;gap:16px;align-items:start;margin-top:12px">
      <div><div class="small muted" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Balíčky</div>
      <table class="cards"><thead><tr><th>Balíček</th><th>Cena</th><th>Vyhodnocení</th><th>Přechod ze Základu</th></tr></thead><tbody>
      ${['basic', 'plus', 'premium'].map((k) => { const v = _testLoc ? (saved_prices.packages || {})[k] || DEFAULTS.packages[k] : LOC.PACKAGES[k].amount; const vb = _testLoc ? (saved_prices.packages || {}).basic || DEFAULTS.packages.basic : LOC.PACKAGES.basic.amount; return `<tr><td>${LOC.PACKAGES[k].label}</td><td>${inp('pkg_' + k, v)}</td><td><input name="lim_${k}" type="number" min="1" max="999" value="${LAPP.LIMITS[k]}" style="width:80px;text-align:right"></td><td class="small muted">${k === 'basic' ? '—' : 'doplatek ' + kc((v - vb) / 100)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <div><div class="small muted" style="text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Dokoupení vyhodnocení (1 / 3 / 10 ks)</div>
      <table class="cards"><thead><tr><th>1 ks</th><th>3 ks</th><th>10 ks</th></tr></thead><tbody><tr>${['eval1', 'eval3', 'eval10'].map((k) => `<td>${inp('ev_' + k, _testLoc ? (saved_prices.evals || {})[k] || DEFAULTS.evals[k] : LOC.EVAL_PACKS[k].amount, 96)}</td>`).join('')}</tr></tbody></table>
      <div class="small muted" style="margin-top:8px">Větší balení by mělo být levnější na kus.</div></div>
    </div>
    ${_testLoc ? `<div class="small" style="color:#ffb3bb;margin-top:10px">Testovací režim je zapnutý – v polích jsou uložené ostré ceny, prodává se za ${TEST_AMOUNT / 100} Kč. Odškrtněte a uložte pro návrat k ostrým cenám.</div>` : ''}
  </div>
  <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button class="btn" type="submit">Uložit</button><span class="small muted">Projeví se okamžitě na prodejní stránce, v aplikaci i ve Stripe. Zaplacené objednávky se nemění.${saved ? ' · Uloženo ' + fmtDT(saved) : ''}</span></div>
  </form>`);
}
// ── Produkt: Vyhledávač míst ──
function productFinder({ adminLayout, admin, holyosUrl, msg, saved, stats, saved_prices }) {
  saved_prices = saved_prices || {}; const seVal = (k) => _testFind ? (saved_prices.searches || {})[k] || DEFAULTS.searches[k] : LOC.EVAL_PACKS[k].amount;
  const czk = (h) => (h / 100).toLocaleString('cs-CZ', { useGrouping: false });
  const inp = (name, val, w) => `<input name="${name}" value="${czk(val)}" inputmode="decimal" style="width:${w || 110}px;text-align:right">`;
  const box = (n, l) => `<div class="card" style="margin:0"><div style="font-size:24px;font-weight:800">${n}</div><div class="small muted">${l}</div></div>`;
  return shell(adminLayout, admin, holyosUrl, 'product:finder', msg, `
  <div class="card" style="margin:0 0 12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">🔎 Vyhledávač míst${testBadge('find')}</h2><p class="muted" style="margin:0">Zákazník zadá město nebo špendlík v mapě; aplikace ukáže spádovost 5/10/15 km, kapacitu, fungující prádlomaty, místa, kde by prádlomat mohl stát, a kontakty na provozovatele. Jedno město = jedno vyhledání, výsledky se ukládají. Vyhledání jsou součástí balíčků Prověření lokality a dokupují se zvlášť.</p></div><div class="row" style="gap:6px"><a class="btn sm" href="/findlocation" target="_blank">Záchytná stránka ↗</a><a class="btn sec sm" href="/lokalita/analyza" target="_blank">Aplikace ↗</a><a class="btn sec sm" href="/admin/location">Objednávky</a></div></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px">${box(stats.searches, 'vyhledání celkem')}${box(stats.searches_30, 'vyhledání za 30 dnů')}${box(stats.with_cands, 's načtenými místy')}${box(stats.contacts, 'dohledaných kontaktů')}${box(kc(stats.revenue), 'tržby z dokoupených vyhledání')}</div>
  <form method="post" action="/admin/online/pricing?back=product:finder">
  <div style="margin:0 0 12px"><label class="row" style="gap:8px;align-items:center;padding:8px 12px;border:1px solid ${_testFind ? 'rgba(255,93,108,.6)' : 'var(--border)'};border-radius:12px;background:${_testFind ? 'rgba(255,93,108,.1)' : 'rgba(4,8,16,.4)'};cursor:pointer;white-space:nowrap"><input type="hidden" name="test_find_present" value="1"><input type="checkbox" name="test_find" value="1"${_testFind ? ' checked' : ''} style="width:auto;margin:0"><span><b>Testovací ceny</b> <span class="small muted">– balíčky a dokup vyhledání za ${TEST_AMOUNT / 100} Kč pro test platební brány</span></span></label></div>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;align-items:start">
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Balíčky na /findlocation</h2><p class="small muted" style="margin:0 0 10px">Cena balíčku prodávaného přes záchytnou stránku Vyhledávače míst (Kč s DPH) a kolik vyhledání v ceně. Ceny Prověření lokality se nastavují zvlášť u něj.</p>
      <table class="cards"><thead><tr><th>Balíček</th><th>Cena</th><th>Vyhledání v ceně</th></tr></thead><tbody>${['basic', 'plus', 'premium'].map((k) => `<tr><td>${LOC.PACKAGES[k].label}</td><td>${inp('fpkg_' + k, _testFind ? (saved_prices.finder_packages || {})[k] || DEFAULTS.finder_packages[k] : LOC.FINDER_PRICES[k], 96)}</td><td><input name="slim_${k}" type="number" min="0" max="999" value="${LAPP.SEARCH_LIMITS[k]}" style="width:80px;text-align:right"></td></tr>`).join('')}</tbody></table></div>
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Dokoupení vyhledání</h2><p class="small muted" style="margin:0 0 10px">Ceny s DPH v Kč za 1 / 3 / 10 ks.</p>
      <table class="cards"><thead><tr><th>1 ks</th><th>3 ks</th><th>10 ks</th></tr></thead><tbody><tr><td>${inp('se_search1', seVal('search1'), 96)}</td><td>${inp('se_search3', seVal('search3'), 96)}</td><td>${inp('se_search10', seVal('search10'), 96)}</td></tr></tbody></table>
      <div class="small muted" style="margin-top:10px">Na kus nyní: ${(LOC.EVAL_PACKS.search1.amount / 100).toFixed(0)} / ${(LOC.EVAL_PACKS.search3.amount / 300).toFixed(0)} / ${(LOC.EVAL_PACKS.search10.amount / 1000).toFixed(0)} Kč</div></div>
  </div>
  <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button class="btn" type="submit">Uložit</button><span class="small muted">Projeví se okamžitě v aplikaci i ve Stripe.${saved ? ' · Uloženo ' + fmtDT(saved) : ''}</span></div>
  </form>`);
}
// ── Ceník a limity (vše na jedné stránce, ponecháno pro přímý odkaz) ──
function pricing({ adminLayout, admin, holyosUrl, msg, saved }) {
  const czk = (h) => (h / 100).toLocaleString('cs-CZ', { useGrouping: false });
  const inp = (name, val, w) => `<input name="${name}" value="${czk(val)}" inputmode="decimal" style="width:${w || 110}px;text-align:right">`;
  const row = (label, cells) => `<tr><td>${label}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  return shell(adminLayout, admin, holyosUrl, 'pricing', msg, `
  <form method="post" action="/admin/online/pricing">
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;align-items:start">
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Balíčky</h2><p class="small muted" style="margin:0 0 10px">Ceny s DPH v Kč. Limity = počet vyhodnocení lokalit a vyhledání v ceně balíčku. Přechod na vyšší balíček = rozdíl cen.</p>
      <table class="cards"><thead><tr><th>Balíček</th><th>Cena</th><th>Vyhodnocení</th><th>Vyhledání</th></tr></thead><tbody>
      ${['basic', 'plus', 'premium'].map((k) => row(LOC.PACKAGES[k].label, [inp('pkg_' + k, LOC.PACKAGES[k].amount), `<input name="lim_${k}" type="number" min="1" max="999" value="${LAPP.LIMITS[k]}" style="width:80px;text-align:right">`, `<input name="slim_${k}" type="number" min="0" max="999" value="${LAPP.SEARCH_LIMITS[k]}" style="width:80px;text-align:right">`])).join('')}
      </tbody></table></div>
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Dokoupení</h2><p class="small muted" style="margin:0 0 10px">Ceny s DPH v Kč za balíček 1 / 3 / 10 ks. Větší balení by mělo být levnější na kus.</p>
      <table class="cards"><thead><tr><th>Položka</th><th>1 ks</th><th>3 ks</th><th>10 ks</th></tr></thead><tbody>
      ${row('Vyhodnocení lokality', [inp('ev_eval1', LOC.EVAL_PACKS.eval1.amount, 96), inp('ev_eval3', LOC.EVAL_PACKS.eval3.amount, 96), inp('ev_eval10', LOC.EVAL_PACKS.eval10.amount, 96)])}
      ${row('Vyhledání ve Vyhledávači', [inp('se_search1', LOC.EVAL_PACKS.search1.amount, 96), inp('se_search3', LOC.EVAL_PACKS.search3.amount, 96), inp('se_search10', LOC.EVAL_PACKS.search10.amount, 96)])}
      </tbody></table>
      <div class="small muted" style="margin-top:10px">Na kus nyní: vyhodnocení ${(LOC.EVAL_PACKS.eval1.amount / 100).toFixed(0)} / ${(LOC.EVAL_PACKS.eval3.amount / 300).toFixed(0)} / ${(LOC.EVAL_PACKS.eval10.amount / 1000).toFixed(0)} Kč · vyhledání ${(LOC.EVAL_PACKS.search1.amount / 100).toFixed(0)} / ${(LOC.EVAL_PACKS.search3.amount / 300).toFixed(0)} / ${(LOC.EVAL_PACKS.search10.amount / 1000).toFixed(0)} Kč</div></div>
  </div>
  <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button class="btn" type="submit">Uložit ceník</button><button class="btn sec" type="submit" name="reset" value="1" onclick="return confirm('Vrátit výchozí ceník a limity?')">Vrátit výchozí</button><span class="small muted">Změna se projeví okamžitě na prodejní stránce, v aplikaci i ve Stripe (částka se posílá při každém checkoutu). Již zaplacené objednávky se nemění.${saved ? ' · Uloženo ' + fmtDT(saved) : ''}</span></div>
  </form>`);
}

module.exports = { PRICING_KEY, DEFAULTS, PRODUCTS, TEST_AMOUNT, testMode, applyPricing, parsePricing, overview, customers, pricing, productLocation, productFinder, shell };
