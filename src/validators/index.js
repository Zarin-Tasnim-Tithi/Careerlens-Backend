// Request validation schemas (zod). Unknown fields are stripped, so clients cannot set protected fields
// such as role, status, recruiterId or passwordHash through these endpoints.
const { z } = require('zod');
const { SKILL_CATEGORIES } = require('../models/Skill');
const { JOB_TYPES, WORK_MODES, EXPERIENCE } = require('../models/Job');
const { roleNames } = require('../services/scoring');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const idParam = z.object({ id: objectId });
const trimmed = (max) => z.string().trim().max(max);
const email = z.string().trim().toLowerCase().max(120).email('Enter a valid email address');
const password = z.string().min(8, 'Use at least 8 characters').max(128)
  .regex(/[A-Za-z]/, 'Password must include a letter').regex(/\d/, 'Password must include a number');
const paging = { page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).optional() };
const skillList = z.union([z.array(trimmed(42)), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().min(1).max(42)).max(20));
const stringList = (maxItems, maxLen) => z.array(trimmed(maxLen).min(1)).max(maxItems);

const auth = {
  register: z.object({
    name: trimmed(80).min(2, 'Please enter your full name'),
    email,
    password,
    role: z.enum(['student', 'recruiter'], { message: 'Role must be student or recruiter' }),
    university: trimmed(120).optional(),
    companyName: trimmed(120).optional(),
  }),
  login: z.object({
    email,
    password: z.string().min(1, 'Please enter your password').max(128),
    role: z.enum(['student', 'recruiter', 'admin']).optional(),
  }),
  forgot: z.object({ email }),
  reset: z.object({ token: z.string().min(20).max(200), password }),
  changePassword: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }),
};

const users = {
  updateMe: z.object({
    name: trimmed(80).min(2).optional(),
    preferences: z.object({
      emailNotifications: z.boolean().optional(),
      careerUpdates: z.boolean().optional(),
      inAppAlerts: z.boolean().optional(),
      weeklyDigest: z.boolean().optional(),
    }).optional(),
    studentProfile: z.object({
      university: trimmed(120).optional(),
      education: trimmed(160).optional(),
      major: trimmed(120).optional(),
      desiredRole: trimmed(80).optional(),
      bio: trimmed(600).optional(),
      links: z.object({ linkedin: trimmed(200).optional(), github: trimmed(200).optional(), portfolio: trimmed(200).optional() }).optional(),
    }).optional(),
    recruiterProfile: z.object({
      companyName: trimmed(120).optional(),
      contactEmail: z.union([email, z.literal('')]).optional(),
      industry: trimmed(80).optional(),
      description: trimmed(1000).optional(),
    }).optional(),
  }),
};

const skills = {
  create: z.object({
    name: trimmed(42).min(1, 'Please enter a skill name'),
    category: z.enum(SKILL_CATEGORIES).optional(),
    level: z.coerce.number().int().min(1).max(100),
    tint: trimmed(12).optional(),
  }),
  update: z.object({
    name: trimmed(42).min(1).optional(),
    category: z.enum(SKILL_CATEGORIES).optional(),
    level: z.coerce.number().int().min(1).max(100).optional(),
    tint: trimmed(12).optional(),
  }).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
  params: z.object({ skillId: objectId }),
  catalogQuery: z.object({ q: trimmed(42).optional(), category: z.enum(SKILL_CATEGORIES).optional() }),
};

const skillGap = {
  analyze: z.object({
    targetRole: z.string().refine((r) => roleNames().includes(r), { message: `targetRole must be one of: ${roleNames().join(', ')}` }),
    // Optional explicit skills (e.g. for what-if checks). Defaults to the student's saved skills.
    currentSkills: z.array(z.union([trimmed(42), z.object({ name: trimmed(42), level: z.coerce.number().min(0).max(100).optional() })])).max(60).optional(),
    save: z.boolean().optional(),
  }),
  learningToggle: z.object({ skill: trimmed(42).min(1), inPlan: z.boolean() }),
  recommendationsQuery: z.object({ targetRole: z.string().optional() }),
};

