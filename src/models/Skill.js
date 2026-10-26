const mongoose = require('mongoose');
const toJSON = require('./plugins');

const { ObjectId } = mongoose.Schema.Types;
const CATEGORIES = ['Programming', 'Frontend', 'Backend', 'Database', 'Tools', 'Soft Skills', 'Data', 'Design', 'Other'];

// Canonical skill catalog (taxonomy). `key` is the normalized name used for matching.
const skillSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 42 },
  key: { type: String, required: true, unique: true },
  category: { type: String, enum: CATEGORIES, default: 'Other' },
  aliases: { type: [String], default: [] },
  source: { type: String, enum: ['catalog', 'user'], default: 'catalog' },
}, { timestamps: true });
skillSchema.plugin(toJSON);
skillSchema.statics.CATEGORIES = CATEGORIES;

// A student's self-assessed skill. Unique per (student, skill).
const studentSkillSchema = new mongoose.Schema({
  studentId: { type: ObjectId, ref: 'User', required: true, index: true },
  skillId: { type: ObjectId, ref: 'Skill', required: true },
  name: { type: String, required: true, trim: true, maxlength: 42 }, // denormalised display name
  key: { type: String, required: true },
  category: { type: String, enum: CATEGORIES, default: 'Other' },
  level: { type: Number, required: true, min: 1, max: 100 },
  tint: { type: String, default: 'blue', maxlength: 12 },
}, { timestamps: true });
studentSkillSchema.index({ studentId: 1, skillId: 1 }, { unique: true });
studentSkillSchema.plugin(toJSON);

module.exports = {
  Skill: mongoose.model('Skill', skillSchema, 'skills'),
  StudentSkill: mongoose.model('StudentSkill', studentSkillSchema, 'studentSkills'),
  SKILL_CATEGORIES: CATEGORIES,
};
