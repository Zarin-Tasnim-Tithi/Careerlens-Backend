// Builds the unique/compound indexes declared in the schemas (users.email, applications(jobId,studentId), savedJobs(...), etc.).
const models = require('../models');

async function ensureIndexes() {
  const list = Object.values(models).filter((m) => m && typeof m.syncIndexes === 'function');
  for (const model of list) {
    try { await model.createIndexes(); } catch (err) { if (process.env.NODE_ENV !== 'test') console.warn(`[db] index build for ${model.modelName} failed: ${err.message}`); }
  }
}

module.exports = { ensureIndexes };
