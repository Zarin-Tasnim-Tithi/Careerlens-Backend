// Consistent success envelope: { success: true, message?, data, meta? }
function ok(res, data, { status = 200, message, meta } = {}) {
  const body = { success: true };
  if (message) body.message = message;
  body.data = data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

const created = (res, data, message) => ok(res, data, { status: 201, message });

module.exports = { ok, created };
