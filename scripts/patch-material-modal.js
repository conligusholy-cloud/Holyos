/**
 * Patch skript: zvětší okno pro editaci zboží (úkol #80)
 * - Okno: 80vw × 80vh
 * - Odstraní záložky (tabs) z modálu — všechny sekce viditelné najednou
 * - Form bez omezeného max-height
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'modules', 'nakup-sklad', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// ============================================================
// 1. Oprav CSS třídu .modal — přidej variantu pro zboží (.modal-goods)
// ============================================================
const cssInsert = `
    /* Modal pro editaci zboží — 80 % obrazovky, bez scrollování */
    .modal-goods {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
      width: 80vw;
      max-width: 80vw;
      height: 80vh;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-goods h2 { font-size: 18px; margin-bottom: 16px; flex-shrink: 0; }
    .modal-goods .modal-actions { flex-shrink: 0; margin-top: 0; padding-top: 12px; border-top: 1px solid var(--border); }
    .modal-goods .mat-form-scroll {
      flex: 1;
      overflow-y: auto;
      padding-right: 8px;
      padding-bottom: 8px;
    }
    .mat-section-title {
      font-size: 13px;
      font-weight: 700;
      color: #f59e0b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 20px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
      grid-column: 1 / -1;
    }
    .mat-section-title:first-child { margin-top: 0; }
`;

// Vlož CSS před uzavírací </style>
content = content.replace('</style>', cssInsert + '\n  </style>');

// ============================================================
// 2. Nahraď otevření modálu — změň max-width:820px na .modal-goods
//    a odstraň záložky; přepiš celý HTML šablonu modálu v openMaterialModal
// ============================================================

// Najdi řádek s document.getElementById('modal-root').innerHTML = ...  v openMaterialModal
// Nahradíme: 'modal' style=\"max-width:820px\"  →  'modal-goods'
content = content.replace(
  "'<div class=\"modal-overlay\" onclick=\"if(event.target===this)closeModal()\"><div class=\"modal\" style=\"max-width:820px\">",
  "'<div class=\"modal-overlay\" onclick=\"if(event.target===this)closeModal()\"><div class=\"modal-goods\">"
);

// ============================================================
// 3. Odstraň záložkový panel sub-tabs z modálu (uvnitř openMaterialModal)
//    Nahrad ho ničím — sekce budou odděleny nadpisy .mat-section-title
// ============================================================
const subTabsBlock = `        '<div class=\"sub-tabs\" style=\"margin-bottom:12px\">' +
          '<div class=\"sub-tab mat-tab active\" data-tab=\"general\" onclick=\"switchMatTab(\\'general\\')\">Obecné</div>' +
          '<div class=\"sub-tab mat-tab\" data-tab=\"technical\" onclick=\"switchMatTab(\\'technical\\')\">Výkres / Tech</div>' +
          '<div class=\"sub-tab mat-tab\" data-tab=\"planning\" onclick=\"switchMatTab(\\'planning\\')\">Plánování</div>' +
          '<div class=\"sub-tab mat-tab\" data-tab=\"properties\" onclick=\"switchMatTab(\\'properties\\')\">Vlastnosti</div>' +
          (showSnTab ? '<div class=\"sub-tab mat-tab\" data-tab=\"serials\" onclick=\"switchMatTab(\\'serials\\');loadSerialPanel(' + id + ')\">🔖 Sériová čísla</div>' : '') +
          (showLotTab ? '<div class=\"sub-tab mat-tab\" data-tab=\"lots\" onclick=\"switchMatTab(\\'lots\\');loadLotPanel(' + id + ')\">📦 Šarže</div>' : '') +
          '<div class=\"sub-tab mat-tab\" data-tab=\"notes\" onclick=\"switchMatTab(\\'notes\\')\">Poznámky</div>' +
        '</div>' +`;

content = content.replace(subTabsBlock, '/* záložky odstraněny — úkol #80 */');

// ============================================================
// 4. Přepis form tagu — odstraň max-height:55vh;overflow-y:auto
//    Nahraď class="mat-form-scroll" wrapper
// ============================================================
content = content.replace(
  `'<form onsubmit=\"saveMaterial(event,' + (id||'null') + ')\" style=\"max-height:55vh;overflow-y:auto;padding-right:8px\">'`,
  `'<div class=\"mat-form-scroll\"><form onsubmit=\"saveMaterial(event,' + (id||'null') + ')\">'`
);

// ============================================================
// 5. Přidej nadpisy sekcí místo záložek + zobraz všechny sekce (display:grid → vždy viditelné)
//    5a. Tab Obecné — přidej nadpis, odstraň skrytí
// ============================================================

// Sekce "general" — již viditelná (je první), přidej nadpis
content = content.replace(
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"general\">'`,
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"general\"><div class=\"mat-section-title\">📋 Obecné informace</div>'`
);

