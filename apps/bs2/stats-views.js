// BS2 — admin stránky Statistiky (přehled chování uživatelů + detail uživatele).
'use strict';

module.exports = function ({ esc, fmtDT, adminLayout }) {
  const nf = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: d }));
  const dur = (s) => { s = Math.round(Number(s) || 0); if (s < 60) return s + ' s'; const m = Math.floor(s / 60); if (m < 60) return m + ' min'; return Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
  const PAGES = { '/': 'Domů', '/pradlomaty': 'Prádlomaty', '/discount-credit': 'Discount Credit', '/team': 'Moje doporučení', '/sit': 'Partnerská síť', '/moje-pradlomaty': 'Moje svoboda', '/compounder': 'Compounder', '/password': 'Můj účet', '/podpora': 'Živá podpora', '/ai-chat': 'AI chat', '/souhlas': 'Souhlas s podmínkami', '/vop': 'VOP', '/gdpr': 'Ochrana údajů', '/login': 'Přihlášení' };
  const pageName = (p) => (p ? (PAGES[p] ? PAGES[p] + ' <span class="muted small">' + esc(p) + '</span>' : esc(p)) : '<span class="muted">—</span>');
  const who = (r) => { const n = [r.last_name, r.first_name].filter(Boolean).join(' ') || r.email || '—'; return r.id ? `<a href="/admin/stats/user/${r.id}"><b>${esc(n)}</b></a>${r.nick ? `<div class="small muted">${esc(r.nick)}</div>` : ''}` : '<span class="muted">neznámý</span>'; };
  const TYPE = { login: ['active', 'přihlášení'], suggestion: ['active', 'podnět na vylepšení'], login_fail: ['blocked', 'neúspěšné přihlášení'], logout: ['invited', 'odhlášení'], consent: ['active', 'souhlas s podmínkami'], reset_request: ['invited', 'žádost o heslo'], pageview: ['invited', 'stránka'], click: ['active', 'klik'], section: ['invited', 'přečtená sekce'], interact: ['active', 'ovládací prvek'], scroll: ['invited', 'scroll'] };
  const typeBadge = (t) => { const x = TYPE[t] || ['invited', t]; return `<span class="badge ${x[0]}">${esc(x[1])}</span>`; };
  const devName = { mobile: 'Mobil', desktop: 'Počítač', tablet: 'Tablet' };

  const bars = (vals, labels, color, h = 90) => {
    const max = Math.max(1, ...vals); const n = vals.length; const w = 100 / Math.max(n, 1);
    return `<svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block">${vals.map((v, i) => {
      const bh = Math.max(v ? 2 : 0, (v / max) * (h - 6)); return `<rect x="${(i * w + w * 0.12).toFixed(2)}" y="${(h - bh).toFixed(1)}" width="${(w * 0.76).toFixed(2)}" height="${bh.toFixed(1)}" rx=".6" fill="${color}"><title>${esc(labels[i])}: ${v}</title></rect>`; }).join('')}</svg>`;
  };
  const stat = (v, l, c) => `<div class="stat"><div class="v"${c ? ` style="color:${c}"` : ''}>${v}</div><div class="l">${l}</div></div>`;
  const tbl = (head, rows, empty) => rows.length ? `<table class="cards"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : `<p class="muted" style="margin:0">${empty || 'Zatím žádná data.'}</p>`;
  const periodBar = (base, days) => `<div class="row" style="gap:8px;margin:10px 0 14px;flex-wrap:wrap">${[[1, 'Dnes'], [7, '7 dní'], [30, '30 dní'], [90, '90 dní'], ['all', 'Vše']].map(([d, l]) => `<a class="btn sec sm${(String(days) === String(d) || (d === 'all' && days >= 3650)) ? ' on' : ''}" href="${base}?days=${d}"${(String(days) === String(d) || (d === 'all' && days >= 3650)) ? ' style="border-color:var(--accent);color:var(--accent2)"' : ''}>${l}</a>`).join('')}</div>`;

  function adminStats({ admin, data: D, days, holyosUrl }) {
    const u = D.users, a = D.active, t = D.totals, f = D.funnel, cr = D.credits;
    const tr = D.transfers;
    const trSum = (st) => tr.filter(x => x.status === st).reduce((s, x) => ({ n: s.n + x.n, dc: s.dc + x.dc }), { n: 0, dc: 0 });
    const tp = trSum('pending'), ta = trSum('approved'), trj = trSum('rejected');
    const trUsers = new Set(); // počet lidí je v funnelu
    const ord = (st) => D.orders.find(o => o.status === st) || { n: 0, net: 0, dc_used: 0, users: 0 };
    const oAll = D.orders.reduce((s, o) => ({ n: s.n + o.n, dc: s.dc + o.dc_used }), { n: 0, dc: 0 });
    const dayLabels = D.daily.map(r => new Date(r.day).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }));
    const hrs = Array.from({ length: 24 }, (_, h) => (D.hours.find(r => r.h === h) || { n: 0 }).n);
    const devTotal = D.devices.reduce((s, r) => s + r.views, 0) || 1;
    const chart = (title, vals, color) => `<div class="card" style="padding:14px 16px"><div class="small muted" style="margin-bottom:6px">${title} <b style="color:var(--text)">${nf(vals.reduce((s, v) => s + v, 0))}</b></div>${bars(vals, dayLabels, color)}<div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>${esc(dayLabels[0] || '')}</span><span>${esc(dayLabels[dayLabels.length - 1] || '')}</span></div></div>`;
    const funnel = [
      ['Uživatelů v databázi', u.total], ['Aktivovali účet (nick + heslo)', u.activated], ['Někdy se přihlásili', u.ever_login], ['Potvrdili VOP', u.consented],
      ['Prohlédli si Prádlomaty', f.viewed_products], ['Prohlédli si Discount Credit', f.viewed_dc], ['Podali objednávku', f.ordered], ['Požádali o převod podpory', f.transferred],
    ];
    const fmax = Math.max(1, u.total);
    return adminLayout('Statistiky', 'stat', admin, `
  <h1 style="margin:0 0 6px">Statistiky chování uživatelů</h1>
  <p class="muted" style="margin-top:0">Co uživatelé dělají v Best Series 2.0: přihlášení, zobrazené stránky, kliknutí, čas v aplikaci, co čtou a kolik převedli DC. Sbírá se jen u přihlášených uživatelů; obsah vyplněných polí se neukládá.</p>
  <div class="row" style="gap:8px;margin:10px 0 0"><a class="btn sm" href="/admin/stats/live">● Živě — co se děje právě teď</a></div>
  ${periodBar('/admin/stats', days)}
  <h3 style="margin:6px 0 8px">Přehled za ${days >= 3650 ? 'celou dobu' : days === 1 ? 'dnešek' : 'posledních ' + days + ' dní'}</h3>
  <div class="grid">
    ${stat(nf(a.d1), 'Aktivních uživatelů za 24 h', 'var(--ok)')}${stat(nf(a.d7), 'Aktivních za 7 dní')}${stat(nf(a.d30), 'Aktivních za 30 dní')}
    ${stat(nf(t.logins), 'Přihlášení (' + nf(t.login_users) + ' různých lidí)')}${stat(nf(t.fails), 'Neúspěšných přihlášení', t.fails ? 'var(--bad, #ff5d6c)' : '')}
    ${stat(nf(t.sessions), 'Návštěv (relací)')}${stat(nf(t.views), 'Zobrazených stránek')}${stat(nf(t.clicks), 'Kliknutí')}
    ${stat(dur(t.secs), 'Aktivní čas celkem')}${stat(t.active_users ? dur(t.secs / t.active_users) : '—', 'Průměr na aktivního uživatele')}
  </div>
  <h3 style="margin:22px 0 8px">Průběh po dnech</h3>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    ${chart('Přihlášení', D.daily.map(r => r.logins), '#4fd1ff')}${chart('Aktivních uživatelů', D.daily.map(r => r.users), '#2fe3a0')}${chart('Zobrazení stránek', D.daily.map(r => r.views), '#7c5cff')}
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:12px">
    <div class="card" style="padding:14px 16px"><div class="small muted" style="margin-bottom:6px">Aktivita podle hodiny dne (pražský čas)</div>${bars(hrs, hrs.map((_, h) => h + ':00'), '#ffb84d')}<div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>0 h</span><span>12 h</span><span>23 h</span></div></div>
    <div class="card" style="padding:14px 16px"><div class="small muted" style="margin-bottom:8px">Zařízení</div>${D.devices.length ? D.devices.map(r => `<div style="display:flex;justify-content:space-between;gap:10px;margin:4px 0"><span>${esc(devName[r.device] || r.device)}</span><span class="muted">${r.users} lidí · ${r.views} zobrazení · ${Math.round(r.views / devTotal * 100)} %</span></div>`).join('') : '<span class="muted">Zatím žádná data.</span>'}</div>
  </div>

  <h3 style="margin:22px 0 8px">Cesta uživatele (celkem v systému)</h3>
  <div class="card" style="padding:14px 16px">${funnel.map(([l, v]) => `<div style="margin:7px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${l}</span><b>${nf(v)} <span class="muted" style="font-weight:500">· ${pct(v, u.total)}</span></b></div><div style="height:8px;border-radius:6px;background:rgba(120,160,255,.12);margin-top:3px"><div style="height:8px;border-radius:6px;width:${Math.max(1, Math.round(v / fmax * 100))}%;background:linear-gradient(90deg,#1e86e0,#7c5cff)"></div></div></div>`).join('')}</div>

  <h3 style="margin:22px 0 8px">Discount Credit a převody</h3>
  <div class="grid">
    ${stat(nf(ta.dc) + ' DC', 'Převedeno ze starého systému (' + ta.n + ' žádostí)', 'var(--ok)')}${stat(nf(tp.dc) + ' DC', 'Čeká na zpracování (' + tp.n + ' žádostí)', 'var(--blue)')}${stat(nf(trj.n), 'Zamítnutých žádostí')}
    ${stat(nf(f.transferred), 'Lidí, kteří žádali o převod')}${stat(nf(cr.holders), 'Lidí s připsaným DC')}${stat(nf(cr.issued) + ' DC', 'Celkem připsáno')}
    ${stat(nf(cr.used) + ' DC', 'Celkem uplatněno / odečteno')}${stat(nf(cr.balance) + ' DC', 'Zůstatek všech uživatelů')}${stat(nf(oAll.n), 'Objednávek (uplatněno ' + nf(oAll.dc) + ' DC)')}
  </div>
  <div class="card tbl-wrap" style="margin-top:12px">${tbl(['Stav', 'Zdroj', 'Počet', 'Lidí', 'DC'], tr.map(x => `<tr><td data-l="Stav"><span class="badge ${x.status === 'approved' ? 'active' : x.status === 'rejected' ? 'blocked' : 'invited'}">${x.status === 'approved' ? 'převedeno' : x.status === 'rejected' ? 'zamítnuto' : 'zpracovává se'}</span></td><td data-l="Zdroj">${x.kind === 'withdrawal' ? 'Z výběru' : x.kind === 'support' ? 'Z podpory' : esc(x.kind || '—')}</td><td data-l="Počet">${x.n}</td><td data-l="Lidí">${x.users}</td><td data-l="DC"><b>${nf(x.dc)} DC</b></td></tr>`), 'Zatím žádné žádosti o převod.')}</div>
  <div class="card tbl-wrap" style="margin-top:12px">${tbl(['Objednávky', 'Počet', 'Lidí', 'Hodnota bez DPH', 'Uplatněné DC'], D.orders.map(o => `<tr><td data-l="Stav"><span class="badge ${o.status === 'confirmed' ? 'active' : o.status === 'cancelled' ? 'blocked' : 'invited'}">${o.status === 'confirmed' ? 'potvrzeno' : o.status === 'cancelled' ? 'zrušeno' : 'čeká na potvrzení'}</span></td><td data-l="Počet">${o.n}</td><td data-l="Lidí">${o.users}</td><td data-l="Hodnota">${nf(o.net)}</td><td data-l="DC">${nf(o.dc_used)} DC</td></tr>`), 'Zatím žádné objednávky.')}</div>

  <h3 style="margin:22px 0 8px">Co si prohlížejí</h3>
  <div class="card tbl-wrap">${tbl(['Stránka', 'Zobrazení', 'Lidí', 'Čas celkem', 'Čas / zobrazení', 'Průměrný scroll'], D.pages.map(p => `<tr><td data-l="Stránka">${pageName(p.path)}</td><td data-l="Zobrazení"><b>${nf(p.views)}</b></td><td data-l="Lidí">${nf(p.users)}</td><td data-l="Čas">${dur(p.secs)}</td><td data-l="Čas/zobr.">${p.views ? dur(p.secs / p.views) : '—'}</td><td data-l="Scroll">${p.scroll != null ? p.scroll + ' %' : '—'}</td></tr>`))}</div>

  <h3 style="margin:22px 0 8px">Na co klikají</h3>
  <div class="card tbl-wrap">${tbl(['Prvek', 'Stránka', 'Kliknutí', 'Lidí'], D.clicks.map(c => `<tr><td data-l="Prvek"><b>${esc(c.label || '—')}</b></td><td data-l="Stránka" class="small">${pageName(c.path)}</td><td data-l="Kliknutí"><b>${nf(c.n)}</b></td><td data-l="Lidí">${nf(c.users)}</td></tr>`))}</div>

  <h3 style="margin:22px 0 8px">Co čtou a studují (sekce a nadpisy, které si opravdu zobrazili)</h3>
  <div class="card tbl-wrap">${tbl(['Sekce', 'Stránka', 'Zobrazení', 'Lidí'], D.sections.map(c => `<tr><td data-l="Sekce"><b>${esc(c.label || '—')}</b></td><td data-l="Stránka" class="small">${pageName(c.path)}</td><td data-l="Zobrazení">${nf(c.n)}</td><td data-l="Lidí">${nf(c.users)}</td></tr>`))}</div>
  ${D.interacts.length ? `<h3 style="margin:22px 0 8px">Práce s ovládacími prvky (posuvníky, přepínače, výběry)</h3><div class="card tbl-wrap">${tbl(['Prvek', 'Stránka', 'Změn', 'Lidí'], D.interacts.map(c => `<tr><td data-l="Prvek"><b>${esc(c.label)}</b></td><td data-l="Stránka" class="small">${pageName(c.path)}</td><td data-l="Změn">${nf(c.n)}</td><td data-l="Lidí">${nf(c.users)}</td></tr>`))}</div>` : ''}

  <h3 style="margin:22px 0 8px">Nejaktivnější uživatelé</h3>
  <div class="card tbl-wrap">${tbl(['Uživatel', 'Přihlášení', 'Zobrazení', 'Kliknutí', 'Aktivní čas', 'Naposledy'], D.topUsers.map(r => `<tr><td data-l="Uživatel">${who(r)}</td><td data-l="Přihlášení">${r.logins}</td><td data-l="Zobrazení">${r.pv}</td><td data-l="Kliknutí">${r.cl}</td><td data-l="Čas"><b>${dur(r.secs)}</b></td><td data-l="Naposledy" class="small muted">${fmtDT(r.last_seen)}</td></tr>`))}</div>

  <h3 style="margin:22px 0 8px">Poslední přihlášení a události účtů</h3>
  <div class="card tbl-wrap">${tbl(['Kdy', 'Uživatel', 'Událost', 'Zařízení', 'IP'], D.logins.map(r => `<tr><td data-l="Kdy" class="small muted">${fmtDT(r.created_at)}</td><td data-l="Uživatel">${who(r)}</td><td data-l="Událost">${typeBadge(r.type)}</td><td data-l="Zařízení" class="small">${esc(devName[r.device] || r.device || '—')}</td><td data-l="IP" class="small muted">${esc(r.ip || '—')}</td></tr>`), 'Zatím žádná přihlášení od zapnutí statistik.')}</div>
  ${D.regs.length ? `<h3 style="margin:22px 0 8px">Nové registrace v období podle zdroje</h3><div class="card" style="padding:14px 16px">${D.regs.map(r => `<span class="badge invited" style="margin:2px 6px 2px 0">${esc(r.source)}: ${r.n}</span>`).join('')}</div>` : ''}
  <p class="muted small" style="margin-top:18px">Statistiky chování se sbírají od nasazení této funkce; dříve proběhlé návštěvy nejsou v datech. Přihlášení před tímto datem je vidět jen v „posledním přihlášení" u uživatele.</p>`, holyosUrl);
  }

  function adminStatsUser({ admin, data: D, days, holyosUrl }) {
    const s = D.s, t = D.tot;
    const name = [s.last_name, s.first_name].filter(Boolean).join(' ') || s.email;
    const metaTxt = (e) => { const m = e.meta || {}; if (e.type === 'click') return (m.href ? '→ ' + m.href : '') + (m.tag ? ' <' + m.tag + '>' : ''); if (e.type === 'interact') return m.v != null ? 'hodnota: ' + m.v : ''; if (e.type === 'scroll') return m.pct + ' %'; if (e.type === 'pageview') return (m.ref ? 'z ' + m.ref + ' · ' : '') + (m.w ? m.w + '×' + m.h : ''); return m.by ? 'přes ' + m.by : (m.sent != null ? (m.sent ? 'e-mail odeslán' : 'e-mail neodeslán') : ''); };
    return adminLayout('Statistiky uživatele', 'stat', admin, `
  <p style="margin:0 0 8px"><a href="/admin/stats">← statistiky</a> · <a href="/admin/supporters/${s.id}">detail uživatele</a></p>
  <h1 style="margin:0 0 4px">${esc(name)}</h1>
  <p class="muted" style="margin-top:0">${esc(s.email)}${s.nick ? ' · nick <b>' + esc(s.nick) + '</b>' : ''} · registrace ${fmtDT(s.created_at)} · aktivace ${fmtDT(s.activated_at)} · poslední přihlášení ${fmtDT(s.last_login_at)}</p>
  ${periodBar('/admin/stats/user/' + s.id, days)}
  <div class="grid">
    ${stat(nf(t.logins), 'Přihlášení')}${stat(nf(t.sessions), 'Návštěv')}${stat(nf(t.views), 'Zobrazených stránek')}${stat(nf(t.clicks), 'Kliknutí')}${stat(dur(t.secs), 'Aktivní čas')}${stat(nf(D.balance) + ' DC', 'Zůstatek DC')}
  </div>
  <h3 style="margin:22px 0 8px">Stránky</h3>
  <div class="card tbl-wrap">${tbl(['Stránka', 'Zobrazení', 'Čas', 'Max. scroll'], D.pages.map(p => `<tr><td data-l="Stránka">${pageName(p.path)}</td><td data-l="Zobrazení">${p.views}</td><td data-l="Čas">${dur(p.secs)}</td><td data-l="Scroll">${p.scroll != null ? p.scroll + ' %' : '—'}</td></tr>`))}</div>
  <h3 style="margin:22px 0 8px">Nejčastější kliknutí</h3>
  <div class="card tbl-wrap">${tbl(['Prvek', 'Stránka', 'Kliknutí'], D.clicks.map(c => `<tr><td data-l="Prvek"><b>${esc(c.label || '—')}</b></td><td data-l="Stránka" class="small">${pageName(c.path)}</td><td data-l="Kliknutí">${c.n}</td></tr>`))}</div>
  <h3 style="margin:22px 0 8px">Převody podpory a objednávky</h3>
  <div class="card tbl-wrap">${tbl(['Datum', 'Typ', 'Částka', 'DC / hodnota', 'Stav'], [
      ...D.transfers.map(x => `<tr><td data-l="Datum" class="small muted">${fmtDT(x.created_at)}</td><td data-l="Typ">Převod ${x.kind === 'withdrawal' ? 'z výběru' : 'z podpory'}</td><td data-l="Částka">${nf(x.amount, 2)} ${x.currency === 'EUR' ? '€' : 'Kč'}</td><td data-l="DC"><b>${nf(x.dc_amount, 2)} DC</b></td><td data-l="Stav">${x.status === 'approved' ? 'převedeno' : x.status === 'rejected' ? 'zamítnuto' : 'zpracovává se'}</td></tr>`),
      ...D.orders.map(o => `<tr><td data-l="Datum" class="small muted">${fmtDT(o.created_at)}</td><td data-l="Typ">Objednávka: ${esc(o.product_name)}</td><td data-l="Částka">${nf(o.final_net, 2)} ${o.currency === 'EUR' ? '€' : 'Kč'}</td><td data-l="DC">uplatněno ${nf(o.dc_used, 2)} DC</td><td data-l="Stav">${o.status === 'confirmed' ? 'potvrzeno' : o.status === 'cancelled' ? 'zrušeno' : 'čeká na potvrzení'}</td></tr>`)], 'Žádné převody ani objednávky.')}</div>
  <h3 style="margin:22px 0 8px">Časová osa (posledních 300 událostí)</h3>
  <div class="card tbl-wrap">${tbl(['Kdy', 'Událost', 'Stránka', 'Detail', 'Zařízení'], D.events.map(e => `<tr><td data-l="Kdy" class="small muted" style="white-space:nowrap">${fmtDT(e.created_at)}</td><td data-l="Událost">${typeBadge(e.type)}</td><td data-l="Stránka" class="small">${pageName(e.path)}</td><td data-l="Detail" class="small">${e.label ? '<b>' + esc(e.label) + '</b> ' : ''}<span class="muted">${esc(metaTxt(e))}</span></td><td data-l="Zařízení" class="small muted">${esc(devName[e.device] || e.device || '')}</td></tr>`), 'Zatím žádné zaznamenané události.')}</div>`, holyosUrl);
  }

  function adminLive({ admin, holyosUrl }) {
    return adminLayout('Statistiky živě', 'stat', admin, `
  <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><h1 style="margin:0">Živě <span id="lv-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#2fe3a0;box-shadow:0 0 0 0 rgba(47,227,160,.6);animation:lvp 1.6s infinite;vertical-align:middle"></span></h1>
    <div class="row" style="gap:8px"><a class="btn sec sm" href="/admin/stats">← Přehled statistik</a><button class="btn sec sm" id="lv-pause" type="button">Pozastavit</button></div></div>
  <p class="muted" style="margin-top:6px">Kdo je právě v aplikaci, na které stránce je a co dělá. Obnovuje se každé 3 sekundy. „Online" = aktivní v posledních 90 s, „nečinný" = otevřená stránka bez aktivity (do 10 min).</p>
  <style>@keyframes lvp{0%{box-shadow:0 0 0 0 rgba(47,227,160,.6)}70%{box-shadow:0 0 0 10px rgba(47,227,160,0)}100%{box-shadow:0 0 0 0 rgba(47,227,160,0)}} .lv-new{animation:lvn 1.6s ease-out} @keyframes lvn{from{background:rgba(79,209,255,.22)}to{background:transparent}} .lvd{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}</style>
  <div class="grid" id="lv-kpi" style="margin-top:12px"></div>
  <h3 style="margin:20px 0 8px">Aktivita posledních 30 minut</h3>
  <div class="card" style="padding:14px 16px"><div id="lv-chart"></div><div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>před 30 min</span><span>teď</span></div></div>
  <h3 style="margin:20px 0 8px">Právě online</h3>
  <div class="card tbl-wrap" id="lv-online"></div>
  <h3 style="margin:20px 0 8px">Kde se zrovna nacházejí</h3>
  <div class="card" style="padding:14px 16px" id="lv-pages"></div>
  <h3 style="margin:20px 0 8px">Proud událostí</h3>
  <div class="card tbl-wrap" id="lv-feed"></div>
  <script>(function(){
    var PAGES=${JSON.stringify(PAGES)},DEV={mobile:'Mobil',desktop:'Počítač',tablet:'Tablet'},TY={pageview:'otevřel stránku',click:'klikl',section:'čte',interact:'změnil',login:'přihlášení',login_fail:'neúspěšné přihlášení',logout:'odhlášení',consent:'souhlas s podmínkami',reset_request:'žádost o heslo'};
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function pg(p){return p?(PAGES[p]?esc(PAGES[p]):esc(p)):'—';}
    function nm(u){var n=[u.last_name,u.first_name].filter(Boolean).join(' ')||u.email||u.nick||'?';return (u.id||u.uid)?'<a href="/admin/stats/user/'+(u.id||u.uid)+'"><b>'+esc(n)+'</b></a>'+(u.nick?'<div class="small muted">'+esc(u.nick)+'</div>':''):'<span class="muted">neznámý</span>';}
    function ago(s){s=Math.max(0,Math.round(s));if(s<60)return s+' s';var m=Math.floor(s/60);if(m<60)return m+' min';return Math.floor(m/60)+' h '+(m%60)+' min';}
    function hhmm(d){return new Date(d).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/Prague'});}
    function stat(v,l,c){return '<div class="stat"><div class="v"'+(c?' style="color:'+c+'"':'')+'>'+v+'</div><div class="l">'+l+'</div></div>';}
    var since=0,seen={},feedRows=[],paused=false;
    function render(d){
      var on=d.online.filter(function(u){return u.state==='online';}),idle=d.online.length-on.length,c=d.counters||{},p=d.pending||{};
      document.getElementById('lv-kpi').innerHTML=stat(on.length,'Online právě teď','#2fe3a0')+stat(idle,'Nečinných (stránka otevřená)')+stat(c.ev5||0,'Akcí za posledních 5 min')+stat(c.pv60||0,'Zobrazení za 60 min')+stat(c.users60||0,'Aktivních lidí za 60 min')+stat(c.logins_today||0,'Přihlášení dnes')+stat(p.pending_tr||0,'Převodů čeká na zpracování',(p.pending_tr?'#4fd1ff':''))+stat(p.new_orders||0,'Nových objednávek',(p.new_orders?'#4fd1ff':''));
      var mx=Math.max(1,Math.max.apply(null,d.minutes.map(function(m){return m.n;})));
      document.getElementById('lv-chart').innerHTML='<svg viewBox="0 0 100 70" preserveAspectRatio="none" style="width:100%;height:80px;display:block">'+d.minutes.map(function(m,i){var h=Math.max(m.n?2:0,m.n/mx*64),w=100/d.minutes.length;return '<rect x="'+(i*w+w*.12).toFixed(2)+'" y="'+(70-h).toFixed(1)+'" width="'+(w*.76).toFixed(2)+'" height="'+h.toFixed(1)+'" rx=".6" fill="#4fd1ff"><title>'+hhmm(m.t)+': '+m.n+'</title></rect>';}).join('')+'</svg>';
      document.getElementById('lv-online').innerHTML=d.online.length?'<table class="cards"><thead><tr><th>Uživatel</th><th>Stav</th><th>Právě na stránce</th><th>Poslední akce</th><th>Zařízení</th><th>V aplikaci</th></tr></thead><tbody>'+d.online.map(function(u){var col=u.state==='online'?'#2fe3a0':'#ffb84d';return '<tr><td data-l="Uživatel">'+nm(u)+'</td><td data-l="Stav"><span class="lvd" style="background:'+col+'"></span>'+(u.state==='online'?'online':'nečinný '+ago(u.idle_s))+'</td><td data-l="Stránka"><b>'+pg(u.path)+'</b></td><td data-l="Akce" class="small">'+(u.last_type?(esc(TY[u.last_type]||u.last_type)+(u.last_label?': <b>'+esc(u.last_label)+'</b>':'')+' <span class="muted">před '+ago((Date.now()-new Date(u.last_at))/1000)+'</span>'):'<span class="muted">—</span>')+'</td><td data-l="Zařízení" class="small">'+esc(DEV[u.device]||u.device||'—')+'</td><td data-l="V aplikaci" class="small muted">'+ago(u.on_s)+'</td></tr>';}).join('')+'</tbody></table>':'<p class="muted" style="margin:0">Právě nikdo není v aplikaci.</p>';
      var g={};d.online.forEach(function(u){var k=u.path||'?';g[k]=(g[k]||0)+1;});var ks=Object.keys(g).sort(function(a,b){return g[b]-g[a];});
      document.getElementById('lv-pages').innerHTML=ks.length?ks.map(function(k){return '<span class="badge invited" style="margin:2px 8px 2px 0">'+pg(k)+': <b>'+g[k]+'</b></span>';}).join(''):'<span class="muted">—</span>';
      var fresh=d.feed.filter(function(e){return !seen[e.id];});fresh.forEach(function(e){seen[e.id]=1;e._new=since>0;if(e.id>since)since=e.id;});
      feedRows=fresh.concat(feedRows).slice(0,80);
      document.getElementById('lv-feed').innerHTML=feedRows.length?'<table class="cards"><thead><tr><th>Čas</th><th>Uživatel</th><th>Událost</th><th>Stránka</th><th>Detail</th></tr></thead><tbody>'+feedRows.map(function(e){var m=e.meta||{},det=(e.label?'<b>'+esc(e.label)+'</b> ':'')+(m.href?'<span class="muted">→ '+esc(m.href)+'</span>':(m.v!=null?'<span class="muted">hodnota '+esc(m.v)+'</span>':''));return '<tr'+(e._new?' class="lv-new"':'')+'><td data-l="Čas" class="small muted" style="white-space:nowrap">'+hhmm(e.created_at)+'</td><td data-l="Uživatel">'+nm(e)+'</td><td data-l="Událost">'+esc(TY[e.type]||e.type)+'</td><td data-l="Stránka" class="small">'+pg(e.path)+'</td><td data-l="Detail" class="small">'+det+'</td></tr>';}).join('')+'</tbody></table>':'<p class="muted" style="margin:0">Zatím žádné události.</p>';
      fresh.forEach(function(e){e._new=false;});
    }
    function tick(){if(paused)return;fetch('/admin/stats/live.json?since='+since,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(d)render(d);document.getElementById('lv-dot').style.background=d?'#2fe3a0':'#ff5d6c';}).catch(function(){document.getElementById('lv-dot').style.background='#ff5d6c';});}
    document.getElementById('lv-pause').addEventListener('click',function(){paused=!paused;this.textContent=paused?'Pokračovat':'Pozastavit';document.getElementById('lv-dot').style.animationPlayState=paused?'paused':'running';if(!paused)tick();});
    tick();setInterval(tick,3000);
  })();</script>`, holyosUrl);
  }

  return { adminStats, adminStatsUser, adminLive };
};
