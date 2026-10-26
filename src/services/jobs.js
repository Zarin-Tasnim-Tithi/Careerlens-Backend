const { Job, SavedJob, Application } = require('../models');
const { jobMatch } = require('./scoring');
const { initialsOf, toneFor } = require('../utils/helpers');

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/** Filter for jobs a student may browse: approved by an admin, not paused, deadline not passed. */
const publicJobFilter = () => ({ status: 'approved', isActive: true, deadline: { $gte: startOfToday() } });

/** Shape a job for API responses. Adds avatar mark/tone so the UI can render company badges. */
function serializeJob(job, extra = {}) {
  const j = typeof job.toJSON === 'function' ? job.toJSON() : { ...job, id: String(job._id) };
  delete j._id; delete j.__v;
  return {
    ...j,
    id: String(j.id || job._id),
    recruiterId: String(j.recruiterId),
    mark: initialsOf(j.company).slice(0, 1),
    tone: toneFor(j.company),
    ...extra,
  };
}

/** Saved / applied lookups for one student over a set of jobs. */
async function studentJobState(studentId, jobIds) {
  const [saved, applied] = await Promise.all([
    SavedJob.find({ studentId, jobId: { $in: jobIds } }).select('jobId').lean(),
    Application.find({ studentId, jobId: { $in: jobIds } }).select('jobId status').lean(),
  ]);
  return {
    saved: new Set(saved.map((s) => String(s.jobId))),
    applied: new Map(applied.map((a) => [String(a.jobId), a.status])),
  };
}

async function decorateForStudent(jobs, studentId, studentSkills) {
  const state = await studentJobState(studentId, jobs.map((j) => j._id));
  return jobs.map((job) => {
    const status = state.applied.get(String(job._id));
    return serializeJob(job, {
      match: jobMatch(job, studentSkills),
      saved: state.saved.has(String(job._id)),
      applied: Boolean(status && status !== 'withdrawn'),
      applicationStatus: status || null,
    });
  });
}

module.exports = { Job, publicJobFilter, serializeJob, decorateForStudent, startOfToday };
