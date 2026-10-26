const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/respond');
const { User, StudentProfile, RecruiterProfile, Session } = require('../models');
const { REFRESH_COOKIE, sha256, issueTokens, clearRefreshCookie } = require('../services/tokens');
const { notify, logActivity } = require('../services/events');

const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt });
// Pre-computed hash used to keep login timing similar for unknown emails.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-placeholder-1', 4);

exports.register = async (req, res) => {
  const { name, email, password, role, university, companyName } = req.body;
  if (await User.exists({ email })) throw ApiError.conflict('This email is already registered.', 'EMAIL_TAKEN');

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  let user;
  try {
    user = await User.create({ name, email, passwordHash, role });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This email is already registered.', 'EMAIL_TAKEN');
    throw err;
  }
  if (role === 'student') await StudentProfile.create({ userId: user._id, university: university || '' });
  else await RecruiterProfile.create({ userId: user._id, companyName: companyName || '', contactEmail: email });

  await notify(user._id, {
    type: 'welcome',
    title: 'Welcome to CareerLens!',
    body: role === 'student' ? 'Add your skills and upload a resume to get started.' : 'Complete your company profile and post your first opportunity.',
    link: role === 'student' ? '/my-skills' : '/recruiter/company',
  });
  await logActivity(user, 'user.registered', { targetType: 'User', targetId: user._id, summary: `${user.name} registered as ${role}` });

  const tokens = await issueTokens(user, req, res);
  return created(res, { user: publicUser(user), ...tokens }, 'Registration successful');
};

exports.login = async (req, res) => {
  const { email, password, role } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact the CareerLens administrator.');
  if (role && role !== user.role) throw new ApiError(403, 'ROLE_MISMATCH', `This account belongs to a ${user.role}. Select the correct role.`);

  user.lastLoginAt = new Date();
  await user.save();
  const tokens = await issueTokens(user, req, res);
  return ok(res, { user: publicUser(user), ...tokens }, { message: 'Login successful' });
};

exports.refresh = async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new ApiError(401, 'NO_REFRESH_TOKEN', 'No active session');

  const session = await Session.findOne({ tokenHash: sha256(token) });
  if (!session || session.expiresAt < new Date()) {
    clearRefreshCookie(res);
    throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  // Short grace period for concurrent refreshes (two tabs, or a page reload racing a refresh).
  const inGrace = session.revokedAt && session.replacedBy === 'rotated' && Date.now() - session.revokedAt.getTime() < 30000;
  if (session.revokedAt && !inGrace) {
    // A rotated token was presented again: possible theft. Revoke every session for this user.
    await Session.updateMany({ userId: session.userId, revokedAt: null }, { revokedAt: new Date() });
    clearRefreshCookie(res);
    throw new ApiError(401, 'SESSION_REVOKED', 'Session is no longer valid. Please sign in again.');
  }
  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') {
    session.revokedAt = new Date(); await session.save();
    clearRefreshCookie(res);
    throw new ApiError(401, 'SESSION_REVOKED', 'Session is no longer valid. Please sign in again.');
  }

  const tokens = await issueTokens(user, req, res);
  if (!session.revokedAt) {
    session.revokedAt = new Date();
    session.replacedBy = 'rotated';
    await session.save();
  }
  return ok(res, { user: publicUser(user), ...tokens });
};

exports.logout = async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) await Session.updateOne({ tokenHash: sha256(token), revokedAt: null }, { revokedAt: new Date() });
  clearRefreshCookie(res);
  return ok(res, null, { message: 'Logged out' });
};

exports.me = async (req, res) => ok(res, { user: publicUser(req.user) });

exports.forgotPassword = async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  const message = 'If an account exists for that email, a password reset link has been issued.';
  const data = {};
  if (user && user.status === 'active') {
    const token = crypto.randomBytes(32).toString('base64url');
    user.passwordReset = { tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60000) };
    await user.save();
    await logActivity(user, 'auth.password_reset_requested', { targetType: 'User', targetId: user._id });
    // No email provider is configured (out of scope). In development/demo the token is returned so the flow can be tested.
    if (env.EXPOSE_RESET_TOKEN) { data.resetToken = token; data.expiresInMinutes = 30; }
    else if (!env.isTest) console.log(`[auth] Password reset token for ${user.email}: ${token}`);
  }
  return ok(res, data, { message });
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  const user = await User.findOne({ 'passwordReset.tokenHash': sha256(token) }).select('+passwordReset.tokenHash +passwordReset.expiresAt');
  if (!user || !user.passwordReset?.expiresAt || user.passwordReset.expiresAt < new Date()) {
    throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  }
  user.passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  user.passwordReset = { tokenHash: undefined, expiresAt: undefined };
  user.passwordChangedAt = new Date();
  await user.save();
  await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });
  await logActivity(user, 'auth.password_reset', { targetType: 'User', targetId: user._id });
  return ok(res, null, { message: 'Password updated. Please sign in with your new password.' });
};

exports.publicUser = publicUser;
