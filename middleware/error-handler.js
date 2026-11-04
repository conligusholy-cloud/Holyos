// =============================================================================
// HolyOS — Centrální error handler
// =============================================================================

function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Prisma chyby
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Duplicitní záznam',
      field: err.meta?.target,
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Záznam nenalezen',
    });
  }

  // Validační chyby (Zod)
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Neplatná data',
      details: err.errors,
    });
  }

  // Obecná chyba. V produkci se vnitřní chyby (Prisma, databáze, síť, soubory) klientovi nepřeposílají —
  // text může obsahovat dotaz, názvy tabulek nebo cesty; detail zůstává jen v logu serveru.
  const status = err.status || 500;
  const msg = String(err.message || '');
  const internal = status >= 500 && (
    /prisma|invalid `|ECONN|ETIMEDOUT|ENOTFOUND|ENOENT|EACCES|EPERM|relation "|column "|syntax error|at \S+ \(|\/app\/|node_modules/i.test(msg)
    || String(err.name || '').startsWith('Prisma')
    || /^P\d{4}$/.test(String(err.code || ''))
  );
  res.status(status).json({
    error: (process.env.NODE_ENV === 'production' && internal) ? 'Interní chyba serveru' : (msg || 'Interní chyba serveru'),
  });
}

module.exports = { errorHandler };
