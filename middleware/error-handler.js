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

  // Obecná chyba
  res.status(err.status || 500).json({
    error: err.message || 'Interní chyba serveru',
  });
}

module.exports = { errorHandler };
