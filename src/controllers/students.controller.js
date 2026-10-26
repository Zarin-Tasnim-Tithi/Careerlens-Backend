const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/respond');
const { StudentSkill, StudentProfile, Application, SavedJob, Resume, ActivityLog, SkillGapAnalysis, Job } = require('../models');
const { resolveSkill, studentSkillsOf } = require('../services/skills');
const { analyzeSkillGap, roleNames } = require('../services/scoring');
const { publicJobFilter, decorateForStudent } = require('../services/jobs');
const { logActivity } = require('../services/events');
const { assertObjectId, dayDiff } = require('../utils/helpers');

const PALETTE = ['blue', 'green', 'purple', 'gold', 'orange', 'teal', 'pink', 'coral', 'indigo'];
const levelName = (n) => (n >= 80 ? 'Advanced' : n >= 55 ? 'Intermediate' : 'Beginner');
const skillOut = (s) => ({
  id: String(s._id), skillId: String(s.skillId), name: s.name, category: s.category, level: s.level,
  levelName: levelName(s.level), tint: s.tint, updated: (s.updatedAt || new Date()).toISOString().slice(0, 10), updatedAt: s.updatedAt,
});

// ---------- Skills ----------
exports.listSkills = async (req, res) => {
  const skills = await studentSkillsOf(req.user._id);
  return ok(res, { skills: skills.map(skillOut) });
};

exports.addSkill = async (req, res) => {
  const { name, category, level, tint } = req.body;
  const skill = await resolveSkill(name, category);
  if (await StudentSkill.exists({ studentId: req.user._id, skillId: skill._id })) {
    throw ApiError.conflict(`${skill.name} is already in your profile.`, 'DUPLICATE_SKILL');
  }
  const count = await StudentSkill.countDocuments({ studentId: req.user._id });
  const doc = await StudentSkill.create({
    studentId: req.user._id, skillId: skill._id, name: skill.name, key: skill.key,
    category: category || skill.category, level, tint: tint || PALETTE[count % PALETTE.length],
  });
  await logActivity(req.user, 'skill.added', { targetType: 'StudentSkill', targetId: doc._id, summary: `Added ${doc.name} (${level}%)` });
  return created(res, { skill: skillOut(doc) }, `${doc.name} added to your skills`);
};

async function ownSkill(req) {
  assertObjectId(req.params.skillId, 'Skill');
  const doc = await StudentSkill.findById(req.params.skillId);
  if (!doc) throw ApiError.notFound('Skill not found');
  if (String(doc.studentId) !== String(req.user._id)) throw ApiError.forbidden('You can only change your own skills');
  return doc;
}

exports.updateSkill = async (req, res) => {
  const doc = await ownSkill(req);
  const { name, category, level, tint } = req.body;
  if (name && name.trim().toLowerCase() !== doc.name.toLowerCase()) {
    const skill = await resolveSkill(name, category);
    if (await StudentSkill.exists({ studentId: req.user._id, skillId: skill._id, _id: { $ne: doc._id } })) {
      throw ApiError.conflict('This skill is already in your profile.', 'DUPLICATE_SKILL');
    }
    Object.assign(doc, { skillId: skill._id, name: skill.name, key: skill.key });
  }
  if (category) doc.category = category;
  if (level !== undefined) doc.level = level;
  if (tint) doc.tint = tint;
  await doc.save();
  await logActivity(req.user, 'skill.updated', { targetType: 'StudentSkill', targetId: doc._id, summary: `Updated ${doc.name} (${doc.level}%)` });
  return ok(res, { skill: skillOut(doc) }, { message: `${doc.name} updated successfully` });
};

exports.deleteSkill = async (req, res) => {
  const doc = await ownSkill(req);
  await doc.deleteOne();
  await logActivity(req.user, 'skill.removed', { targetType: 'StudentSkill', targetId: doc._id, summary: `Removed ${doc.name}` });
  return res.status(204).end();
};

// ---------- Dashboard ----------
const ACTIVITY_LABELS = {
  'user.registered': ['Account created', 'Welcome to CareerLens'],
  'user.profile_updated': ['Profile updated', 'Your profile details were saved'],
  'skill.added': ['Skill added', null], 'skill.updated': ['Skill updated', null], 'skill.removed': ['Skill removed', null],
  'resume.uploaded': ['Resume uploaded', null], 'resume.analyzed': ['CV analysis completed', null], 'resume.improved': ['CV improvement generated', null],
  'skillgap.analyzed': ['Skill gap analysed', null], 'application.submitted': ['Application submitted', null],
  'application.withdrawn': ['Application withdrawn', null], 'job.saved': ['Job saved', null],
};
const activityOut = (a) => {
  const [title, detail] = ACTIVITY_LABELS[a.action] || [a.action, null];
  return { id: String(a._id), action: a.action, title, detail: detail || a.summary || '', at: a.createdAt };
};

