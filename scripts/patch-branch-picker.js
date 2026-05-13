/**
 * Patch script — nahradí funkce branchPickerHtml, getSelectedBranchIds,
 * onCompanyChange, addBranchChip, removeBranchChip v index.html vozového parku.
 *
 * Spustit: node scripts/patch-branch-picker.js
 */
const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, '..', 'modules', 'vozovy-park', 'index.html');

let src = fs.readFileSync(HTML_FILE, 'utf8');

// ─── 1. Nahraď branchPickerHtml ─────────────────────────────────────────────
// Původní funkce začíná "    function branchPickerHtml(prefix, companyId, selectedBranchIds) {"
// a končí zavírací závorkou funkce (hledáme ji bezpečně přes regex s balanced braces není
// nutný — nahradíme celý blok od def po return + '}' jako celek pomocí textového markeru).

const OLD_BRANCH_PICKER_START = '    function branchPickerHtml(prefix, companyId, selectedBranchIds) {';
const OLD_BRANCH_PICKER_END   = "      '</div>';\n    }\n\n    function getSelectedBranchIds";

const NEW_BRANCH_PICKER = `    // ─── Branch picker — OPRAVENÁ verze (bug fix: provozovna se zobrazuje přímo v kolonce) ─
    // Vybraná provozovna se zobrazuje přímo ve <select> elementu (= v kolonce Místo výměny).
    // Jedno kliknutí na provozovnu v dropdownu ji okamžitě vybere — bez tlačítka "+ Vybrat".
    function branchPickerHtml(prefix, companyId, selectedBranchIds) {
      const sel = (selectedBranchIds || []).map(Number).filter(n => !isNaN(n));
      const branches = getBranchesForCompany(companyId);
      // Všechny provozovny firmy jako options; vybraná je označena selected → zobrazí se v selectu.
      let optHtml = '<option value="">— vyber provozovnu —</option>';
      branches.forEach(b => {
        const isSelected = sel.includes(b.id);
        optHtml += '<option value="' + b.id + '"' + (isSelected ? ' selected' : '') + '>'
          + escHtml(formatBranchLabel(b)) + '</option>';
      });
      const isDisabled = !companyId || branches.length === 0;
      const helpHtml = !companyId
        ? '<div style="color:var(--text2,#6b7280);font-size:11px;margin-top:6px;">💡 Nejdřív vyber firmu provádějící servis.</div>'
        : (branches.length === 0
            ? '<div style="color:var(--text2,#6b7280);font-size:11px;margin-top:6px;">⚠️ Tato firma zatím nemá v adresáři žádné provozovny. Otevři 📇 <strong>Adresář firem</strong> a přidej provozovny tlačítkem „+ Přidat\\".</div>'
            : '');
      // data-branch-ids uchovává aktuální výběr pro save funkce.
      // hidden chips div zachováme kvůli getSelectedBranchIds().
      return '<div id="' + prefix + '-branch-picker" data-company-id="' + (companyId || '') + '">' +
        '<div style="display:flex;gap:6px;align-items:stretch;">' +
          '<select id="' + prefix + '-branch-select" style="flex:1;"' +
          (isDisabled ? ' disabled' : '') +
          ' onchange="onBranchSelect(\\'' + prefix + '\\')"' +
          '>' + optHtml + '</select>' +
        '</div>' +
        '<div id="' + prefix + '-branch-chips" data-branch-ids="' + sel.join(',') + '" style="display:none;"></div>' +
        helpHtml +
      '</div>';
    }

    // Okamžitý výběr provozovny při změně selectu — zapíše do hidden data-branch-ids.
    function onBranchSelect(prefix) {
      const selectEl = document.getElementById(prefix + '-branch-select');
      const chips = document.getElementById(prefix + '-branch-chips');
      if (!selectEl || !chips) return;
      chips.dataset.branchIds = selectEl.value ? selectEl.value : '';
    }

    function getSelectedBranchIds`;

// Provedeme náhradu
const startIdx = src.indexOf(OLD_BRANCH_PICKER_START);
if (startIdx === -1) {
  console.error('❌ Nepodařilo se najít začátek funkce branchPickerHtml.');
  process.exit(1);
}
const endIdx = src.indexOf(OLD_BRANCH_PICKER_END, startIdx);
if (endIdx === -1) {
  console.error('❌ Nepodařilo se najít konec funkce branchPickerHtml.');
  process.exit(1);
}

