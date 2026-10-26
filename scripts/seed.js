/**
 * Seeds the skill catalog, an admin account and (optionally) clearly-labelled demo records.
 *
 *   npm run seed          -> idempotent: creates what is missing
 *   npm run seed:reset    -> DELETES all CareerLens collections first (never run against production data you need)
 *
 * Credentials come from environment variables; nothing is hard-coded:
 *   ADMIN_EMAIL, ADMIN_PASSWORD           (required for the admin account)
 *   SEED_DEMO_DATA=true                   (default true) create demo student/recruiter/jobs
 *   DEMO_PASSWORD                         password for demo student + recruiter (random if omitted; printed once)
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { ensureIndexes } = require('../src/config/indexes');
const M = require('../src/models');
const catalog = require('../src/data/skillCatalog');
const sampleJobs = require('./sampleJobs.json');
const { normalizeKey } = require('../src/utils/helpers');
const { jobMatch } = require('../src/services/scoring');

const reset = process.argv.includes('--reset');
const withDemo = (process.env.SEED_DEMO_DATA || 'true') === 'true';
const randomPassword = () => `${crypto.randomBytes(6).toString('base64url')}A1!`;

async function upsertUser({ name, email, role, password }) {
  let user = await M.User.findOne({ email });
  if (user) return { user, created: false };
  user = await M.User.create({ name, email, role, passwordHash: await bcrypt.hash(password, env.BCRYPT_ROUNDS) });
  return { user, created: true };
}

async function main() {
  await connectDB();
  if (reset) {
    if (env.isProd && process.env.ALLOW_PROD_RESET !== 'true') throw new Error('Refusing to reset in production (set ALLOW_PROD_RESET=true to override).');
    const names = (await M.User.db.db.listCollections().toArray()).map((c) => c.name);
    for (const n of names) await M.User.db.db.dropCollection(n);
    console.log(`[seed] Dropped ${names.length} collections`);
  }
  await ensureIndexes();

  // 1. Skill catalog
  for (const s of catalog) {
    await M.Skill.updateOne({ key: normalizeKey(s.name) },
      { $set: { name: s.name, category: s.category, aliases: s.aliases.map(normalizeKey), source: 'catalog' } }, { upsert: true });
  }
  console.log(`[seed] Skill catalog: ${catalog.length} skills`);

  // 2. Admin
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const { created } = await upsertUser({ name: 'CareerLens Admin', email: adminEmail, role: 'admin', password: adminPassword });
    console.log(`[seed] Admin ${adminEmail}: ${created ? 'created' : 'already exists'}`);
  } else {
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set: admin account skipped');
  }

  if (!withDemo) { await disconnectDB(); return; }

  // 3. Demo student + recruiter (fictional)
  const demoPassword = process.env.DEMO_PASSWORD || randomPassword();
  const { user: recruiter, created: rNew } = await upsertUser({ name: 'Demo Recruiter', email: 'recruiter@careerlens.demo', role: 'recruiter', password: demoPassword });
  await M.RecruiterProfile.updateOne({ userId: recruiter._id }, { $setOnInsert: { companyName: 'CareerLens Demo Co.', contactEmail: 'hire@careerlens.demo', industry: 'Technology', description: 'Fictional demo company used to showcase CareerLens.' } }, { upsert: true });
  const { user: student, created: sNew } = await upsertUser({ name: 'Demo Student', email: 'student@careerlens.demo', role: 'student', password: demoPassword });
  await M.StudentProfile.updateOne({ userId: student._id }, { $setOnInsert: { university: 'CareerLens University', major: 'Computer Science', education: 'BSc in CSE · 4th year', desiredRole: 'MERN Developer', bio: 'Building skills and exploring career opportunities.' } }, { upsert: true });
  if (rNew || sNew) console.log(`[seed] Demo accounts: student@careerlens.demo / recruiter@careerlens.demo  password: ${process.env.DEMO_PASSWORD ? '(from DEMO_PASSWORD)' : demoPassword}`);

  if (sNew) {
    const starter = [['JavaScript', 86], ['React', 74], ['HTML', 92], ['CSS', 84], ['Node.js', 59], ['MongoDB', 66], ['Python', 65], ['Git & GitHub', 76], ['Communication', 81]];
    const tints = ['gold', 'blue', 'orange', 'purple', 'green', 'teal', 'indigo', 'coral', 'pink'];
    for (const [i, [name, level]] of starter.entries()) {
      const skill = await M.Skill.findOne({ key: normalizeKey(name) });
      await M.StudentSkill.updateOne({ studentId: student._id, skillId: skill._id },
        { $setOnInsert: { name: skill.name, key: skill.key, category: skill.category, level, tint: tints[i] } }, { upsert: true });
    }
  }

  // 4. Fictional sample jobs owned by the demo recruiter (most approved, two pending for the moderation demo)
  if (await M.Job.countDocuments({ recruiterId: recruiter._id }) === 0) {
    const day = 86400000;
    const docs = sampleJobs.map((j, i) => ({
      recruiterId: recruiter._id, title: j.title, company: j.company, type: j.type, mode: j.mode, location: j.location,
      experience: j.experience, pay: j.pay, deadline: new Date(Date.now() + j.deadline * day), summary: j.summary,
      description: `${j.summary} ${j.responsibilities.join('. ')}.`, requirements: j.required, preferredSkills: j.preferred,
      responsibilities: j.responsibilities, benefits: j.benefits, featured: Boolean(j.featured),
      status: i >= sampleJobs.length - 2 ? 'pending' : 'approved', isActive: true,
      createdAt: new Date(Date.now() - j.posted * day),
    }));
    const jobs = await M.Job.insertMany(docs);
    console.log(`[seed] Sample jobs: ${jobs.length} (fictional companies; ${jobs.filter((j) => j.status === 'pending').length} pending approval)`);

    // One demo application so recruiter and admin dashboards have data.
    const skills = await M.StudentSkill.find({ studentId: student._id }).lean();
    const target = jobs.find((j) => j.status === 'approved');
    await M.Application.create({ jobId: target._id, studentId: student._id, recruiterId: recruiter._id, matchScore: jobMatch(target, skills).score, statusHistory: [{ status: 'applied', by: student._id }] });
    await M.Job.updateOne({ _id: target._id }, { $inc: { applicantCount: 1 } });
    await M.ActivityLog.insertMany([
      { actorId: student._id, actorRole: 'student', action: 'user.registered', targetType: 'User', targetId: student._id, summary: 'Demo Student registered as student' },
      { actorId: recruiter._id, actorRole: 'recruiter', action: 'user.registered', targetType: 'User', targetId: recruiter._id, summary: 'Demo Recruiter registered as recruiter' },
      { actorId: student._id, actorRole: 'student', action: 'application.submitted', targetType: 'Job', targetId: target._id, summary: `${target.title} · ${target.company}` },
    ]);
    await M.Notification.create({ userId: student._id, type: 'welcome', title: 'Welcome to CareerLens!', body: 'Add your skills and upload a resume to get started.', link: '/my-skills' });
  }
  await disconnectDB();
}

main().then(() => console.log('[seed] Done')).catch(async (err) => { console.error('[seed] Failed:', err.message); await disconnectDB().catch(() => {}); process.exit(1); });
