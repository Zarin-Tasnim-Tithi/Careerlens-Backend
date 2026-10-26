const mongoose = require('mongoose');
const toJSON = require('./plugins');

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Student bookmarks. Unique per (student, job).
const savedJobSchema = new mongoose.Schema({
  studentId: { type: ObjectId, ref: 'User', required: true },
  jobId: { type: ObjectId, ref: 'Job', required: true },
}, { timestamps: true });
savedJobSchema.index({ studentId: 1, jobId: 1 }, { unique: true });
savedJobSchema.plugin(toJSON);

// Stored skill-gap results, so students can review history.
const skillGapAnalysisSchema = new mongoose.Schema({
  studentId: { type: ObjectId, ref: 'User', required: true, index: true },
  targetRole: { type: String, required: true },
  scoringVersion: { type: String, required: true },
  snapshot: { type: [{ _id: false, name: String, level: Number }], default: [] }, // student's skills at analysis time
  items: { type: Mixed, default: [] },
  matchedSkills: { type: [String], default: [] },
  missingSkills: { type: [String], default: [] },
  improveSkills: { type: [String], default: [] },
  score: { type: Number, min: 0, max: 100 },        // weighted readiness
  readiness: { type: Number, min: 0, max: 100 },    // simple average of levels
  coverage: { type: Number, min: 0, max: 100 },
}, { timestamps: true });
skillGapAnalysisSchema.plugin(toJSON);

const notificationSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true }, // e.g. application.received, application.status, job.approved
  title: { type: String, required: true, maxlength: 140 },
  body: { type: String, maxlength: 400, default: '' },
  link: { type: String, maxlength: 200, default: '' },
  details: { type: Mixed },
  readAt: { type: Date, default: null },
}, { timestamps: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.plugin(toJSON);

// Audit trail for moderation and key platform events.
const activityLogSchema = new mongoose.Schema({
  actorId: { type: ObjectId, ref: 'User' },
  actorRole: { type: String },
  action: { type: String, required: true, index: true }, // e.g. user.registered, job.approved
  targetType: { type: String },
  targetId: { type: ObjectId },
  summary: { type: String, maxlength: 200 },
  details: { type: Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actorId: 1, createdAt: -1 });
activityLogSchema.plugin(toJSON);

// Refresh-token sessions (only a SHA-256 hash of the token is stored).
const sessionSchema = new mongoose.Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: String, default: null },
  userAgent: { type: String, maxlength: 200 },
  ip: { type: String, maxlength: 64 },
}, { timestamps: true });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.plugin(toJSON);

module.exports = {
  SavedJob: mongoose.model('SavedJob', savedJobSchema, 'savedJobs'),
  SkillGapAnalysis: mongoose.model('SkillGapAnalysis', skillGapAnalysisSchema, 'skillGapAnalyses'),
  Notification: mongoose.model('Notification', notificationSchema, 'notifications'),
  ActivityLog: mongoose.model('ActivityLog', activityLogSchema, 'activityLogs'),
  Session: mongoose.model('Session', sessionSchema, 'sessions'),
};
