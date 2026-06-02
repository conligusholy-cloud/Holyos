// Úkol #78 — bootstrap: dynamicky načte material-modal-patch.js
// Tento soubor je načten z index.html jako poslední script před </body>
(function() {
  var s = document.createElement('script');
  // Cesta relativní k base href="../../" → absolutní cesta modulu
  s.src = 'modules/nakup-sklad/material-modal-patch.js?v=78';
  document.head.appendChild(s);
})();
