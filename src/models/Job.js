const mongoose = require('mongoose');
const toJSON = require('./plugins');

const { ObjectId } = mongoose.Schema.Types;
const JOB_TYPES = ['Internship', 'Full-time', 'Part-time', 'Contract'];
const WORK_MODES = ['Remote', 'Hybrid', 'On-site'];
const EXPERIENCE = ['Student', 'Fresh graduate', '1–2 years', '3+ years'];
const MODERATION = ['pending', 'approved', 'rejected'];

const jobSchema = new mongoose.Schema({
  recruiterId: { type: ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  company: { type: String, required: true, trim: true, maxlength: 120 },
  type: { type: String, enum: JOB_TYPES, default: 'Full-time' },
  mode: { type: String, enum: WORK_MODES, default: 'On-site' },
  location: { type: String, required: true, trim: true, maxlength: 120 },
  experience: { type: String, enum: EXPERIENCE, default: 'Fresh graduate' },
  pay: { type: String, trim: true, maxlength: 60, default: '' },
  deadline: { type: Date, required: true },
  summary: { type: String, trim: true, maxlength: 300, default: '' },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  requirements: { type: [String], default: [] }, // required skills (display names)
  preferredSkills: { type: [String], default: [] },
  responsibilities: { type: [String], default: [] },
  benefits: { type: [String], default: [] },
  featured: { type: Boolean, default: false },
  // Moderation (admin) and listing visibility (recruiter pause/resume) are separate concerns.
  status: { type: String, enum: MODERATION, default: 'pending' },
  isActive: { type: Boolean, default: true },
  rejectionReason: { type: String, trim: true, maxlength: 500, default: '' },
  reviewedBy: { type: ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  applicantCount: { type: Number, default: 0 },
}, { timestamps: true });

jobSchema.index({ status: 1, isActive: 1, deadline: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.plugin(toJSON);

module.exports = mongoose.model('Job', jobSchema, 'jobs');
module.exports.JOB_TYPES = JOB_TYPES;
module.exports.WORK_MODES = WORK_MODES;
module.exports.EXPERIENCE = EXPERIENCE;
module.exports.MODERATION = MODERATION;
