const { Skill, StudentSkill } = require('../models');
const { normalizeKey } = require('../utils/helpers');

const CATEGORY_GUESS = {
  Frontend: ['react', 'html', 'css', 'typescript', 'figma', 'vue', 'angular', 'tailwind'],
  Backend: ['nodejs', 'expressjs', 'restapi', 'authentication', 'deployment', 'docker', 'testing', 'django', 'flask'],
  Database: ['mongodb', 'sql', 'powerbi', 'postgresql', 'mysql', 'redis'],
};

function guessCategory(name) {
  const key = normalizeKey(name);
  for (const [category, keys] of Object.entries(CATEGORY_GUESS)) if (keys.includes(key)) return category;
  return 'Tools';
}

/** Resolve a free-text skill name to the canonical catalog entry, creating a user-sourced entry if needed. */
async function resolveSkill(name, category) {
  const key = normalizeKey(name);
  let skill = await Skill.findOne({ $or: [{ key }, { aliases: key }] });
  if (!skill) {
    try {
      skill = await Skill.create({ name: name.trim(), key, category: category || guessCategory(name), source: 'user' });
    } catch (err) {
      if (err.code === 11000) skill = await Skill.findOne({ key });
      else throw err;
    }
  }
  return skill;
}

const studentSkillsOf = (studentId) => StudentSkill.find({ studentId }).sort({ level: -1, name: 1 }).lean();

module.exports = { resolveSkill, studentSkillsOf, guessCategory };
