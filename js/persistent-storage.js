/* ============================================
   persistent-storage.js — Persistentní úložiště

   Nahrazuje localStorage zápisem do JSON souborů
   přes proxy-server.js (port 3001).

   Automaticky synchronizuje localStorage ↔ soubor:
   - Při čtení: načte ze souboru, uloží do localStorage jako cache
   - Při zápisu: uloží do souboru i localStorage
   - Fallback: pokud server neběží, použije localStorage
   ============================================ */

var PersistentStorage = (function() {
  var SERVER_URL = 'http://localhost:3001';
  var _cache = {};
  var _serverAvailable = null; // null = neznámo, true/false

  // ==========================================
  // Interní: HTTP požadavky
  // ==========================================
  function httpGet(key) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', SERVER_URL + '/storage/' + key, true);
      xhr.timeout = 3000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          _serverAvailable = true;
          resolve(xhr.responseText);
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function() { _serverAvailable = false; reject(new Error('Network error')); };
      xhr.ontimeout = function() { _serverAvailable = false; reject(new Error('Timeout')); };
      xhr.send();
    });
  }

  function httpPost(key, data) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', SERVER_URL + '/storage/' + key, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 5000;
      xhr.onload = function() {
        if (xhr.status === 200) {
          _serverAvailable = true;
          resolve(true);
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function() { _serverAvailable = false; reject(new Error('Network error')); };
      xhr.ontimeout = function() { _serverAvailable = false; reject(new Error('Timeout')); };
      xhr.send(data);
    });
  }

  // ==========================================
  // Synchronní čtení (z cache/localStorage)
  // Na pozadí stáhne ze souboru a aktualizuje
  // ==========================================
  function getItemSync(key) {
    // 1. Zkus cache
    if (_cache[key] !== undefined) return _cache[key];
    // 2. Zkus localStorage
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        _cache[key] = raw;
        return raw;
      }
    } catch(e) {}
    return null;
  }

  // ==========================================
  // Asynchronní čtení (ze souboru, pak cache)
  // ==========================================
  function getItem(key) {
    return httpGet(key).then(function(data) {
      _cache[key] = data;
      // Sync do localStorage jako cache
      try { localStorage.setItem(key, data); } catch(e) {}
      return data;
    }).catch(function() {
      // Fallback na localStorage
      console.warn('[PersistentStorage] Server nedostupný, používám localStorage pro:', key);
      try {
        var raw = localStorage.getItem(key);
        return raw || '[]';
      } catch(e) {
        return '[]';
      }
    });
  }

  // ==========================================
  // Zápis (do souboru + localStorage + cache)
  // ==========================================
  function setItem(key, data) {
    var dataStr = typeof data === 'string' ? data : JSON.stringify(data);

    // Okamžitě do cache a localStorage
    _cache[key] = dataStr;
    try { localStorage.setItem(key, dataStr); } catch(e) {}

    // Na pozadí do souboru
    return httpPost(key, dataStr).then(function() {
      console.log('[PersistentStorage] Uloženo do souboru:', key);
      return true;
    }).catch(function(err) {
      console.warn('[PersistentStorage] Nelze uložit do souboru:', key, err.message);
      console.warn('[PersistentStorage] Data jsou v localStorage (dočasně).');
      return false;
    });
  }

  // ==========================================
  // Inicializace: načíst data ze serveru do localStorage
  // Volat při startu každého modulu
  // ==========================================
  function init(keys) {
    if (!Array.isArray(keys)) keys = [keys];
    var promises = keys.map(function(key) {
      return getItem(key).then(function(data) {
        console.log('[PersistentStorage] Načteno:', key, '(' + (data ? data.length : 0) + ' bytes)');
      });
    });
    return Promise.all(promises);
  }

  // ==========================================
  // Migrace: pokud jsou data jen v localStorage,
  // zkopíruje je do souboru
  // ==========================================
  function migrateFromLocalStorage(keys) {
    if (!Array.isArray(keys)) keys = [keys];
    var promises = keys.map(function(key) {
      return httpGet(key).then(function(fileData) {
        // Soubor existuje a má data — nemusíme migrovat
        if (fileData && fileData !== '[]' && fileData.length > 2) {
          // Sync do localStorage
          try { localStorage.setItem(key, fileData); } catch(e) {}
          return 'file-ok';
        }
        // Soubor je prázdný, zkus localStorage
        try {
          var lsData = localStorage.getItem(key);
          if (lsData && lsData !== '[]' && lsData.length > 2) {
            return httpPost(key, lsData).then(function() {
              console.log('[PersistentStorage] Migrováno z localStorage do souboru:', key);
              return 'migrated';
            });
          }
        } catch(e) {}
        return 'empty';
      }).catch(function() {
        return 'server-unavailable';
      });
    });
    return Promise.all(promises);
  }

  // ==========================================
  // Veřejné API
  // ==========================================
  return {
    getItem: getItem,
    getItemSync: getItemSync,
    setItem: setItem,
    init: init,
    migrateFromLocalStorage: migrateFromLocalStorage,
    isServerAvailable: function() { return _serverAvailable; }
  };
})();
