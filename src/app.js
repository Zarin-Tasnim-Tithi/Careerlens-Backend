const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render/Vercel sit in front of the app; needed for correct client IPs and secure cookies
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server / Postman requests (no Origin header) and listed browser origins only.
      if (!origin || env.allowedOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
      return cb(new Error('CORS: origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(cookieParser());
  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.isTest ? 10000 : (Number(process.env.API_RATE_LIMIT) || 600), standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', details: [] } }) });
  app.use('/api', limiter);

  // Render health checks hit "/health"; the versioned one lives at /api/v1/health.
  app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
  app.get('/', (_req, res) => res.json({ success: true, data: { name: 'CareerLens API', docs: '/api/v1/api-docs', health: '/api/v1/health' } }));

  app.use('/api/v1', apiRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
