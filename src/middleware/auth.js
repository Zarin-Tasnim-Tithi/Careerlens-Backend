const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { User } = require('../models');

/**
 * Verifies the short-lived access token (Authorization: Bearer <jwt>) and loads the user.
 * The user is re-read from MongoDB on every request so suspensions and role changes apply immediately.
 */
async function authenticate(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'careerlens-api' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'TOKEN_EXPIRED', 'Access token expired');
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid access token');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Session ended because the password was changed');
  }
  req.user = user;
  next();
}

/** Role-based access control. Usage: requireRole('admin') or requireRole('recruiter', 'admin'). */
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) throw ApiError.unauthorized();
  if (!roles.includes(req.user.role)) throw ApiError.forbidden(`This action requires the ${roles.join(' or ')} role`);
  next();
};

module.exports = { authenticate, requireRole };
