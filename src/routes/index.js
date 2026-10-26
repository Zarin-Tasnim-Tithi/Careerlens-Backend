const express = require('express');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const env = require('../config/env');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { resumeUpload } = require('../middleware/upload');
const v = require('../validators');
const { buildOpenApi } = require('../docs/openapi');

const users = require('../controllers/users.controller');
const students = require('../controllers/students.controller');
const gap = require('../controllers/skillgap.controller');
const jobs = require('../controllers/jobs.controller');
const apps = require('../controllers/applications.controller');
const recruiter = require('../controllers/recruiter.controller');
const admin = require('../controllers/admin.controller');
const resumes = require('../controllers/resumes.controller');
const notifications = require('../controllers/notifications.controller');

const router = express.Router();
const student = [authenticate, requireRole('student')];
const recruiterOnly = [authenticate, requireRole('recruiter')];
const adminOnly = [authenticate, requireRole('admin')];
const id = validate({ params: v.idParam });

// ---- System ----
router.get('/health', (_req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const db = dbStates[mongoose.connection.readyState] || 'unknown';
  res.status(db === 'connected' ? 200 : 503).json({
    success: db === 'connected',
    data: { status: db === 'connected' ? 'ok' : 'degraded', database: db, uptimeSeconds: Math.round(process.uptime()), version: '1.0.0', time: new Date().toISOString() },
  });
});
if (env.API_DOCS_PUBLIC) {
  const spec = buildOpenApi();
  router.get('/api-docs.json', (_req, res) => res.json(spec));
  router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'CareerLens API Docs' }));
}

// ---- Authentication ----
router.use('/auth', require('./auth.routes'));

// ---- Profile & account ----
router.get('/users/me', authenticate, users.getMe);
router.patch('/users/me', authenticate, validate({ body: v.users.updateMe }), users.updateMe);
router.post('/users/me/password', authenticate, validate({ body: v.auth.changePassword }), users.changePassword);

// ---- Student dashboard & skills ----
router.get('/students/dashboard', student, students.dashboard);
router.get('/students/me/skills', student, students.listSkills);
router.post('/students/me/skills', student, validate({ body: v.skills.create }), students.addSkill);
router.patch('/students/me/skills/:skillId', student, validate({ params: v.skills.params, body: v.skills.update }), students.updateSkill);
router.delete('/students/me/skills/:skillId', student, validate({ params: v.skills.params }), students.deleteSkill);
router.get('/students/me/analytics', student, students.analytics);

// ---- Resumes & CV improvement ----
router.post('/resumes/upload', student, resumeUpload, resumes.upload);
router.get('/resumes', student, resumes.list);
router.get('/resumes/:id', student, id, resumes.getOne);
router.delete('/resumes/:id', student, id, resumes.remove);
router.post('/resumes/:id/analyze', student, validate({ params: v.idParam, body: v.resumes.analyze }), resumes.analyze);
router.get('/resumes/:id/analysis', student, id, resumes.getAnalysis);
router.post('/resumes/:id/improve', student, validate({ params: v.idParam, body: v.resumes.improve }), resumes.improve);
router.patch('/resumes/:id/draft', student, validate({ params: v.idParam, body: v.resumes.draft }), resumes.saveDraft);
router.get('/resumes/:id/export', student, validate({ params: v.idParam, query: v.resumes.exportQuery }), resumes.exportFile);

// ---- Skill gap & learning ----
router.get('/skills', authenticate, validate({ query: v.skills.catalogQuery }), gap.catalog);
router.get('/skill-gap/roles', authenticate, gap.roles);
router.post('/skill-gap/analyze', student, validate({ body: v.skillGap.analyze }), gap.analyze);
router.get('/skill-gap/history', student, gap.history);
router.get('/skill-gap/:id', student, id, gap.getOne);
router.get('/learning/recommendations', student, validate({ query: v.skillGap.recommendationsQuery }), gap.recommendations);
router.patch('/learning/plan', student, validate({ body: v.skillGap.learningToggle }), gap.updatePlan);

