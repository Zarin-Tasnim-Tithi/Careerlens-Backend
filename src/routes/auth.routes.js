const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const v = require('../validators');
const c = require('../controllers/auth.controller');

// Stricter limit on credential endpoints to slow down password guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: env.isTest ? 10000 : env.AUTH_RATE_LIMIT, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.', details: [] } }),
});

router.post('/register', authLimiter, validate({ body: v.auth.register }), c.register);
router.post('/login', authLimiter, validate({ body: v.auth.login }), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);
router.get('/me', authenticate, c.me);
router.post('/forgot-password', authLimiter, validate({ body: v.auth.forgot }), c.forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: v.auth.reset }), c.resetPassword);

module.exports = router;
