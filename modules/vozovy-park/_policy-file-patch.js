/**
 * Patch: Zelená karta + Smlouva scan — zobrazení vybraného souboru uvnitř kolonky A.
 *
 * Přepisuje showPolicyForm tak, aby:
 *  A) Tlačítko "Vybrat soubor" otevřelo dialog (input[type=file] skrytý).
 *  B) Po výběru souboru se jeho název + odkaz na náhled zobrazily UVNITŘ kolonky A
 *     (= pod tlačítkem Vybrat soubor, uvnitř téže form-group).
 *  C) Aktuálně uložený soubor se zobrazuje v koloně A (s odkazem pro náhled v novém okně).
 *  D) Tlačítko "Odebrat" je POD kolonkou A (nikoli vedle ní).
 *  E) Logika platí symetricky pro Zelenou kartu i pro Smlouvu scan.
 */

// ─── Globální helper — preview uvnitř kolonky A po výběru souboru ──────────
function onPolicyFileSelected(inputEl, previewContainerId) {
  var container = document.getElementById(previewContainerId);
  if (!container) return;
  var file = inputEl.files && inputEl.files[0];
  if (!file) {
    container.innerHTML = '';
    return;
  }
  var objectUrl = URL.createObjectURL(file);
  var isImage = file.type && file.type.startsWith('image/');
  var isPdf   = file.type && file.type.includes('pdf');
  var icon    = isImage ? '🖼️' : (isPdf ? '📕' : '📎');
  container.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:8px 10px;' +
      'background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.25);border-radius:8px;">' +
      '<span style="font-size:18px;">' + icon + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(file.name) + '">' +
          escHtml(file.name) +
        '</div>' +
        '<div style="font-size:11px;color:var(--text2);">' + fmtSize(file.size) + ' · nový výběr</div>' +
      '</div>' +
      '<a href="' + objectUrl + '" target="_blank" rel="noopener" ' +
        'style="font-size:12px;color:#0ea5e9;white-space:nowrap;padding:4px 10px;border:1px solid rgba(14,165,233,0.35);border-radius:6px;text-decoration:none;"' +
        ' title="Otevřít náhled v novém okně">👁️ Náhled</a>' +
    '</div>';
}

