/**
 * Úkol #78 — auto-inject patch pro okno editace zboží
 *
 * Tento soubor se načítá přes <script src> z index.html NEBO
 * může být načten manuálně. Obsahuje kompletní přepsání openMaterialModal.
 *
 * Načtení: přidáno jako poslední <script> v index.html před </body>
 * Alternativně: sidebar.js hook (není potřeba měnit sdílený soubor)
 */

// Pokud je soubor načten dříve než jsou definovány globální proměnné,
// počkáme na DOMContentLoaded a pak patchujeme
(function autoInjectPatch() {
  function doInject() {
    var el = document.createElement('script');
    el.src = (document.querySelector('base')?.href || '/') + 'modules/nakup-sklad/material-modal-patch.js?v=78.' + Date.now();
    document.body.appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doInject);
  } else {
    doInject();
  }
})();
