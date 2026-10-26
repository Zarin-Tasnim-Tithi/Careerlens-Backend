const ApiError = require('../utils/ApiError');

/**
 * Validates req.body / req.query / req.params against zod schemas.
 * Parsed (coerced + stripped) values are written to req.valid.{body,query,params}; req.body is replaced too.
 */
const validate = (schemas) => (req, _res, next) => {
  req.valid = req.valid || {};
  const details = [];
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      for (const issue of result.error.issues) {
        details.push({ location: part, field: issue.path.join('.') || part, message: issue.message });
      }
    } else {
      req.valid[part] = result.data;
      if (part === 'body') req.body = result.data;
    }
  }
  if (details.length) throw ApiError.validation('Some fields are missing or invalid', details);
  next();
};

module.exports = validate;
