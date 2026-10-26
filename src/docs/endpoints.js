/**
 * Single source of truth for API documentation.
 * Drives: Swagger/OpenAPI (/api/v1/api-docs), the Postman collection (npm run postman) and docs/ENDPOINTS.md.
 *
 * access: public | auth | student | recruiter | admin | refresh-cookie | reset-token
 * spec:   true = listed in the handover specification; false = documented addition needed by an existing screen.
 */
const E = (method, path, tag, access, summary, o = {}) => ({ method, path, tag, access, summary, spec: true, ...o });

module.exports = [
  // ---------------- Authentication ----------------
  E('POST', '/auth/register', 'Authentication', 'public', 'Register a student or recruiter account', {
    body: { name: 'Demo Student', email: 'student2@example.com', password: 'ExamplePass123!', role: 'student', university: 'CareerLens University' },
    collections: 'users, studentProfiles | recruiterProfiles, sessions, notifications, activityLogs', screen: 'auth/pages/SignUp.jsx', status: 201,
    errors: ['409 EMAIL_TAKEN', '422 VALIDATION_ERROR'], saveToken: true,
  }),
  E('POST', '/auth/login', 'Authentication', 'public', 'Verify credentials and start a session (sets HttpOnly refresh cookie)', {
    body: { email: 'student@careerlens.demo', password: '{{studentPassword}}', role: 'student' },
    collections: 'users (lastLoginAt), sessions', screen: 'auth/pages/SignIn.jsx', errors: ['401 INVALID_CREDENTIALS', '403 ROLE_MISMATCH', '403 ACCOUNT_SUSPENDED'], saveToken: true,
  }),
  E('POST', '/auth/refresh', 'Authentication', 'refresh-cookie', 'Rotate the refresh cookie and return a new access token', {
    collections: 'sessions', screen: 'auth/AuthContext.jsx (page load / 401 retry)', errors: ['401 SESSION_EXPIRED', '401 SESSION_REVOKED'], saveToken: true,
  }),
  E('POST', '/auth/logout', 'Authentication', 'auth', 'Revoke the refresh session and clear the cookie', { collections: 'sessions', screen: 'Sign out buttons' }),
  E('GET', '/auth/me', 'Authentication', 'auth', 'Current account and role', { collections: 'users', screen: 'auth/AuthContext.jsx' }),
  E('POST', '/auth/forgot-password', 'Authentication', 'public', 'Issue a 30-minute password reset token', {
    body: { email: 'student@careerlens.demo' }, collections: 'users.passwordReset', screen: 'auth/pages/ForgotPassword.jsx',
  }),
  E('POST', '/auth/reset-password', 'Authentication', 'reset-token', 'Set a new password using a reset token', {
    body: { token: '<token from forgot-password>', password: 'NewPass123!' }, collections: 'users, sessions (revoked)', screen: 'auth/pages/ResetPassword.jsx', errors: ['400 INVALID_RESET_TOKEN'],
  }),

  // ---------------- Profile ----------------
  E('GET', '/users/me', 'Profile', 'auth', 'Get account, preferences and role profile', { collections: 'users, studentProfiles | recruiterProfiles', screen: 'StudentWorkspacePages (profile/settings), RecruiterExtras (company/settings)' }),
  E('PATCH', '/users/me', 'Profile', 'auth', 'Edit permitted profile fields', {
    body: { name: 'Demo Student', studentProfile: { university: 'CareerLens University', major: 'Computer Science', desiredRole: 'Frontend Developer', bio: 'Building skills.' }, preferences: { emailNotifications: true } },
    collections: 'users, studentProfiles | recruiterProfiles', screen: 'StudentWorkspacePages (profile/settings), RecruiterExtras (company/settings)',
  }),
  E('POST', '/users/me/password', 'Profile', 'auth', 'Change password (revokes all sessions)', {
    spec: false, body: { currentPassword: '{{studentPassword}}', newPassword: 'NewPass123!' }, collections: 'users, sessions', screen: 'StudentWorkspacePages (settings)',
  }),

  // ---------------- Student ----------------
  E('GET', '/students/dashboard', 'Student', 'student', 'Counts and summaries from the database', { collections: 'studentSkills, applications, savedJobs, jobs, resumes, activityLogs', screen: 'pages/StudentDashboard.jsx' }),
  E('GET', '/students/me/skills', 'Student', 'student', 'List my skills', { collections: 'studentSkills', screen: 'pages/MySkills.jsx, SkillGap.jsx, Opportunities.jsx' }),
  E('POST', '/students/me/skills', 'Student', 'student', 'Add a skill', { body: { name: 'TypeScript', category: 'Frontend', level: 60 }, collections: 'skills (resolve/create), studentSkills', screen: 'pages/MySkills.jsx, SkillGap.jsx', status: 201, errors: ['409 DUPLICATE_SKILL'], saveId: 'skillId' }),
  E('PATCH', '/students/me/skills/:skillId', 'Student', 'student', 'Change level/details of my skill', { body: { level: 75 }, collections: 'studentSkills', screen: 'pages/MySkills.jsx', errors: ['403 FORBIDDEN (not owner)'] }),
  E('DELETE', '/students/me/skills/:skillId', 'Student', 'student', 'Remove my skill', { collections: 'studentSkills', screen: 'pages/MySkills.jsx', status: 204 }),
  E('GET', '/students/me/analytics', 'Student', 'student', 'Student statistics', { collections: 'applications, studentSkills, resumes, skillGapAnalyses, savedJobs', screen: 'StudentWorkspacePages (analytics)' }),

  // ---------------- Resumes ----------------
  E('POST', '/resumes/upload', 'Resumes', 'student', 'Upload a PDF/DOCX (multipart field "file", max 8 MB)', { multipart: true, collections: 'resumes, resumes.files/chunks (GridFS)', screen: 'cv/CareerCVPages.jsx', status: 201, errors: ['413 PAYLOAD_TOO_LARGE', '415 UNSUPPORTED_FILE_TYPE', '415 INVALID_FILE_SIGNATURE', '422 NO_TEXT_FOUND'], saveId: 'resumeId' }),
  E('GET', '/resumes', 'Resumes', 'student', 'List my resumes', { collections: 'resumes', screen: 'cv/CareerCVPages.jsx' }),
  E('GET', '/resumes/:id', 'Resumes', 'student', 'Resume metadata (?includeText=true adds extracted text)', { query: { includeText: 'true' }, collections: 'resumes', screen: 'cv/CareerCVPages.jsx' }),
  E('DELETE', '/resumes/:id', 'Resumes', 'student', 'Delete stored resume, its file and analyses', { collections: 'resumes, resumeAnalyses, GridFS', screen: 'cv/CareerCVPages.jsx', status: 204 }),
  E('POST', '/resumes/:id/analyze', 'Resumes', 'student', 'Run the rule-based quality analysis', { body: { targetRole: 'Software Engineer', jobDescription: 'React developer with REST API and testing experience' }, collections: 'resumeAnalyses, resumes.latestScore', screen: 'cv/CareerCVPages.jsx (ResumeAnalyzer)', status: 201 }),
  E('GET', '/resumes/:id/analysis', 'Resumes', 'student', 'Latest analysis (?history=true for all versions)', { collections: 'resumeAnalyses', screen: 'cv/CareerCVPages.jsx (ResumeAnalyzer)' }),
  E('POST', '/resumes/:id/improve', 'Resumes', 'student', 'Generate conservative rule-based wording improvements', { body: { targetRole: 'Software Engineer', level: 'Entry level', industry: 'Technology' }, collections: 'resumeAnalyses, resumes.draft', screen: 'cv/CareerCVPages.jsx (CVImprovement)', status: 201 }),
  E('PATCH', '/resumes/:id/draft', 'Resumes', 'student', 'Save the user-edited draft and settings', { body: { content: 'Edited CV text…', template: 'Minimalist' }, collections: 'resumes.draft', screen: 'cv/CareerCVPages.jsx (CVImprovement)' }),
  E('GET', '/resumes/:id/export', 'Resumes', 'student', 'Download the draft as DOCX or PDF', { query: { format: 'docx' }, binary: true, collections: '—', screen: 'cv/CareerCVPages.jsx (CVImprovement)' }),

  // ---------------- Skill gap & learning ----------------
  E('GET', '/skills', 'Skill gap & learning', 'auth', 'Skill catalog (taxonomy)', { query: { q: 'react' }, collections: 'skills', screen: 'pages/MySkills.jsx (suggestions)' }),
  E('GET', '/skill-gap/roles', 'Skill gap & learning', 'auth', 'Target roles and their skill checklists', { spec: false, collections: '— (versioned role catalog)', screen: 'pages/SkillGap.jsx, MySkills.jsx' }),
  E('POST', '/skill-gap/analyze', 'Skill gap & learning', 'student', 'Compare my skills to a target role', { body: { targetRole: 'MERN Developer' }, collections: 'skillGapAnalyses, studentProfiles.desiredRole', screen: 'pages/SkillGap.jsx, MySkills.jsx', saveId: 'gapId' }),
  E('GET', '/skill-gap/history', 'Skill gap & learning', 'student', 'Past skill-gap results', { collections: 'skillGapAnalyses', screen: 'StudentWorkspacePages (analytics)' }),
  E('GET', '/skill-gap/:id', 'Skill gap & learning', 'student', 'Skill-gap analysis details', { idVar: 'gapId', collections: 'skillGapAnalyses', screen: 'pages/SkillGap.jsx' }),
  E('GET', '/learning/recommendations', 'Skill gap & learning', 'student', 'Prioritised learning items for my target role', { query: { targetRole: 'MERN Developer' }, collections: 'studentSkills, studentProfiles', screen: 'pages/SkillGap.jsx (roadmap)' }),
  E('PATCH', '/learning/plan', 'Skill gap & learning', 'student', 'Add/remove a skill in my learning plan', { spec: false, body: { skill: 'Express.js', inPlan: true }, collections: 'studentProfiles.learningPlan', screen: 'pages/SkillGap.jsx (roadmap)' }),

  // ---------------- Jobs ----------------
  E('GET', '/jobs', 'Jobs', 'auth', 'Search/filter/sort/paginate approved open jobs (students get match scores)', {
    query: { q: 'react', type: 'Internship', mode: 'Remote', sort: 'match', page: '1', limit: '20' }, collections: 'jobs, savedJobs, applications, studentSkills', screen: 'pages/Opportunities.jsx',
  }),
  E('GET', '/jobs/recommended', 'Jobs', 'student', 'Rule-based recommended jobs', { collections: 'jobs, studentSkills', screen: 'pages/StudentDashboard.jsx' }),
  E('GET', '/jobs/saved', 'Jobs', 'student', 'My saved jobs', { collections: 'savedJobs, jobs', screen: 'pages/Opportunities.jsx (?saved=1)' }),
  E('GET', '/jobs/:id', 'Jobs', 'auth', 'Job detail (status-aware access)', { idVar: 'jobId', collections: 'jobs', screen: 'pages/Opportunities.jsx (details modal)' }),
  E('POST', '/jobs', 'Jobs', 'recruiter', 'Create a job (pending until admin approval)', {
    body: { title: 'Frontend Developer Intern', company: 'Demo Recruiting Co.', type: 'Internship', mode: 'Hybrid', location: 'Dhaka', experience: 'Student', pay: '৳18k–25k /mo', deadline: '2026-12-31', description: 'Build responsive interfaces with React and modern CSS alongside our product team.', requirements: ['React', 'JavaScript', 'CSS'], preferredSkills: ['TypeScript'] },
    collections: 'jobs, notifications (admins), activityLogs', screen: 'pages/RecruiterDashboard.jsx (Post opportunities)', status: 201, saveId: 'jobId',
  }),
  E('PATCH', '/jobs/:id', 'Jobs', 'recruiter', 'Edit my job (content edits return it to pending; isActive pauses/resumes)', { idVar: 'jobId', body: { isActive: false }, collections: 'jobs', screen: 'pages/RecruiterDashboard.jsx', errors: ['403 FORBIDDEN (not owner)'] }),
  E('DELETE', '/jobs/:id', 'Jobs', 'recruiter', 'Remove my job (closes its applications)', { idVar: 'jobId', collections: 'jobs, applications, savedJobs, notifications', screen: 'pages/RecruiterDashboard.jsx', status: 204 }),
  E('POST', '/jobs/:id/save', 'Jobs', 'student', 'Save a job (no duplicates)', { idVar: 'jobId', collections: 'savedJobs', screen: 'pages/Opportunities.jsx', status: 201, errors: ['409 ALREADY_SAVED'] }),
  E('DELETE', '/jobs/:id/save', 'Jobs', 'student', 'Unsave a job', { idVar: 'jobId', collections: 'savedJobs', screen: 'pages/Opportunities.jsx' }),

  // ---------------- Applications ----------------
  E('POST', '/applications', 'Applications', 'student', 'Apply to a job (duplicates rejected)', { body: { jobId: '{{jobId}}', resumeId: '{{resumeId}}', coverNote: 'I would love to join your team.' }, collections: 'applications, jobs.applicantCount, notifications', screen: 'pages/Opportunities.jsx (apply modal)', status: 201, errors: ['409 ALREADY_APPLIED', '409 JOB_CLOSED'], saveId: 'applicationId' }),
  E('GET', '/applications/me', 'Applications', 'student', 'My applications', { collections: 'applications, jobs', screen: 'StudentWorkspacePages (applications), Opportunities.jsx' }),
  E('GET', '/applications/:id', 'Applications', 'auth', 'Application detail (student owner or owning recruiter)', { idVar: 'applicationId', collections: 'applications, jobs', screen: 'StudentWorkspacePages (applications)' }),
  E('PATCH', '/applications/:id/withdraw', 'Applications', 'student', 'Withdraw my application', { idVar: 'applicationId', collections: 'applications, jobs.applicantCount, notifications', screen: 'StudentWorkspacePages (applications)', errors: ['409 ALREADY_WITHDRAWN'] }),
  E('PATCH', '/applications/:id/status', 'Applications', 'recruiter', 'Review status transition (job owner)', { idVar: 'applicationId', body: { status: 'shortlisted' }, collections: 'applications, notifications', screen: 'pages/RecruiterDashboard.jsx (Applicant profiles)', errors: ['409 INVALID_TRANSITION', '403 FORBIDDEN (not job owner)'] }),

  // ---------------- Recruiter ----------------
  E('GET', '/recruiter/dashboard', 'Recruiter', 'recruiter', 'My job/applicant counts', { collections: 'jobs, applications', screen: 'pages/RecruiterDashboard.jsx (home)' }),
  E('GET', '/recruiter/jobs', 'Recruiter', 'recruiter', 'My postings (all statuses)', { collections: 'jobs, applications', screen: 'pages/RecruiterDashboard.jsx (Post opportunities)' }),
  E('GET', '/recruiter/jobs/:id/applicants', 'Recruiter', 'recruiter', 'Applicants for one of my jobs', { idVar: 'jobId', collections: 'applications, users, studentProfiles, studentSkills', screen: 'pages/RecruiterDashboard.jsx (Applicant profiles)' }),
  E('GET', '/recruiter/applicants', 'Recruiter', 'recruiter', 'All applicants across my jobs (search/filter)', { spec: false, query: { q: '', status: 'in_review', saved: 'false' }, collections: 'applications, users, studentProfiles, studentSkills', screen: 'pages/RecruiterDashboard.jsx, RecruiterExtras (saved)' }),
  E('GET', '/recruiter/applicants/:id', 'Recruiter', 'recruiter', 'Applicant detail', { idVar: 'applicationId', collections: 'applications, users, studentProfiles, studentSkills, resumes', screen: 'pages/RecruiterDashboard.jsx (profile modal)' }),
  E('PATCH', '/recruiter/applicants/:id/status', 'Recruiter', 'recruiter', 'Review applicant status', { idVar: 'applicationId', body: { status: 'in_review' }, collections: 'applications, notifications', screen: 'pages/RecruiterDashboard.jsx (shortlist/reject)' }),
  E('PATCH', '/recruiter/applicants/:id/save', 'Recruiter', 'recruiter', 'Save/unsave a candidate', { spec: false, idVar: 'applicationId', body: { saved: true }, collections: 'applications.savedByRecruiter', screen: 'RecruiterExtras (Saved candidates)' }),
  E('PUT', '/recruiter/applicants/:id/interview', 'Recruiter', 'recruiter', 'Schedule an interview', { spec: false, idVar: 'applicationId', body: { date: '2026-11-12', time: '10:00', notes: 'Google Meet' }, collections: 'applications, notifications', screen: 'RecruiterExtras (Interviews)' }),
  E('DELETE', '/recruiter/applicants/:id/interview', 'Recruiter', 'recruiter', 'Cancel an interview', { spec: false, idVar: 'applicationId', collections: 'applications, notifications', screen: 'RecruiterExtras (Interviews)' }),
  E('GET', '/recruiter/applicants/:id/resume', 'Recruiter', 'recruiter', 'Download the resume attached to an application', { spec: false, idVar: 'applicationId', binary: true, collections: 'resumes, GridFS', screen: 'pages/RecruiterDashboard.jsx (profile modal)' }),
  E('GET', '/recruiter/interviews', 'Recruiter', 'recruiter', 'My scheduled interviews', { spec: false, collections: 'applications', screen: 'RecruiterExtras (Interviews)' }),
  E('GET', '/recruiter/analytics', 'Recruiter', 'recruiter', 'My recruitment metrics', { collections: 'jobs, applications', screen: 'RecruiterExtras (Hiring analytics)' }),

  // ---------------- Admin ----------------
  E('GET', '/admin/dashboard', 'Admin', 'admin', 'Global metrics', { collections: 'users, jobs, applications, activityLogs', screen: 'admin/AdminDashboard.jsx (overview)' }),
  E('GET', '/admin/users', 'Admin', 'admin', 'Paginated users', { query: { role: 'student', q: '', page: '1', limit: '25' }, collections: 'users, studentSkills', screen: 'admin/AdminDashboard.jsx (users)' }),
  E('GET', '/admin/users/:id', 'Admin', 'admin', 'User detail', { idVar: 'targetUserId', collections: 'users, profiles, studentSkills, applications, resumes, activityLogs', screen: 'admin/AdminDashboard.jsx (user modal)' }),
  E('PATCH', '/admin/users/:id/status', 'Admin', 'admin', 'Suspend/activate a user', { idVar: 'targetUserId', body: { status: 'suspended', reason: 'Policy violation' }, collections: 'users, sessions, activityLogs', screen: 'admin/AdminDashboard.jsx (users)' }),
  E('GET', '/admin/jobs', 'Admin', 'admin', 'Jobs for moderation', { query: { status: 'pending' }, collections: 'jobs', screen: 'admin/AdminDashboard.jsx (jobs/approvals)' }),
  E('PATCH', '/admin/jobs/:id/approve', 'Admin', 'admin', 'Approve a job', { idVar: 'jobId', collections: 'jobs, notifications, activityLogs', screen: 'admin/AdminDashboard.jsx (approvals)' }),
  E('PATCH', '/admin/jobs/:id/reject', 'Admin', 'admin', 'Reject a job with a reason', { idVar: 'jobId', body: { reason: 'Please add salary information.' }, collections: 'jobs, notifications, activityLogs', screen: 'admin/AdminDashboard.jsx (approvals)' }),
  E('GET', '/admin/analytics', 'Admin', 'admin', 'Platform analytics', { collections: 'users, jobs, applications, studentSkills, resumes', screen: 'admin/AdminDashboard.jsx (analytics)' }),
  E('GET', '/admin/activity-logs', 'Admin', 'admin', 'Moderation/audit events', { collections: 'activityLogs', screen: 'admin/AdminDashboard.jsx (activity)' }),

  // ---------------- Notifications ----------------
  E('GET', '/notifications', 'Notifications', 'auth', 'My notifications', { spec: false, collections: 'notifications', screen: 'StudentWorkspacePages (notifications), RecruiterExtras (notifications), top bars' }),
  E('PATCH', '/notifications/read-all', 'Notifications', 'auth', 'Mark all as read', { spec: false, collections: 'notifications', screen: 'Notifications pages' }),
  E('PATCH', '/notifications/:id/read', 'Notifications', 'auth', 'Mark one read/unread', { spec: false, idVar: 'notificationId', body: { read: true }, collections: 'notifications', screen: 'StudentWorkspacePages (notifications)' }),

  // ---------------- System ----------------
  E('GET', '/health', 'System', 'public', 'Health/status (no secrets)', { collections: '—', screen: 'Render health check' }),
  E('GET', '/api-docs', 'System', 'public', 'Swagger/OpenAPI explorer', { collections: '—', screen: 'Browser', noPostman: true }),
];
