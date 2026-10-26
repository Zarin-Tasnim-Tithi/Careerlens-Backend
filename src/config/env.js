// Centralised, validated environment configuration.
// Secrets are read only from process.env (set in .env locally or in Render's dashboard).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function required(name, fallbackForDev) {
  const value = process.env[name];
  if (value) return value;
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable: ${name}`);
}

const env = {
  NODE_ENV,
  isProd,
  isTest,
  PORT: Number(process.env.PORT) || 5000,
  MONGODB_URI: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/careerlens'),
  // Comma-separated list of allowed browser origins, e.g. "https://careerlens.vercel.app,http://localhost:5173"
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me'),
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  REFRESH_TOKEN_DAYS: Number(process.env.REFRESH_TOKEN_DAYS) || 7,
  // "lax" when the frontend and API share a site (e.g. Vercel rewrite proxy); "none" when they are cross-site.
  COOKIE_SAMESITE: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),
  COOKIE_SECURE: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  // Password reset tokens are returned in the API response only when explicitly enabled (no email provider is configured).
  EXPOSE_RESET_TOKEN: process.env.EXPOSE_RESET_TOKEN ? process.env.EXPOSE_RESET_TOKEN === 'true' : !isProd,
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB) || 8,
  BCRYPT_ROUNDS: Number(process.env.BCRYPT_ROUNDS) || (isTest ? 4 : 12),
  AUTH_RATE_LIMIT: Number(process.env.AUTH_RATE_LIMIT) || 50, // login/register/reset attempts per IP per 15 minutes
  API_DOCS_PUBLIC: process.env.API_DOCS_PUBLIC ? process.env.API_DOCS_PUBLIC === 'true' : true,
};

env.allowedOrigins = env.CLIENT_URL.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

if (isProd && env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
  throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (HTTPS).');
}

module.exports = env;
