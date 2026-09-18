// HolyOS — Průvodce novou objednávkou (sdílený widget)
// Otevře se z obrazovky obchodníka i z detailu leadu v HolyOS:
//   OrderWizard.open(leadId)
// Napojení (vše pod /api/compounder, aby fungovalo i na obchodníkově doméně):
//   GET  /leads/:id                 — předvyplnění odběratele z leadu
//   GET  /pricelist                 — ceník strojů (verze=délka, varianta=výška, ceny malo/kamion, výbava)
//   GET  /pricelist-config          — Společná výbava (skupiny voleb)
//   GET  /ares/:ico                 — dohledání firmy z ARES
//   POST /leads/:id/create-sales-order — založí koncept objednávky + odběratele
// MVP (fáze 1): sloty a auto-doklady zatím ne; platba/servis/výbava se ukládají do poznámky objednávky.

(function () {
  var RATE = 24.3;
  var fmt = new Intl.NumberFormat('cs-CZ');
  var st = null; // stav aktuálního průvodce

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function api(path, opts) { return fetch('/api/compounder' + path, Object.assign({ credentials: 'include' }, opts || {})); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }

  function injectCss() {
    if (document.getElementById('ow-css')) return;
    var s = document.createElement('style'); s.id = 'ow-css';
    s.textContent = [
      '.ow-ov{position:fixed;inset:0;background:#0f1220;z-index:100000;display:flex;align-items:stretch;justify-content:center;}',
      '@media(min-width:640px){.ow-ov{align-items:center;background:rgba(0,0,0,.6);}}',
      '.ow-card{background:#1a1e33;color:#e7e9f5;width:100%;max-width:100%;height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;display:flex;flex-direction:column;border:none;border-radius:0;font-family:"Segoe UI",system-ui,sans-serif;}',
      '@media(min-width:640px){.ow-card{max-width:520px;height:auto;max-height:92vh;border:1px solid #333a5c;border-radius:16px;}}',
      '.ow-hd{padding:calc(14px + env(safe-area-inset-top,0px)) 16px 10px;border-bottom:1px solid #333a5c;}',
      '.ow-hd .r{display:flex;align-items:center;gap:8px;}',
      '.ow-hd h3{font-size:16px;font-weight:600;flex:1;margin:0;}',
      '.ow-x{background:#232840;border:1px solid #333a5c;color:#e7e9f5;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px;}',
      '.ow-sub{font-size:13px;color:#9aa0c4;margin-top:4px;}',
      '.ow-bar{height:4px;background:#0f1220;border-radius:999px;margin-top:10px;overflow:hidden;}',
      '.ow-bar>div{height:100%;background:#6c8cff;border-radius:999px;transition:width .2s;}',
      '.ow-bd{padding:16px;overflow-y:auto;flex:1;}',
      '.ow-ft{display:flex;gap:10px;padding:12px 16px calc(16px + env(safe-area-inset-bottom,0px));border-top:1px solid #333a5c;}',
      '.ow-bd label{display:block;font-size:13px;color:#9aa0c4;margin-bottom:6px;}',
      '.ow-bd .sm{font-size:12px;color:#6b7099;}',
      '.ow-in{width:100%;background:#232840;color:#e7e9f5;border:1px solid #333a5c;border-radius:9px;padding:10px 12px;font-size:14px;outline:none;box-sizing:border-box;}',
      '.ow-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}',
      '.ow-mb{margin-bottom:12px;}',
      '.ow-seg{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}',
      '.ow-seg button{flex:1;min-width:70px;padding:9px 8px;font-size:13px;border:1px solid #333a5c;background:#232840;color:#9aa0c4;border-radius:9px;cursor:pointer;}',
      '.ow-seg button.on{border-color:#6c8cff;background:rgba(108,140,255,.16);color:#aab6ff;font-weight:600;}',
      '.ow-cards{display:flex;flex-direction:column;gap:8px;}',
      '.ow-cards button{display:flex;flex-direction:column;gap:2px;text-align:left;padding:11px 12px;border:1px solid #333a5c;background:#232840;border-radius:12px;cursor:pointer;color:#e7e9f5;}',
      '.ow-cards button.on{border:2px solid #6c8cff;background:rgba(108,140,255,.16);}',
      '.ow-cards .cn{font-size:14px;font-weight:600;}',
      '.ow-cards .cd{font-size:12px;color:#9aa0c4;}',
      '.ow-cards .cp{font-size:13px;font-weight:600;color:#aab6ff;margin-top:2px;}',
      '.ow-cards .ck{font-size:11px;color:#6b7099;}',
      '.ow-btn{border:1px solid #333a5c;background:#232840;color:#e7e9f5;border-radius:10px;padding:12px;font-size:15px;cursor:pointer;}',
      '.ow-btn.prim{flex:1;border-color:#6c8cff;color:#fff;background:linear-gradient(135deg,#6C5CE7,#0984E3);font-weight:600;}',
      '.ow-note{display:flex;gap:8px;padding:10px 12px;border-radius:9px;font-size:12px;margin-top:12px;}',
      '.ow-note.acc{background:rgba(108,140,255,.14);color:#aab6ff;}',
      '.ow-note.warn{background:rgba(245,158,11,.14);color:#f7c774;}',
      '.ow-note.ok{background:rgba(34,197,94,.14);color:#7ee2a8;}',
      '.ow-note.err{background:rgba(239,68,68,.14);color:#f6a3a3;}',
      '.ow-chk{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:8px;color:#e7e9f5;}',
      '.ow-sm{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #333a5c;font-size:13px;}',
      '.ow-sm .k{color:#9aa0c4;}.ow-sm .v{text-align:right;font-weight:600;}',
    ].join('');
    document.head.appendChild(s);
  }

  // ---- načtení dat ----
  function loadData(leadId) {
    return Promise.all([
      api('/leads/' + leadId).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      api('/pricelist').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      api('/pricelist-config').then(function (r) { return r.ok ? r.json() : { config_options: [] }; }).catch(function () { return { config_options: [] }; }),
      api('/slots-free').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    ]);
  }

  // ---- pomocné výběry ----
  function versions() {
    var seen = {}, out = [];
    st.items.forEach(function (it) { var v = it.model_version || '—'; if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }
  function variants(ver) {
    var seen = {}, out = [];
    st.items.forEach(function (it) { if ((it.model_version || '—') === ver) { var v = it.model_variant || '—'; if (!seen[v]) { seen[v] = 1; out.push(v); } } });
    return out;
  }
  function machinesFor(ver, va) {
    return st.items.filter(function (it) { return (it.model_version || '—') === ver && (it.model_variant || '—') === va; });
  }
  function selItem() { return st.items.filter(function (it) { return it.id === st.machineId; })[0] || null; }
  function foreign() { return st.origin === 'foreign'; }
  function capacity() { var it = selItem(); return num(it && it.truck_capacity) || 0; }
  function autoKamion() { var c = capacity(); return c > 0 && (st.qty || 1) >= c; }
  function slotLabel(s) {
    var d1 = s.start_date ? new Date(s.start_date) : null, d2 = s.end_date ? new Date(s.end_date) : null;
    var r = (d1 ? d1.toLocaleDateString('cs-CZ') : '') + (d2 ? ('–' + d2.toLocaleDateString('cs-CZ')) : '');
    return (s.name || ('Slot #' + s.id)) + (r ? (' · ' + r) : '');
  }

  function unitPrice(it, kamion) {
    if (!it) return 0;
    if (foreign()) {
      var e = kamion ? num(it.truck_price_eur) : num(it.price_eur);
      if (!e && !kamion) e = num(it.price_eur);
      return e || (kamion ? num(it.price_eur) : 0);
    }
    var czk = kamion ? num(it.truck_price_czk) : num(it.price_czk);
    if (czk) return czk;
    var eur = kamion ? num(it.truck_price_eur) : num(it.price_eur);
    return eur ? Math.round(eur * RATE) : 0;
  }
  function money(n) { return fmt.format(Math.round(n)) + (foreign() ? ' €' : ' Kč'); }

  // výbava pro vybraný stroj: vlastní config_options, jinak společná
  function effectiveConfig() {
    var it = selItem();
    var own = it && Array.isArray(it.config_options) ? it.config_options : null;
    return (own && own.length) ? own : (st.sharedConfig || []);
  }
  // Příplatek jedné volby v aktuální měně (u zahraniční EUR, jinak Kč; dopočet kurzem když druhá měna chybí)
  function optPrice(o) {
    if (!o) return 0;
    if (foreign()) return num(o.price_eur) || (num(o.price_czk) ? Math.round(num(o.price_czk) / RATE) : 0);
    return num(o.price_czk) || (num(o.price_eur) ? Math.round(num(o.price_eur) * RATE) : 0);
  }
  function priceSuffix(o) { var p = optPrice(o); return p > 0 ? ' (+' + money(p) + ')' : ''; }
  // Součet příplatků za aktuálně vybrané volby výbavy (za 1 kus)
  function configSurcharge() {
    var cfg = effectiveConfig(); var sum = 0;
    cfg.forEach(function (g, gi) {
      var opts = Array.isArray(g.options) ? g.options : [];
      if (g.type === 'multi') {
        opts.forEach(function (o, oi) { var key = gi + ':' + oi; if (st.configMulti && st.configMulti[key]) sum += optPrice(o); });
      } else {
        var nm = g.name || ('Skupina ' + (gi + 1));
        var o = opts.filter(function (x) { return x.name === (st.config && st.config[nm]); })[0];
        sum += optPrice(o);
      }
    });
    return sum;
  }
  // Cena za kus včetně výbavy (příplatků)
  function unitAll(it, kamion) { return unitPrice(it, kamion) + configSurcharge(); }

  // ---- kroky ----
  function stepDefs() {
    return [
      { t: 'Odběratel', r: renderCustomer },
      { t: 'Stroj', r: renderMachine },
      { t: 'Výbava a počet kusů', r: renderConfig },
      { t: 'Výrobní sloty', r: renderSlots },
      { t: 'Platba', r: renderPay },
      { t: 'Servis', r: renderServis },
      { t: 'Souhrn a potvrzení', r: renderSummary },
    ];
  }

  function renderCustomer() {
    var l = st.lead || {};
    return ''
      + '<div class="ow-note acc"><span>Nová objednávka pro lead #' + st.leadId + (l.name ? ' — ' + esc(l.name) : '') + '.</span></div>'
      + '<div style="margin-top:12px;"><label>Sídlo firmy</label>'
      + '<div class="ow-seg" data-seg="origin">'
      + '<button data-v="cz" class="' + (foreign() ? '' : 'on') + '">Český (ARES)</button>'
      + '<button data-v="foreign" class="' + (foreign() ? 'on' : '') + '">Zahraniční</button></div></div>'
      + (foreign() ? renderForeign() : renderCz())
      + '<div style="border-top:1px solid #333a5c;margin-top:8px;padding-top:12px;">'
      + '<label>Odpovědná osoba</label><input class="ow-in ow-mb" id="ow-resp" value="' + esc(st.resp || l.name || '') + '">'
      + '<div class="ow-row"><div><label>E-mail</label><input class="ow-in" id="ow-email" value="' + esc(st.email || l.email || '') + '"></div>'
      + '<div><label>Telefon</label><input class="ow-in" id="ow-phone" value="' + esc(st.phone || l.phone || '') + '"></div></div></div>';
  }
  function renderCz() {
    return '<div id="ow-cz">'
      + '<label>IČO</label><div style="display:flex;gap:8px;margin-bottom:12px;">'
      + '<input class="ow-in" id="ow-ico" value="' + esc(st.ico || '') + '" style="flex:1;">'
      + '<button class="ow-btn" id="ow-ares" style="white-space:nowrap;">Načíst z ARES</button></div>'
      + '<label>Název firmy</label><input class="ow-in ow-mb" id="ow-name" value="' + esc(st.name || (st.lead && st.lead.company) || '') + '">'
      + '<div class="ow-row"><div><label>DIČ</label><input class="ow-in" id="ow-dic" value="' + esc(st.dic || '') + '"></div>'
      + '<div><label>Adresa</label><input class="ow-in" id="ow-addr" value="' + esc(st.addr || '') + '"></div></div>'
      + '<div id="ow-ares-ok" class="sm" style="color:#7ee2a8;display:' + (st.aresOk ? 'block' : 'none') + ';">✓ Načteno z ARES</div></div>';
  }
  function renderForeign() {
    return '<div id="ow-foreign">'
      + '<label>Země</label><input class="ow-in ow-mb" id="ow-country" value="' + esc(st.country || '') + '" placeholder="např. Velká Británie">'
      + '<label>Název firmy</label><input class="ow-in ow-mb" id="ow-name" value="' + esc(st.name || (st.lead && st.lead.company) || '') + '">'
      + '<div class="ow-row"><div><label>VAT / DIČ</label><input class="ow-in" id="ow-dic" value="' + esc(st.dic || '') + '"></div>'
      + '<div><label>Adresa</label><input class="ow-in" id="ow-addr" value="' + esc(st.addr || '') + '"></div></div></div>';
  }

  function renderMachine() {
    var vers = versions();
    if (!st.ver || vers.indexOf(st.ver) < 0) st.ver = vers[0];
    var vars = variants(st.ver);
    if (!st.va || vars.indexOf(st.va) < 0) st.va = vars[0];
    var list = machinesFor(st.ver, st.va);
    if (!selItem() || list.indexOf(selItem()) < 0) st.machineId = list[0] && list[0].id;
    var h = '<label>1) Verze — délka</label><div class="ow-seg" data-seg="ver">'
      + vers.map(function (v) { return '<button data-v="' + esc(v) + '" class="' + (v === st.ver ? 'on' : '') + '">' + esc(v) + '</button>'; }).join('') + '</div>';
    h += '<label>2) Varianta — výška</label><div class="ow-seg" data-seg="va">'
      + vars.map(function (v) { return '<button data-v="' + esc(v) + '" class="' + (v === st.va ? 'on' : '') + '">' + esc(v) + '</button>'; }).join('') + '</div>';
    h += '<label>3) Stroj</label><div class="ow-cards" data-cards="machine">';
    if (!list.length) h += '<div class="sm">V ceníku nejsou stroje pro tuto kombinaci.</div>';
    list.forEach(function (it) {
      h += '<button data-id="' + it.id + '" class="' + (it.id === st.machineId ? 'on' : '') + '">'
        + '<span class="cn">' + esc(it.name_cs || it.machine_code || ('#' + it.id)) + '</span>'
        + '<span class="cd">' + esc(it.machine_code || '') + '</span>'
        + '<span class="cp">' + money(unitPrice(it, false)) + ' / ks bez DPH</span>'
        + (unitPrice(it, true) ? '<span class="ck">velkoobch. (kamion): ' + money(unitPrice(it, true)) + ' / ks</span>' : '')
        + '</button>';
    });
    h += '</div><div class="sm" style="margin-top:8px;">Ceny z ceníku HolyOS, bez DPH.' + (foreign() ? '' : ' Kurz ČNB 1 € ≈ 24,3 Kč.') + '</div>';
    return h;
  }

  function renderConfig() {
    var cfg = effectiveConfig();
    var h = '<div class="ow-note acc"><span>Výbava ze Společné výbavy / ceníku.</span></div><div style="margin-top:12px;">';
    if (!cfg.length) h += '<div class="sm ow-mb">Pro tento stroj není definovaná výbava.</div>';
    cfg.forEach(function (g, gi) {
      var name = g.name || ('Skupina ' + (gi + 1));
      var opts = Array.isArray(g.options) ? g.options : [];
      st.config = st.config || {};
      h += '<label>' + esc(name) + (g.required ? ' *' : '') + '</label>';
      if (g.type === 'multi') {
        opts.forEach(function (o, oi) {
          var key = gi + ':' + oi; var checked = st.configMulti && st.configMulti[key];
          h += '<label class="ow-chk"><input type="checkbox" data-cfgmulti="' + key + '" data-name="' + esc(name) + '" data-opt="' + esc(o.name) + '"' + (checked ? ' checked' : '') + '> ' + esc(o.name) + priceSuffix(o) + '</label>';
        });
      } else {
        if (st.config[name] == null && opts[0]) st.config[name] = opts[0].name;
        h += '<select class="ow-in ow-mb" data-cfg="' + esc(name) + '">'
          + opts.map(function (o) { return '<option value="' + esc(o.name) + '"' + (st.config[name] === o.name ? ' selected' : '') + '>' + esc(o.name) + priceSuffix(o) + '</option>'; }).join('') + '</select>';
      }
    });
    h += '</div><div style="border-top:1px solid #333a5c;margin-top:8px;padding-top:12px;">'
      + '<label>Počet kusů (stejná konfigurace)</label>'
      + '<div style="display:flex;align-items:center;gap:10px;">'
      + '<button class="ow-btn" id="ow-qminus" style="width:44px;">−</button>'
      + '<input class="ow-in" id="ow-qty" type="number" min="1" max="50" value="' + (st.qty || 1) + '" style="flex:1;text-align:center;font-size:16px;">'
      + '<button class="ow-btn" id="ow-qplus" style="width:44px;">+</button></div>';
    h += '<div id="ow-kamion-note" class="ow-note" style="margin-top:10px;"></div>';
    h += '<div class="sm" id="ow-price-note" style="margin-top:6px;"></div></div>';
    return h;
  }

  function renderSlots() {
    var n = st.qty || 1; var free = st.slotsFree || []; st.slotSel = st.slotSel || [];
    // Auto-předvyplnění: každému kusu jiný volný slot (1 slot = 1 stroj), jen když ještě nic nevybráno.
    var anySel = st.slotSel.slice(0, n).some(function (x) { return x; });
    if (!anySel) { for (var k = 0; k < n; k++) { st.slotSel[k] = free[k] ? free[k].id : null; } }
    var h = '<div class="ow-note acc"><span>Vyber volný výrobní slot pro každý kus. <b>Jeden slot = jeden stroj.</b> Sloty se zarezervují na 3 dny do zaplacení zálohy; po uplynutí se uvolní.</span></div>';
    if (!free.length) h += '<div class="ow-note warn" style="margin-top:8px;"><span>Teď nejsou volné výrobní sloty — objednávku můžeš založit i bez slotu a přiřadit později.</span></div>';
    else if (free.length < n) h += '<div class="ow-note warn" style="margin-top:8px;"><span>Volných slotů je jen ' + free.length + ' z ' + n + ' kusů — zbytek přiřadíš později.</span></div>';
    h += '<div style="margin-top:12px;">';
    for (var i = 0; i < n; i++) {
      var cur = st.slotSel[i];
      // sloty vybrané u jiných kusů — ať je nejde zvolit dvakrát
      var takenByOthers = {};
      for (var j = 0; j < n; j++) { if (j !== i && st.slotSel[j]) takenByOthers[st.slotSel[j]] = 1; }
      var opts = free.filter(function (s) { return !takenByOthers[s.id] || String(s.id) === String(cur); });
      h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:56px;flex:0 0 auto;font-size:13px;color:#9aa0c4;">Kus ' + (i + 1) + '</span>'
        + '<select class="ow-in" data-slot="' + i + '" style="flex:1;"><option value="">— bez slotu —</option>'
        + opts.map(function (s) { return '<option value="' + s.id + '"' + (String(cur) === String(s.id) ? ' selected' : '') + '>' + esc(slotLabel(s)) + '</option>'; }).join('')
        + '</select></div>';
    }
    h += '</div>';
    return h;
  }

  function renderPay() {
    var h = '<label>Model platby</label><div class="ow-seg" data-seg="pay">'
      + '<button data-v="zaloha" class="' + (st.pay !== 'full' ? 'on' : '') + '">Záloha + doplatek</button>'
      + '<button data-v="full" class="' + (st.pay === 'full' ? 'on' : '') + '">100 % předem</button></div>';
    if (st.pay !== 'full') {
      h += '<div class="ow-row"><div><label>Záloha (%)</label><input class="ow-in" id="ow-dep" type="number" min="0" max="100" value="' + (st.dep != null ? st.dep : 30) + '"></div>'
        + '<div><label>Splatnost zálohy (dní)</label><input class="ow-in" id="ow-depd" type="number" min="0" value="' + (st.depDays != null ? st.depDays : 3) + '"></div></div>';
      h += '<label>Doplatek splatný</label><div class="ow-seg" data-seg="restwhen">'
        + '<button data-v="Před dodáním stroje" class="' + (st.restWhen !== 'Po dodání stroje' ? 'on' : '') + '">Před dodáním</button>'
        + '<button data-v="Po dodání stroje" class="' + (st.restWhen === 'Po dodání stroje' ? 'on' : '') + '">Po dodání</button></div>';
      h += '<div class="ow-row"><div><label>Splatnost doplatku (dní)</label><input class="ow-in" id="ow-restd" type="number" min="0" value="' + (st.restDays != null ? st.restDays : 14) + '"></div><div></div></div>';
      h += '<div class="sm" id="ow-pay-note"></div>';
    }
    h += '<label class="ow-chk" style="margin-top:10px;"><input type="checkbox" id="ow-loan"' + (st.loan ? ' checked' : '') + '> Financováno úvěrem</label>';
    return h;
  }

  function renderServis() {
    var cz = !foreign();
    var h = '<label>Jak bude řešený servis</label><div class="ow-seg" data-seg="svc" style="flex-direction:column;">'
      + '<button data-v="smlouva" class="' + (cz && st.svc !== 'sam' ? 'on' : '') + '"' + (cz ? '' : ' disabled style="opacity:.4;"') + '>Servisní smlouva</button>'
      + '<button data-v="sam" class="' + ((!cz || st.svc === 'sam') ? 'on' : '') + '">Zákazník řeší sám</button></div>';
    if (cz && st.svc !== 'sam') h += '<div class="ow-note acc"><span>Servisní smlouva: <b>13 % z obratu (vč. DPH)</b>. Jen pro kiosky v ČR.</span></div>';
    if (!cz) h += '<div class="ow-note warn"><span>Servisní smlouva je jen pro kiosky v ČR. Zahraniční zákazník řeší servis sám.</span></div>';
    return h;
  }

  function buyerName() { return (document.getElementById('ow-name') && document.getElementById('ow-name').value.trim()) || st.name || (st.lead && st.lead.company) || (st.lead && st.lead.name) || ''; }

  function renderSummary() {
    collect();
    var it = selItem();
    var full = autoKamion();
    var unit = unitAll(it, full);
    var q = st.qty || 1;
    var svc = foreign() ? 'Zákazník řeší sám' : (st.svc === 'sam' ? 'Zákazník řeší sám' : 'Servisní smlouva (13 % z obratu vč. DPH)');
    function row(k, v) { return '<div class="ow-sm"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'; }
    var cfgTxt = configSummary();
    var payTxt = st.pay === 'full' ? '100 % předem' : ('Záloha ' + (st.dep) + ' % (' + st.depDays + ' dní) + doplatek ' + (100 - st.dep) + ' % · ' + (st.restWhen || 'Před dodáním stroje') + ' (' + st.restDays + ' dní)');
    var h = '<div id="ow-sum">'
      + row('Odběratel', buyerName() + (foreign() && st.country ? ' · ' + st.country : ''))
      + row('Odpovědná osoba', st.resp || '—')
      + row('Stroj', (it ? (it.name_cs || it.machine_code) : '—') + ' · ' + st.ver + '/' + st.va)
      + row('Výbava', cfgTxt || '—')
      + row('Počet kusů', q)
      + row('Cena / ks', money(unit) + (full ? ' (kamionová)' : ' (maloobchodní)'))
      + row('Celkem bez DPH', money(unit * q))
      + row('Výrobní sloty', slotsSummary())
      + row('Platba', payTxt)
      + row('Úvěr', st.loan ? 'Ano' : 'Ne')
      + row('Servis', svc)
      + '</div>'
      + '<label style="margin-top:12px;">Termín dodání (volitelně)</label><input class="ow-in ow-mb" id="ow-deldate" type="date" value="' + esc(st.delDate || '') + '">'
      + '<div id="ow-result"></div>';
    return h;
  }

  function configSummary() {
    var parts = [];
    var cfg = effectiveConfig();
    cfg.forEach(function (g) {
      if (g.type === 'multi') {
        var picks = [];
        Object.keys(st.configMulti || {}).forEach(function (k) { if (st.configMulti[k]) { var m = st.configMulti[k]; if (m && m.name === g.name) picks.push(m.opt); } });
        if (picks.length) parts.push(g.name + ': ' + picks.join(', '));
      } else {
        var v = (st.config || {})[g.name];
        if (v) parts.push(g.name + ': ' + v);
      }
    });
    return parts.join(' · ');
  }

  function slotsSummary() {
    var n = st.qty || 1; var sel = st.slotSel || []; var free = st.slotsFree || []; var out = [];
    for (var i = 0; i < n; i++) {
      var id = sel[i]; var s = id ? free.filter(function (x) { return x.id === id; })[0] : null;
      out.push('Kus ' + (i + 1) + ' → ' + (s ? slotLabel(s) : 'bez slotu'));
    }
    return out.join(' · ');
  }

  // ---- sběr hodnot z DOM (volá se před přechodem/souhrnem) ----
  function collect() {
    function v(id) { var e = document.getElementById(id); return e ? e.value : undefined; }
    if (v('ow-resp') !== undefined) st.resp = v('ow-resp').trim();
    if (v('ow-email') !== undefined) st.email = v('ow-email').trim();
    if (v('ow-phone') !== undefined) st.phone = v('ow-phone').trim();
    if (v('ow-name') !== undefined) st.name = v('ow-name').trim();
    if (v('ow-ico') !== undefined) st.ico = v('ow-ico').trim();
    if (v('ow-dic') !== undefined) st.dic = v('ow-dic').trim();
    if (v('ow-addr') !== undefined) st.addr = v('ow-addr').trim();
    if (v('ow-country') !== undefined) st.country = v('ow-country').trim();
    if (v('ow-qty') !== undefined) st.qty = Math.max(1, Math.min(50, Number(v('ow-qty')) || 1));
    if (v('ow-dep') !== undefined) st.dep = Math.max(0, Math.min(100, Number(v('ow-dep')) || 0));
    if (v('ow-depd') !== undefined) st.depDays = Math.max(0, Number(v('ow-depd')) || 0);
    if (v('ow-restd') !== undefined) st.restDays = Math.max(0, Number(v('ow-restd')) || 0);
    if (document.getElementById('ow-loan')) st.loan = document.getElementById('ow-loan').checked;
    if (v('ow-deldate') !== undefined) st.delDate = v('ow-deldate');
    // config selecty
    document.querySelectorAll('[data-cfg]').forEach(function (selEl) { st.config = st.config || {}; st.config[selEl.getAttribute('data-cfg')] = selEl.value; });
    document.querySelectorAll('[data-cfgmulti]').forEach(function (c) { st.configMulti = st.configMulti || {}; st.configMulti[c.getAttribute('data-cfgmulti')] = c.checked ? { name: c.getAttribute('data-name'), opt: c.getAttribute('data-opt') } : null; });
    // výrobní sloty per kus
    if (document.querySelector('[data-slot]')) { st.slotSel = st.slotSel || []; document.querySelectorAll('[data-slot]').forEach(function (sel) { st.slotSel[Number(sel.getAttribute('data-slot'))] = sel.value ? Number(sel.value) : null; }); }
  }

  // ---- render + navigace ----
  function paint() {
    var defs = stepDefs();
    var d = defs[st.step];
    st._defs = defs;
    document.getElementById('ow-count').textContent = 'Krok ' + (st.step + 1) + ' z ' + defs.length;
    document.getElementById('ow-title').textContent = d.t;
    document.getElementById('ow-barf').style.width = Math.round((st.step + 1) / defs.length * 100) + '%';
    document.getElementById('ow-bd').innerHTML = d.r();
    bindStep();
    var back = document.getElementById('ow-back'); back.style.visibility = st.step === 0 ? 'hidden' : 'visible';
    var next = document.getElementById('ow-next');
    next.textContent = (st.step === defs.length - 1) ? 'Potvrdit objednávku' : 'Další →';
    if (st.step === 2) updatePriceNote();
  }

  function bindSeg(name, cb) {
    var seg = document.querySelector('.ow-seg[data-seg="' + name + '"]'); if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
        cb(b.getAttribute('data-v'));
      });
    });
  }

  function bindStep() {
    // Odběratel
    bindSeg('origin', function (v) { collect(); st.origin = (v === 'foreign') ? 'foreign' : 'cz'; paint(); });
    var ares = document.getElementById('ow-ares');
    if (ares) ares.addEventListener('click', function () {
      collect(); var ico = (st.ico || '').replace(/\D/g, '');
      if (ico.length < 6) { alert('Zadej IČO.'); return; }
      ares.textContent = '…';
      api('/ares/' + ico).then(function (r) { return r.json(); }).then(function (j) {
        ares.textContent = 'Načíst z ARES';
        if (j && (j.ok || j.name)) { st.name = j.name || st.name; st.dic = j.dic || st.dic; st.addr = j.address || st.addr; st.aresOk = true; paint(); }
        else alert('ARES nenašel firmu.');
      }).catch(function () { ares.textContent = 'Načíst z ARES'; alert('ARES se nepodařilo zavolat.'); });
    });
    // Stroj
    bindSeg('ver', function (v) { collect(); st.ver = v; st.va = null; st.machineId = null; paint(); });
    bindSeg('va', function (v) { collect(); st.va = v; st.machineId = null; paint(); });
    var mc = document.querySelector('.ow-cards[data-cards="machine"]');
    if (mc) mc.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { mc.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); st.machineId = Number(b.getAttribute('data-id')); }); });
    // Výrobní sloty: po výběru překresli, ať zmizí sloty obsazené jiným kusem (1 slot = 1 stroj)
    document.querySelectorAll('[data-slot]').forEach(function (sel) { sel.addEventListener('change', function () { collect(); paint(); }); });
    // Výbava + počet
    var qm = document.getElementById('ow-qminus'), qp = document.getElementById('ow-qplus'), qi = document.getElementById('ow-qty');
    if (qm) qm.addEventListener('click', function () { qi.value = Math.max(1, (Number(qi.value) || 1) - 1); collect(); updatePriceNote(); });
    if (qp) qp.addEventListener('click', function () { qi.value = Math.min(50, (Number(qi.value) || 1) + 1); collect(); updatePriceNote(); });
    if (qi) qi.addEventListener('input', function () { collect(); updatePriceNote(); });
    var km = document.getElementById('ow-kamion'); if (km) km.addEventListener('change', function () { collect(); updatePriceNote(); });
    // Platba
    bindSeg('pay', function (v) { collect(); st.pay = v; paint(); });
    bindSeg('restwhen', function (v) { collect(); st.restWhen = v; });
    var dep = document.getElementById('ow-dep'); if (dep) dep.addEventListener('input', function () { collect(); updatePayNote(); });
    updatePayNote();
    // Servis
    bindSeg('svc', function (v) { collect(); st.svc = v; paint(); });
  }

  function updatePriceNote() {
    var el = document.getElementById('ow-price-note');
    var kn = document.getElementById('ow-kamion-note');
    var it = selItem(); var q = st.qty || 1; var c = capacity(); var full = autoKamion();
    if (kn) {
      if (c > 0) {
        kn.className = 'ow-note ' + (full ? 'ok' : 'acc');
        kn.innerHTML = '<span>' + (full
          ? '🚚 Plný kamion (' + c + '+ ks) — účtuje se velkoobchodní (kamionová) cena za kus.'
          : ('Kapacita kamionu: ' + c + ' ks. Do velkoobchodní ceny chybí ' + (c - q) + ' ks.')) + '</span>';
      } else {
        var hasTruck = it && (num(it.truck_price_czk) || num(it.truck_price_eur));
        kn.style.display = 'flex'; kn.className = 'ow-note warn';
        kn.innerHTML = '<span>' + (hasTruck
          ? 'Stroj má kamionovou cenu, ale v ceníku není „Kapacita ks/kamion" — účtuje se maloobchodní. Doplň kapacitu v ceníku.'
          : 'Kamionová cena se neúčtuje (v ceníku není kapacita ani velkoobchodní cena) — účtuje se maloobchodní.') + '</span>';
      }
    }
    if (el) { var unit = unitAll(it, full); var sur = configSurcharge(); el.textContent = 'Cena/ks ' + money(unit) + (full ? ' (kamionová' : ' (maloobchodní') + (sur > 0 ? ' vč. výbavy +' + money(sur) : '') + ') · Celkem ' + money(unit * q) + ' bez DPH'; }
  }
  function updatePayNote() {
    var el = document.getElementById('ow-pay-note'); if (!el) return;
    var d = st.dep != null ? st.dep : 30;
    el.textContent = 'Doplatek se dopočítá do 100 %: ' + (100 - d) + ' %.';
  }

  function submit() {
    collect();
    var it = selItem();
    if (!it) { showResult('err', 'Vyber stroj.'); st.step = 1; paint(); return; }
    if (!buyerName()) { showResult('err', 'Chybí odběratel.'); st.step = 0; paint(); return; }
    var full = autoKamion(); var unit = unitAll(it, full); var q = st.qty || 1;
    var slots = (st.slotSel || []).slice(0, q).filter(function (x) { return x; });
    var cfgTxt = configSummary();
    var svc = foreign() ? 'Zákazník řeší sám' : (st.svc === 'sam' ? 'Zákazník řeší sám' : 'Servisní smlouva 13 % z obratu (vč. DPH)');
    var payTxt = st.pay === 'full' ? '100 % předem'
      : ('Záloha ' + st.dep + ' % / ' + st.depDays + ' dní + doplatek ' + (100 - st.dep) + ' % · ' + (st.restWhen || 'Před dodáním stroje') + ' / ' + st.restDays + ' dní');
    var noteLines = [];
    noteLines.push('— KONFIGURACE (z průvodce) —');
    noteLines.push('Stroj: ' + (it.name_cs || it.machine_code) + ' (' + st.ver + '/' + st.va + ', ' + (it.machine_code || '') + ')');
    if (cfgTxt) noteLines.push('Výbava: ' + cfgTxt);
    noteLines.push('Počet kusů: ' + q + (full ? ' (kamionová cena)' : ''));
    noteLines.push('Cena/ks bez DPH: ' + money(unit) + ' · Celkem: ' + money(unit * q));
    noteLines.push('Platba: ' + payTxt);
    noteLines.push('Servis: ' + svc);
    if (st.loan) noteLines.push('Financováno úvěrem: ano');
    if (slots.length) noteLines.push('Výrobní sloty (rezervace 3 dny): ' + slotsSummary());
    var itemName = (it.name_cs || it.machine_code) + (cfgTxt ? ' — ' + cfgTxt : '');
    var body = {
      buyer_type: foreign() ? 'firma' : 'firma',
      company_name: buyerName(),
      ico: foreign() ? null : (st.ico || null),
      dic: st.dic || null,
      address: (foreign() && st.country ? (st.country + ' · ') : '') + (st.addr || ''),
      responsible: st.resp || null,
      email: st.email || null,
      phone: st.phone || null,
      version: st.ver + '/' + st.va,
      currency: foreign() ? 'EUR' : 'CZK',
      expected_delivery: st.delDate || null,
      note: noteLines.join('\n'),
      items: [{ name: itemName.slice(0, 250), quantity: q, unit: 'ks', unit_price: unit }],
      slots: slots,
      payment_split: st.pay !== 'full',
      deposit_percent: st.pay !== 'full' ? st.dep : null,
      deposit_due_days: st.depDays,
      final_invoice_lead_days: st.restDays,
      release_on_deposit: true,
    };
    var next = document.getElementById('ow-next'); next.disabled = true; next.textContent = 'Zakládám…';
    api('/leads/' + st.leadId + '/create-sales-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.ok) { next.disabled = false; next.textContent = 'Potvrdit objednávku'; showResult('err', (res.j && res.j.error) || 'Objednávku se nepodařilo založit.'); return; }
        document.getElementById('ow-bd').innerHTML = '<div style="text-align:center;padding:24px 8px;">'
          + '<div style="font-size:38px;">✅</div>'
          + '<div style="font-size:16px;font-weight:600;margin-top:8px;">Objednávka založena</div>'
          + '<div class="sm" style="margin-top:4px;">Číslo: ' + esc(res.j.order_number) + ' · ' + money(res.j.total) + '</div>'
          + (res.j.deposit_invoice_number ? '<div class="sm" style="margin-top:4px;">Zálohová faktura: ' + esc(res.j.deposit_invoice_number) + ' (koncept)</div>' : '')
          + '</div>';
        document.getElementById('ow-back').style.visibility = 'hidden';
        next.style.display = 'none';
        var xb = document.getElementById('ow-xbtn'); if (xb) xb.textContent = 'Zavřít';
        st.done = true;
        if (typeof st.onDone === 'function') { try { st.onDone(res.j); } catch (e) {} }
      })
      .catch(function () { next.disabled = false; next.textContent = 'Potvrdit objednávku'; showResult('err', 'Chyba spojení.'); });
  }
  function showResult(kind, msg) {
    var el = document.getElementById('ow-result');
    if (el) { el.innerHTML = '<div class="ow-note ' + kind + '" style="margin-top:12px;"><span>' + esc(msg) + '</span></div>'; }
    else alert(msg);
  }

  function close() { var ov = document.getElementById('ow-ov'); if (ov) ov.remove(); st = null; }

  function open(leadId, opts) {
    opts = opts || {};
    injectCss();
    st = { leadId: leadId, step: 0, origin: 'cz', qty: 1, pay: 'zaloha', dep: 30, depDays: 3, restDays: 14, restWhen: 'Před dodáním stroje', svc: 'smlouva', config: {}, configMulti: {}, items: [], sharedConfig: [], slotsFree: [], slotSel: [], lead: null, onDone: opts.onDone };
    var ov = document.createElement('div'); ov.className = 'ow-ov'; ov.id = 'ow-ov';
    ov.innerHTML = '<div class="ow-card">'
      + '<div class="ow-hd"><div class="r"><span style="font-size:18px;">🧾</span><h3>Nová objednávka</h3>'
      + '<span id="ow-count" class="sm"></span><button class="ow-x" id="ow-xbtn">Zrušit</button></div>'
      + '<div id="ow-title" class="ow-sub"></div><div class="ow-bar"><div id="ow-barf" style="width:14%;"></div></div></div>'
      + '<div class="ow-bd" id="ow-bd"><div class="sm">Načítám…</div></div>'
      + '<div class="ow-ft"><button class="ow-btn" id="ow-back">← Zpět</button><button class="ow-btn prim" id="ow-next">Další →</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    document.getElementById('ow-xbtn').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov && st && st.done) close(); });
    document.getElementById('ow-back').addEventListener('click', function () { if (st.step > 0) { collect(); st.step--; paint(); } });
    document.getElementById('ow-next').addEventListener('click', function () {
      if (st.done) return;
      collect();
      if (st.step === st._defs.length - 1) { submit(); return; }
      // validace platby (krok Platba = index 4)
      if (st.step === 4 && st.pay !== 'full' && (st.dep < 0 || st.dep > 100)) { alert('Záloha musí být 0–100 %.'); return; }
      st.step++; paint();
    });

    loadData(leadId).then(function (res) {
      st.lead = res[0] || {};
      st.items = Array.isArray(res[1]) ? res[1] : [];
      st.sharedConfig = (res[2] && Array.isArray(res[2].config_options)) ? res[2].config_options : [];
      st.slotsFree = Array.isArray(res[3]) ? res[3] : [];
      if (!st.items.length) { document.getElementById('ow-bd').innerHTML = '<div class="ow-note err"><span>Ceník je prázdný — přidej stroje v záložce Ceník.</span></div>'; return; }
      paint();
    });
  }

  window.OrderWizard = { open: open };
})();
