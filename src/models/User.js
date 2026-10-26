const mongoose = require('mongoose');
const toJSON = require('./plugins');

const ROLES = ['student', 'recruiter', 'admin'];
const STATUSES = ['active', 'suspended'];

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true, index: true },
  status: { type: String, enum: STATUSES, default: 'active', index: true },
  passwordChangedAt: { type: Date },
  passwordReset: {
    tokenHash: { type: String, select: false },
    expiresAt: { type: Date, select: false },
  },
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    careerUpdates: { type: Boolean, default: true },
    inAppAlerts: { type: Boolean, default: true },
    weeklyDigest: { type: Boolean, default: false },
  },
  lastLoginAt: { type: Date },
}, { timestamps: true });

userSchema.plugin(toJSON);
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = String(ret._id); delete ret._id; delete ret.__v;
    delete ret.passwordHash; delete ret.passwordReset;
    return ret;
  },
});

userSchema.statics.ROLES = ROLES;
userSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('User', userSchema);
