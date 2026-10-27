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
  document.addEventListener('click', (e) => {
    if (replaying || !e.isTrusted) return;
    const el = e.target.closest && e.target.closest(TAB_SEL);
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
  }, true);

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
    finally { replaying = false; }
  }
  if (document.readyState === 'complete') setTimeout(replay, 300);
  else window.addEventListener('load', () => setTimeout(replay, 300));
})();
