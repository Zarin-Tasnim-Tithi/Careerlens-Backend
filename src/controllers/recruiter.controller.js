const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/respond');
const { Job, Application, StudentProfile, StudentSkill, Resume } = require('../models');
const { serializeJob } = require('../services/jobs');
const { readFile } = require('../services/storage');
const { notify, logActivity } = require('../services/events');
const { loadApplication, STATUS_LABEL } = require('./applications.controller');
const { assertObjectId, escapeRegex, initialsOf, toneFor, pageMeta } = require('../utils/helpers');

const REVIEW_STATES = ['applied', 'in_review'];

/** Applicant card: student identity + skills + education, scoped to one application. */
async function applicantCards(apps) {
  const studentIds = [...new Set(apps.map((a) => String(a.studentId._id || a.studentId)))];
  const [profiles, skills] = await Promise.all([
    StudentProfile.find({ userId: { $in: studentIds } }).lean(),
    StudentSkill.find({ studentId: { $in: studentIds } }).sort({ level: -1 }).lean(),
  ]);
  const profileBy = new Map(profiles.map((p) => [String(p.userId), p]));
  const skillsBy = skills.reduce((m, s) => { const k = String(s.studentId); (m[k] = m[k] || []).push(s); return m; }, {});
  return apps.map((a) => {
    const student = a.studentId;
    const sid = String(student._id || student);
    const p = profileBy.get(sid) || {};
    const job = a.jobId || {};
    return {
      id: String(a._id),
      applicationId: String(a._id),
      studentId: sid,
      name: student.name,
      email: student.email,
      initials: initialsOf(student.name),
      tone: toneFor(student.name),
      education: p.education || [p.major, p.university].filter(Boolean).join(' · ') || 'Education not provided',
      university: p.university || '',
      bio: p.bio || '',
      links: p.links || {},
      desiredRole: p.desiredRole || '',
      skills: (skillsBy[sid] || []).slice(0, 8).map((s) => s.name),
      skillDetails: (skillsBy[sid] || []).map((s) => ({ name: s.name, level: s.level, category: s.category })),
      jobId: String(job._id || a.jobId),
      role: job.title,
      company: job.company,
      match: a.matchScore,
      status: a.status,
      statusLabel: REVIEW_STATES.includes(a.status) ? 'In review' : STATUS_LABEL[a.status],
      saved: a.savedByRecruiter,
      interview: a.interview?.date ? a.interview : null,
      appliedAt: a.appliedAt,
      hasResume: Boolean(a.resumeId),
      coverNote: a.coverNote,
    };
  });
}

exports.dashboard = async (req, res) => {
  const recruiterId = req.user._id;
  const [jobs, apps] = await Promise.all([
    Job.find({ recruiterId }).sort({ createdAt: -1 }).lean(),
    Application.find({ recruiterId, status: { $ne: 'withdrawn' } }).select('status savedByRecruiter jobId').lean(),
  ]);
  const countBy = apps.reduce((m, a) => { m[String(a.jobId)] = (m[String(a.jobId)] || 0) + 1; return m; }, {});
  return ok(res, {
    stats: {
      opportunities: jobs.length,
      activeListings: jobs.filter((j) => j.status === 'approved' && j.isActive).length,
      pendingApproval: jobs.filter((j) => j.status === 'pending').length,
      applicants: apps.length,
      toReview: apps.filter((a) => REVIEW_STATES.includes(a.status)).length,
      shortlisted: apps.filter((a) => a.status === 'shortlisted').length,
      interviews: apps.filter((a) => a.status === 'interview').length,
      savedCandidates: apps.filter((a) => a.savedByRecruiter).length,
    },
    recentJobs: jobs.slice(0, 5).map((j) => serializeJob(j, { applicants: countBy[String(j._id)] || 0 })),
  });
};