// Nahraď celý úsek (od začátku branchPickerHtml po "function getSelectedBranchIds")
src = src.slice(0, startIdx) + NEW_BRANCH_PICKER + src.slice(endIdx + OLD_BRANCH_PICKER_END.length);

// ─── 2. Nahraď tělo getSelectedBranchIds ────────────────────────────────────
const OLD_GET_SEL_BODY = `    function getSelectedBranchIds(prefix) {
      const chips = document.getElementById(prefix + '-branch-chips');
      if (!chips) return [];
      return (chips.dataset.branchIds || '').split(',').filter(Boolean).map(Number).filter(n => !isNaN(n));
    }`;

const NEW_GET_SEL_BODY = `    function getSelectedBranchIds(prefix) {
      const chips = document.getElementById(prefix + '-branch-chips');
      // Primárně čteme z data-branch-ids (nastaveného přes onBranchSelect).
      // Fallback: přečíst přímo hodnotu selectu.
      const fromData = chips ? (chips.dataset.branchIds || '').split(',').filter(Boolean).map(Number).filter(n => !isNaN(n)) : [];
      if (fromData.length > 0) return fromData;
      const sel = document.getElementById(prefix + '-branch-select');
      if (sel && sel.value) return [parseInt(sel.value)].filter(n => !isNaN(n));
      return [];
    }`;

if (src.includes(OLD_GET_SEL_BODY)) {
  src = src.replace(OLD_GET_SEL_BODY, NEW_GET_SEL_BODY);
  console.log('✅ getSelectedBranchIds nahrazena.');
} else {
  console.warn('⚠️  getSelectedBranchIds – originální text nenalezen, přeskakuji.');
}

// ─── 3. Nahraď addBranchChip ────────────────────────────────────────────────
const OLD_ADD_CHIP = `    // Přidá vybranou hodnotu z dropdownu do chipů (multi-select „+ Vybrat\").
    function addBranchChip(prefix) {
      const sel = document.getElementById(prefix + '-branch-select');
      if (!sel || !sel.value) return;
      const bid = parseInt(sel.value);
      const cur = getSelectedBranchIds(prefix);
      if (cur.includes(bid)) return;
      cur.push(bid);
      const picker = document.getElementById(prefix + '-branch-picker');
      const companyId = picker && picker.dataset.companyId ? parseInt(picker.dataset.companyId) : null;
      picker.outerHTML = branchPickerHtml(prefix, companyId, cur);
    }`;

const NEW_ADD_CHIP = `    // addBranchChip — zachováno kvůli zpětné kompatibilitě, výběr probíhá přes onBranchSelect.
    function addBranchChip(prefix) { onBranchSelect(prefix); }`;

if (src.includes(OLD_ADD_CHIP)) {
  src = src.replace(OLD_ADD_CHIP, NEW_ADD_CHIP);
  console.log('✅ addBranchChip nahrazena.');
} else {
  console.warn('⚠️  addBranchChip – originální text nenalezen, přeskakuji.');
}

// ─── 4. Nahraď removeBranchChip ─────────────────────────────────────────────
const OLD_REMOVE_CHIP = `    function removeBranchChip(prefix, branchId) {
      const cur = getSelectedBranchIds(prefix).filter(x => x !== branchId);
      const picker = document.getElementById(prefix + '-branch-picker');
      const companyId = picker && picker.dataset.companyId ? parseInt(picker.dataset.companyId) : null;
      picker.outerHTML = branchPickerHtml(prefix, companyId, cur);
    }`;

const NEW_REMOVE_CHIP = `    function removeBranchChip(prefix, branchId) {
      const chips = document.getElementById(prefix + '-branch-chips');
      if (chips) chips.dataset.branchIds = '';
      const sel = document.getElementById(prefix + '-branch-select');
      if (sel) sel.value = '';
    }`;

if (src.includes(OLD_REMOVE_CHIP)) {
  src = src.replace(OLD_REMOVE_CHIP, NEW_REMOVE_CHIP);
  console.log('✅ removeBranchChip nahrazena.');
} else {
  console.warn('⚠️  removeBranchChip – originální text nenalezen, přeskakuji.');
}

// ─── Zapis ───────────────────────────────────────────────────────────────────
fs.writeFileSync(HTML_FILE, src, 'utf8');
console.log('✅ Soubor úspěšně zapsán:', HTML_FILE);
console.log('   Celková velikost:', src.length, 'znaků');