// ---- Jobs, saves & applications ----
router.get('/jobs', authenticate, validate({ query: v.jobs.list }), jobs.list);
router.get('/jobs/recommended', student, jobs.recommended);
router.get('/jobs/saved', student, jobs.saved);
router.get('/jobs/:id', authenticate, id, jobs.getOne);
router.post('/jobs', recruiterOnly, validate({ body: v.jobs.create }), jobs.create);
router.patch('/jobs/:id', recruiterOnly, validate({ params: v.idParam, body: v.jobs.update }), jobs.update);
router.delete('/jobs/:id', recruiterOnly, id, jobs.remove);
router.post('/jobs/:id/save', student, id, jobs.save);
router.delete('/jobs/:id/save', student, id, jobs.unsave);

router.post('/applications', student, validate({ body: v.applications.create }), apps.create);
router.get('/applications/me', student, validate({ query: v.applications.listMine }), apps.listMine);
router.get('/applications/:id', authenticate, id, apps.getOne);
router.patch('/applications/:id/withdraw', student, id, apps.withdraw);
router.patch('/applications/:id/status', recruiterOnly, validate({ params: v.idParam, body: v.applications.status }), apps.changeStatus);

// ---- Recruiter management ----
router.get('/recruiter/dashboard', recruiterOnly, recruiter.dashboard);
router.get('/recruiter/jobs', recruiterOnly, recruiter.jobs);
router.get('/recruiter/jobs/:id/applicants', recruiterOnly, id, recruiter.jobApplicants);
router.get('/recruiter/applicants', recruiterOnly, validate({ query: v.recruiter.applicantsQuery }), recruiter.applicants);
router.get('/recruiter/applicants/:id', recruiterOnly, id, recruiter.applicantDetail);
router.patch('/recruiter/applicants/:id/status', recruiterOnly, validate({ params: v.idParam, body: v.applications.status }), apps.changeStatus);
router.patch('/recruiter/applicants/:id/save', recruiterOnly, validate({ params: v.idParam, body: v.recruiter.save }), recruiter.toggleSave);
router.put('/recruiter/applicants/:id/interview', recruiterOnly, validate({ params: v.idParam, body: v.recruiter.interview }), recruiter.scheduleInterview);
router.delete('/recruiter/applicants/:id/interview', recruiterOnly, id, recruiter.cancelInterview);
router.get('/recruiter/applicants/:id/resume', recruiterOnly, id, recruiter.applicantResume);
router.get('/recruiter/interviews', recruiterOnly, recruiter.interviews);
router.get('/recruiter/analytics', recruiterOnly, recruiter.analytics);

// ---- Admin management ----
router.get('/admin/dashboard', adminOnly, admin.dashboard);
router.get('/admin/users', adminOnly, validate({ query: v.admin.usersQuery }), admin.users);
router.get('/admin/users/:id', adminOnly, id, admin.userDetail);
router.patch('/admin/users/:id/status', adminOnly, validate({ params: v.idParam, body: v.admin.userStatus }), admin.setUserStatus);
router.get('/admin/jobs', adminOnly, validate({ query: v.admin.jobsQuery }), admin.jobs);
router.patch('/admin/jobs/:id/approve', adminOnly, id, admin.approveJob);
router.patch('/admin/jobs/:id/reject', adminOnly, validate({ params: v.idParam, body: v.admin.reject }), admin.rejectJob);
router.get('/admin/analytics', adminOnly, admin.analytics);
router.get('/admin/activity-logs', adminOnly, validate({ query: v.admin.logsQuery }), admin.activityLogs);

// ---- Notifications ----
router.get('/notifications', authenticate, validate({ query: v.notifications.list }), notifications.list);
router.patch('/notifications/read-all', authenticate, notifications.readAll);
router.patch('/notifications/:id/read', authenticate, id, notifications.setRead);

module.exports = router;
