const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/respond');
const { User, Job, Application, StudentSkill, StudentProfile, RecruiterProfile, Resume, ActivityLog, Session } = require('../models');
const { serializeJob } = require('../services/jobs');
const { notify, logActivity } = require('../services/events');
const { assertObjectId, escapeRegex, pagination, pageMeta } = require('../utils/helpers');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function userGrowth(months = 6) {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() - (months - 1));
  const users = await User.find({ createdAt: { $gte: start } }).select('createdAt role').lean();
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(start); d.setMonth(start.getMonth() + i);
    const value = users.filter((u) => u.createdAt.getMonth() === d.getMonth() && u.createdAt.getFullYear() === d.getFullYear()).length;
    return { label: MONTHS[d.getMonth()], year: d.getFullYear(), value };
  });
}

const logOut = (l) => ({
  id: String(l._id), action: l.action, summary: l.summary || '', actor: l.actorId ? { id: String(l.actorId._id || l.actorId), name: l.actorId.name, role: l.actorRole } : null,
  targetType: l.targetType, targetId: l.targetId ? String(l.targetId) : null, at: l.createdAt,
  type: l.action.startsWith('job') ? 'job' : l.action.startsWith('user') || l.action.startsWith('admin.user') ? 'user' : 'success',
});

exports.dashboard = async (_req, res) => {
  const [students, activeStudents, recruiters, jobsByStatus, applications, recentUsers, recentLogs, pending] = await Promise.all([
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'student', status: 'active' }),
    User.countDocuments({ role: 'recruiter' }),
    Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Application.countDocuments({ status: { $ne: 'withdrawn' } }),
    User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 }).limit(4).lean(),
    ActivityLog.find().sort({ createdAt: -1 }).limit(6).populate('actorId', 'name').lean(),
    Job.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(5).lean(),
  ]);
  const jobs = Object.fromEntries(jobsByStatus.map((j) => [j._id, j.n]));
  return ok(res, {
    metrics: {
      totalStudents: students, activeStudents, recruiters,
      approvedJobs: jobs.approved || 0, pendingJobs: jobs.pending || 0, rejectedJobs: jobs.rejected || 0,
      applications,
    },
    userGrowth: await userGrowth(),
    pendingJobs: pending.map((j) => serializeJob(j)),
    recentUsers: recentUsers.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status, joined: u.createdAt })),
    recentActivity: recentLogs.map(logOut),
  });
};

exports.users = async (req, res) => {
  const q = req.valid.query;
  const { page, limit, skip } = pagination(q, { defaultLimit: 25 });
  const filter = {};
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.q) { const rx = { $regex: escapeRegex(q.q), $options: 'i' }; filter.$or = [{ name: rx }, { email: rx }]; }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const ids = items.map((u) => u._id);
  const skillCounts = await StudentSkill.aggregate([{ $match: { studentId: { $in: ids } } }, { $group: { _id: '$studentId', n: { $sum: 1 } } }]);
  const skillsBy = new Map(skillCounts.map((s) => [String(s._id), s.n]));
  const [activeCount, suspendedCount] = await Promise.all([
    User.countDocuments({ ...(q.role ? { role: q.role } : {}), status: 'active' }),
    User.countDocuments({ ...(q.role ? { role: q.role } : {}), status: 'suspended' }),
  ]);
  return ok(res, {
    items: items.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status, skills: skillsBy.get(String(u._id)) || 0, joined: u.createdAt, lastLoginAt: u.lastLoginAt })),
    summary: { active: activeCount, suspended: suspendedCount },
  }, { meta: pageMeta(page, limit, total) });
};

