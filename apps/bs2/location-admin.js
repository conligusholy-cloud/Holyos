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
  evals: { eval1: 99900, eval3: 199900, eval10: 499900 },
  searches: { search1: 49900, search3: 99900, search10: 299900 },
  limits: { basic: 3, plus: 10, premium: 10 },
  search_limits: { basic: 1, plus: 2, premium: 3 },
};
// Aplikuje uložený ceník do běžících konstant (volá se po startu a po uložení)
function applyPricing(p) {
  p = p || {};
  Object.keys(DEFAULTS.packages).forEach((k) => { LOC.PACKAGES[k].amount = Number((p.packages || {})[k]) > 0 ? Number(p.packages[k]) : DEFAULTS.packages[k]; });
  Object.keys(DEFAULTS.evals).forEach((k) => { LOC.EVAL_PACKS[k].amount = Number((p.evals || {})[k]) > 0 ? Number(p.evals[k]) : DEFAULTS.evals[k]; });
  Object.keys(DEFAULTS.searches).forEach((k) => { LOC.EVAL_PACKS[k].amount = Number((p.searches || {})[k]) > 0 ? Number(p.searches[k]) : DEFAULTS.searches[k]; });
  Object.keys(DEFAULTS.limits).forEach((k) => { LAPP.LIMITS[k] = Number((p.limits || {})[k]) > 0 ? Number(p.limits[k]) : DEFAULTS.limits[k]; });
  Object.keys(DEFAULTS.search_limits).forEach((k) => { LAPP.SEARCH_LIMITS[k] = Number((p.search_limits || {})[k]) >= 0 && (p.search_limits || {})[k] !== undefined ? Number(p.search_limits[k]) : DEFAULTS.search_limits[k]; });
}
// Z formuláře ceníku → objekt (Kč → haléře)
function parsePricing(b) {
  const n = (v) => { const x = Math.round(Number(String(v || '').replace(/\s/g, '').replace(',', '.')) * 100); return Number.isFinite(x) && x > 0 ? x : null; };
  const i = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= 0 ? x : null; };
  const out = { packages: {}, evals: {}, searches: {}, limits: {}, search_limits: {} };
  Object.keys(DEFAULTS.packages).forEach((k) => { out.packages[k] = b['pkg_' + k] !== undefined ? (n(b['pkg_' + k]) || DEFAULTS.packages[k]) : LOC.PACKAGES[k].amount; });
  Object.keys(DEFAULTS.evals).forEach((k) => { out.evals[k] = b['ev_' + k] !== undefined ? (n(b['ev_' + k]) || DEFAULTS.evals[k]) : LOC.EVAL_PACKS[k].amount; });
  Object.keys(DEFAULTS.searches).forEach((k) => { out.searches[k] = b['se_' + k] !== undefined ? (n(b['se_' + k]) || DEFAULTS.searches[k]) : LOC.EVAL_PACKS[k].amount; });
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
function shell(adminLayout, admin, holyosUrl, tab, msg, inner, counts) {
  return adminLayout('Online produkty', 'loc', admin, `
  <h1 style="margin:0 0 4px">Online produkty</h1>
  <p class="muted" style="margin:0 0 12px">Prověření lokality + Vyhledávač míst – prodej přes <a href="/location" target="_blank">/location</a>, platby Stripe, přístup 12 měsíců.</p>
  <div class="row" style="gap:8px;margin:0 0 14px;flex-wrap:wrap;align-items:center">${TABS.map(([k, l]) => `<a class="btn sm ${tab === k ? '' : 'sec'}" href="/admin/online${k ? '?tab=' + k : ''}">${l}${counts && counts[k] != null ? ` <span class="muted">${counts[k]}</span>` : ''}</a>`).join('')}<span class="muted small" style="margin:0 4px">│ Produkty:</span>${PRODUCTS.map((p) => `<a class="btn sm ${tab === 'product:' + p.key ? '' : 'sec'}" href="/admin/online?tab=product:${p.key}">${p.icon} ${p.label}</a>`).join('')}<a class="btn sec sm" href="#" title="Další online produkt – připravíme podle potřeby" style="opacity:.6">+ další</a></div>
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
function productLocation({ adminLayout, admin, holyosUrl, msg, saved, stats }) {
  const czk = (h) => (h / 100).toLocaleString('cs-CZ', { useGrouping: false });
  const inp = (name, val, w) => `<input name="${name}" value="${czk(val)}" inputmode="decimal" style="width:${w || 110}px;text-align:right">`;
  const box = (n, l) => `<div class="card" style="margin:0"><div style="font-size:24px;font-weight:800">${n}</div><div class="small muted">${l}</div></div>`;
  return shell(adminLayout, admin, holyosUrl, 'product:location', msg, `
  <div class="card" style="margin:0 0 12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">🧠 Prověření lokality</h2><p class="muted" style="margin:0">Zákazník zakreslí prádlomat do letecké mapy, doplní nájem, přípojky a financování; aplikace sestaví AI studii s verdiktem, scénáři a PDF. Prodává se v balíčcích Základ / Plus / Premium (12 měsíců), vyhodnocení navíc se dokupují, přechod na vyšší balíček = doplatek rozdílu.</p></div><div class="row" style="gap:6px"><a class="btn sec sm" href="/location" target="_blank">Prodejní stránka ↗</a><a class="btn sec sm" href="/location/vop" target="_blank">VOP</a><a class="btn sec sm" href="/admin/location">Objednávky</a></div></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px">${box(stats.customers, 'zákazníků s balíčkem')}${box(stats.sites, 'lokalit v aplikaci')}${box(stats.sites_eval, 'vyhodnocených lokalit')}${box(stats.running, 'studií právě běží')}${box(stats.errors, 'studií s chybou')}${box(kc(stats.revenue), 'tržby (balíčky + dokupy + přechody)')}</div>
  <form method="post" action="/admin/online/pricing?back=product:location">
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;align-items:start">
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Balíčky</h2><p class="small muted" style="margin:0 0 10px">Ceny s DPH v Kč. Vyhodnocení = kolik lokalit lze v balíčku vyhodnotit. Vyhledání v balíčku se nastavují u Vyhledávače míst.</p>
      <table class="cards"><thead><tr><th>Balíček</th><th>Cena</th><th>Vyhodnocení</th><th>Přechod ze Základu</th></tr></thead><tbody>
      ${['basic', 'plus', 'premium'].map((k) => `<tr><td>${LOC.PACKAGES[k].label}</td><td>${inp('pkg_' + k, LOC.PACKAGES[k].amount)}</td><td><input name="lim_${k}" type="number" min="1" max="999" value="${LAPP.LIMITS[k]}" style="width:80px;text-align:right"></td><td class="small muted">${k === 'basic' ? '—' : 'doplatek ' + kc((LOC.PACKAGES[k].amount - LOC.PACKAGES.basic.amount) / 100)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Dokoupení vyhodnocení</h2><p class="small muted" style="margin:0 0 10px">Ceny s DPH v Kč za 1 / 3 / 10 ks. Větší balení by mělo být levnější na kus.</p>
      <table class="cards"><thead><tr><th>1 ks</th><th>3 ks</th><th>10 ks</th></tr></thead><tbody><tr><td>${inp('ev_eval1', LOC.EVAL_PACKS.eval1.amount, 96)}</td><td>${inp('ev_eval3', LOC.EVAL_PACKS.eval3.amount, 96)}</td><td>${inp('ev_eval10', LOC.EVAL_PACKS.eval10.amount, 96)}</td></tr></tbody></table>
      <div class="small muted" style="margin-top:10px">Na kus nyní: ${(LOC.EVAL_PACKS.eval1.amount / 100).toFixed(0)} / ${(LOC.EVAL_PACKS.eval3.amount / 300).toFixed(0)} / ${(LOC.EVAL_PACKS.eval10.amount / 1000).toFixed(0)} Kč</div></div>
  </div>
  <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button class="btn" type="submit">Uložit</button><span class="small muted">Projeví se okamžitě na prodejní stránce, v aplikaci i ve Stripe. Zaplacené objednávky se nemění.${saved ? ' · Uloženo ' + fmtDT(saved) : ''}</span></div>
  </form>`);
}
// ── Produkt: Vyhledávač míst ──
function productFinder({ adminLayout, admin, holyosUrl, msg, saved, stats }) {
  const czk = (h) => (h / 100).toLocaleString('cs-CZ', { useGrouping: false });
  const inp = (name, val, w) => `<input name="${name}" value="${czk(val)}" inputmode="decimal" style="width:${w || 110}px;text-align:right">`;
  const box = (n, l) => `<div class="card" style="margin:0"><div style="font-size:24px;font-weight:800">${n}</div><div class="small muted">${l}</div></div>`;
  return shell(adminLayout, admin, holyosUrl, 'product:finder', msg, `
  <div class="card" style="margin:0 0 12px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0 0 4px">🔎 Vyhledávač míst</h2><p class="muted" style="margin:0">Zákazník zadá město nebo špendlík v mapě; aplikace ukáže spádovost 5/10/15 km, kapacitu, fungující prádlomaty, místa, kde by prádlomat mohl stát, a kontakty na provozovatele. Jedno město = jedno vyhledání, výsledky se ukládají. Vyhledání jsou součástí balíčků Prověření lokality a dokupují se zvlášť.</p></div><div class="row" style="gap:6px"><a class="btn sec sm" href="/lokalita/analyza" target="_blank">Aplikace ↗</a><a class="btn sec sm" href="/admin/location">Objednávky</a></div></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px">${box(stats.searches, 'vyhledání celkem')}${box(stats.searches_30, 'vyhledání za 30 dnů')}${box(stats.with_cands, 's načtenými místy')}${box(stats.contacts, 'dohledaných kontaktů')}${box(kc(stats.revenue), 'tržby z dokoupených vyhledání')}</div>
  <form method="post" action="/admin/online/pricing?back=product:finder">
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px;align-items:start">
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Vyhledání v balíčcích</h2><p class="small muted" style="margin:0 0 10px">Kolik vyhledání dostane zákazník v ceně balíčku Prověření lokality.</p>
      <table class="cards"><thead><tr><th>Balíček</th><th>Vyhledání v ceně</th></tr></thead><tbody>${['basic', 'plus', 'premium'].map((k) => `<tr><td>${LOC.PACKAGES[k].label} <span class="muted small">(${kc(LOC.PACKAGES[k].amount / 100)})</span></td><td><input name="slim_${k}" type="number" min="0" max="999" value="${LAPP.SEARCH_LIMITS[k]}" style="width:80px;text-align:right"></td></tr>`).join('')}</tbody></table></div>
    <div class="card" style="margin:0"><h2 style="margin:0 0 4px">Dokoupení vyhledání</h2><p class="small muted" style="margin:0 0 10px">Ceny s DPH v Kč za 1 / 3 / 10 ks.</p>
      <table class="cards"><thead><tr><th>1 ks</th><th>3 ks</th><th>10 ks</th></tr></thead><tbody><tr><td>${inp('se_search1', LOC.EVAL_PACKS.search1.amount, 96)}</td><td>${inp('se_search3', LOC.EVAL_PACKS.search3.amount, 96)}</td><td>${inp('se_search10', LOC.EVAL_PACKS.search10.amount, 96)}</td></tr></tbody></table>
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

module.exports = { PRICING_KEY, DEFAULTS, PRODUCTS, applyPricing, parsePricing, overview, customers, pricing, productLocation, productFinder, shell };