// Sekce "technical" — odstraň style="display:none", přidej nadpis
content = content.replace(
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"technical\" style=\"display:none\">'`,
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"technical\"><div class=\"mat-section-title\">📐 Výkres / Technické</div>'`
);

// Sekce "planning" — odstraň style="display:none", přidej nadpis
content = content.replace(
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"planning\" style=\"display:none\">'`,
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"planning\"><div class=\"mat-section-title\">📈 Plánování</div>'`
);

// Sekce "properties" — odstraň style="display:none", přidej nadpis
content = content.replace(
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"properties\" style=\"display:none\">'`,
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"properties\"><div class=\"mat-section-title\">⚙️ Vlastnosti</div>'`
);

// Sekce "notes" — odstraň style="display:none", přidej nadpis
content = content.replace(
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"notes\" style=\"display:none\">'`,
  `'<div class=\"form-grid mat-tab-content\" data-tab=\"notes\"><div class=\"mat-section-title\">📝 Poznámky</div>'`
);

// ============================================================
// 6. Sekce sériových čísel — odstraň style="display:none"
// ============================================================
content = content.replace(
  `'<div class=\"mat-tab-content\" data-tab=\"serials\" style=\"display:none\">'`,
  `'<div class=\"mat-tab-content mat-section-serials\" data-tab=\"serials\"><div class=\"mat-section-title\">🔖 Sériová čísla</div>'`
);

// ============================================================
// 7. Sekce šarží — odstraň style="display:none"
// ============================================================
content = content.replace(
  `'<div class=\"mat-tab-content\" data-tab=\"lots\" style=\"display:none\">'`,
  `'<div class=\"mat-tab-content mat-section-lots\" data-tab=\"lots\"><div class=\"mat-section-title\">📦 Šarže</div>'`
);

// ============================================================
// 8. Uzavírací tag formu — přidej uzavření .mat-form-scroll wrapperu
//    Hledáme modal-actions a uzavírací </form></div></div>
// ============================================================
content = content.replace(
  `'<div class=\"modal-actions\" style=\"margin-top:16px;padding-top:12px;border-top:1px solid var(--border);gap:8px\">' +\n          (id ? '<button type=\"button\" class=\"btn btn-secondary\" onclick=\"printMaterialLabel(' + id + ')\">🖨 Tisknout etiketu</button>' : '') +\n          '<div style=\"flex:1\"></div>' +\n          '<button type=\"button\" class=\"btn btn-secondary\" onclick=\"closeModal()\">Zrušit</button>' +\n          '<button type=\"submit\" class=\"btn btn-primary\">' + (id ? 'Uložit' : 'Vytvořit') + '</button>' +\n        '</div></form></div></div>`,
  `'</form></div>' +\n        '<div class=\"modal-actions\" style=\"gap:8px\">' +\n          (id ? '<button type=\"button\" class=\"btn btn-secondary\" onclick=\"printMaterialLabel(' + id + ')\">🖨 Tisknout etiketu</button>' : '') +\n          '<div style=\"flex:1\"></div>' +\n          '<button type=\"button\" class=\"btn btn-secondary\" onclick=\"closeModal()\">Zrušit</button>' +\n          '<button type=\"button\" class=\"btn btn-primary\" onclick=\"this.closest(\\'.modal-goods\\').querySelector(\\'form\\').requestSubmit()\">' + (id ? 'Uložit' : 'Vytvořit') + '</button>' +\n        '</div></div></div>`
);

// ============================================================
// 9. Uprav switchMatTab — při přepnutí záložky (z deep-link) stačí scrollnout na sekci
// ============================================================
const oldSwitchMatTab = `    let matModalTab = 'general';
    function switchMatTab(tab) {
      matModalTab = tab;
      document.querySelectorAll('.mat-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      document.querySelectorAll('.mat-tab-content').forEach(t => t.style.display = t.dataset.tab === tab ? 'grid' : 'none');
    }`;

const newSwitchMatTab = `    let matModalTab = 'general';
    function switchMatTab(tab) {
      matModalTab = tab;
      // Všechny sekce jsou vždy viditelné — stačí scrollovat na příslušnou sekci
      const target = document.querySelector('.mat-tab-content[data-tab="' + tab + '"]');
      if (target) {
        const scroll = target.closest('.mat-form-scroll');
        if (scroll) scroll.scrollTop = target.offsetTop - 8;
        else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }`;

content = content.replace(oldSwitchMatTab, newSwitchMatTab);

// ============================================================
// Zapis
// ============================================================
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ Patch aplikován na modules/nakup-sklad/index.html');
