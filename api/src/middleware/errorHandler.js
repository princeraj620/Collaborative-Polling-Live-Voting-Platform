const { AppError } = require('../lib/errors');
const log = require('../lib/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } });
  }

  log.error('unhandled error', { reqId: req.id, err: err.message, stack: err.stack });
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id },
  });
}

function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

module.exports = { errorHandler, notFoundHandler };
