// =============================================================================
// HolyOS — Validace middleware (Zod)
// =============================================================================

const { ZodError } = require('zod');

/**
 * Middleware factory — validuje request body podle Zod schématu
 *
 * Použití:
 *   router.post('/people', validate(createPersonSchema), controller.create)
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Neplatná data',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

/**
 * Middleware factory — validuje query parametry
 */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Neplatné parametry',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

module.exports = { validate, validateQuery };
