// BS2 — administrace leadů z veřejných stránek (/admin/leads): kdo, odkud přišel a celé jeho chování na webu.
// Lead vzniká rezervací schůzky (/cesta), online objednávkou nebo žádostí o balíček (/location, /findlocation).
// Chování = page_events všech jeho sezení (sids) + po přihlášení user_events jeho účtu.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { meeting: '📅 Schůzka', order: '🌐 Online objednávka', interest: '📝 Žádost o balíček' };
const fmt = (d) => new Date(d).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hm = (d) => new Date(d).toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const nicePath = (p) => String(p || '').replace(/^\/lp\/zachytna-stranka-velka-myslenka-bestseries2-cz-start$/, '/lp (záchytná stránka)');

const CSS = `
.ld-tbl{width:100%;border-collapse:collapse;font-size:13.5px}.ld-tbl th,.ld-tbl td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top}
.ld-tbl th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text2)}.ld-tbl tr:hover td{background:rgba(79,209,255,.04)}
.ld-pill{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--border2);white-space:nowrap;margin:0 4px 4px 0}
.ld-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:900px){.ld-grid{grid-template-columns:1fr}}
.ld-kv{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:14px}.ld-kv b{color:var(--text2);font-weight:500}
.ld-sess{border:1px solid var(--border);border-radius:12px;margin-top:12px;overflow:hidden}
.ld-sh{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 12px;background:rgba(79,209,255,.05);border-bottom:1px solid var(--border);font-size:13px}
.ld-ev{display:grid;grid-template-columns:76px 22px 1fr;gap:6px;padding:6px 12px;font-size:13px;border-bottom:1px solid rgba(120,160,255,.06)}
.ld-ev:last-child{border-bottom:none}.ld-ev .t{color:var(--text3);font-variant-numeric:tabular-nums}.ld-ev .d{color:var(--text)}.ld-ev .m{color:var(--text2)}
.ld-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}.ld-sum .s{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 12px}.ld-sum .s b{display:block;font-size:20px}.ld-sum .s span{font-size:12px;color:var(--text2)}
`;

function srcPills(src, leadSource) {
  const a = src || {}; const out = ['<span class="ld-pill" style="color:#4fd1ff;border-color:rgba(79,209,255,.5)">' + esc(leadSource(a)) + '</span>'];
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id'].forEach((k) => { if (a[k]) out.push('<span class="ld-pill">' + k.replace('utm_', '') + ': ' + esc(a[k]) + '</span>'); });
  if (a.fbclid) out.push('<span class="ld-pill">fbclid</span>'); if (a.gclid) out.push('<span class="ld-pill">gclid</span>');
  return out.join('');
}

