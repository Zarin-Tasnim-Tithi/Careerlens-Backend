const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/respond');
const { Skill, SkillGapAnalysis, StudentProfile } = require('../models');
const { studentSkillsOf } = require('../services/skills');
const { analyzeSkillGap, roleCatalog, roleNames, PRIORITY_WEIGHT, READY_THRESHOLD } = require('../services/scoring');
const { logActivity } = require('../services/events');
const { assertObjectId, escapeRegex, normalizeKey } = require('../utils/helpers');

exports.catalog = async (req, res) => {
  const { q, category } = req.valid.query;
  const filter = {};
  if (category) filter.category = category;
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  const skills = await Skill.find(filter).sort({ source: 1, name: 1 }).limit(200).lean();
  return ok(res, { skills: skills.map((s) => ({ id: String(s._id), name: s.name, category: s.category, source: s.source })) });
};

exports.roles = async (_req, res) => ok(res, {
  roles: roleCatalog(),
  scoring: { priorityWeights: PRIORITY_WEIGHT, readyThreshold: READY_THRESHOLD },
});

exports.analyze = async (req, res) => {
  const { targetRole, currentSkills, save = true } = req.body;
  let skills;
  if (currentSkills) {
    // What-if mode: plain names count as present at level 50 unless a level is supplied.
    skills = currentSkills.map((s) => (typeof s === 'string' ? { name: s, level: 50 } : { name: s.name, level: s.level ?? 50 }));
  } else {
    skills = await studentSkillsOf(req.user._id);
  }
  const result = analyzeSkillGap(targetRole, skills);
  await StudentProfile.updateOne({ userId: req.user._id }, { $set: { desiredRole: targetRole } }, { upsert: true });

  let id = null;
  if (save) {
    const doc = await SkillGapAnalysis.create({
      studentId: req.user._id,
      targetRole,
      scoringVersion: result.scoringVersion,
      snapshot: skills.map((s) => ({ name: s.name, level: s.level })),
      items: result.items,
      matchedSkills: result.matchedSkills,
      missingSkills: result.missingSkills,
      improveSkills: result.improveSkills,
      score: result.score,
      readiness: result.readiness,
      coverage: result.coverage,
    });
    id = String(doc._id);
    await logActivity(req.user, 'skillgap.analyzed', { targetType: 'SkillGapAnalysis', targetId: doc._id, summary: `${targetRole}: ${result.readiness}% readiness` });
  }
  return ok(res, { id, ...result, method: 'rule-based', note: 'Self-assessed estimate from predefined role checklists; not an AI evaluation or hiring probability.' });
};

exports.history = async (req, res) => {
  const items = await SkillGapAnalysis.find({ studentId: req.user._id })
    .select('targetRole score readiness coverage missingSkills scoringVersion createdAt').sort({ createdAt: -1 }).limit(50).lean();
  return ok(res, { items: items.map((i) => ({ ...i, id: String(i._id), _id: undefined })) });
};

exports.getOne = async (req, res) => {
  assertObjectId(req.params.id, 'Analysis');
  const doc = await SkillGapAnalysis.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Analysis not found');
  if (String(doc.studentId) !== String(req.user._id)) throw ApiError.forbidden('You can only view your own analyses');
  return ok(res, { analysis: doc });
};

// Prioritised learning items for the student's target role (missing first, then low-rated; High priority first).
exports.recommendations = async (req, res) => {
  const profile = await StudentProfile.findOne({ userId: req.user._id }).lean();
  const requested = req.valid.query.targetRole;
  if (requested && !roleNames().includes(requested)) throw ApiError.validation(`targetRole must be one of: ${roleNames().join(', ')}`);
  const targetRole = requested || (roleNames().includes(profile?.desiredRole) ? profile.desiredRole : 'MERN Developer');
  const result = analyzeSkillGap(targetRole, await studentSkillsOf(req.user._id));
  const plan = new Set(profile?.learningPlan || []);
  const items = result.gaps.map((g, i) => ({
    rank: i + 1, skill: g.name, key: g.key, priority: g.priority, state: g.state, level: g.level,
    summary: g.summary, steps: g.steps, inPlan: plan.has(g.key),
  }));
  return ok(res, { targetRole, items, learningPlan: [...plan], completedCount: plan.size });
};

// Toggle an item in the student's learning plan (persisted on the student profile).
exports.updatePlan = async (req, res) => {
  const key = normalizeKey(req.body.skill);
  const update = req.body.inPlan ? { $addToSet: { learningPlan: key } } : { $pull: { learningPlan: key } };
  const profile = await StudentProfile.findOneAndUpdate({ userId: req.user._id }, update, { upsert: true, returnDocument: 'after' });
  return ok(res, { learningPlan: profile.learningPlan }, { message: req.body.inPlan ? 'Added to learning plan' : 'Removed from learning plan' });
};
