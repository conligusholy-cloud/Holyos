// PATCH — opravená verze branchPickerHtml + helpers
// Provozovna se vybere jedním kliknutím ze selectu a zobrazí se přímo v kolonce.
// Místo chipů pod selectem se vybraná provozovna zobrazí inline jako badge přímo
// uvnitř kontejneru pickeru — tedy viditelně V kolonce Místo výměny.

function branchPickerHtml(prefix, companyId, selectedBranchIds) {
  const sel = (selectedBranchIds || []).map(Number).filter(n => !isNaN(n));
  const branches = getBranchesForCompany(companyId);
  // Sestavíme options — VŠECHNY provozovny firmy, vybrané označíme selected.
  // Uživatel vidí vybranou hodnotu přímo v selectu.
  const singleSelectedId = sel.length > 0 ? sel[0] : null; // primárně 1 výběr v koloně
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
        ? '<div style="color:var(--text2,#6b7280);font-size:11px;margin-top:6px;">⚠️ Tato firma zatím nemá v adresáři žádné provozovny. Otevři 📇 <strong>Adresář firem</strong> a přidej provozovny tlačítkem „+ Přidat".</div>'
        : '');

  // data-branch-ids drží aktuální výběr (pro saveTireChange / saveService)
  return '<div id="' + prefix + '-branch-picker" data-company-id="' + (companyId || '') + '">'
    + '<div style="display:flex;gap:6px;align-items:stretch;">'
      + '<select id="' + prefix + '-branch-select" style="flex:1;"'
        + (isDisabled ? ' disabled' : '')
        + ' onchange="onBranchSelect(\'' + prefix + '\')"'
        + '>' + optHtml + '</select>'
    + '</div>'
    + '<div id="' + prefix + '-branch-chips" data-branch-ids="' + sel.join(',') + '" style="display:none;"></div>'
    + helpHtml
    + '</div>';
}

// Obsluha okamžitého výběru provozovny — zavolá se onchange selectu.
// Vybraná hodnota se zapíše do hidden data-branch-ids (pro save funkce).
function onBranchSelect(prefix) {
  const selectEl = document.getElementById(prefix + '-branch-select');
  const chips = document.getElementById(prefix + '-branch-chips');
  if (!selectEl || !chips) return;
  const val = selectEl.value;
  chips.dataset.branchIds = val ? val : '';
}

function getSelectedBranchIds(prefix) {
  const chips = document.getElementById(prefix + '-branch-chips');
  if (!chips) {
    // Fallback: přečíst přímo ze selectu
    const sel = document.getElementById(prefix + '-branch-select');
    if (!sel || !sel.value) return [];
    return [parseInt(sel.value)].filter(n => !isNaN(n));
  }
  // Zkombinuj: data-branch-ids (ze select onchange) nebo aktuální select value
  const fromData = (chips.dataset.branchIds || '').split(',').filter(Boolean).map(Number).filter(n => !isNaN(n));
  if (fromData.length > 0) return fromData;
  const sel = document.getElementById(prefix + '-branch-select');
  if (sel && sel.value) return [parseInt(sel.value)].filter(n => !isNaN(n));
  return [];
}

// Při změně firmy resetujeme picker — překreslíme s novou firmou a prázdným výběrem.
function onCompanyChange(prefix) {
  const sel = document.getElementById(prefix + '-company-id');
  const picker = document.getElementById(prefix + '-branch-picker');
  if (!picker) return;
  const newCompanyId = sel && sel.value ? parseInt(sel.value) : null;
  picker.outerHTML = branchPickerHtml(prefix, newCompanyId, []);
}

// addBranchChip a removeBranchChip ponecháváme jako no-op aliasy
// (mohou být volány z jiných míst kódu, neměly by shazovat chybu)
function addBranchChip(prefix) { onBranchSelect(prefix); }
function removeBranchChip(prefix, branchId) {
  const chips = document.getElementById(prefix + '-branch-chips');
  if (chips) chips.dataset.branchIds = '';
  const sel = document.getElementById(prefix + '-branch-select');
  if (sel) sel.value = '';
}
