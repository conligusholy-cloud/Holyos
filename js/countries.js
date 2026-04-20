// HolyOS — sdílený seznam zemí s vlaječkami pro formuláře (Společnosti, odběratelé, dodavatelé).
// ISO 3166-1 alpha-2 kódy; názvy jsou lokalizované přes Intl.DisplayNames('cs').
// Vlaječky: Unicode Regional Indicator Symbols (např. 'CZ' -> 🇨🇿).

(function (global) {
  'use strict';

  // Plný seznam ISO 3166-1 alpha-2 kódů. "Oblíbené" (CZ, SK, okolní EU a hlavní EU
  // ekonomiky) přednostně nahoře, zbytek abecedně dle lokalizovaného názvu.
  var FAVORITE_CODES = ['CZ', 'SK', 'DE', 'AT', 'PL', 'HU', 'IT', 'FR', 'GB', 'NL', 'BE', 'ES', 'CH', 'US', 'RO'];

  var ALL_CODES = [
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
    'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
    'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
    'DE','DJ','DK','DM','DO','DZ',
    'EC','EE','EG','EH','ER','ES','ET',
    'FI','FJ','FK','FM','FO','FR',
    'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
    'HK','HM','HN','HR','HT','HU',
    'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
    'JE','JM','JO','JP',
    'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
    'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
    'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
    'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
    'OM',
    'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
    'QA',
    'RE','RO','RS','RU','RW',
    'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
    'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
    'UA','UG','UM','US','UY','UZ',
    'VA','VC','VE','VG','VI','VN','VU',
    'WF','WS',
    'YE','YT',
    'ZA','ZM','ZW'
  ];

  // Vlaječka z ISO alpha-2 kódu pomocí Regional Indicator Symbols.
  function flagEmoji(code) {
    if (!code || code.length !== 2) return '\uD83C\uDFF3'; // 🏳 fallback
    try {
      var A = 0x1F1E6; // 🇦
      var up = code.toUpperCase();
      return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
    } catch (e) {
      return '\uD83C\uDFF3';
    }
  }

  // Lokalizované jméno (cs). Fallback na kód, kdyby API nevrátilo.
  var displayNames = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
      displayNames = new Intl.DisplayNames(['cs', 'en'], { type: 'region' });
    }
  } catch (e) { displayNames = null; }

  function countryName(code) {
    if (!code) return '';
    if (displayNames) {
      try {
        var n = displayNames.of(code);
        if (n && n !== code) return n;
      } catch (e) {}
    }
    return code;
  }

  // Vrátí string s <option> elementy pro <select name="country">.
  // Prvních pár oblíbených zemí (CZ/SK/DE…), pak oddělovač, pak zbytek abecedně.
  function renderCountryOptions(selected) {
    var sel = (selected || 'CZ').toUpperCase();
    var favSet = {};
    FAVORITE_CODES.forEach(function (c) { favSet[c] = true; });

    var favOpts = FAVORITE_CODES.map(function (c) {
      return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' +
        flagEmoji(c) + ' ' + countryName(c) + '</option>';
    }).join('');

    var rest = ALL_CODES
      .filter(function (c) { return !favSet[c]; })
      .map(function (c) { return { code: c, name: countryName(c) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'cs'); });

    var restOpts = rest.map(function (x) {
      return '<option value="' + x.code + '"' + (x.code === sel ? ' selected' : '') + '>' +
        flagEmoji(x.code) + ' ' + x.name + '</option>';
    }).join('');

    // Ujisti, že selected (nestandardní kód?) má alespoň placeholder, jinak by se neukázal.
    var hasSelected = favSet[sel] || ALL_CODES.indexOf(sel) >= 0;
    var fallback = hasSelected ? '' :
      '<option value="' + sel + '" selected>' + flagEmoji(sel) + ' ' + countryName(sel) + '</option>';

    return fallback +
      favOpts +
      '<option disabled>──────────</option>' +
      restOpts;
  }

  global.HolyCountries = {
    all: ALL_CODES,
    favorites: FAVORITE_CODES,
    flag: flagEmoji,
    name: countryName,
    renderOptions: renderCountryOptions,
  };
})(typeof window !== 'undefined' ? window : globalThis);
