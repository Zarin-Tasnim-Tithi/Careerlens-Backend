const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/respond');
const { Notification } = require('../models');
const { assertObjectId, pagination, pageMeta } = require('../utils/helpers');

const out = (n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, read: Boolean(n.readAt), readAt: n.readAt, createdAt: n.createdAt });

exports.list = async (req, res) => {
  const { page, limit, skip } = pagination(req.valid.query, { defaultLimit: 30 });
  const filter = { userId: req.user._id };
  if (req.valid.query.unread === 'true') filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.user._id, readAt: null }),
  ]);
  return ok(res, { items: items.map(out), unread }, { meta: pageMeta(page, limit, total) });
};

exports.setRead = async (req, res) => {
  assertObjectId(req.params.id, 'Notification');
  const n = await Notification.findById(req.params.id);
  if (!n) throw ApiError.notFound('Notification not found');
  if (String(n.userId) !== String(req.user._id)) throw ApiError.forbidden('You can only update your own notifications');
  n.readAt = req.body?.read === false ? null : new Date();
  await n.save();
  return ok(res, { notification: out(n) });
};

exports.readAll = async (req, res) => {
  const result = await Notification.updateMany({ userId: req.user._id, readAt: null }, { readAt: new Date() });
  return ok(res, { updated: result.modifiedCount }, { message: 'All notifications marked as read' });
};
