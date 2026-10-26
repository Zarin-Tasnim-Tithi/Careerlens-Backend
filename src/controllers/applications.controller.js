const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/respond');
const { Application, Job, Resume } = require('../models');
const { TRANSITIONS } = require('../models/Application');
const { jobMatch } = require('../services/scoring');
const { studentSkillsOf } = require('../services/skills');
const { serializeJob, startOfToday } = require('../services/jobs');
const { notify, logActivity } = require('../services/events');
const { assertObjectId } = require('../utils/helpers');

const STATUS_LABEL = { applied: 'Applied', in_review: 'In review', shortlisted: 'Shortlisted', interview: 'Interview', offered: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };

function applicationOut(app) {
  const a = app.toJSON ? app.toJSON() : { ...app, id: String(app._id) };
  const job = a.jobId && typeof a.jobId === 'object' && a.jobId.title ? a.jobId : null;
  return {
    id: String(a.id || app._id),
    status: a.status,
    statusLabel: STATUS_LABEL[a.status],
    appliedAt: a.appliedAt,
    updatedAt: a.updatedAt,
    matchScore: a.matchScore,
    coverNote: a.coverNote,
    resumeId: a.resumeId ? String(a.resumeId._id || a.resumeId) : null,
    interview: a.interview?.date ? a.interview : null,
    statusHistory: a.statusHistory,
    jobId: job ? String(job._id || job.id) : String(a.jobId),
    job: job ? { id: String(job._id || job.id), title: job.title, company: job.company, location: job.location, type: job.type, mode: job.mode, deadline: job.deadline, status: job.status, isActive: job.isActive } : null,
  };
}

// POST /applications — student applies to an open job; duplicates are rejected (409).
exports.create = async (req, res) => {
  const { jobId, resumeId, coverNote = '' } = req.body;
  const job = await Job.findById(jobId);
  if (!job || job.status !== 'approved') throw ApiError.notFound('Job not found');
  if (!job.isActive || job.deadline < startOfToday()) throw ApiError.conflict('This opportunity is no longer accepting applications.', 'JOB_CLOSED');
  if (resumeId) {
    const resume = await Resume.findById(resumeId).select('studentId').lean();
    if (!resume || String(resume.studentId) !== String(req.user._id)) throw ApiError.forbidden('You can only attach your own resume');
  }
  const match = jobMatch(job, await studentSkillsOf(req.user._id));

  let app = await Application.findOne({ jobId, studentId: req.user._id });
  if (app && app.status !== 'withdrawn') throw ApiError.conflict('You have already applied to this opportunity.', 'ALREADY_APPLIED');
  const historyEntry = { status: 'applied', at: new Date(), by: req.user._id };
  if (app) {
    Object.assign(app, { status: 'applied', resumeId, coverNote, matchScore: match.score, appliedAt: new Date(), interview: {}, savedByRecruiter: false });
    app.statusHistory.push({ ...historyEntry, note: 'Re-applied after withdrawing' });
    await app.save();
  } else {
    try {
      app = await Application.create({
        jobId, studentId: req.user._id, recruiterId: job.recruiterId, resumeId, coverNote, matchScore: match.score, statusHistory: [historyEntry],
      });
    } catch (err) {
      if (err.code === 11000) throw ApiError.conflict('You have already applied to this opportunity.', 'ALREADY_APPLIED');
      throw err;
    }
  }
  await Job.updateOne({ _id: job._id }, { $inc: { applicantCount: 1 } });
  await notify(job.recruiterId, { type: 'application.received', title: 'New application received', body: `${req.user.name} applied for ${job.title}`, link: '/recruiter/applicants' });
  await logActivity(req.user, 'application.submitted', { targetType: 'Application', targetId: app._id, summary: `${job.title} · ${job.company}` });
  await app.populate('jobId', 'title company location type mode deadline status isActive');
  return created(res, { application: applicationOut(app) }, 'Application submitted');
};

