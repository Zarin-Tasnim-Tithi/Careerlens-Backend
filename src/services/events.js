// Notifications (per-user inbox) and activity logs (audit trail). Failures here never break the main request.
const { Notification, ActivityLog } = require('../models');
const env = require('../config/env');

async function notify(userId, { type, title, body = '', link = '', details }) {
  try { await Notification.create({ userId, type, title, body, link, details }); } catch (err) {
    if (!env.isTest) console.warn('[notify] failed', err.message);
  }
}

async function logActivity(actor, action, { targetType, targetId, summary, details } = {}) {
  try {
    await ActivityLog.create({
      actorId: actor?._id || actor?.id, actorRole: actor?.role, action, targetType, targetId, summary, details,
    });
  } catch (err) {
    if (!env.isTest) console.warn('[activity] failed', err.message);
  }
}

module.exports = { notify, logActivity };
