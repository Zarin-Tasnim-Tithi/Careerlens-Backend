/**
 * Authentication scheme (documented in docs/AUTH.md):
 *  - Access token: JWT (HS256), 15 minutes, sent as "Authorization: Bearer". Kept in memory by the frontend, never in localStorage.
 *  - Refresh token: 48 random bytes in an HttpOnly cookie scoped to /api/v1/auth, stored server-side as a SHA-256 hash.
 *    Rotated on every refresh; reuse of an already-rotated token revokes all of that user's sessions.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { Session } = require('../models');

const REFRESH_COOKIE = 'cl_refresh';
const COOKIE_PATH = '/api/v1/auth';
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const signAccessToken = (user) => jwt.sign(
  { sub: String(user._id), role: user.role },
  env.JWT_ACCESS_SECRET,
  { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL, issuer: 'careerlens-api' },
);

async function createSession(user, req) {
  const token = crypto.randomBytes(48).toString('base64url');
  await Session.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000),
    userAgent: (req.get('user-agent') || '').slice(0, 200),
    ip: req.ip,
  });
  return token;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: COOKIE_PATH,
  maxAge: env.REFRESH_TOKEN_DAYS * 86400000,
});

function setRefreshCookie(res, token) { res.cookie(REFRESH_COOKIE, token, cookieOptions()); }
function clearRefreshCookie(res) { const { maxAge, ...opts } = cookieOptions(); res.clearCookie(REFRESH_COOKIE, opts); }

/** Issues an access token + rotated refresh cookie and returns the response payload. */
async function issueTokens(user, req, res) {
  const refresh = await createSession(user, req);
  setRefreshCookie(res, refresh);
  return { accessToken: signAccessToken(user), tokenType: 'Bearer', expiresIn: env.ACCESS_TOKEN_TTL };
}

module.exports = { REFRESH_COOKIE, sha256, signAccessToken, createSession, setRefreshCookie, clearRefreshCookie, issueTokens };