exports.jobs = async (req, res) => {
  const [jobs, counts] = await Promise.all([
    Job.find({ recruiterId: req.user._id }).sort({ createdAt: -1 }),
    Application.aggregate([{ $match: { recruiterId: req.user._id, status: { $ne: 'withdrawn' } } }, { $group: { _id: '$jobId', n: { $sum: 1 } } }]),
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  return ok(res, { items: jobs.map((j) => serializeJob(j, { applicants: countBy.get(String(j._id)) || 0 })) });
};

async function ownJob(req, id) {
  assertObjectId(id, 'Job');
  const job = await Job.findById(id).lean();
  if (!job) throw ApiError.notFound('Job not found');
  if (String(job.recruiterId) !== String(req.user._id)) throw ApiError.forbidden('You can only view applicants for your own jobs');
  return job;
}

exports.jobApplicants = async (req, res) => {
  const job = await ownJob(req, req.params.id);
  const apps = await Application.find({ jobId: job._id, status: { $ne: 'withdrawn' } })
    .populate('studentId', 'name email').populate('jobId', 'title company').sort({ matchScore: -1, appliedAt: -1 }).lean();
  return ok(res, { job: serializeJob(job), items: await applicantCards(apps) });
};

// GET /recruiter/applicants — every applicant across this recruiter's jobs, with search and filters.
exports.applicants = async (req, res) => {
  const q = req.valid.query;
  const filter = { recruiterId: req.user._id, status: { $ne: 'withdrawn' } };
  if (q.jobId) filter.jobId = q.jobId;
  if (q.saved === 'true') filter.savedByRecruiter = true;
  if (q.status) {
    const wanted = q.status.split(',').flatMap((s) => (s === 'in_review' || s === 'In review' ? REVIEW_STATES : [s.toLowerCase()]));
    filter.status = { $in: wanted };
  }
  const page = q.page || 1;
  const limit = q.limit || 50;
  let apps = await Application.find(filter).populate('studentId', 'name email').populate('jobId', 'title company').sort({ appliedAt: -1 }).limit(1000).lean();
  let cards = await applicantCards(apps);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    cards = cards.filter((c) => rx.test(`${c.name} ${c.role} ${c.skills.join(' ')} ${c.email}`));
  }
  const total = cards.length;
  apps = null;
  return ok(res, { items: cards.slice((page - 1) * limit, page * limit) }, { meta: pageMeta(page, limit, total) });
};

async function ownApplication(req) {
  const app = await loadApplication(req.params.id);
  if (String(app.recruiterId) !== String(req.user._id)) throw ApiError.forbidden('You can only manage applicants for your own jobs');
  return app;
}

exports.applicantDetail = async (req, res) => {
  const app = await ownApplication(req);
  const raw = await Application.findById(app._id).populate('studentId', 'name email').populate('jobId', 'title company').lean();
  const [card] = await applicantCards([raw]);
  let resume = null;
  if (app.resumeId) {
    const r = await Resume.findById(app.resumeId).select('filename size latestScore createdAt').lean();
    if (r) resume = { id: String(r._id), filename: r.filename, size: r.size, score: r.latestScore ?? null, uploadedAt: r.createdAt };
  }
  return ok(res, { applicant: { ...card, resume, statusHistory: app.statusHistory } });
};

exports.toggleSave = async (req, res) => {
  const app = await ownApplication(req);
  app.savedByRecruiter = req.body.saved;
  await app.save();
  return ok(res, { id: String(app._id), saved: app.savedByRecruiter }, { message: app.savedByRecruiter ? 'Candidate saved to shortlist' : 'Candidate removed from saved list' });
};

exports.scheduleInterview = async (req, res) => {
  const app = await ownApplication(req);
  if (['withdrawn', 'rejected', 'offered'].includes(app.status)) throw ApiError.conflict(`Cannot schedule an interview for a ${app.status} application`, 'INVALID_TRANSITION');
  app.interview = { date: req.body.date, time: req.body.time, notes: req.body.notes || '' };
  if (app.status !== 'interview') { app.status = 'interview'; app.statusHistory.push({ status: 'interview', at: new Date(), by: req.user._id }); }
  await app.save();
  await app.populate('jobId', 'title company');
  await notify(app.studentId, { type: 'application.interview', title: 'Interview scheduled', body: `${app.jobId.company} · ${app.jobId.title} on ${req.body.date} at ${req.body.time}`, link: '/dashboard/applications' });
  await logActivity(req.user, 'application.interview_scheduled', { targetType: 'Application', targetId: app._id, summary: `${app.jobId.title} · ${req.body.date} ${req.body.time}` });
  return ok(res, { id: String(app._id), status: app.status, interview: app.interview }, { message: 'Interview scheduled successfully.' });
};

exports.cancelInterview = async (req, res) => {
  const app = await ownApplication(req);
  if (!app.interview?.date) throw ApiError.notFound('No interview scheduled for this applicant');
  app.interview = { date: '', time: '', notes: '' };
  if (app.status === 'interview') { app.status = 'shortlisted'; app.statusHistory.push({ status: 'shortlisted', at: new Date(), by: req.user._id, note: 'Interview cancelled' }); }
  await app.save();
  await notify(app.studentId, { type: 'application.interview', title: 'Interview cancelled', body: 'A scheduled interview was cancelled by the recruiter.', link: '/dashboard/applications' });
  return ok(res, { id: String(app._id), status: app.status }, { message: 'Interview removed.' });
};

exports.interviews = async (req, res) => {
  const apps = await Application.find({ recruiterId: req.user._id, 'interview.date': { $nin: ['', null] }, status: { $ne: 'withdrawn' } })
    .populate('studentId', 'name email').populate('jobId', 'title company').lean();
  const items = apps.map((a) => ({
    id: String(a._id), applicationId: String(a._id), candidate: a.studentId?.name, email: a.studentId?.email,
    position: a.jobId?.title, date: a.interview.date, time: a.interview.time, notes: a.interview.notes, status: a.status,
  })).sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
  return ok(res, { items });
};

// Recruiters may download the resume a candidate attached to an application for one of their jobs.
exports.applicantResume = async (req, res) => {
  const app = await ownApplication(req);
  if (!app.resumeId) throw ApiError.notFound('This applicant did not attach a resume');
  const resume = await Resume.findById(app.resumeId).lean();
  if (!resume) throw ApiError.notFound('Resume no longer available');
  const buffer = await readFile(resume.storageKey);
  res.set({ 'Content-Type': resume.mimeType, 'Content-Disposition': `attachment; filename="${resume.filename.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store' });
  return res.send(buffer);
};

exports.analytics = async (req, res) => {
  const recruiterId = req.user._id;
  const [jobs, apps] = await Promise.all([
    Job.find({ recruiterId }).sort({ createdAt: -1 }).lean(),
    Application.find({ recruiterId, status: { $ne: 'withdrawn' } }).select('jobId status savedByRecruiter matchScore appliedAt').lean(),
  ]);
  const byJob = jobs.map((j) => {
    const list = apps.filter((a) => String(a.jobId) === String(j._id));
    return { jobId: String(j._id), title: j.title, status: j.status, isActive: j.isActive, applicants: list.length,
      averageMatch: list.length ? Math.round(list.reduce((s, a) => s + a.matchScore, 0) / list.length) : 0 };
  });
  const pipeline = apps.reduce((m, a) => { const k = REVIEW_STATES.includes(a.status) ? 'in_review' : a.status; m[k] = (m[k] || 0) + 1; return m; }, {});
  return ok(res, {
    totals: {
      jobListings: jobs.length,
      activeListings: jobs.filter((j) => j.status === 'approved' && j.isActive).length,
      applicants: apps.length,
      savedCandidates: apps.filter((a) => a.savedByRecruiter).length,
    },
    pipeline,
    byJob,
  });
};

exports.applicantCards = applicantCards;
