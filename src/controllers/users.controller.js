const bcrypt = require('bcryptjs');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/respond');
const { User, StudentProfile, RecruiterProfile, Session } = require('../models');
const { publicUser } = require('./auth.controller');
const { logActivity } = require('../services/events');

async function loadProfile(user) {
  if (user.role === 'student') {
    return { studentProfile: await StudentProfile.findOneAndUpdate({ userId: user._id }, { $setOnInsert: { userId: user._id } }, { upsert: true, returnDocument: 'after' }) };
  }
  if (user.role === 'recruiter') {
    return { recruiterProfile: await RecruiterProfile.findOneAndUpdate({ userId: user._id }, { $setOnInsert: { userId: user._id, contactEmail: user.email } }, { upsert: true, returnDocument: 'after' }) };
  }
  return {};
}

const flatten = (prefix, obj) => Object.fromEntries(Object.entries(obj).flatMap(([k, v]) => (
  v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(flatten(`${prefix}${k}.`, v)) : [[`${prefix}${k}`, v]]
)));

exports.getMe = async (req, res) => {
  const profile = await loadProfile(req.user);
  return ok(res, { user: { ...publicUser(req.user), preferences: req.user.preferences, lastLoginAt: req.user.lastLoginAt }, ...profile });
};

exports.updateMe = async (req, res) => {
  const { name, preferences, studentProfile, recruiterProfile } = req.body;
  const user = req.user;
  if (studentProfile && user.role !== 'student') throw ApiError.forbidden('Only students have a student profile');
  if (recruiterProfile && user.role !== 'recruiter') throw ApiError.forbidden('Only recruiters have a company profile');

  if (name) user.name = name;
  if (preferences) Object.assign(user.preferences, preferences);
  await user.save();

  if (studentProfile && Object.keys(studentProfile).length) {
    await StudentProfile.updateOne({ userId: user._id }, { $set: flatten('', studentProfile) }, { upsert: true, runValidators: true });
  }
  if (recruiterProfile && Object.keys(recruiterProfile).length) {
    await RecruiterProfile.updateOne({ userId: user._id }, { $set: recruiterProfile }, { upsert: true, runValidators: true });
  }
  await logActivity(user, 'user.profile_updated', { targetType: 'User', targetId: user._id, summary: 'Profile updated' });
  const profile = await loadProfile(user);
  return ok(res, { user: { ...publicUser(user), preferences: user.preferences }, ...profile }, { message: 'Profile saved successfully' });
};

exports.changePassword = async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
    throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, env.BCRYPT_ROUNDS);
  user.passwordChangedAt = new Date();
  await user.save();
  await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await logActivity(user, 'auth.password_changed', { targetType: 'User', targetId: user._id });
  return ok(res, null, { message: 'Password changed. Please sign in again.' });
};

exports.loadProfile = loadProfile;