// ─── Přepis showPolicyForm — opravená fileFieldHtml uvnitř closure ─────────
(function() {
  // Původní funkci zabalíme — showPolicyForm má lokální fileFieldHtml closure,
  // takže ji musíme celou nahradit s novou verzí fileFieldHtml.
  var _orig = window.showPolicyForm;
  if (!_orig) return; // defensivní check

  window.showPolicyForm = function(vehicleId, policyId) {
    var wrap = document.getElementById('policy-form-wrap');
    if (!wrap) return;

    var editing = policyId != null;
    var p = editing ? ((window.currentPolicies || []).find(function(x) { return x.id === policyId; }) || null) : null;

    var policyTypeOpts = Object.entries(POLICY_TYPES)
      .map(function(e) { var k=e[0],label=e[1]; return '<option value="' + k + '"' + (p && p.policy_type === k ? ' selected' : '') + '>' + label + '</option>'; }).join('');

    function toDateInput(d) {
      if (!d) return '';
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toISOString().split('T')[0];
    }
    var valFrom = p && p.valid_from ? toDateInput(p.valid_from) : '';
    var valTo = p && p.valid_to ? toDateInput(p.valid_to) : '';
    var premium = p && p.premium_amount != null ? Number(p.premium_amount) : '';

    // ─── NOVÁ fileFieldHtml: soubor se zobrazuje UVNITŘ kolonky A ──────────
    function fileFieldHtml(idPrefix, label, currentUrl, currentName) {
      var hasFile = !!currentUrl;
      var previewId = idPrefix + '-preview';

      // Aktuálně uložený soubor — zobrazit v koloně A s náhledem
      var currentHtml = hasFile
        ? '<div id="' + idPrefix + '-current" style="display:flex;align-items:center;gap:8px;padding:8px 10px;' +
            'background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;">' +
            '<span style="font-size:18px;">📎</span>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(currentName || '') + '">' +
                escHtml(currentName || 'uložený soubor') +
              '</div>' +
              '<div style="font-size:11px;color:var(--text2);">Aktuálně uloženo</div>' +
            '</div>' +
            '<a href="' + escHtml(currentUrl) + '" target="_blank" rel="noopener" ' +
              'style="font-size:12px;color:#0ea5e9;white-space:nowrap;padding:4px 10px;border:1px solid rgba(14,165,233,0.35);border-radius:6px;text-decoration:none;"' +
              ' title="Otevřít v novém okně">👁️ Náhled</a>' +
          '</div>'
        : '';

      return '<div class="form-group full">' +
        // Label kolonky
        '<label style="margin-bottom:6px;">' + label + '</label>' +
        // Kolonka A — aktuální soubor (nebo prázdné)
        '<div id="' + previewId + '" style="margin-bottom:6px;">' + currentHtml + '</div>' +
        // Nový výběr souboru — skrytý input spouštěný přes label-tlačítko
        '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;' +
          'padding:7px 14px;background:var(--surface2);border:1px solid var(--border);' +
          'border-radius:8px;font-size:13px;font-weight:500;width:fit-content;margin-bottom:4px;">' +
          '<span>📂 Vybrat soubor</span>' +
          '<input type="file" id="' + idPrefix + '-file" accept="image/*,application/pdf" ' +
            'style="display:none;" ' +
            'onchange="onPolicyFileSelected(this, \'' + previewId + '\')">' +
        '</label>' +
        // Tlačítko Odebrat — pod kolonkou A, viditelné jen pokud existuje uložený soubor
        (hasFile
          ? '<div style="margin-top:4px;">' +
              '<button type="button" class="btn btn-sm btn-danger" ' +
                'id="' + idPrefix + '-remove-btn" ' +
                'onclick="removePolicyFile(\'' + idPrefix + '\')" ' +
                'title="Odebrat soubor ze systému HolyOS">🗑️ Odebrat</button>' +
            '</div>'
          : '') +
        '<input type="hidden" id="' + idPrefix + '-remove" value="0">' +
      '</div>';
    }
    // ─────────────────────────────────────────────────────────────────────────

    var contractField  = fileFieldHtml('p-contract', 'Smlouva scan', p && p.contract_url, p && p.contract_name);
    var greenCardField = fileFieldHtml('p-greencard', 'Zelená karta', p && p.file_url, p && p.file_name);

    var title = editing ? 'Upravit pojistku' : 'Nová pojistka';
    var submitLabel = editing ? 'Uložit změny' : 'Uložit pojistku';
    var saveArg = editing ? (vehicleId + ',' + policyId) : (vehicleId + ',null');

    var selectedCompanyId = (p && p.company_id) ? p.company_id : null;
    var companySelect = '<select id="p-company-id">' + companyOptionsHtml(selectedCompanyId) + '</select>';

    function cb(id, label, val) {
      return '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;">' +
        '<input type="checkbox" id="' + id + '"' + (val ? ' checked' : '') + '>' + label + '</label>';
    }
    var coveragesRow = '<div class="form-group full" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;">' +
      '<span style="font-size:12px;font-weight:600;color:var(--text2);margin-right:8px;">Doplňková krytí:</span>' +
      cb('p-cov-havarijni', 'Havarijní pojištění',       p && p.has_havarijni) +
      cb('p-cov-glass',     'Pojištění čelního skla',    p && p.has_glass) +
      cb('p-cov-animal',    'Pojištění střetu se zvěří', p && p.has_animal) +
      cb('p-cov-natural',   'Živelní pojištění',         p && p.has_natural) +
    '</div>';

    wrap.innerHTML = '<div class="policy-card" id="new-policy-card">' +
      '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;">' + title + '</div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label>Typ *</label><select id="p-type">' + policyTypeOpts + '</select></div>' +
        '<div class="form-group"><label>Pojišťovna</label>' + companySelect + '</div>' +
        coveragesRow +
        '<div class="form-group"><label>Číslo pojistky</label><input type="text" id="p-number" value="' + escHtml(p && p.policy_number || '') + '"></div>' +
        '<div class="form-group"><label>Pojistné (Kč)</label><input type="number" id="p-premium" step="0.01" min="0" value="' + premium + '"></div>' +
        '<div class="form-group"><label>Platnost od</label><input type="date" id="p-from" value="' + valFrom + '"></div>' +
        '<div class="form-group"><label>Platnost do</label><input type="date" id="p-to" value="' + valTo + '"></div>' +
        '<div class="form-group full"><label>Poznámka</label><textarea id="p-note">' + escHtml(p && p.note || '') + '</textarea></div>' +
        contractField +
        greenCardField +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
        '<button type="button" class="btn btn-sm btn-secondary" onclick="cancelPolicyForm()">Zrušit</button>' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="savePolicy(' + saveArg + ')">' + submitLabel + '</button>' +
      '</div>' +
    '</div>';
  };
})();