function listPage(V, { admin, holyosUrl, rows, leadSource, q }) {
  return V.adminLayout('Leady', 'leads', admin, `<style>${CSS}</style>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><h2 style="margin:0">🎯 Leady z webu</h2><span class="muted small">Každý nový lead posílá notifikaci do Velína Tomášovi a Janovi.</span><span style="flex:1"></span>
  <form method="get" style="display:flex;gap:6px"><input name="q" value="${esc(q || '')}" placeholder="jméno, e-mail, telefon, zdroj…" style="padding:8px 10px;border-radius:9px;border:1px solid var(--border2);background:rgba(8,13,26,.85);color:var(--text);min-width:240px"><button class="btn sec sm">Hledat</button></form></div>
  <div class="card" style="padding:0;overflow:auto"><table class="ld-tbl"><thead><tr><th>Kdy</th><th>Typ</th><th>Kdo</th><th>Kontakt</th><th>Odkud přišel</th><th>Vstup</th><th>Návštěv</th></tr></thead><tbody>
  ${rows.length ? rows.map((r) => `<tr onclick="location.href='/admin/leads/${r.id}'" style="cursor:pointer"><td>${fmt(r.created_at)}</td><td>${KIND[r.kind] || esc(r.kind)}${r.detail && r.detail.termin ? '<div class="small muted">' + esc(r.detail.termin) + '</div>' : ''}</td><td><b>${esc(r.name || '—')}</b></td><td>${esc(r.phone || '')}<div class="small muted">${esc(r.email || '')}</div></td><td>${srcPills(r.source, leadSource)}</td><td class="small">${esc(nicePath((r.landing || '').split('?')[0]))}</td><td>${r.sessions || 0}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">Zatím žádné leady.</td></tr>'}
  </tbody></table></div>`, holyosUrl);
}

// Časová osa chování: sezení → události (bez šumu: myš, ping)
function timeline(events) {
  const bySid = new Map();
  events.forEach((e) => { if (!bySid.has(e.sid)) bySid.set(e.sid, []); bySid.get(e.sid).push(e); });
  const sess = [...bySid.entries()].map(([sid, ev]) => ({ sid, ev, start: ev[0].created_at, end: ev[ev.length - 1].created_at })).sort((a, b) => new Date(b.start) - new Date(a.start));
  const icon = { view: '👁', section: '📖', click: '👆', scroll: '↕', dwell: '⏱', exit: '🚪', custom: '⚠', time: '⏳' };
  return sess.map((s) => {
    const v = s.ev.find((e) => e.kind === 'view'); const vm = (v && v.meta) || {};
    const secs = s.ev.filter((e) => e.kind === 'time').reduce((a, e) => a + Number((e.meta || {}).s || 0), 0);
    const paths = [...new Set(s.ev.map((e) => nicePath(e.path)))];
    const rows = s.ev.filter((e) => !['mouse', 'ping', 'time'].includes(e.kind) && !(e.kind === 'custom' && e.label === 'perf')).map((e) => {
      const m = e.meta || {}; let d = '', mm = '';
      if (e.kind === 'view') { d = 'Otevřel ' + esc(nicePath(e.path)); mm = [m.ref ? 'odkud: ' + esc(m.ref) : '', m.q ? esc(m.q) : ''].filter(Boolean).join(' · '); }
      else if (e.kind === 'section') d = 'Četl sekci „' + esc(e.label) + '“';
      else if (e.kind === 'click') { d = 'Klikl: „' + esc(e.label) + '“'; mm = [m.sec ? 'v sekci ' + esc(m.sec) : '', m.href ? '→ ' + esc(m.href) : ''].filter(Boolean).join(' · '); }
      else if (e.kind === 'scroll') d = 'Doscrolloval na ' + esc(e.label) + ' %';
      else if (e.kind === 'dwell') { d = 'Čas na sekcích'; mm = (m.secs || []).map((x) => esc(x.l) + ' ' + x.s + ' s').join(' · '); }
      else if (e.kind === 'exit') { d = 'Odešel' + (e.label ? ' u sekce „' + esc(e.label) + '“' : ''); mm = m.scroll != null ? 'scroll ' + m.scroll + ' %' : ''; }
      else if (e.kind === 'custom') { d = e.label === 'rage_click' ? 'Opakované klikání (frustrace)' : e.label === 'dead_click' ? 'Klik na neklikací prvek' : esc(e.label); mm = [m.sec, m.txt].filter(Boolean).map(esc).join(' · '); }
      else d = esc(e.kind + ' ' + (e.label || ''));
      return `<div class="ld-ev"><span class="t">${hm(e.created_at)}</span><span>${icon[e.kind] || '•'}</span><span><span class="d">${d}</span>${mm ? ' <span class="m">· ' + mm + '</span>' : ''}</span></div>`;
    }).join('');
    return `<div class="ld-sess"><div class="ld-sh"><b>${fmt(s.start)}</b><span class="muted">${Math.round(secs / 60 * 10) / 10} min aktivně</span><span class="muted">${vm.ua === 'm' ? '📱 mobil' : vm.ua === 'd' ? '💻 počítač' : ''} ${esc(vm.br || '')}</span><span class="muted">${esc(paths.join(' → '))}</span></div>${rows || '<div class="ld-ev"><span></span><span></span><span class="m">Bez podrobností.</span></div>'}</div>`;
  }).join('');
}

function detailPage(V, { admin, holyosUrl, lead, events, userEvents, leadSource, related }) {
  const d = lead.detail || {};
  const views = events.filter((e) => e.kind === 'view').length, sessions = new Set(events.map((e) => e.sid)).size;
  const activeMin = Math.round(events.filter((e) => e.kind === 'time').reduce((a, e) => a + Number((e.meta || {}).s || 0), 0) / 6) / 10;
  const clicks = events.filter((e) => e.kind === 'click').length;
  return V.adminLayout('Lead ' + (lead.name || ''), 'leads', admin, `<style>${CSS}</style>
  <p><a href="/admin/leads">← všechny leady</a></p>
  <h2 style="margin:4px 0 12px">${esc(lead.name || 'Lead #' + lead.id)} <span class="muted" style="font-size:15px">${KIND[lead.kind] || esc(lead.kind)}</span></h2>
  <div class="ld-grid">
    <div class="card"><h3 style="margin-top:0">Kontakt a stav</h3><div class="ld-kv">
      <b>Vznik</b><span>${fmt(lead.created_at)}</span>
      <b>Telefon</b><span>${lead.phone ? '<a href="tel:' + esc(lead.phone) + '">' + esc(lead.phone) + '</a>' : '—'}</span>
      <b>E-mail</b><span>${lead.email ? '<a href="mailto:' + esc(lead.email) + '">' + esc(lead.email) + '</a>' : '—'}</span>
      ${Object.keys(d).map((k) => `<b>${esc(k.replace(/_/g, ' '))}</b><span>${esc(typeof d[k] === 'boolean' ? (d[k] ? 'ano' : 'ne') : d[k])}</span>`).join('')}
      <b>Účet BS2</b><span>${lead.supporter_id ? '<a href="/admin/supporters/' + lead.supporter_id + '">otevřít účet #' + lead.supporter_id + '</a>' : '—'}</span>
    </div>${related.length ? '<p class="small muted" style="margin:12px 0 0">Další záznamy stejného kontaktu: ' + related.map((r) => '<a href="/admin/leads/' + r.id + '">' + (KIND[r.kind] || r.kind) + ' ' + fmt(r.created_at) + '</a>').join(' · ') + '</p>' : ''}</div>
    <div class="card"><h3 style="margin-top:0">Odkud přišel</h3><div>${srcPills(lead.source, leadSource)}</div><div class="ld-kv" style="margin-top:10px">
      <b>Vstupní stránka</b><span>${esc(nicePath((lead.landing || '').split('?')[0]) || '—')}</span>
      <b>Odkaz</b><span>${esc((lead.source || {}).ref || '—')}</span>
      <b>První návštěva</b><span>${(lead.source || {}).ft ? fmt(lead.source.ft) : '—'}</span>
    </div></div>
  </div>
  <div class="ld-sum"><div class="s"><b>${sessions}</b><span>návštěv (sezení)</span></div><div class="s"><b>${views}</b><span>zobrazených stránek</span></div><div class="s"><b>${activeMin} min</b><span>aktivně na webu</span></div><div class="s"><b>${clicks}</b><span>kliknutí</span></div><div class="s"><b>${userEvents.length}</b><span>akcí v účtu BS2</span></div></div>
  <div class="card"><h3 style="margin-top:0">Chování na webu</h3>${events.length ? timeline(events) : '<p class="muted">Zatím bez záznamu chování (lead mohl přijít ze starého odkazu nebo s blokováním skriptů).</p>'}</div>
  ${userEvents.length ? `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Aktivita v účtu Best Series 2.0</h3>${userEvents.map((e) => `<div class="ld-ev"><span class="t">${fmt(e.created_at)}</span><span>•</span><span><span class="d">${esc(e.type)} ${esc(e.label || '')}</span> <span class="m">${esc(e.path || '')}</span></span></div>`).join('')}</div>` : ''}`, holyosUrl);
}

module.exports = { listPage, detailPage };
