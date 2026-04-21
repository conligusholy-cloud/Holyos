/* ============================================
   super-admin-guard.js
   Redirect na hlavní stránku, pokud aktuální uživatel není super admin.
   Používá se v interních modulech (CAD výkresy, AI Agenti, Dev Hub,
   Myšlenková mapa, Požadavky, Historie změn).
   ============================================ */

(function () {
  var headers = { credentials: 'include' };
  var token = sessionStorage.getItem('token');
  if (token) headers.headers = { 'Authorization': 'Bearer ' + token };

  fetch('/api/auth/me', headers)
    .then(function (r) {
      if (r.status === 401) {
        // Nepřihlášen — přesměrování řeší sidebar.js samo.
        return null;
      }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      var u = data.user || data;
      var isSuper = u.isSuperAdmin || u.is_super_admin;
      if (!isSuper) {
        // Zamaskuj obsah stránky a přesměruj na dashboard.
        document.body.style.visibility = 'hidden';
        window.location.replace('/');
      }
    })
    .catch(function () { /* ticho — síťová chyba, uživatel dostane 403 na API */ });
})();
