const mongoose = require('mongoose');
const toJSON = require('./plugins');

const { ObjectId } = mongoose.Schema.Types;

// One profile per student account.
const studentProfileSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User', required: true, unique: true },
  university: { type: String, trim: true, maxlength: 120, default: '' },
  education: { type: String, trim: true, maxlength: 160, default: '' }, // e.g. "BSc in CSE · 4th year"
  major: { type: String, trim: true, maxlength: 120, default: '' },
  desiredRole: { type: String, trim: true, maxlength: 80, default: 'MERN Developer' },
  bio: { type: String, trim: true, maxlength: 600, default: '' },
  links: {
    linkedin: { type: String, trim: true, maxlength: 200, default: '' },
    github: { type: String, trim: true, maxlength: 200, default: '' },
    portfolio: { type: String, trim: true, maxlength: 200, default: '' },
  },
  // Skill-gap learning plan: normalized skill keys the student marked "added to learning plan".
  learningPlan: { type: [String], default: [] },
}, { timestamps: true });
studentProfileSchema.plugin(toJSON);

// One profile per recruiter account (company identity shown on job posts).
const recruiterProfileSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User', required: true, unique: true },
  companyName: { type: String, trim: true, maxlength: 120, default: '' },
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
  industry: { type: String, trim: true, maxlength: 80, default: '' },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
}, { timestamps: true });
recruiterProfileSchema.plugin(toJSON);

module.exports = {
  StudentProfile: mongoose.model('StudentProfile', studentProfileSchema, 'studentProfiles'),
  RecruiterProfile: mongoose.model('RecruiterProfile', recruiterProfileSchema, 'recruiterProfiles'),
};
