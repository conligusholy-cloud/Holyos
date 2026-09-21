// =============================================================================
// HolyOS — CAD výkresy: záložka „Importy" (samostatný modul, self-injecting)
// =============================================================================
// Přidává se do stránky jediným <script src="imports-tab.js"> na konci body.
// Sám si vloží záložky nad obsah + vlastní pohled s protokoly importů, takže
// se nemusí zasahovat do velkého index.html (bezpečné proti ořezu při zápisu).
// Backend: GET /api/cad/imports a /api/cad/imports/:id.
(function () {
  'use strict';

  function auth() {
    var h = { 'Content-Type': 'application/json' };
    var t = sessionStorage.getItem('token');
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }
  function opts(extra) { return Object.assign({ credentials: 'include', headers: auth() }, extra || {}); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function fmtDT(d) { if (!d) return '—'; var dt = new Date(d); return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('cs-CZ'); }
  function fmtMs(ms) { if (ms == null) return '—'; ms = Number(ms); if (!isFinite(ms)) return '—'; if (ms < 1000) return ms + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(1) + ' s'; var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000); return m + ' min ' + s + ' s'; }

  var loaded = false;

  function modalRoot() {
    var m = document.getElementById('modal-root');
    if (!m) { m = document.createElement('div'); m.id = 'modal-root'; document.body.appendChild(m); }
    return m;
  }

  function switchTab(name) {
    var isImp = name === 'imports';
    var content = document.querySelector('.content');
    var impView = document.getElementById('cad-view-imports');
    if (content) content.style.display = isImp ? 'none' : '';
    if (impView) impView.style.display = isImp ? '' : 'none';
    var td = document.getElementById('cadtab-drawings'), ti = document.getElementById('cadtab-imports');
    if (td && ti) {
      td.style.borderBottomColor = isImp ? 'transparent' : 'var(--primary)';
      td.style.color = isImp ? 'var(--text2)' : 'var(--text)';
      td.style.fontWeight = isImp ? '600' : '700';
      ti.style.borderBottomColor = isImp ? 'var(--primary)' : 'transparent';
      ti.style.color = isImp ? 'var(--text)' : 'var(--text2)';
      ti.style.fontWeight = isImp ? '700' : '600';
    }
    if (isImp && !loaded) loadImports();
  }

  async function loadImports() {
    var box = document.getElementById('cad-imports-list');
    if (!box) return;
    box.innerHTML = '<div style="padding:16px;color:var(--text2);">Načítám…</div>';
    try {
      var res = await fetch('/api/cad/imports?limit=200', opts());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var rows = await res.json();
      loaded = true;
      renderImports(rows);
    } catch (e) {
      box.innerHTML = '<div style="padding:16px;color:#ef4444;">Chyba načtení: ' + esc(e.message) + '</div>';
    }
  }

  function pill(n, color) {
    return '<span style="display:inline-block;min-width:22px;text-align:center;background:' + color + '22;color:' + color + ';border-radius:6px;padding:1px 8px;font-weight:700;font-size:12px;">' + (n || 0) + '</span>';
  }

  function renderImports(rows) {
    var box = document.getElementById('cad-imports-list');
    if (!box) return;
    if (!rows || !rows.length) { box.innerHTML = '<div style="padding:16px;color:var(--text2);">Zatím žádné importy.</div>'; return; }
    var h = '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
      '<thead><tr style="text-align:left;color:var(--text2);border-bottom:1px solid var(--border);">' +
      '<th style="padding:8px 10px;">Datum a čas</th><th style="padding:8px 10px;">Kdo</th><th style="padding:8px 10px;">Zdroj</th>' +
      '<th style="padding:8px 10px;">Souborů</th><th style="padding:8px 10px;">Vytvořeno</th><th style="padding:8px 10px;">Aktualizováno</th>' +
      '<th style="padding:8px 10px;">Beze změny</th><th style="padding:8px 10px;">Chyby</th><th style="padding:8px 10px;">Trvání</th><th style="padding:8px 10px;">Stav</th><th></th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr style="border-bottom:1px solid var(--border);cursor:pointer;" onclick="cadImports.open(' + r.id + ')">' +
        '<td style="padding:8px 10px;white-space:nowrap;font-weight:600;">' + fmtDT(r.created_at) + '</td>' +
        '<td style="padding:8px 10px;">' + esc(r.author || '—') + '</td>' +
        '<td style="padding:8px 10px;color:var(--text2);">' + esc(r.source || '—') + '</td>' +
        '<td style="padding:8px 10px;">' + (r.count_files || 0) + '</td>' +
        '<td style="padding:8px 10px;">' + pill(r.count_created, '#10b981') + '</td>' +
        '<td style="padding:8px 10px;">' + pill(r.count_updated, '#3b82f6') + '</td>' +
        '<td style="padding:8px 10px;">' + pill(r.count_not_changed, '#9ca3af') + '</td>' +
        '<td style="padding:8px 10px;">' + pill(r.count_errors, r.count_errors ? '#ef4444' : '#9ca3af') + '</td>' +
        '<td style="padding:8px 10px;white-space:nowrap;color:var(--text2);">' + fmtMs(r.duration_ms) + '</td>' +
        '<td style="padding:8px 10px;">' + (r.success ? '<span style="color:#10b981;font-weight:700;">✅ OK</span>' : '<span style="color:#ef4444;font-weight:700;">⚠ chyby</span>') + '</td>' +
        '<td style="padding:8px 10px;"><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();cadImports.open(' + r.id + ')">Protokol →</button></td>' +
        '</tr>';
    });
    h += '</tbody></table>';
    box.innerHTML = h;
  }

  function section(title, items, color, mode) {
    if (!items || !items.length) return '';
    var rows = items.map(function (it) {
      if (mode === 'error') return '<tr><td style="padding:4px 8px;">' + esc(it.file || '') + '</td><td style="padding:4px 8px;color:#ef4444;">' + esc(it.message || '') + '</td></tr>';
      return '<tr><td style="padding:4px 8px;">' + esc(it.DrawingFileName || it.file || '') + '</td><td style="padding:4px 8px;">' + esc(it.Title || '') + '</td><td style="padding:4px 8px;text-align:center;">' + (it.Version != null ? ('v' + it.Version) : '—') + '</td></tr>';
    }).join('');
    var head = mode === 'error'
      ? '<tr style="color:var(--text2);"><th style="text-align:left;padding:4px 8px;">Soubor</th><th style="text-align:left;padding:4px 8px;">Chyba</th></tr>'
      : '<tr style="color:var(--text2);"><th style="text-align:left;padding:4px 8px;">Soubor</th><th style="text-align:left;padding:4px 8px;">Název</th><th style="padding:4px 8px;">Verze</th></tr>';
    return '<h4 style="margin:14px 0 4px;color:' + color + ';">' + title + ' (' + items.length + ')</h4>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;">' + head + rows + '</table>';
  }

  async function openProtocol(id) {
    var root = modalRoot();
    root.innerHTML = overlay('<div style="padding:24px;color:var(--text2);">Načítám…</div>');
    try {
      var res = await fetch('/api/cad/imports/' + id, opts());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var b = await res.json();
      var d = b.details || {};
      var totalMs = (d.total_ms != null ? d.total_ms : b.duration_ms);

      var stepsRows = (d.steps || []).map(function (s) {
        return '<tr><td style="padding:4px 8px;">' + esc(s.name) + '</td><td style="padding:4px 8px;text-align:right;white-space:nowrap;">' + fmtMs(s.ms) + '</td></tr>';
      }).join('');
      var stepsTable = (d.steps && d.steps.length) ? ('<h4 style="margin:14px 0 4px;">Kroky procesu importu</h4>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<tr style="color:var(--text2);"><th style="text-align:left;padding:4px 8px;">Krok</th><th style="text-align:right;padding:4px 8px;">Trvání</th></tr>' +
        stepsRows +
        '<tr style="border-top:1px solid var(--border);font-weight:700;"><td style="padding:6px 8px;">Celkem</td><td style="padding:6px 8px;text-align:right;">' + fmtMs(totalMs) + '</td></tr></table>') : '';

      var ft = (d.file_timings || []).slice().sort(function (a, c) { return (c.ms || 0) - (a.ms || 0); });
      var actLabel = { created: 'vytvořeno', updated: 'aktualizováno', not_changed: 'beze změny', error: 'chyba' };
      var ftRows = ft.map(function (t) {
        return '<tr><td style="padding:4px 8px;">' + esc(t.file || '') + '</td><td style="padding:4px 8px;">' + esc(actLabel[t.action] || t.action || '') + '</td><td style="padding:4px 8px;text-align:right;white-space:nowrap;">' + fmtMs(t.ms) + '</td></tr>';
      }).join('');
      var ftTable = ft.length ? ('<h4 style="margin:14px 0 4px;">Trvání po souborech</h4>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<tr style="color:var(--text2);"><th style="text-align:left;padding:4px 8px;">Soubor</th><th style="text-align:left;padding:4px 8px;">Akce</th><th style="text-align:right;padding:4px 8px;">Trvání</th></tr>' +
        ftRows + '</table>') : '';

      var inner =
        '<div id="cad-protocol-print">' +
        '<h2 style="margin:0 0 4px;">Protokol o importu CAD výkresů</h2>' +
        '<div style="color:var(--text2);font-size:13px;margin-bottom:10px;">' + fmtDT(b.created_at) + ' · ' + esc(b.author || '—') + ' · zdroj: ' + esc(b.source || '—') + (b.project_label ? ' · ' + esc(b.project_label) : '') + (totalMs != null ? ' · celkové trvání: ' + fmtMs(totalMs) : '') + '</div>' +
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--text2);line-height:1.5;">' +
        '<b style="color:var(--text);">Popis procesu importu:</b> Desktopový CAD exportér odešle výkresy a jejich konfigurace do HolyOS. Import proběhne v krocích: <b>1) Validace vstupu</b>, <b>2) Nalezení projektu</b>, <b>3) Zpracování výkresů</b> — pro každý soubor se uloží přílohy (PNG/PDF/STL), porovná se feature-hash / kontrolní součet proti poslední verzi a podle toho se výkres <i>vytvoří</i>, <i>aktualizuje</i> (nová verze) nebo označí <i>beze změny</i>, uloží se konfigurace a změnový log, a nakonec <b>4) Uložení protokolu</b>.' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;font-size:13px;">' +
        '<span>Souborů: <b>' + (b.count_files || 0) + '</b></span>' +
        '<span style="color:#10b981;">Vytvořeno: <b>' + (b.count_created || 0) + '</b></span>' +
        '<span style="color:#3b82f6;">Aktualizováno: <b>' + (b.count_updated || 0) + '</b></span>' +
        '<span style="color:#9ca3af;">Beze změny: <b>' + (b.count_not_changed || 0) + '</b></span>' +
        '<span style="color:#ef4444;">Chyby: <b>' + (b.count_errors || 0) + '</b></span>' +
        '</div>' +
        stepsTable + ftTable +
        section('Vytvořené výkresy', d.created, '#10b981') +
        section('Aktualizované výkresy', d.updated, '#3b82f6') +
        section('Beze změny', d.not_changed, '#9ca3af') +
        section('Neznámé komponenty', d.unknown, '#eab308') +
        section('Chyby', d.errors, '#ef4444', 'error') +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="cadImports.print()">🖨️ Tisk / PDF</button>' +
        '<button class="btn btn-secondary" onclick="document.getElementById(\'modal-root\').innerHTML=\'\'">Zavřít</button>' +
        '</div>';
      root.innerHTML = overlay(inner, true);
    } catch (e) {
      root.innerHTML = overlay('<div style="padding:20px;color:#ef4444;">Chyba: ' + esc(e.message) + '</div>', true);
    }
  }

  function overlay(inner, closable) {
    var onclick = closable ? ' onclick="if(event.target===this)document.getElementById(\'modal-root\').innerHTML=\'\'"' : '';
    return '<div class="modal-overlay"' + onclick + ' style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;">' +
      '<div class="modal" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;width:780px;max-width:95vw;max-height:90vh;overflow:auto;">' + inner + '</div></div>';
  }

  function printProtocol() {
    var el = document.getElementById('cad-protocol-print');
    if (!el) return;
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<html><head><meta charset="utf-8"><title>Protokol o importu</title>' +
      '<style>body{font-family:Arial,sans-serif;color:#111;padding:24px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ddd;padding:4px 8px;font-size:12px;text-align:left;} h2{margin:0 0 6px;} h4{margin:14px 0 4px;}</style>' +
      '</head><body>' + el.innerHTML + '</body></html>');
    w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }

  function inject() {
    var content = document.querySelector('.content');
    if (!content || document.getElementById('cadtab-drawings')) return;
    // Záložky nad obsah
    var tabs = document.createElement('div');
    tabs.className = 'cad-tabs';
    tabs.style.cssText = 'display:flex;gap:6px;margin:0 0 12px;border-bottom:1px solid var(--border);padding:0 2px;';
    tabs.innerHTML =
      '<button id="cadtab-drawings" style="background:none;border:none;border-bottom:2px solid var(--primary);color:var(--text);font-weight:700;font-size:13px;padding:8px 12px;cursor:pointer;">📄 Výkresy</button>' +
      '<button id="cadtab-imports" style="background:none;border:none;border-bottom:2px solid transparent;color:var(--text2);font-weight:600;font-size:13px;padding:8px 12px;cursor:pointer;">📥 Importy</button>';
    content.parentNode.insertBefore(tabs, content);
    // Pohled Importy za obsah
    var view = document.createElement('div');
    view.id = 'cad-view-imports';
    view.style.display = 'none';
    view.innerHTML = '<div id="cad-imports-list" style="margin-top:4px;">Načítám…</div>';
    content.parentNode.insertBefore(view, content.nextSibling);
    document.getElementById('cadtab-drawings').addEventListener('click', function () { switchTab('drawings'); });
    document.getElementById('cadtab-imports').addEventListener('click', function () { switchTab('imports'); });
  }

  window.cadImports = { open: openProtocol, print: printProtocol, reload: loadImports };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
  // Bezpečnostní pojistka — obsah se plní async, zkus injektovat i po chvíli.
  setTimeout(inject, 800);
  setTimeout(inject, 2000);
})();
