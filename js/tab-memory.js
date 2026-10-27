// HolyOS — Paměť otevřených záložek (po F5 / obnovení zůstaneš tam, kde jsi byl)
// Načítá se globálně ze sidebar.js. Při kliknutí na záložku (top i podzáložky) si uloží
// cestu kliknutí do sessionStorage (per stránka, per karta prohlížeče) a po načtení stránky
// ji postupně „přehraje". Nová karta prohlížeče začíná výchozí záložkou.
(function () {
  'use strict';
  if (window.__holyTabMemory) return;
  window.__holyTabMemory = true;

  const KEY = 'tabmem:' + location.pathname;
  // Co je „záložka" — tlačítka přepínání sekcí napříč moduly
  const TAB_SEL = [
    '.tab-btn', '.tab', '.sub-tab', '.module-tab', '.section-tab', '.view-tab', '.pv2-tab', '.aidev-tab',
    '.tasks-tab', '.sd-tab', '.veh-tab', '[role="tab"]', '[data-tab]', '[data-section]',
    '[onclick*="switchTab("]', '[onclick*="SubTab("]', '[onclick*="switchAccountingTab("]', '[onclick*="switchBankSub("]',
    '[onclick*="setOrderView("]', '[onclick*="switchMatTab("]', '[onclick*="switchPvTab("]', '[onclick*="switchVehTab("]',
    '[onclick*="sdSwitchTab("]', '[onclick*="Tab("]',
  ].join(',');
  const MODAL_SEL = '.modal, .modal-overlay, .modal-backdrop, #modal-root, [role="dialog"], .cf-menu, .dialog';

  function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function write(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v.slice(-6))); } catch (e) { /* ignore */ } }

  function sig(el) {
    const oc = el.getAttribute('onclick');
    if (oc) return { t: 'oc', v: oc.trim() };
    if (el.dataset.tab) return { t: 'dt', v: el.dataset.tab };
    if (el.dataset.section) return { t: 'ds', v: el.dataset.section };
    if (el.id) return { t: 'id', v: el.id };
    return { t: 'tx', v: (el.textContent || '').trim().slice(0, 60), c: (el.className || '').split(/\s+/).filter(c => !/active|selected|btn-primary|btn-secondary/.test(c)).join('.') };
  }
  // „skupina" = rodič se sourozeneckými záložkami (abychom věděli, co přepisujeme)
  function group(el) {
    try { return groupRaw(el); } catch (e) { return el.parentElement ? el.parentElement.tagName : ''; }
  }
  function groupRaw(el) {
    const p = el.parentElement; if (!p) return '';
    if (p.id) return '#' + p.id;
    const idx = Array.prototype.indexOf.call(document.querySelectorAll(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).trim().split(/\s+/).join('.') : '')), p);
    return (p.id ? '#' + p.id : p.tagName + '.' + String(p.className || '').trim().replace(/\s+/g, '.') + ':' + idx);
  }
  function findBySig(s) {
    const all = document.querySelectorAll(TAB_SEL);
    for (const el of all) {
      if (el.closest(MODAL_SEL)) continue;
      const x = sig(el);
      if (x.t !== s.t || x.v !== s.v) continue;
      if (s.t === 'tx' && s.c && x.c !== s.c) continue;
      return el;
    }
    return null;
  }
  const isActive = (el) => /(^|\s)(active|selected)(\s|$)/.test(el.className || '') || el.getAttribute('aria-selected') === 'true' || /btn-primary/.test(el.className || '');

  let replaying = false;
  let ready = false; // dokud se neobnoví uložený stav, nic nezapisujeme (výchozí záložky stránky by ho přepsaly)
  function record(el) {
    if (!el || el.closest(MODAL_SEL)) return;
    if (el.tagName === 'A' && el.getAttribute('href') && !/^#|^javascript/.test(el.getAttribute('href'))) return; // skutečná navigace
    if (el.matches('input, select, textarea, label')) return;
    const steps = read();
    const g = group(el);
    const i = steps.findIndex(s => s.g === g);
    const entry = Object.assign({ g }, sig(el));
    if (i >= 0) steps.splice(i); // přepnutí v téže skupině → zahodit i podzáložky za ní
    steps.push(entry);
    write(steps);
  }
  // 1) kliknutí uživatele na záložku
  document.addEventListener('click', (e) => {
    if (replaying || !e.isTrusted) return;
    const el = e.target.closest && e.target.closest(TAB_SEL);
    if (el) record(el);
  }, true);
  // 2) záložka se aktivovala jinak (dlaždice, odkaz, kód stránky) → zapsat taky
  try {
    new MutationObserver((muts) => {
      if (replaying || !ready) return;
      for (const m of muts) {
        const el = m.target;
        if (!(el instanceof Element) || !el.matches(TAB_SEL) || !isActive(el)) continue;
        const was = m.oldValue || '';
        if (/(^|\s)(active|selected|btn-primary)(\s|$)/.test(was)) continue; // byla aktivní už předtím
        record(el);
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'], attributeOldValue: true });
  } catch (e) { /* starý prohlížeč — jen kliky */ }

  async function replay() {
    const steps = read();
    if (!steps.length) return;
    replaying = true;
    try {
      for (const s of steps) {
        let el = null;
        const until = Date.now() + 6000; // záložky se můžou vykreslit až po načtení dat
        while (!el && Date.now() < until) { el = findBySig(s); if (!el) await new Promise(r => setTimeout(r, 150)); }
        if (!el) break;
        if (!isActive(el)) { el.click(); await new Promise(r => setTimeout(r, 350)); }
      }
    } catch (e) { /* nic — výchozí záložka */ }
    finally { replaying = false; setTimeout(() => { ready = true; }, 400); }
  }
  // Obnovit co nejdřív (po vykreslení DOM), ať neproblikne výchozí záložka; prvky případně počká až 6 s
  let started = false;
  const start = () => { if (started) return; started = true; setTimeout(() => { replay().then(() => { if (!read().length) ready = true; }); }, 50); };
  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
  window.HolyTabMemory = { read, record };
})();
