// HolyOS — Sloupcové filtry tabulek (text / číslo / datum) s volbou operátoru
// Použití:
//   const cf = ColFilters.create({ columns: [{ key, type: 'text'|'num'|'date', get: row => value, ph }], onChange });
//   '<th>' + cf.cellHtml('key') + '</th>'      — buňka filtru (ikona operátoru + pole)
//   cf.bind(rootEl)                            — po vykreslení řádku filtrů (delegace událostí)
//   cf.apply(rows) → vyfiltrované řádky, cf.activeCount(), cf.clear(), cf.set(key, op, value)
// Více podmínek na sloupec = AND („Přidat podmínku…").
(function () {
  'use strict';

  const FUNNEL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/></svg>';
  const CAL = (t) => '<span style="display:inline-flex;align-items:center;gap:2px"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>' + (t ? '<b style="font-size:9px">' + t + '</b>' : '') + '</span>';

  // [op, label, ikona, počet hodnot (0/1/2), placeholder]
  const OPS = {
    in:           ['Je jeden z', '☑', 3],
    not_in:       ['Není žádný z', '☒', 3],
    contains:     ['Obsahuje', FUNNEL, 1],
    not_contains: ['Neobsahuje', '⊘', 1],
    eq:           ['Rovná se', '=', 1],
    neq:          ['Nerovná se', '≠', 1],
    gt:           ['Větší než', '>', 1],
    gte:          ['Větší nebo rovno', '≥', 1],
    lt:           ['Menší než', '<', 1],
    lte:          ['Menší nebo rovno', '≤', 1],
    range:        ['Rozsah', '↔', 2],
    empty:        ['Je prázdný', '∅', 0],
    not_empty:    ['Není prázdné', '⊙', 0],
    month:        ['Měsíc', CAL('M'), 1, 'např. 10.2026'],
    year:         ['Rok', CAL('R'), 1, 'např. 2026'],
    today:        ['Dnes', CAL('D'), 0],
    next_days:    ['Po dnešku + dny', CAL('+d'), 1, 'počet dní'],
    prev_days:    ['Před dneškem − dny', CAL('−d'), 1, 'počet dní'],
  };
  const TYPE_OPS = {
    text: ['contains', 'not_contains', 'empty', 'not_empty'],
    enum: ['in', 'not_in', 'contains', 'not_contains', 'empty', 'not_empty'],
    num:  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty', 'range', 'contains'],
    date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'range', 'empty', 'not_empty', 'month', 'year', 'today', 'next_days', 'prev_days'],
  };
  const DEFAULT_OP = { text: 'contains', num: 'eq', date: 'eq', enum: 'in' };
  const ENUM_MAX = 10; // sloupec s nejvýš tolika různými hodnotami = výběr zaškrtnutím
  const OP_TITLES = {
    next_days: 'Datum od dneška do dneška + zadaný počet dní',
    prev_days: 'Datum od dneška − zadaný počet dní do dneška',
  };

  // ─── Pomocné funkce ───
  const norm = (v) => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  function parseNum(s) {
    const t = String(s == null ? '' : s).replace(/\s| /g, '').replace(',', '.');
    if (t === '' || isNaN(+t)) return null;
    return +t;
  }
  function parseDate(s) {
    const t = norm(s).trim();
    if (!t) return null;
    if (t === 'dnes') return today0();
    if (t === 'vcera') return new Date(+today0() - 86400000);
    if (t === 'zitra') return new Date(+today0() + 86400000);
    let m = t.match(/^(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})?$/);
    if (m) return new Date(m[3] ? +m[3] : new Date().getFullYear(), +m[2] - 1, +m[1]);
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  const isEmpty = (type, v) => type === 'date' ? !(v instanceof Date) || isNaN(v)
    : type === 'num' ? (v == null || v === '' || isNaN(Number(v)))
    : String(v == null ? '' : v).trim() === '';

  // Starý „rychlý zápis" ve výchozím operátoru (>1000, 5..10, >1.10.2026, 10.2026, dnes…)
  function quickNum(n, f) {
    const t = f.replace(/\s/g, '').replace(',', '.');
    let m;
    if ((m = t.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/))) return n >= +m[1] && n <= +m[2];
    if ((m = t.match(/^(>=|<=|>|<|=|!=)(-?\d+(?:\.\d+)?)$/))) { const x = +m[2]; return { '>': n > x, '<': n < x, '>=': n >= x, '<=': n <= x, '=': n === x, '!=': n !== x }[m[1]]; }
    return undefined;
  }
  function quickDate(d, f) {
    const t = norm(f).trim();
    let m;
    if ((m = t.match(/^(.+?)\.\.(.+)$/))) { const a = parseDate(m[1]), b = parseDate(m[2]); return (!a || d >= a) && (!b || d <= b); }
    if ((m = t.match(/^(>=|<=|>|<)(.+)$/))) { const x = parseDate(m[2]); if (!x) return undefined; return { '>': d > x, '<': d < x, '>=': d >= x, '<=': d <= x }[m[1]]; }
    if ((m = t.match(/^(\d{1,2})\.(\d{4})$/))) return d.getMonth() + 1 === +m[1] && d.getFullYear() === +m[2];
    if ((m = t.match(/^(\d{4})$/))) return d.getFullYear() === +m[1];
    return undefined;
  }

  function matchCond(type, raw, c) {
    const op = c.op;
    if (op === 'empty') return isEmpty(type, raw);
    if (op === 'not_empty') return !isEmpty(type, raw);
    if (op === 'in' || op === 'not_in') {
      const vals = Array.isArray(c.vals) ? c.vals : [];
      if (!vals.length) return true;
      const s = norm(String(raw == null ? '' : raw).trim());
      const hit = vals.some((x) => norm(x) === s);
      return op === 'in' ? hit : !hit;
    }
    const v = String(c.v == null ? '' : c.v).trim();
    const needVal = OPS[op][2];
    if (needVal === 1 && v === '') return true; // nevyplněno = nefiltruje
    if (needVal === 2 && v === '' && String(c.v2 || '').trim() === '') return true;

    if (type === 'text' || op === 'contains' || op === 'not_contains') {
      const s = norm(raw);
      const words = norm(v).split(/\s+/).filter(Boolean);
      if (op === 'not_contains') return !words.every((w) => s.includes(w));
      return words.every((w) => (w[0] === '!' && w.length > 1 ? !s.includes(w.slice(1)) : s.includes(w)));
    }

    if (type === 'num') {
      if (isEmpty('num', raw)) return false;
      const n = Number(raw);
      if (op === 'eq') { const q = quickNum(n, v); if (q !== undefined) return q; }
      const x = parseNum(v), y = parseNum(c.v2);
      switch (op) {
        case 'eq': return x == null ? norm(raw).includes(norm(v)) : n === x;
        case 'neq': return x == null ? true : n !== x;
        case 'gt': return x == null || n > x;
        case 'gte': return x == null || n >= x;
        case 'lt': return x == null || n < x;
        case 'lte': return x == null || n <= x;
        case 'range': return (x == null || n >= x) && (y == null || n <= y);
      }
      return true;
    }

    // datum
    if (!(raw instanceof Date) || isNaN(raw)) return op === 'neq';
    const d = day0(raw), t0 = today0();
    if (op === 'today') return +d === +t0;
    if (op === 'month') {
      const m = norm(v).match(/^(\d{1,2})(?:[.\/-](\d{4}))?$/);
      if (!m) return true;
      return d.getMonth() + 1 === +m[1] && d.getFullYear() === (m[2] ? +m[2] : t0.getFullYear());
    }
    if (op === 'year') { const y = parseInt(v, 10); return isNaN(y) || d.getFullYear() === y; }
    if (op === 'next_days' || op === 'prev_days') {
      const k = parseInt(v, 10); if (isNaN(k)) return true;
      return op === 'next_days' ? (d >= t0 && d <= new Date(+t0 + k * 86400000)) : (d <= t0 && d >= new Date(+t0 - k * 86400000));
    }
    if (op === 'eq') {
      const q = quickDate(d, v); if (q !== undefined) return q;
      const x = parseDate(v);
      return x ? +d === +x : norm(raw.toLocaleString('cs-CZ')).replace(/\s/g, '').includes(norm(v).replace(/\s/g, ''));
    }
    const x = parseDate(v), y = parseDate(c.v2);
    switch (op) {
      case 'neq': return !x || +d !== +x;
      case 'gt': return !x || d > x;
      case 'gte': return !x || d >= x;
      case 'lt': return !x || d < x;
      case 'lte': return !x || d <= x;
      case 'range': return (!x || d >= x) && (!y || d <= y);
    }
    return true;
  }

  // ─── CSS (jednou) ───
  function injectCss() {
    if (document.getElementById('cf-css')) return;
    const st = document.createElement('style'); st.id = 'cf-css';
    st.textContent = [
      '.cf-cell{display:flex;align-items:center;gap:2px;background:var(--bg,#111827);border:1px solid var(--border,#374151);border-radius:6px;padding:0 2px 0 0;min-width:70px}',
      '.cf-cell.cf-on{border-color:#818cf8}',
      '.cf-op{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:24px;background:none;border:none;border-right:1px solid var(--border,#374151);color:var(--text2,#9ca3af);cursor:pointer;font-size:13px;font-weight:600;padding:0 4px;border-radius:6px 0 0 6px}',
      '.cf-op:hover{color:#c7d2fe;background:rgba(129,140,248,.12)}',
      '.cf-cell.cf-on .cf-op{color:#818cf8}',
      '.cf-in{flex:1 1 auto;min-width:0;width:100%;background:transparent;border:none;outline:none;color:var(--text,#e5e7eb);padding:5px 4px;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0}',
      '.cf-in:disabled{color:#818cf8;font-style:italic}',
      '.cf-in2{border-left:1px dashed var(--border,#374151)}',
      '.cf-x,.cf-more{flex:0 0 auto;background:none;border:none;color:var(--text2,#9ca3af);cursor:pointer;font-size:12px;padding:0 3px;line-height:1}',
      '.cf-x:hover{color:#f87171}',
      '.cf-more{color:#818cf8;font-size:10px;font-weight:700}',
      '.cf-menu{position:fixed;z-index:5000;min-width:220px;background:var(--surface2,#1f2937);border:1px solid var(--border,#374151);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:6px 0;font-size:13px;color:var(--text,#e5e7eb)}',
      '.cf-menu button.cf-mi{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;color:inherit;padding:8px 14px;cursor:pointer;white-space:nowrap}',
      '.cf-menu button.cf-mi:hover{background:rgba(129,140,248,.12)}',
      '.cf-menu button.cf-mi.cf-act{background:rgba(129,140,248,.22)}',
      '.cf-menu .cf-ic{display:inline-flex;justify-content:center;min-width:22px;color:#818cf8;font-weight:700}',
      '.cf-menu hr{border:none;border-top:1px solid var(--border,#374151);margin:4px 0}',
      '.cf-ed{padding:10px 12px;min-width:360px}',
      '.cf-ed-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}',
      '.cf-ed-row select,.cf-ed-row input{background:var(--bg,#111827);border:1px solid var(--border,#374151);border-radius:6px;color:var(--text,#e5e7eb);padding:5px 6px;font-size:12px}',
      '.cf-ed-row input{width:100px}',
      '.cf-ed-and{font-size:10px;color:var(--text2,#9ca3af);text-transform:uppercase;margin:2px 0 4px 4px}',
      '.cf-pick{min-width:240px;padding:0 0 6px}',
      '.cf-pick input.cf-ps{width:calc(100% - 20px);margin:8px 10px;box-sizing:border-box;background:var(--bg,#111827);border:1px solid var(--border,#374151);border-radius:6px;color:var(--text,#e5e7eb);padding:6px 8px;font-size:12px}',
      '.cf-pick .cf-pl{max-height:260px;overflow-y:auto}',
      '.cf-pick label{display:flex;align-items:center;gap:10px;padding:7px 14px;cursor:pointer;white-space:nowrap}',
      '.cf-pick label:hover{background:rgba(129,140,248,.12)}',
      '.cf-pick label input{width:15px;height:15px;accent-color:#818cf8;margin:0}',
      '.cf-pick .cf-pf{display:flex;justify-content:space-between;gap:6px;padding:6px 10px 0;border-top:1px solid var(--border,#374151);margin-top:4px}',
      '.cf-in.cf-ro{cursor:pointer}',
      '.cf-ed-btn{background:none;border:1px solid var(--border,#374151);border-radius:6px;color:var(--text,#e5e7eb);padding:4px 10px;font-size:12px;cursor:pointer}',
    ].join('\n');
    document.head.appendChild(st);
  }

  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.cf-op,.cf-more,.cf-ro')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  function placeMenu(menu, anchor) {
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    let top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    openMenu = menu;
  }

  function create(opts) {
    injectCss();
    const cols = opts.columns || [];
    const colBy = {}; cols.forEach((c) => { colBy[c.key] = c; });
    const state = {}; // key → [{op, v, v2}]
    const roots = new Set();
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
    let timer = null;
    const fire = (now) => { clearTimeout(timer); if (now) onChange(); else timer = setTimeout(onChange, 120); };

    // ─── Výčtové sloupce (málo různých hodnot) → výběr zaškrtnutím ───
    let lastRows = [];
    let enumCache = {};
    const enumVal = (col, row) => (col.enumValue || col.get)(row);
    function distinct(key) {
      if (key in enumCache) return enumCache[key];
      const col = colBy[key]; const limit = col.enum === true ? Infinity : (col.enumMax || ENUM_MAX);
      const m = new Map();
      for (const r of lastRows) {
        const raw = enumVal(col, r); const v = String(raw == null ? '' : raw).trim();
        if (!v) continue;
        const k = norm(v); if (!m.has(k)) m.set(k, v);
        if (m.size > limit) break;
      }
      return (enumCache[key] = [...m.values()].sort((a, b) => a.localeCompare(b, 'cs')));
    }
    function isEnum(key) {
      const col = colBy[key]; if (!col || col.enum === false || (col.type || 'text') !== 'text') return false;
      if (col.enum === true) return true;
      const d = distinct(key); return d.length > 0 && d.length <= (col.enumMax || ENUM_MAX);
    }
    const typeOf = (key) => (isEnum(key) ? 'enum' : ((colBy[key] && colBy[key].type) || 'text'));
    const newCond = (key) => ({ op: DEFAULT_OP[typeOf(key)], v: '', v2: '', vals: [] });
    const conds = (key) => (state[key] || (state[key] = [newCond(key)]));
    const isActive = (c) => { const n = OPS[c.op][2]; if (n === 3) return (c.vals || []).length > 0; return n === 0 || String(c.v || '').trim() !== '' || (n === 2 && String(c.v2 || '').trim() !== ''); };
    const activeConds = (key) => (state[key] || []).filter(isActive);

    function cellHtml(key) {
      const col = colBy[key]; if (!col) return '';
      const c = (state[key] || [])[0] || newCond(key);
      const def = OPS[c.op];
      const on = activeConds(key).length > 0;
      const extra = Math.max(0, (state[key] || []).length - 1);
      const ph = def[2] === 3 ? (col.ph && !/…$/.test(col.ph) ? col.ph : 'Vyber…') : def[2] === 0 ? def[0] : (def[3] || (def[2] === 2 ? 'od' : (c.op === DEFAULT_OP[col.type || 'text'] ? (col.ph || '') : def[0] + '…')));
      return '<div class="cf-cell' + (on ? ' cf-on' : '') + '" data-cfk="' + escH(key) + '">' +
        '<button type="button" class="cf-op" data-cfk="' + escH(key) + '" title="' + escH(def[0] + (OP_TITLES[c.op] ? ' — ' + OP_TITLES[c.op] : '') + ' (klikni pro změnu)') + '">' + def[1] + '</button>' +
        (def[2] === 3
          ? '<input class="cf-in cf-ro" readonly data-cfk="' + escH(key) + '" data-vi="1" value="' + escH((c.vals || []).join(', ')) + '" placeholder="' + escH(ph) + '" title="' + escH((c.vals || []).join(', ') || 'Klikni a vyber hodnoty') + '">'
          : '<input class="cf-in" data-cfk="' + escH(key) + '" data-vi="1" value="' + escH(def[2] ? c.v : '') + '" placeholder="' + escH(ph) + '"' + (def[2] === 0 ? ' disabled' : '') + '>') +
        (def[2] === 2 ? '<input class="cf-in cf-in2" data-cfk="' + escH(key) + '" data-vi="2" value="' + escH(c.v2 || '') + '" placeholder="do">' : '') +
        (extra > 0 ? '<button type="button" class="cf-more" data-cfk="' + escH(key) + '" title="Další podmínky (' + extra + ')">+' + extra + '</button>' : '') +
        (on || extra > 0 ? '<button type="button" class="cf-x" data-cfk="' + escH(key) + '" title="Zrušit filtr sloupce">✕</button>' : '') +
        '</div>';
    }
    function refreshCell(key, focus) {
      roots.forEach((root) => {
        const el = root.querySelector('.cf-cell[data-cfk="' + CSS.escape(key) + '"]');
        if (el) {
          el.outerHTML = cellHtml(key);
          if (focus) { const inp = root.querySelector('.cf-in[data-cfk="' + CSS.escape(key) + '"]:not(:disabled)'); if (inp) inp.focus(); }
        }
      });
    }

    function openOpMenu(btn, key) {
      const had = openMenu && openMenu.dataset.key === key && openMenu.dataset.kind === 'ops';
      closeMenu(); if (had) return;
      const cur = ((state[key] || [])[0] || newCond(key)).op;
      const menu = document.createElement('div'); menu.className = 'cf-menu'; menu.dataset.key = key; menu.dataset.kind = 'ops';
      menu.innerHTML = TYPE_OPS[typeOf(key)].map((op) => '<button type="button" class="cf-mi' + (op === cur ? ' cf-act' : '') + '" data-op="' + op + '" title="' + escH(OP_TITLES[op] || '') + '"><span class="cf-ic">' + OPS[op][1] + '</span>' + OPS[op][0] + '</button>').join('') +
        '<hr><button type="button" class="cf-mi" data-op="__add"><span class="cf-ic">+</span>Přidat podmínku…</button>';
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-op]'); if (!b) return;
        closeMenu();
        if (b.dataset.op === '__add') { conds(key).push(newCond(key)); openEditor(btn, key); refreshCell(key); return; }
        const c = conds(key)[0];
        const wasActive = isActive(c);
        c.op = b.dataset.op;
        if (OPS[c.op][2] === 0) { c.v = ''; c.v2 = ''; c.vals = []; }
        refreshCell(key, OPS[c.op][2] !== 3);
        if (wasActive || isActive(c)) fire(true);
        if (OPS[c.op][2] === 3) { const inp = findInput(key); if (inp) openPick(inp, key); }
      });
      placeMenu(menu, btn);
    }

    function openEditor(anchor, key) {
      closeMenu();
      const col = colBy[key];
      const menu = document.createElement('div'); menu.className = 'cf-menu cf-ed'; menu.dataset.key = key; menu.dataset.kind = 'ed';
      const render = () => {
        const list = conds(key);
        menu.innerHTML = '<div style="font-size:11px;color:var(--text2,#9ca3af);text-transform:uppercase;margin-bottom:8px">Podmínky sloupce' + (col.label ? ': ' + escH(col.label) : '') + ' (musí platit všechny)</div>' +
          list.map((c, i) => (i ? '<div class="cf-ed-and">a zároveň</div>' : '') +
            '<div class="cf-ed-row" data-i="' + i + '"><select data-f="op">' + TYPE_OPS[typeOf(key)].map((op) => '<option value="' + op + '"' + (op === c.op ? ' selected' : '') + '>' + OPS[op][0] + '</option>').join('') + '</select>' +
            (OPS[c.op][2] === 3 ? '<input data-f="vals" style="width:180px" value="' + escH((c.vals || []).join(', ')) + '" placeholder="hodnoty oddělené čárkou">' :
             OPS[c.op][2] >= 1 ? '<input data-f="v" value="' + escH(c.v || '') + '" placeholder="' + escH(OPS[c.op][3] || (OPS[c.op][2] === 2 ? 'od' : 'hodnota')) + '">' : '') +
            (OPS[c.op][2] === 2 ? '<input data-f="v2" value="' + escH(c.v2 || '') + '" placeholder="do">' : '') +
            '<button type="button" class="cf-ed-btn" data-rm="' + i + '" title="Odebrat podmínku">✕</button></div>').join('') +
          '<div style="display:flex;gap:6px;justify-content:space-between;margin-top:8px"><button type="button" class="cf-ed-btn" data-add="1">+ Další podmínka</button><button type="button" class="cf-ed-btn" data-done="1" style="border-color:#818cf8;color:#c7d2fe">Hotovo</button></div>';
      };
      render();
      menu.addEventListener('input', (e) => {
        const row = e.target.closest('.cf-ed-row'); if (!row) return;
        const c = conds(key)[+row.dataset.i]; const f = e.target.dataset.f;
        if (f === 'v' || f === 'v2') { c[f] = e.target.value; fire(); refreshCell(key); }
        if (f === 'vals') { c.vals = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); fire(); refreshCell(key); }
      });
      menu.addEventListener('change', (e) => {
        const row = e.target.closest('.cf-ed-row'); if (!row || e.target.dataset.f !== 'op') return;
        const c = conds(key)[+row.dataset.i]; c.op = e.target.value; if (OPS[c.op][2] === 0) { c.v = ''; c.v2 = ''; c.vals = []; }
        render(); refreshCell(key); fire(true);
      });
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.add) { conds(key).push(newCond(key)); render(); refreshCell(key); }
        else if (b.dataset.rm != null) {
          const list = conds(key); list.splice(+b.dataset.rm, 1);
          if (!list.length) list.push(newCond(key));
          render(); refreshCell(key); fire(true);
        } else if (b.dataset.done) closeMenu();
      });
      placeMenu(menu, anchor);
    }

    function findInput(key) {
      for (const root of roots) { const el = root.querySelector('.cf-in[data-cfk="' + CSS.escape(key) + '"]'); if (el) return el; }
      return null;
    }
    // Našeptávač se zaškrtávátky (výčtové sloupce)
    function openPick(anchor, key) {
      if (openMenu && openMenu.dataset.key === key && openMenu.dataset.kind === 'pick') { closeMenu(); return; }
      closeMenu();
      const vals = distinct(key).slice();
      const c0 = (state[key] || [])[0];
      (c0 && c0.vals || []).forEach((v) => { if (!vals.some((x) => norm(x) === norm(v))) vals.push(v); });
      const menu = document.createElement('div'); menu.className = 'cf-menu cf-pick'; menu.dataset.key = key; menu.dataset.kind = 'pick';
      const sel = () => new Set(((state[key] || [])[0] || {}).vals || []);
      const renderList = (q) => {
        const s = sel(); const nq = norm(q || '');
        const list = vals.filter((v) => !nq || norm(v).includes(nq));
        menu.querySelector('.cf-pl').innerHTML = list.length
          ? list.map((v) => '<label><input type="checkbox" data-v="' + escH(v) + '"' + (s.has(v) ? ' checked' : '') + '>' + escH(v) + '</label>').join('')
          : '<div style="padding:8px 14px;color:var(--text2,#9ca3af)">Nic nenalezeno</div>';
      };
      menu.innerHTML = (vals.length > 6 ? '<input class="cf-ps" placeholder="Hledat…">' : '<div style="height:6px"></div>') + '<div class="cf-pl"></div>' +
        '<div class="cf-pf"><button type="button" class="cf-ed-btn" data-all="1">Vybrat vše</button><button type="button" class="cf-ed-btn" data-none="1">Zrušit výběr</button></div>';
      renderList('');
      const apply = (list) => {
        const c = conds(key)[0];
        if (OPS[c.op][2] !== 3) c.op = 'in';
        c.vals = list; refreshCell(key); fire(true);
      };
      menu.addEventListener('change', (e) => {
        const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
        const s = sel(); if (cb.checked) s.add(cb.dataset.v); else s.delete(cb.dataset.v);
        apply(vals.filter((v) => s.has(v)));
      });
      menu.addEventListener('input', (e) => { if (e.target.classList.contains('cf-ps')) renderList(e.target.value); });
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.all) { const q = (menu.querySelector('.cf-ps') || {}).value || ''; const nq = norm(q); const s = sel(); vals.filter((v) => !nq || norm(v).includes(nq)).forEach((v) => s.add(v)); apply(vals.filter((v) => s.has(v))); renderList(q); }
        if (b.dataset.none) { apply([]); renderList((menu.querySelector('.cf-ps') || {}).value || ''); }
      });
      placeMenu(menu, anchor.closest('.cf-cell') || anchor);
      const ps = menu.querySelector('.cf-ps'); if (ps) ps.focus();
    }

    function bind(root) {
      if (!root) return;
      roots.forEach((r) => { if (!document.body.contains(r)) roots.delete(r); });
      roots.add(root);
      if (root.__cfBound === ctrl) return;
      root.__cfBound = ctrl;
      root.addEventListener('input', (e) => {
        const inp = e.target.closest('.cf-in'); if (!inp || inp.readOnly) return;
        const key = inp.dataset.cfk; const c = conds(key)[0];
        if (inp.dataset.vi === '2') c.v2 = inp.value; else c.v = inp.value;
        const cell = inp.closest('.cf-cell');
        const on = activeConds(key).length > 0;
        if (cell && cell.classList.contains('cf-on') !== on) { refreshCell(key); const n = root.querySelector('.cf-in[data-cfk="' + CSS.escape(key) + '"][data-vi="' + (inp.dataset.vi || '1') + '"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
        fire();
      });
      root.addEventListener('keydown', (e) => {
        const ro = e.target.closest('.cf-ro'); if (ro && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ')) { e.preventDefault(); openPick(ro, ro.dataset.cfk); }
      });
      root.addEventListener('click', (e) => {
        const op = e.target.closest('.cf-op'); if (op) { e.stopPropagation(); e.preventDefault(); openOpMenu(op, op.dataset.cfk); return; }
        const ro = e.target.closest('.cf-ro'); if (ro) { e.stopPropagation(); openPick(ro, ro.dataset.cfk); return; }
        const more = e.target.closest('.cf-more'); if (more) { e.stopPropagation(); e.preventDefault(); openEditor(more, more.dataset.cfk); return; }
        const x = e.target.closest('.cf-x'); if (x) { e.stopPropagation(); e.preventDefault(); delete state[x.dataset.cfk]; refreshCell(x.dataset.cfk); fire(true); }
        if (e.target.closest('.cf-cell')) e.stopPropagation();
      });
    }

    let prevEnum = {};
    function apply(rows) {
      lastRows = Array.isArray(rows) ? rows : []; enumCache = {};
      cols.forEach((c) => { const e = isEnum(c.key); if (prevEnum[c.key] !== e) { prevEnum[c.key] = e; if (!state[c.key]) refreshCell(c.key); } });
      const act = cols.map((c) => [c, activeConds(c.key)]).filter(([, l]) => l.length);
      if (!act.length) return rows;
      return rows.filter((row) => act.every(([col, list]) => list.every((c) => {
        let raw = (c.op === 'in' || c.op === 'not_in') ? enumVal(col, row) : col.get(row);
        // datum může přijít i jako ISO string / timestamp
        if (col.type === 'date' && raw != null && raw !== '' && !(raw instanceof Date)) { const d = new Date(raw); raw = isNaN(d) ? null : d; }
        else if (col.type === 'date' && raw === '') raw = null;
        return matchCond(col.type || 'text', raw, c);
      })));
    }

    const ctrl = {
      cellHtml, bind, apply,
      activeCount: () => cols.filter((c) => activeConds(c.key).length).length,
      clear: () => { Object.keys(state).forEach((k) => delete state[k]); cols.forEach((c) => refreshCell(c.key)); fire(true); },
      set: (key, op, v, v2) => {
        op = op || DEFAULT_OP[typeOf(key)];
        if (op === 'in' || op === 'not_in') state[key] = [{ op, v: '', v2: '', vals: (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])) }];
        else state[key] = [{ op, v: v == null ? '' : v, v2: v2 == null ? '' : v2, vals: [] }];
        refreshCell(key); fire(true);
      },
      isEnum,
      get: (key) => (state[key] ? JSON.parse(JSON.stringify(state[key])) : null),
      state,
    };
    return ctrl;
  }

  // ─── Hotová tabulka: filtry + 3-stavové řazení ↑↓ + info řádek + render řádků ───
  // const t = ColFilters.table({
  //   table: '#my-table',            // selektor nebo funkce vracející <table> (může se překreslovat — vždy se dohledá znovu)
  //   columns: [ {key,label,type,get,ph,enum,enumValue,sortGet,sort:false,filter:false} | null, ... ],  // 1 položka na <th> hlavičky; null = bez filtru i řazení
  //   renderRow: (row, idx) => '<tr>…</tr>',
  //   limit: 500, noun: 'záznamů', emptyText: 'Žádné záznamy.', onRender: (visibleRows) => {}
  // });
  // t.setRows(data)  — po načtení dat;  t.refresh()  — překreslit;  t.cf — controller filtrů
  const SORT_ARROWS = (on, dir) => '<span style="display:inline-flex;font-size:12px;line-height:1;vertical-align:middle">' +
    '<span style="' + (on && dir === 1 ? 'color:#f59e0b;font-weight:900;font-size:14px' : 'opacity:.4') + '">↑</span>' +
    '<span style="' + (on && dir === -1 ? 'color:#f59e0b;font-weight:900;font-size:14px' : 'opacity:.4') + '">↓</span></span>';
  function sortTitle(type, on, dir) {
    const lab = type === 'num' ? (dir === -1 ? 'od největšího po nejmenší' : 'od nejmenšího po největší')
      : type === 'date' ? (dir === -1 ? 'od nejnovějšího po nejstarší' : 'od nejstaršího po nejnovější')
      : (dir === 1 ? 'A → Z' : 'Z → A');
    return on ? 'Řazeno ' + lab + ' — klikni pro změnu' : 'Klikni pro řazení';
  }
  function table(o) {
    const colsAll = o.columns || [];
    const fcols = colsAll.filter((c) => c && c.filter !== false);
    const sort = { key: null, dir: 1 };
    let rows = [];
    let visible = [];
    const limit = o.limit || 500;
    const noun = o.noun || 'záznamů';
    const getTable = () => (typeof o.table === 'function' ? o.table() : (typeof o.table === 'string' ? document.querySelector(o.table) : o.table));
    const cf = create({ columns: fcols, onChange: () => render() });
    const colByKey = {}; colsAll.forEach((c) => { if (c) colByKey[c.key] = c; });

    function ensure(tbl) {
      if (!tbl) return null;
      let thead = tbl.tHead;
      if (!thead) return null;
      const head = thead.rows[0]; if (!head) return null;
      if (!thead.querySelector('.cf-filter-row')) {
        const ths = head.cells;
        colsAll.forEach((c, i) => {
          const th = ths[i]; if (!th || !c || c.sort === false) return;
          if (th.querySelector('.cf-sort')) return;
          th.style.whiteSpace = 'nowrap';
          th.insertAdjacentHTML('beforeend', ' <button type="button" class="cf-sort" data-sk="' + escH(c.key) + '" style="background:none;border:none;color:var(--text2,#9ca3af);cursor:pointer;padding:0 2px"></button>');
        });
        const tr = document.createElement('tr'); tr.className = 'cf-filter-row';
        let h = '';
        for (let i = 0; i < head.cells.length; i++) {
          const c = colsAll[i];
          h += '<th style="padding:4px 3px;text-transform:none;letter-spacing:0">' + (c && c.filter !== false ? cf.cellHtml(c.key) : '') + '</th>';
        }
        tr.innerHTML = h;
        thead.appendChild(tr);
        cf.bind(tr);
        head.addEventListener('click', (e) => {
          const b = e.target.closest('.cf-sort'); if (!b) return;
          e.stopPropagation(); e.preventDefault();
          const c = colByKey[b.dataset.sk]; if (!c) return;
          const order = (c.type || 'text') === 'text' ? [1, -1] : [-1, 1];
          if (sort.key !== c.key) { sort.key = c.key; sort.dir = order[0]; }
          else if (sort.dir === order[0]) sort.dir = order[1];
          else sort.key = null;
          render();
        });
      }
      let info = tbl.previousElementSibling;
      if (!info || !info.classList || !info.classList.contains('cf-info')) {
        info = document.createElement('div'); info.className = 'cf-info';
        info.style.cssText = 'font-size:12px;color:var(--text2,#9ca3af);margin:0 0 6px;display:flex;gap:10px;align-items:center';
        tbl.parentNode.insertBefore(info, tbl);
      }
      return { thead, info };
    }
    function markSort(tbl) {
      tbl.querySelectorAll('.cf-sort').forEach((b) => {
        const c = colByKey[b.dataset.sk]; const on = sort.key === b.dataset.sk;
        b.innerHTML = SORT_ARROWS(on, sort.dir);
        b.title = sortTitle((c && c.type) || 'text', on, sort.dir);
        const th = b.closest('th'); if (th) th.style.color = on ? '#f59e0b' : '';
      });
    }
    function render() {
      const tbl = getTable();
      let list = cf.apply(rows);
      if (sort.key) {
        const c = colByKey[sort.key];
        if (c) {
          const t = c.type || 'text'; const g = c.sortGet || c.get;
          // prázdné hodnoty vždy na konec
          const val = (r) => { const v = g(r); if (v == null || v === '') return null; if (t === 'date') { const d = +new Date(v); return isNaN(d) ? null : d; } if (t === 'num') { const n = Number(v); return isNaN(n) ? null : n; } return norm(v); };
          list = list.slice().sort((a, b) => { const x = val(a), y = val(b); if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; const r = t === 'text' ? String(x).localeCompare(String(y), 'cs') : (x - y); return r * sort.dir; });
        }
      }
      visible = list;
      if (!tbl) return;
      const parts = ensure(tbl);
      const tbody = tbl.tBodies[0] || tbl.appendChild(document.createElement('tbody'));
      const ncol = (tbl.tHead && tbl.tHead.rows[0] && tbl.tHead.rows[0].cells.length) || 1;
      tbody.innerHTML = list.length
        ? list.slice(0, limit).map((r, i) => o.renderRow(r, i)).join('')
        : '<tr><td colspan="' + ncol + '" style="text-align:center;color:var(--text2,#9ca3af);padding:18px">' + (rows.length ? 'Filtrům nic neodpovídá.' : escH(o.emptyText || 'Žádné záznamy.')) + '</td></tr>';
      markSort(tbl);
      if (parts && parts.info) {
        const n = cf.activeCount();
        parts.info.innerHTML = (n ? 'Zobrazeno <b>' + list.length + '</b> z ' + rows.length + ' ' + noun : 'Zobrazeno všech ' + rows.length + ' ' + noun) +
          (list.length > limit ? ' · prvních ' + limit + ' — upřesni filtr' : '') +
          (n ? ' <button type="button" class="btn btn-secondary btn-sm cf-clear-all">✕ Zrušit filtry</button>' : '') +
          ' <span title="Ikona vlevo v poli filtru = typ podmínky (Obsahuje, Rovná se, Větší než, Rozsah, Měsíc, Dnes…). Kliknutím ji změníš, „Přidat podmínku…“ přidá další. Sloupce s málo hodnotami: klikni do pole a zaškrtej. Šipky ↑↓ v hlavičce = řazení (3 stavy). Rychlý zápis: >1000, 5..10, >1.10.2026, 10.2026, dnes, !slovo" style="cursor:help">ⓘ</span>';
        const cb = parts.info.querySelector('.cf-clear-all'); if (cb) cb.onclick = () => cf.clear();
      }
      if (typeof o.onRender === 'function') o.onRender(list);
    }
    return {
      cf,
      setRows(r) { rows = Array.isArray(r) ? r : []; render(); },
      refresh: render,
      getRows: () => rows,
      getVisible: () => visible,
      sort,
    };
  }

  window.ColFilters = { create, table, matchCond, OPS, TYPE_OPS };
})();
