// Test harness: real Express app + a throwaway MongoDB database.
// Uses TEST_MONGODB_URI if provided (e.g. a local mongod or an Atlas test cluster); otherwise starts mongodb-memory-server.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret-0123456789abcdef0123456789';
process.env.EXPOSE_RESET_TOKEN = 'true';

const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph } = require('docx');

let memoryServer;
let app;

async function setup() {
  let base = process.env.TEST_MONGODB_URI;
  if (!base) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    base = memoryServer.getUri();
  }
  const dbName = `careerlens_test_${crypto.randomBytes(4).toString('hex')}`;
  const uri = base.replace(/\/([^/?]*)(\?|$)/, `/${dbName}$2`);
  await mongoose.connect(uri);
  const { ensureIndexes } = require('../src/config/indexes');
  await ensureIndexes();
  const M = require('../src/models');
  const catalog = require('../src/data/skillCatalog');
  const { normalizeKey } = require('../src/utils/helpers');
  await M.Skill.insertMany(catalog.map((s) => ({ name: s.name, key: normalizeKey(s.name), category: s.category, aliases: s.aliases.map(normalizeKey) })));
  app = require('../src/app')();
  return app;
}

async function teardown() {
  if (mongoose.connection.db) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

const api = () => request(app);
const PASSWORD = 'ExamplePass123!';
let counter = 0;

/** Registers a user and returns { token, user, agent } where agent keeps the refresh cookie. */
async function register(role = 'student', extra = {}) {
  counter += 1;
  const agent = request.agent(app);
  const body = { name: `Test ${role} ${counter}`, email: `${role}${counter}_${Date.now()}@example.com`, password: PASSWORD, role, ...extra };
  const res = await agent.post('/api/v1/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken, user: res.body.data.user, agent, email: body.email };
}

async function createAdmin() {
  const M = require('../src/models');
  counter += 1;
  const email = `admin${counter}@example.com`;
  await M.User.create({ name: 'Admin', email, role: 'admin', passwordHash: await bcrypt.hash(PASSWORD, 4) });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD, role: 'admin' });
  return { token: res.body.data.accessToken, user: res.body.data.user };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const RESUME_TEXT = [
  'Demo Student', 'demo.student@example.com | +880 1700 000000',
  'SUMMARY', 'I am a computer science student who is good at building web apps. Responsible for frontend work in team projects.',
  'EXPERIENCE', 'Frontend Intern, Example Labs (2025)', 'Worked on a React dashboard used by 300 users. Developed reusable components and improved load time by 20%.',
  'EDUCATION', 'BSc in Computer Science and Engineering, CareerLens University',
  'SKILLS', 'JavaScript, React, Node.js, MongoDB, Git, REST API, HTML, CSS',
  'PROJECTS', 'Built a MERN task manager with authentication and deployed it on Render.',
  ...Array.from({ length: 12 }, (_, i) => `Additional project note ${i + 1}: designed, implemented and tested features with teammates over several weeks.`),
].join('\n');

function makePdf(text = RESUME_TEXT) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)));
    text.split('\n').forEach((line) => doc.text(line));
    doc.end();
  });
}

const makeDocx = (text = RESUME_TEXT) => Packer.toBuffer(new Document({ sections: [{ children: text.split('\n').map((t) => new Paragraph(t)) }] }));

module.exports = { setup, teardown, api, register, createAdmin, auth, PASSWORD, makePdf, makeDocx, RESUME_TEXT };
