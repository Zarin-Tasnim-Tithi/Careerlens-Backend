const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/respond');
const { Job, SavedJob, Application, RecruiterProfile, User } = require('../models');
const { publicJobFilter, serializeJob, decorateForStudent, startOfToday } = require('../services/jobs');
const { studentSkillsOf } = require('../services/skills');
const { notify, logActivity } = require('../services/events');
const { assertObjectId, escapeRegex, pageMeta, normalizeKey } = require('../utils/helpers');

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const MAX_SCAN = 500; // jobs scanned per search before in-memory match scoring (ample for a course-scale platform)

function inferMode(location = '') {
  if (/remote/i.test(location)) return 'Remote';
  if (/hybrid/i.test(location)) return 'Hybrid';
  return 'On-site';
}
const dedupe = (list = []) => {
  const seen = new Set();
  return list.filter((s) => { const k = normalizeKey(s); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};

// GET /jobs — approved, active, open jobs with search, filters, sorting and pagination.
exports.list = async (req, res) => {
  const q = req.valid.query;
  const page = q.page || 1;
  const limit = q.limit || 20;
  const filter = publicJobFilter();
  if (q.q) {
    const rx = { $regex: escapeRegex(q.q), $options: 'i' };
    filter.$or = [{ title: rx }, { company: rx }, { location: rx }, { summary: rx }, { description: rx }, { requirements: rx }, { preferredSkills: rx }, { type: rx }, { mode: rx }];
  }
  if (asArray(q.type).length) filter.type = { $in: asArray(q.type) };
  if (asArray(q.mode).length) filter.mode = { $in: asArray(q.mode) };
  if (q.location) filter.location = { $regex: escapeRegex(q.location), $options: 'i' };
  if (q.experience) filter.experience = q.experience;
  if (q.skill) filter.requirements = { $regex: `^${escapeRegex(q.skill)}$`, $options: 'i' };
  if (q.deadlineWithin) filter.deadline = { $gte: startOfToday(), $lte: new Date(Date.now() + q.deadlineWithin * 86400000) };

  const docs = await Job.find(filter).sort({ createdAt: -1 }).limit(MAX_SCAN);
  let items;
  if (req.user.role === 'student') {
    items = await decorateForStudent(docs, req.user._id, await studentSkillsOf(req.user._id));
    if (q.minMatch) items = items.filter((j) => j.match.score >= q.minMatch);
  } else {
    items = docs.map((d) => serializeJob(d));
  }
  const sort = q.sort || (req.user.role === 'student' ? 'match' : 'latest');
  items.sort((a, b) => {
    if (sort === 'deadline') return new Date(a.deadline) - new Date(b.deadline);
    if (sort === 'match' && a.match) return b.match.score - a.match.score || new Date(a.deadline) - new Date(b.deadline);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const total = items.length;
  const paged = items.slice((page - 1) * limit, page * limit);
  return ok(res, { items: paged }, { meta: { ...pageMeta(page, limit, total), sort } });
};

// GET /jobs/recommended — rule-based relevance from the student's skills.
exports.recommended = async (req, res) => {
  const limit = Math.min(20, Number(req.query.limit) || 6);
  const docs = await Job.find(publicJobFilter()).limit(MAX_SCAN);
  const items = (await decorateForStudent(docs, req.user._id, await studentSkillsOf(req.user._id)))
    .filter((j) => !j.applied && j.match.score >= 40)
    .sort((a, b) => b.match.score - a.match.score || new Date(a.deadline) - new Date(b.deadline))
    .slice(0, limit);
  return ok(res, { items, method: 'rule-based skill overlap (80% required, 20% preferred)' });
};

exports.saved = async (req, res) => {
  const saved = await SavedJob.find({ studentId: req.user._id }).sort({ createdAt: -1 }).lean();
  const jobs = await Job.find({ _id: { $in: saved.map((s) => s.jobId) } });
  const decorated = await decorateForStudent(jobs, req.user._id, await studentSkillsOf(req.user._id));
  const byId = new Map(decorated.map((j) => [j.id, j]));
  const items = saved.map((s) => byId.get(String(s.jobId))).filter(Boolean)
    .map((j) => ({ ...j, isOpen: j.status === 'approved' && j.isActive && new Date(j.deadline) >= startOfToday() }));
  return ok(res, { items });
};

async function loadJob(id) {
  assertObjectId(id, 'Job');
  const job = await Job.findById(id);
  if (!job) throw ApiError.notFound('Job not found');
  return job;
}
const isOwner = (job, user) => String(job.recruiterId) === String(user._id);

// GET /jobs/:id — public jobs for everyone; otherwise owner, admin, or a student who applied/saved it.
exports.getOne = async (req, res) => {
  const job = await loadJob(req.params.id);
  const isPublic = job.status === 'approved' && job.isActive;
  const { user } = req;
  if (!isPublic && user.role !== 'admin' && !isOwner(job, user)) {
    const linked = user.role === 'student' && (await Application.exists({ jobId: job._id, studentId: user._id }) || await SavedJob.exists({ jobId: job._id, studentId: user._id }));
    if (!linked) throw ApiError.notFound('Job not found');
  }
  if (user.role === 'student') {
    const [item] = await decorateForStudent([job], user._id, await studentSkillsOf(user._id));
    return ok(res, { job: item });
  }
  return ok(res, { job: serializeJob(job) });
};

// POST /jobs — recruiter creates a job; it stays "pending" until an admin approves it.
exports.create = async (req, res) => {
  const body = req.body;
  if (body.deadline && body.deadline < startOfToday()) throw ApiError.validation('Deadline cannot be in the past');
  const profile = await RecruiterProfile.findOne({ userId: req.user._id }).lean();
  const job = await Job.create({
    ...body,
    company: body.company || profile?.companyName,
    mode: body.mode || inferMode(body.location),
    deadline: body.deadline || new Date(Date.now() + 30 * 86400000),
    summary: body.summary || body.description.slice(0, 160),
    requirements: dedupe(body.requirements),
    preferredSkills: dedupe(body.preferredSkills),
    recruiterId: req.user._id,
    status: 'pending',
    isActive: true,
  });
  await logActivity(req.user, 'job.submitted', { targetType: 'Job', targetId: job._id, summary: `${job.company} · ${job.title}` });
  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').lean();
  await Promise.all(admins.map((a) => notify(a._id, { type: 'job.pending', title: 'Job waiting for review', body: `${job.company} · ${job.title}`, link: '/admin' })));
  return created(res, { job: serializeJob(job) }, 'Job submitted for admin approval');
};

const CONTENT_FIELDS = ['title', 'company', 'type', 'mode', 'location', 'experience', 'pay', 'deadline', 'summary', 'description', 'requirements', 'preferredSkills', 'responsibilities', 'benefits'];

// PATCH /jobs/:id — owner edits. Content changes on an approved/rejected job send it back for moderation.
exports.update = async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!isOwner(job, req.user)) throw ApiError.forbidden('You can only edit your own job listings');
  const body = { ...req.body };
  if (body.requirements) body.requirements = dedupe(body.requirements);
  if (body.preferredSkills) body.preferredSkills = dedupe(body.preferredSkills);
  if (body.location && !body.mode) body.mode = inferMode(body.location);
  if (body.deadline && body.deadline < startOfToday()) throw ApiError.validation('Deadline cannot be in the past');

  const contentChanged = CONTENT_FIELDS.some((f) => body[f] !== undefined && JSON.stringify(body[f]) !== JSON.stringify(job[f]));
  Object.assign(job, body);
  let message = 'Opportunity updated successfully.';
  if (contentChanged && job.status !== 'pending') {
    job.status = 'pending';
    job.rejectionReason = '';
    message = 'Opportunity updated and sent back for admin approval.';
  }
  await job.save();
  await logActivity(req.user, body.isActive === false ? 'job.paused' : body.isActive === true && !contentChanged ? 'job.resumed' : 'job.updated',
    { targetType: 'Job', targetId: job._id, summary: `${job.company} · ${job.title}` });
  return ok(res, { job: serializeJob(job) }, { message });
};

// DELETE /jobs/:id — owner removes a listing; applicants and savers are cleaned up and applicants notified.
exports.remove = async (req, res) => {
  const job = await loadJob(req.params.id);
  if (!isOwner(job, req.user)) throw ApiError.forbidden('You can only delete your own job listings');
  const applicants = await Application.find({ jobId: job._id, status: { $ne: 'withdrawn' } }).select('studentId').lean();
  await Promise.all(applicants.map((a) => notify(a.studentId, { type: 'job.removed', title: 'An opportunity was removed', body: `${job.company} removed "${job.title}". Your application was closed.`, link: '/dashboard/applications' })));
  await Promise.all([Application.deleteMany({ jobId: job._id }), SavedJob.deleteMany({ jobId: job._id }), job.deleteOne()]);
  await logActivity(req.user, 'job.deleted', { targetType: 'Job', targetId: job._id, summary: `${job.company} · ${job.title}` });
  return res.status(204).end();
};

exports.save = async (req, res) => {
  const job = await loadJob(req.params.id);
  if (job.status !== 'approved') throw ApiError.notFound('Job not found');
  try {
    await SavedJob.create({ studentId: req.user._id, jobId: job._id });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This job is already in your saved list.', 'ALREADY_SAVED');
    throw err;
  }
  await logActivity(req.user, 'job.saved', { targetType: 'Job', targetId: job._id, summary: `${job.title} · ${job.company}` });
  return created(res, { jobId: String(job._id), saved: true }, 'Opportunity added to Saved Jobs');
};

exports.unsave = async (req, res) => {
  assertObjectId(req.params.id, 'Job');
  const result = await SavedJob.deleteOne({ studentId: req.user._id, jobId: req.params.id });
  if (!result.deletedCount) throw ApiError.notFound('This job is not in your saved list');
  return ok(res, { jobId: req.params.id, saved: false }, { message: 'Removed from saved opportunities' });
};

exports.loadJob = loadJob;
