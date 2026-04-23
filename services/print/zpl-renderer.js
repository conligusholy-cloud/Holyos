// HolyOS — ZPL Renderer
//
// Nahrazuje {{placeholder}} tokeny v ZPL šabloně skutečnými hodnotami z `data`.
// Escapuje speciální ZPL znaky (^, ~) v hodnotách, aby uživatelský vstup
// nezměnil strukturu příkazů tiskárny.

/**
 * Vyescapuje ZPL speciální znaky.
 * - '^' je start příkazu → nahrazujeme za mezeru (TSC TC200 kočaj toleruje)
 * - '~' je start preamble → totéž
 * - backslashe a uvozovky nemusíme, ZPL nečte.
 */
function escapeZpl(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\^~]/g, ' ');
}

/**
 * Vyrenderuje ZPL šablonu — substituuje {{key}} za data[key].
 * Chybějící hodnota se nahradí prázdným stringem (bez pádu).
 *
 * @param {string} templateBody - ZPL tělo s `{{placeholder}}` tokeny
 * @param {object} data         - mapa key → hodnota pro substituci
 * @returns {string} - ZPL připravený k odeslání na tiskárnu
 */
function render(templateBody, data = {}) {
  if (typeof templateBody !== 'string') {
    throw new Error('[ZPL] template body musí být string');
  }
  return templateBody.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = data[key];
    return escapeZpl(value);
  });
}

/**
 * Vrátí seznam placeholderů použitých v šabloně.
 * Užitečné pro validaci šablon (UI upozorní na chybějící pole v data).
 */
function extractPlaceholders(templateBody) {
  const out = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(templateBody)) !== null) out.add(m[1]);
  return [...out];
}

module.exports = { render, extractPlaceholders, escapeZpl };
