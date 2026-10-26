// Shared schema plugin: expose `id` instead of `_id`, hide `__v`.
module.exports = function toJSONPlugin(schema) {
  const transform = (_doc, ret) => {
    if (ret._id !== undefined) { ret.id = String(ret._id); delete ret._id; }
    delete ret.__v;
    return ret;
  };
  schema.set('toJSON', { virtuals: false, transform });
  schema.set('toObject', { virtuals: false, transform });
};