exports.listMine = async (req, res) => {
  const filter = { studentId: req.user._id };
  if (req.valid.query.status) filter.status = { $in: req.valid.query.status.split(',') };
  const apps = await Application.find(filter).populate('jobId', 'title company location type mode deadline status isActive').sort({ appliedAt: -1 }).lean();
  return ok(res, { items: apps.map(applicationOut) });
};

async function loadApplication(id) {
  assertObjectId(id, 'Application');
  const app = await Application.findById(id);
  if (!app) throw ApiError.notFound('Application not found');
  return app;
}

exports.getOne = async (req, res) => {
  const app = await loadApplication(req.params.id);
  const { user } = req;
  const allowed = user.role === 'admin' || String(app.studentId) === String(user._id) || String(app.recruiterId) === String(user._id);
  if (!allowed) throw ApiError.forbidden('You do not have access to this application');
  await app.populate('jobId');
  const out = applicationOut(app);
  out.job = serializeJob(app.jobId);
  return ok(res, { application: out });
};

exports.withdraw = async (req, res) => {
  const app = await loadApplication(req.params.id);
  if (String(app.studentId) !== String(req.user._id)) throw ApiError.forbidden('You can only withdraw your own applications');
  if (app.status === 'withdrawn') throw ApiError.conflict('This application is already withdrawn.', 'ALREADY_WITHDRAWN');
  app.status = 'withdrawn';
  app.statusHistory.push({ status: 'withdrawn', at: new Date(), by: req.user._id });
  await app.save();
  await Job.updateOne({ _id: app.jobId, applicantCount: { $gt: 0 } }, { $inc: { applicantCount: -1 } });
  const job = await Job.findById(app.jobId).select('title').lean();
  await notify(app.recruiterId, { type: 'application.withdrawn', title: 'Application withdrawn', body: `${req.user.name} withdrew from ${job?.title || 'a job'}`, link: '/recruiter/applicants' });
  await logActivity(req.user, 'application.withdrawn', { targetType: 'Application', targetId: app._id, summary: job?.title });
  await app.populate('jobId', 'title company location type mode deadline status isActive');
  return ok(res, { application: applicationOut(app) }, { message: 'Application withdrawn' });
};

/** Shared by PATCH /applications/:id/status and PATCH /recruiter/applicants/:id/status. */
async function changeStatus(req, res) {
  const app = await loadApplication(req.params.id);
  if (String(app.recruiterId) !== String(req.user._id)) throw ApiError.forbidden('Only the recruiter who owns this job can review this application');
  const next = req.body.status;
  if (app.status === next) return ok(res, { application: applicationOut(await app.populate('jobId', 'title company location type mode deadline status isActive')) });
  if (!TRANSITIONS[app.status].includes(next)) {
    throw new ApiError(409, 'INVALID_TRANSITION', `Cannot move an application from "${app.status}" to "${next}"`, [{ allowed: TRANSITIONS[app.status] }]);
  }
  app.status = next;
  app.statusHistory.push({ status: next, at: new Date(), by: req.user._id, note: req.body.note });
  await app.save();
  await app.populate('jobId', 'title company location type mode deadline status isActive');
  await notify(app.studentId, {
    type: 'application.status', title: `Application update: ${STATUS_LABEL[next]}`,
    body: `${app.jobId.company} · ${app.jobId.title}`, link: '/dashboard/applications',
  });
  await logActivity(req.user, 'application.status_changed', { targetType: 'Application', targetId: app._id, summary: `${app.jobId.title}: ${STATUS_LABEL[next]}` });
  return ok(res, { application: applicationOut(app) }, { message: `Application marked as ${STATUS_LABEL[next].toLowerCase()}` });
}

exports.changeStatus = changeStatus;
exports.loadApplication = loadApplication;
exports.applicationOut = applicationOut;
exports.STATUS_LABEL = STATUS_LABEL;