exports.dashboard = async (req, res) => {
  const studentId = req.user._id;
  const [skills, profile, applications, savedCount, latestResume, activity] = await Promise.all([
    studentSkillsOf(studentId),
    StudentProfile.findOne({ userId: studentId }).lean(),
    Application.find({ studentId }).populate('jobId', 'title company deadline').sort({ appliedAt: -1 }).lean(),
    SavedJob.countDocuments({ studentId }),
    Resume.findOne({ studentId }).sort({ createdAt: -1 }).lean(),
    ActivityLog.find({ actorId: studentId }).sort({ createdAt: -1 }).limit(6).lean(),
  ]);

  const targetRole = roleNames().includes(profile?.desiredRole) ? profile.desiredRole : 'MERN Developer';
  const gap = analyzeSkillGap(targetRole, skills);

  const openJobs = await Job.find(publicJobFilter()).sort({ createdAt: -1 }).limit(300);
  const decorated = await decorateForStudent(openJobs, studentId, skills);
  const matches = decorated.filter((j) => j.match.score >= 50);
  const recommended = decorated.filter((j) => !j.applied && j.match.score >= 40).sort((a, b) => b.match.score - a.match.score).slice(0, 3);

  // Upcoming deadlines: saved or recommended open jobs, soonest first.
  const savedIds = new Set((await SavedJob.find({ studentId }).select('jobId').lean()).map((s) => String(s.jobId)));
  const deadlines = decorated
    .filter((j) => !j.applied && (savedIds.has(j.id) || j.match.score >= 50))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 3)
    .map((j) => ({ jobId: j.id, title: j.title, company: j.company, deadline: j.deadline, daysLeft: Math.max(0, dayDiff(j.deadline)) }));

  const active = applications.filter((a) => a.status !== 'withdrawn');
  return ok(res, {
    greetingName: req.user.name.split(' ')[0],
    targetRole,
    stats: {
      readiness: gap.readiness,
      readinessScore: gap.score,
      skills: skills.length,
      jobMatches: matches.length,
      applications: active.length,
      savedJobs: savedCount,
      interviews: active.filter((a) => a.status === 'interview').length,
      latestResumeScore: latestResume?.latestScore ?? null,
    },
    readinessBreakdown: [
      { name: 'Resume quality', score: latestResume?.latestScore ?? 0 },
      { name: 'Skill average', score: skills.length ? Math.round(skills.reduce((s, x) => s + x.level, 0) / skills.length) : 0 },
      { name: 'Role coverage', score: gap.coverage },
      { name: 'Priority-weighted', score: gap.score },
    ],
    topSkills: skills.slice(0, 5).map((s) => ({ name: s.name, score: s.level })),
    recommendedJobs: recommended,
    deadlines,
    recentActivity: activity.map(activityOut),
    scoringNote: 'Readiness and match scores are rule-based estimates from self-rated skills, not AI or hiring predictions.',
  });
};

// ---------- Analytics ----------
exports.analytics = async (req, res) => {
  const studentId = req.user._id;
  const [skills, applications, resumes, gapHistory, savedCount] = await Promise.all([
    studentSkillsOf(studentId),
    Application.find({ studentId }).lean(),
    Resume.find({ studentId }).select('filename latestScore createdAt').sort({ createdAt: -1 }).lean(),
    SkillGapAnalysis.find({ studentId }).select('targetRole score readiness coverage createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    SavedJob.countDocuments({ studentId }),
  ]);
  const byStatus = applications.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const byCategory = skills.reduce((acc, s) => { acc[s.category] = (acc[s.category] || 0) + 1; return acc; }, {});
  const active = applications.filter((a) => a.status !== 'withdrawn');
  return ok(res, {
    applications: {
      total: active.length,
      byStatus,
      interviews: byStatus.interview || 0,
      offers: byStatus.offered || 0,
      rejected: byStatus.rejected || 0,
    },
    skills: {
      total: skills.length,
      averageLevel: skills.length ? Math.round(skills.reduce((s, x) => s + x.level, 0) / skills.length) : 0,
      advanced: skills.filter((s) => s.level >= 80).length,
      byCategory,
    },
    resumes: { total: resumes.length, latestScore: resumes[0]?.latestScore ?? null, items: resumes.map((r) => ({ id: String(r._id), filename: r.filename, score: r.latestScore ?? null, uploadedAt: r.createdAt })) },
    skillGapHistory: gapHistory.map((g) => ({ id: String(g._id), targetRole: g.targetRole, score: g.score, readiness: g.readiness, coverage: g.coverage, at: g.createdAt })),
    savedJobs: savedCount,
  });
};

exports.skillOut = skillOut;
