/**
 * Patch: Zvětšení okna pro editaci zboží na 80vw × 80vh
 * Úkol #78 — všechna pole viditelná bez posuvníků, bez záložek
 *
 * Přepisuje openMaterialModal tak, aby:
 *  - okno mělo 80 % šířky a 80 % výšky obrazovky
 *  - veškerý obsah byl zobrazen najednou (bez sub-tabs)
 *  - nebyl potřeba horizontální ani vertikální posuvník v levé/pravé liště
 */
(function () {
  'use strict';

  // Počkáme, až bude původní funkce definována
  function patchWhenReady() {
    if (typeof openMaterialModal !== 'function') {
      setTimeout(patchWhenReady, 50);
      return;
    }
    _applyPatch();
  }

  function _applyPatch() {
    // Uložíme originál pro případ potřeby
    window._origOpenMaterialModal = window.openMaterialModal;

    window.openMaterialModal = async function (id) {
      if (typeof companies === 'undefined' || companies.length === 0) {
        try { const r = await fetch('/api/wh/companies?type=supplier'); window.companies = await r.json(); } catch (e) {}
      }
      let m = {};
      if (id) {
        try {
          const r = await fetch('/api/wh/materials/' + id + '?_=' + Date.now(), { cache: 'no-store' });
          m = await r.json();
        } catch (e) {}
      }

      const supOpts = (window.companies || [])
        .filter(c => c.type === 'supplier' || c.type === 'both')
        .map(c => '<option value="' + c.id + '"' + (m.supplier_id === c.id ? ' selected' : '') + '>' + c.name + '</option>')
        .join('');

      const s = (f, v) => m[f] === v ? ' selected' : '';
      const c = (f) => m[f] ? ' checked' : '';
      const v = (f, def) => (m[f] !== undefined && m[f] !== null) ? m[f] : (def !== undefined ? def : '');

      const showSnTab  = !!(id && m.save_sn_first_scan);
      const showLotTab = !!(id && (m.expirable || m.distinguish_batches));

      // ── CSS injektovaný jednou ────────────────────────────────────────────
      if (!document.getElementById('mat-modal-patch-css')) {
        const style = document.createElement('style');
        style.id = 'mat-modal-patch-css';
        style.textContent = `
          .mat-modal-80 {
            width: 80vw !important;
            max-width: 80vw !important;
            height: 80vh !important;
            max-height: 80vh !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            padding: 24px 28px !important;
            box-sizing: border-box !important;
          }
          .mat-modal-80 h2 {
            flex-shrink: 0;
            margin-bottom: 16px;
          }
          .mat-modal-80 .mat-modal-scroll {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding-right: 4px;
          }
          .mat-modal-80 .mat-modal-actions {
            flex-shrink: 0;
            margin-top: 0;
            padding-top: 12px;
            border-top: 1px solid var(--border);
            display: flex;
            gap: 8px;
            align-items: center;
          }
          /* Sekce nadpisy uvnitř formuláře */
          .mat-section-title {
            grid-column: 1 / -1;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--text2);
            padding: 14px 0 6px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 2px;
          }
        `;
        document.head.appendChild(style);
      }

      // ── Pomocné funkce ────────────────────────────────────────────────────
      function esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
      }

      function photoUploadArea(photoUrl) {
        const escaped = esc(v('photo_url'));
        return '<div class="form-group full"><label>Fotografie</label>' +
          '<div id="photo-upload-area" style="border:2px dashed var(--border);border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:border-color 0.2s,background 0.2s;position:relative;" ' +
            'onclick="document.getElementById(\'photo-file-input\').click()" ' +
            'ondragover="event.preventDefault();this.style.borderColor=\'#eab308\';this.style.background=\'rgba(234,179,8,0.06)\'" ' +
            'ondragleave="this.style.borderColor=\'var(--border)\';this.style.background=\'transparent\'" ' +
            'ondrop="event.preventDefault();this.style.borderColor=\'var(--border)\';this.style.background=\'transparent\';handlePhotoDrop(event)">' +
            (v('photo_url') ? '<div id="photo-preview" style="margin-bottom:8px;"><img src="' + v('photo_url') + '" style="max-width:160px;max-height:110px;border-radius:8px;object-fit:cover;"></div>' : '<div id="photo-preview"></div>') +
            '<div id="photo-upload-label">' +
              (v('photo_url')
                ? '<div style="font-size:12px;color:var(--text2);">Klikněte nebo přetáhněte nový obrázek pro nahrazení</div>'
                : '<div style="font-size:24px;opacity:0.4;margin-bottom:4px;">📷</div><div style="font-size:13px;color:var(--text2);">Klikněte nebo přetáhněte obrázek</div><div style="font-size:11px;color:var(--text2);opacity:0.6;margin-top:2px;">JPG, PNG, WEBP · max 5 MB</div>') +
            '</div>' +
            '<input type="file" id="photo-file-input" accept="image/*" style="display:none;" onchange="handlePhotoSelect(this)">' +
          '</div>' +
          '<input type="hidden" name="photo_url" id="photo-url-hidden" value="' + v('photo_url') + '">' +
        '</div>';
      }

      // ── Sestavení HTML formuláře (vše najednou, bez záložek) ─────────────
      const formHtml =
        // ── SEKCE: Identifikace ──────────────────────────────────────────
        '<div class="mat-section-title">🏷️ Identifikace</div>' +
        '<div class="form-group"><label>Kód</label><input type="text" name="code" value="' + v('code') + '" placeholder="Auto"></div>' +
        '<div class="form-group"><label>Název *</label><input type="text" name="name" value="' + v('name') + '" required></div>' +
        '<div class="form-group"><label>Typ *</label><select name="type"><option value="material"' + s('type','material') + '>Materiál</option><option value="product"' + s('type','product') + '>Výrobek</option><option value="goods"' + s('type','goods') + '>Zboží</option><option value="semi_product"' + s('type','semi_product') + '>Polotovar</option></select></div>' +
        '<div class="form-group"><label>Stav *</label><select name="status"><option value="active"' + s('status','active') + '>Aktivní</option><option value="new"' + s('status','new') + '>Nový</option><option value="first_run"' + s('status','first_run') + '>První běh</option></select></div>' +
        '<div class="form-group"><label>Externí ID</label><input type="text" name="external_id" value="' + v('external_id') + '"></div>' +
        '<div class="form-group"><label>Čárový kód</label><input type="text" name="barcode" value="' + v('barcode') + '"></div>' +
        '<div class="form-group"><label>Jednotka *</label><input type="text" name="unit" value="' + v('unit','ks') + '"></div>' +
        '<div class="form-group"><label>Alternativní jednotka</label><input type="text" name="alt_unit" value="' + v('alt_unit') + '"></div>' +
        '<div class="form-group"><label>Koeficient alt. jednotky</label><input type="number" name="alt_unit_coeff" value="' + v('alt_unit_coeff',0) + '" step="0.001"></div>' +
        '<div class="form-group"><label>Nákupní cena</label><input type="number" name="unit_price" value="' + v('unit_price',0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Dodavatel</label><select name="supplier_id"><option value="">—</option>' + supOpts + '</select></div>' +
        '<div class="form-group"><label>Skupina materiálu</label><input type="text" name="material_group" value="' + v('material_group') + '"></div>' +
        '<div class="form-group"><label>Norma</label><input type="text" name="norm" value="' + v('norm') + '"></div>' +
        '<div class="form-group"><label>Hmotnost (kg)</label><input type="number" name="weight" value="' + v('weight',0) + '" step="0.001"></div>' +
        '<div class="form-group"><label>Rodina</label><input type="text" name="family" value="' + v('family') + '"></div>' +
        '<div class="form-group"><label>Barva</label><input type="text" name="color" value="' + v('color') + '"></div>' +
        '<div class="form-group"><label>Druhotná barva</label><input type="text" name="secondary_color" value="' + v('secondary_color') + '"></div>' +
        '<div class="form-group full"><label>Klíčová slova</label><input type="text" name="keywords" value="' + v('keywords') + '" placeholder="oddělená čárkou"></div>' +
        photoUploadArea(v('photo_url')) +

        // ── SEKCE: Technické a výkresové info ───────────────────────────
        '<div class="mat-section-title">📐 Výkres / Technické info</div>' +
        '<div class="form-group"><label>Materiál (ref.)</label><input type="text" name="material_ref" value="' + v('material_ref') + '"></div>' +
        '<div class="form-group"><label>Polotovar (ref.)</label><input type="text" name="semi_product_ref" value="' + v('semi_product_ref') + '"></div>' +
        '<div class="form-group"><label>Cesta</label><input type="text" name="route" value="' + v('route') + '"></div>' +
        '<div class="form-group"><label>Číslo revize</label><input type="text" name="revision_number" value="' + v('revision_number') + '"></div>' +
        '<div class="form-group"><label>Číslo zakázky</label><input type="text" name="order_number" value="' + v('order_number') + '"></div>' +
        '<div class="form-group"><label>Pozice</label><input type="text" name="position" value="' + v('position') + '"></div>' +
        '<div class="form-group"><label>Křeslil</label><input type="text" name="drawn_by" value="' + v('drawn_by') + '"></div>' +
        '<div class="form-group"><label>Název ToolBox</label><input type="text" name="toolbox_name" value="' + v('toolbox_name') + '"></div>' +
        '<div class="form-group"><label>Rozměr</label><input type="text" name="dimension" value="' + v('dimension') + '"></div>' +
        '<div class="form-group"><label>Název Solid</label><input type="text" name="solid_name" value="' + v('solid_name') + '"></div>' +
        '<div class="form-group"><label>Doba dodání (dny)</label><input type="number" name="lead_time_days" value="' + v('lead_time_days',0) + '" step="1"></div>' +

        // ── SEKCE: Plánování a zásoby ────────────────────────────────────
        '<div class="mat-section-title">📊 Plánování a zásoby</div>' +
        '<div class="form-group"><label>Minimální zásoba *</label><input type="number" name="min_stock" value="' + v('min_stock',0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Maximální zásoba</label><input type="number" name="max_stock" value="' + v('max_stock',0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Typ min. zásoby</label><select name="min_stock_type"><option value="min_stock"' + s('min_stock_type','min_stock') + '>Minimální zásoba</option><option value="safety_stock"' + s('min_stock_type','safety_stock') + '>Pojistná zásoba</option></select></div>' +
        '<div class="form-group"><label>Typ max. zásoby</label><select name="max_stock_type"><option value="total_stock"' + s('max_stock_type','total_stock') + '>Skladem celkem</option><option value="available"' + s('max_stock_type','available') + '>Dostupné</option></select></div>' +
        '<div class="form-group"><label>Min. velikost dávky</label><input type="number" name="batch_size_min" value="' + v('batch_size_min',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Max. velikost dávky</label><input type="number" name="batch_size_max" value="' + v('batch_size_max',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Běžná velikost dávky</label><input type="number" name="batch_size_default" value="' + v('batch_size_default',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Zpracováno v násobcích</label><input type="number" name="processed_in_multiples" value="' + v('processed_in_multiples',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Priorita</label><input type="number" name="priority" value="' + v('priority',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Denní cíl</label><input type="number" name="daily_target" value="' + v('daily_target',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Forecasty [%]</label><input type="number" name="forecast_pct" value="' + v('forecast_pct',0) + '" step="0.1"></div>' +
        '<div class="form-group"><label>Váha pro řazení</label><input type="number" name="sort_weight" value="' + v('sort_weight',0) + '" step="0.1"></div>' +
        '<div class="form-group"><label>Rezerva před expedicí [dny]</label><input type="number" name="expedition_reserve_days" value="' + v('expedition_reserve_days',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Tolerance menší dodávky [%]</label><input type="number" name="delivery_tolerance_pct" value="' + v('delivery_tolerance_pct',0) + '" step="0.1"></div>' +
        '<div class="form-group"><label>Uvolnit dávky před odesláním [dny]</label><input type="number" name="release_before_dispatch_days" value="' + v('release_before_dispatch_days',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Čeká po naskladnění [h]</label><input type="number" name="wait_after_stock_hours" value="' + v('wait_after_stock_hours',0) + '" step="0.1"></div>' +
        '<div class="form-group"><label>Platné od</label><input type="date" name="valid_from" value="' + v('valid_from') + '"></div>' +
        '<div class="form-group"><label>Platné do</label><input type="date" name="valid_to" value="' + v('valid_to') + '"></div>' +
        '<div class="form-group"><label>Zákazníci</label><input type="text" name="customers" value="' + v('customers') + '"></div>' +
        '<div class="form-group"><label>Interní stav</label><input type="text" name="internal_status" value="' + v('internal_status') + '"></div>' +
        '<div class="form-group"><label>Cílový sklad</label><input type="text" name="target_warehouse" value="' + v('target_warehouse') + '"></div>' +

        // ── SEKCE: Vlastnosti a příznaky ─────────────────────────────────
        '<div class="mat-section-title">⚙️ Vlastnosti a příznaky</div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="non_stock"' + c('non_stock') + '> Neskladové zboží</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="uses_service_eshop"' + c('uses_service_eshop') + '> Používá servis / e-shop</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="distinguish_batches"' + c('distinguish_batches') + '> Rozlišovat dávky</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="interchangeable_batches"' + c('interchangeable_batches') + '> Zaměnitelné dávky</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="no_availability_check"' + c('no_availability_check') + '> Nehlídat dostupnost</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="check_availability_stage"' + c('check_availability_stage') + '> Hlídat dostupnost na pracovišti</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="check_availability_expedition"' + c('check_availability_expedition') + '> Hlídat dostupnost na expedici</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="plan_orders"' + c('plan_orders') + '> Plánovat objednávky</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="mandatory_scan"' + c('mandatory_scan') + '> Povinně skenovat</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="save_sn_first_scan"' + c('save_sn_first_scan') + '> Uložit SN při prvním naskenování</label></div>' +
        '<div class="form-group"><label>SN mask</label><input type="text" name="sn_mask" value="' + v('sn_mask') + '"></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="temp_barcode"' + c('temp_barcode') + '> Dočasný barcode</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="auto_complete_after_bom_scan"' + c('auto_complete_after_bom_scan') + '> Auto-dokončit po skenování kusovníku</label></div>' +
        '<div class="form-group"><label>Náhrada zásoby</label><select name="stock_substitution"><option value="none"' + s('stock_substitution','none') + '>Nenahrazovat</option><option value="auto"' + s('stock_substitution','auto') + '>Automaticky</option></select></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="exact_consumption"' + c('exact_consumption') + '> Přesně spočítaná spotřeba</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="ignore"' + c('ignore') + '> Ignorovat</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="ignore_forecast_eval"' + c('ignore_forecast_eval') + '> Ignorovat ve vyhodnocení forecastů</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="split_receipt_by_sales_items"' + c('split_receipt_by_sales_items') + '> Rozdělit při příjmu dle prod. obj.</label></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="expirable"' + c('expirable') + '> Expiruje</label></div>' +
        '<div class="form-group"><label>Max. akceptovatelná trvanlivost [%]</label><input type="number" name="max_acceptable_shelf_life_pct" value="' + v('max_acceptable_shelf_life_pct',0) + '" step="1"></div>' +
        '<div class="form-group"><label>Trvanlivost</label><input type="text" name="shelf_life" value="' + v('shelf_life') + '"></div>' +
        '<div class="form-group"><label>Jednotka trvanlivosti</label><select name="shelf_life_unit"><option value="month"' + s('shelf_life_unit','month') + '>Měsíc</option><option value="day"' + s('shelf_life_unit','day') + '>Den</option><option value="year"' + s('shelf_life_unit','year') + '>Rok</option></select></div>' +
        '<div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="allow_rotation"' + c('allow_rotation') + '> Povolit otočení</label></div>' +

        // ── SEKCE: Klasifikace a ostatní ─────────────────────────────────
        '<div class="mat-section-title">🗂️ Klasifikace a ostatní</div>' +
        '<div class="form-group"><label>Pomocná klasifikace</label><input type="text" name="classification" value="' + v('classification') + '"></div>' +
        '<div class="form-group"><label>Interní hodnota</label><input type="text" name="internal_value" value="' + v('internal_value') + '"></div>' +
        '<div class="form-group"><label>Účetní jednotka</label><input type="text" name="accounting_unit" value="' + v('accounting_unit') + '"></div>' +
        '<div class="form-group"><label>Šablona zboží</label><input type="text" name="goods_template" value="' + v('goods_template') + '"></div>' +
        '<div class="form-group"><label>Export state</label><input type="text" name="export_state" value="' + v('export_state') + '"></div>' +
        '<div class="form-group"><label>Aktivní</label><select name="active_flag"><option value="active"' + s('active_flag','active') + '>Aktivní</option><option value="inactive"' + s('active_flag','inactive') + '>Neaktivní</option></select></div>' +
        '<div class="form-group"><label>Podobné zboží</label><input type="text" name="similar_goods" value="' + v('similar_goods') + '"></div>' +
        '<div class="form-group"><label>Alternativní zboží</label><input type="text" name="alt_goods" value="' + v('alt_goods') + '"></div>' +
        '<div class="form-group"><label>Alt. zboží forecastu</label><input type="text" name="alt_goods_forecast" value="' + v('alt_goods_forecast') + '"></div>' +

        // ── SEKCE: Sériová čísla (jen pokud save_sn_first_scan) ─────────
        (showSnTab ?
          '<div class="mat-section-title">🔖 Sériová čísla</div>' +
          '<div style="grid-column:1/-1;">' +
            '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="display:flex;gap:8px;align-items:center">' +
                '<label style="font-size:12px;color:var(--text2)">Stav:</label>' +
                '<select id="sn-filter-status" onchange="loadSerialPanel(' + id + ')" style="padding:6px 10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:12px">' +
                  '<option value="">Vše</option>' +
                  '<option value="in_stock" selected>Skladem</option>' +
                  '<option value="issued">Vydané</option>' +
                  '<option value="scrapped">Vyřazené</option>' +
                  '<option value="returned">Vrácené</option>' +
                '</select>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" onclick="openSerialBulkReceipt(' + id + ')">+ Přijmout kusy</button>' +
            '</div>' +
            '<div id="sn-panel-content">Načítám…</div>' +
          '</div>'
        : '') +

        // ── SEKCE: Šarže (jen pokud expirable / distinguish_batches) ────
        (showLotTab ?
          '<div class="mat-section-title">📦 Šarže</div>' +
          '<div style="grid-column:1/-1;">' +
            '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="display:flex;gap:8px;align-items:center">' +
                '<label style="font-size:12px;color:var(--text2)">Stav:</label>' +
                '<select id="lot-filter-status" onchange="loadLotPanel(' + id + ')" style="padding:6px 10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:12px">' +
                  '<option value="in_stock" selected>Na skladě</option>' +
                  '<option value="">Vše</option>' +
                  '<option value="consumed">Spotřebováno</option>' +
                  '<option value="expired">Po expiraci</option>' +
                  '<option value="scrapped">Vyřazeno</option>' +
                '</select>' +
              '</div>' +
              '<button type="button" class="btn btn-primary" onclick="openLotReceiveDialog(' + id + ')">+ Přijmout šarži</button>' +
            '</div>' +
            '<div id="lot-panel-content">Načítám…</div>' +
          '</div>'
        : '') +

        // ── SEKCE: Poznámky ──────────────────────────────────────────────
        '<div class="mat-section-title">📝 Poznámky</div>' +
        '<div class="form-group full"><label>Popis / Poznámka</label><textarea name="description" rows="3">' + v('description') + '</textarea></div>' +
        '<div class="form-group full"><label>Poznámka pro výrobu</label><textarea name="production_note" rows="3">' + v('production_note') + '</textarea></div>';

      // ── Celý modal ────────────────────────────────────────────────────────
      document.getElementById('modal-root').innerHTML =
        '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
          '<div class="modal mat-modal-80">' +
            '<h2>' + (id ? '✏️ Upravit zboží' : '➕ Nové zboží') + '</h2>' +
            '<form onsubmit="saveMaterial(event,' + (id || 'null') + ')" style="display:contents">' +
              '<div class="mat-modal-scroll">' +
                '<div class="form-grid">' + formHtml + '</div>' +
              '</div>' +
              '<div class="mat-modal-actions">' +
                (id ? '<button type="button" class="btn btn-secondary" onclick="printMaterialLabel(' + id + ')">🖨 Tisknout etiketu</button>' : '') +
                '<div style="flex:1"></div>' +
                '<button type="button" class="btn btn-secondary" onclick="closeModal()">Zrušit</button>' +
                '<button type="submit" class="btn btn-primary">' + (id ? 'Uložit' : 'Vytvořit') + '</button>' +
              '</div>' +
            '</form>' +
          '</div>' +
        '</div>';

      // Načíst panely pokud jsou viditelné
      if (showSnTab)  { setTimeout(function() { if (typeof loadSerialPanel  === 'function') loadSerialPanel(id);  }, 80); }
      if (showLotTab) { setTimeout(function() { if (typeof loadLotPanel     === 'function') loadLotPanel(id);     }, 80); }
    };

    console.log('[patch #78] openMaterialModal přepsán — okno 80vw × 80vh, bez záložek');
  }

  patchWhenReady();
})();