async function loadUser(id) {
  assertObjectId(id, 'User');
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

exports.userDetail = async (req, res) => {
  const user = await loadUser(req.params.id);
  const detail = { id: String(user._id), name: user.name, email: user.email, role: user.role, status: user.status, joined: user.createdAt, lastLoginAt: user.lastLoginAt };
  if (user.role === 'student') {
    const [profile, skills, applications, resumes] = await Promise.all([
      StudentProfile.findOne({ userId: user._id }).lean(),
      StudentSkill.find({ studentId: user._id }).sort({ level: -1 }).lean(),
      Application.countDocuments({ studentId: user._id }),
      Resume.countDocuments({ studentId: user._id }),
    ]);
    Object.assign(detail, {
      profile: profile ? { university: profile.university, education: profile.education, major: profile.major, desiredRole: profile.desiredRole } : null,
      skills: skills.map((s) => ({ name: s.name, level: s.level, category: s.category })),
      counts: { applications, resumes },
    });
  } else if (user.role === 'recruiter') {
    const [profile, jobs] = await Promise.all([
      RecruiterProfile.findOne({ userId: user._id }).lean(),
      Job.find({ recruiterId: user._id }).select('title status createdAt').sort({ createdAt: -1 }).lean(),
    ]);
    Object.assign(detail, {
      profile: profile ? { companyName: profile.companyName, industry: profile.industry, contactEmail: profile.contactEmail } : null,
      jobs: jobs.map((j) => ({ id: String(j._id), title: j.title, status: j.status, createdAt: j.createdAt })),
    });
  }
  const activity = await ActivityLog.find({ $or: [{ actorId: user._id }, { targetId: user._id }] }).sort({ createdAt: -1 }).limit(10).populate('actorId', 'name').lean();
  detail.activity = activity.map(logOut);
  return ok(res, { user: detail });
};

exports.setUserStatus = async (req, res) => {
  const user = await loadUser(req.params.id);
  if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('You cannot change the status of your own account');
  if (user.role === 'admin') throw ApiError.forbidden('Administrator accounts cannot be suspended from the dashboard');
  const { status, reason } = req.body;
  user.status = status;
  await user.save();
  if (status === 'suspended') await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await logActivity(req.user, status === 'suspended' ? 'admin.user_suspended' : 'admin.user_activated',
    { targetType: 'User', targetId: user._id, summary: user.name, details: reason ? { reason } : undefined });
  return ok(res, { user: { id: String(user._id), name: user.name, status: user.status } }, { message: `${user.name} is now ${status}` });
};

exports.jobs = async (req, res) => {
  const q = req.valid.query;
  const { page, limit, skip } = pagination(q, { defaultLimit: 50 });
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.q) { const rx = { $regex: escapeRegex(q.q), $options: 'i' }; filter.$or = [{ title: rx }, { company: rx }, { location: rx }]; }
  const [items, total, counts] = await Promise.all([
    Job.find(filter).sort({ status: -1, createdAt: -1 }).skip(skip).limit(limit).populate('recruiterId', 'name email').lean(),
    Job.countDocuments(filter),
    Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return ok(res, {
    items: items.map((j) => serializeJob({ ...j, recruiterId: j.recruiterId?._id || j.recruiterId }, { recruiter: j.recruiterId?.name ? { name: j.recruiterId.name, email: j.recruiterId.email } : null })),
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
  }, { meta: pageMeta(page, limit, total) });
};

async function moderate(req, res, status) {
  assertObjectId(req.params.id, 'Job');
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');
  if (job.status === status) throw ApiError.conflict(`Job is already ${status}`, 'NO_CHANGE');
  job.status = status;
  job.reviewedBy = req.user._id;
  job.reviewedAt = new Date();
  job.rejectionReason = status === 'rejected' ? req.body.reason : '';
  await job.save();
  await notify(job.recruiterId, status === 'approved'
    ? { type: 'job.approved', title: 'Your job is live', body: `"${job.title}" was approved and is now visible to students.`, link: '/recruiter/post-opportunities' }
    : { type: 'job.rejected', title: 'Job listing needs changes', body: `"${job.title}" was rejected: ${req.body.reason}`, link: '/recruiter/post-opportunities' });
  await logActivity(req.user, `job.${status}`, { targetType: 'Job', targetId: job._id, summary: `${job.company} · ${job.title}`, details: status === 'rejected' ? { reason: req.body.reason } : undefined });
  return ok(res, { job: serializeJob(job) }, { message: `Job ${status}` });
}
exports.approveJob = (req, res) => moderate(req, res, 'approved');
exports.rejectJob = (req, res) => moderate(req, res, 'rejected');

exports.analytics = async (_req, res) => {
  const [byRole, jobsByStatus, appsByStatus, topSkills, resumes, jobsByType] = await Promise.all([
    User.aggregate([{ $group: { _id: { role: '$role', status: '$status' }, n: { $sum: 1 } } }]),
    Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Application.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    StudentSkill.aggregate([{ $group: { _id: '$name', n: { $sum: 1 }, total: { $sum: '$level' } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    Resume.countDocuments(),
    Job.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]),
  ]);
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const users = {};
  for (const r of byRole) { users[r._id.role] = users[r._id.role] || { active: 0, suspended: 0 }; users[r._id.role][r._id.status] = r.n; }
  return ok(res, {
    users,
    userGrowth: await userGrowth(),
    jobsByStatus: toMap(jobsByStatus),
    jobsByType: toMap(jobsByType),
    applicationsByStatus: toMap(appsByStatus),
    topSkills: topSkills.map((s) => ({ name: s._id, students: s.n, averageLevel: Math.round(s.total / s.n) })),
    resumesUploaded: resumes,
  });
};

exports.activityLogs = async (req, res) => {
  const q = req.valid.query;
  const { page, limit, skip } = pagination(q, { defaultLimit: 40 });
  const filter = q.action ? { action: { $regex: `^${escapeRegex(q.action)}` } } : {};
  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actorId', 'name').lean(),
    ActivityLog.countDocuments(filter),
  ]);
  return ok(res, { items: items.map(logOut) }, { meta: pageMeta(page, limit, total) });
};
