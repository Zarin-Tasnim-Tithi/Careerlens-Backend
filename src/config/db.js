const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

async function connectDB(uri = env.MONGODB_URI) {
  mongoose.connection.on('disconnected', () => { if (!env.isTest) console.warn('[db] MongoDB disconnected'); });
  mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, maxPoolSize: 10 });
  if (!env.isTest) console.log(`[db] Connected to MongoDB (${mongoose.connection.name})`);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
