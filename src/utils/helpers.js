const mongoose = require('mongoose');
const ApiError = require('./ApiError');

/** Canonical skill key: "Node.js" -> "nodejs", "Git & GitHub" -> "gitgithub". */
const normalizeKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
  return id;
}

/** Parse ?page=&limit= with sane bounds. */
function pagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

const pageMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

const initialsOf = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const TONES = ['mint', 'violet', 'sky', 'peach', 'amber', 'indigo']; // match the frontend's avatar colour classes
const toneFor = (seed = '') => TONES[[...String(seed)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

const dayDiff = (from, to = new Date()) => Math.round((new Date(from).getTime() - new Date(to).getTime()) / 86400000);

module.exports = { normalizeKey, escapeRegex, assertObjectId, pagination, pageMeta, initialsOf, toneFor, dayDiff };
