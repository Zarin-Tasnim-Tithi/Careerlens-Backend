const mongoose = require('mongoose');
const toJSON = require('./plugins');

const { ObjectId } = mongoose.Schema.Types;
const STATUSES = ['applied', 'in_review', 'shortlisted', 'interview', 'offered', 'rejected', 'withdrawn'];

// Allowed recruiter-driven transitions. "in_review" is the neutral state used to undo a shortlist/reject.
const TRANSITIONS = {
  applied: ['in_review', 'shortlisted', 'interview', 'rejected'],
  in_review: ['shortlisted', 'interview', 'rejected'],
  shortlisted: ['in_review', 'interview', 'offered', 'rejected'],
  interview: ['shortlisted', 'offered', 'rejected'],
  offered: ['rejected'],
  rejected: ['in_review'],
  withdrawn: [],
};

const applicationSchema = new mongoose.Schema({
  jobId: { type: ObjectId, ref: 'Job', required: true },
  studentId: { type: ObjectId, ref: 'User', required: true, index: true },
  recruiterId: { type: ObjectId, ref: 'User', required: true, index: true }, // denormalised job owner
  resumeId: { type: ObjectId, ref: 'Resume' },
  coverNote: { type: String, trim: true, maxlength: 1500, default: '' },
  status: { type: String, enum: STATUSES, default: 'applied', index: true },
  statusHistory: [{
    _id: false,
    status: { type: String, enum: STATUSES },
    at: { type: Date, default: Date.now },
    by: { type: ObjectId, ref: 'User' },
    note: { type: String, maxlength: 300 },
  }],
  matchScore: { type: Number, min: 0, max: 100, default: 0 }, // rule-based skill match at time of applying
  savedByRecruiter: { type: Boolean, default: false },
  interview: {
    date: { type: String, default: '' }, // YYYY-MM-DD
    time: { type: String, default: '' }, // HH:mm
    notes: { type: String, maxlength: 300, default: '' },
  },
  appliedAt: { type: Date, default: Date.now },
}, { timestamps: true });

applicationSchema.index({ jobId: 1, studentId: 1 }, { unique: true });
applicationSchema.plugin(toJSON);

module.exports = mongoose.model('Application', applicationSchema, 'applications');
module.exports.STATUSES = STATUSES;
module.exports.TRANSITIONS = TRANSITIONS;
