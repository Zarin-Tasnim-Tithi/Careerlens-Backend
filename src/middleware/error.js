const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}

// Converts every error into { success:false, error:{ code, message, details } } with a safe message.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof multer.MulterError) {
    error = err.code === 'LIMIT_FILE_SIZE'
      ? ApiError.tooLarge(`File must be smaller than ${env.MAX_UPLOAD_MB} MB`)
      : ApiError.badRequest(err.message);
  } else if (err?.type === 'entity.too.large') {
    error = ApiError.tooLarge('Request body is too large');
  } else if (err?.type === 'entity.parse.failed') {
    error = ApiError.badRequest('Malformed JSON body');
  } else if (err?.name === 'CastError') {
    error = ApiError.notFound(`${err.path === '_id' ? 'Resource' : err.path} not found`);
  } else if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => ({ field: e.path, message: e.message }));
    error = ApiError.validation('Some fields are invalid', details);
  } else if (err?.code === 11000) {
    error = ApiError.conflict('This record already exists', 'DUPLICATE');
  } else if (err?.message?.startsWith('CORS')) {
    error = ApiError.forbidden('Origin not allowed');
  }

  if (!(error instanceof ApiError)) {
    if (!env.isTest) console.error('[error]', req.method, req.originalUrl, err);
    error = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again later.');
  }

  res.status(error.status).json({
    success: false,
    error: { code: error.code, message: error.message, details: error.details || [] },
  });
}

module.exports = { notFound, errorHandler };
