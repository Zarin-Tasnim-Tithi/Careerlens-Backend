const env = require('./config/env');
const { connectDB } = require('./config/db');
const createApp = require('./app');
const { ensureIndexes } = require('./config/indexes');

async function start() {
  await connectDB();
  await ensureIndexes();
  const app = createApp();
  // Render injects PORT; bind to 0.0.0.0 so the platform can route traffic to the container.
  const server = app.listen(env.PORT, '0.0.0.0', () => console.log(`[api] CareerLens API listening on port ${env.PORT} (${env.NODE_ENV})`));
  const shutdown = (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[api] Failed to start:', err.message);
  process.exit(1);
});