const jobBase = {
  title: trimmed(120).min(3, 'Job title is required'),
  company: trimmed(120).min(1, 'Company name is required'),
  type: z.enum(JOB_TYPES).optional(),
  mode: z.enum(WORK_MODES).optional(),
  location: trimmed(120).min(2, 'Location is required'),
  experience: z.enum(EXPERIENCE).optional(),
  pay: trimmed(60).optional(),
  deadline: z.coerce.date().optional(),
  summary: trimmed(300).optional(),
  description: trimmed(5000).min(20, 'Please describe the role (at least 20 characters)'),
  requirements: skillList.optional(),
  preferredSkills: skillList.optional(),
  responsibilities: stringList(15, 200).optional(),
  benefits: stringList(10, 80).optional(),
};
const jobs = {
  create: z.object(jobBase),
  update: z.object({ ...Object.fromEntries(Object.entries(jobBase).map(([k, v]) => [k, v.optional()])), isActive: z.boolean().optional() })
    .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
  list: z.object({
    ...paging,
    q: trimmed(80).optional(),
    type: z.union([z.enum(JOB_TYPES), z.array(z.enum(JOB_TYPES))]).optional(),
    mode: z.union([z.enum(WORK_MODES), z.array(z.enum(WORK_MODES))]).optional(),
    location: trimmed(120).optional(),
    experience: z.enum(EXPERIENCE).optional(),
    skill: trimmed(42).optional(),
    deadlineWithin: z.coerce.number().int().min(1).max(365).optional(),
    minMatch: z.coerce.number().min(0).max(100).optional(),
    sort: z.enum(['match', 'latest', 'deadline']).optional(),
  }),
};

const applications = {
  create: z.object({ jobId: objectId, resumeId: objectId.optional(), coverNote: trimmed(1500).optional() }),
  status: z.object({ status: z.enum(['in_review', 'shortlisted', 'interview', 'offered', 'rejected']), note: trimmed(300).optional() }),
  listMine: z.object({ ...paging, status: z.string().optional() }),
};

const recruiter = {
  applicantsQuery: z.object({ ...paging, q: trimmed(80).optional(), jobId: objectId.optional(), status: z.string().optional(), saved: z.enum(['true', 'false']).optional() }),
  interview: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
    notes: trimmed(300).optional(),
  }),
  save: z.object({ saved: z.boolean() }),
};

const admin = {
  usersQuery: z.object({ ...paging, q: trimmed(80).optional(), role: z.enum(['student', 'recruiter', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional() }),
  userStatus: z.object({ status: z.enum(['active', 'suspended']), reason: trimmed(300).optional() }),
  jobsQuery: z.object({ ...paging, q: trimmed(80).optional(), status: z.enum(['pending', 'approved', 'rejected']).optional() }),
  reject: z.object({ reason: trimmed(500).min(3, 'Please give a reason for rejecting this job') }),
  logsQuery: z.object({ ...paging, action: trimmed(60).optional() }),
};

const resumes = {
  analyze: z.object({ targetRole: trimmed(80).optional(), jobDescription: trimmed(8000).optional() }),
  improve: z.object({
    targetRole: trimmed(80).optional(),
    level: trimmed(40).optional(),
    industry: trimmed(80).optional(),
    sourceText: trimmed(50000).optional(), // student-edited original text (optional)
  }),
  draft: z.object({
    content: z.string().max(60000).optional(),
    sourceText: z.string().max(60000).optional(),
    role: trimmed(80).optional(),
    industry: trimmed(80).optional(),
    level: trimmed(40).optional(),
    language: trimmed(40).optional(),
    jobDescription: trimmed(8000).optional(),
    template: z.enum(['Modern Professional', 'Minimalist', 'Corporate', 'Creative']).optional(),
  }),
  exportQuery: z.object({ format: z.enum(['docx', 'pdf']).default('docx'), source: z.enum(['draft', 'original']).default('draft') }),
};

const notifications = { list: z.object({ ...paging, unread: z.enum(['true', 'false']).optional() }) };

module.exports = { z, objectId, idParam, auth, users, skills, skillGap, jobs, applications, recruiter, admin, resumes, notifications };
