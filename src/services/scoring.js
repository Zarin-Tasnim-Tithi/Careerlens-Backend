/**
 * Transparent, deterministic scoring rules (no AI, no hiring prediction).
 * Every formula here is documented in docs/SCORING.md.
 */
const roles = require('../data/careerRoles.json');
const { normalizeKey } = require('../utils/helpers');

const SKILL_GAP_VERSION = 'skill-gap-rules-v1';
const JOB_MATCH_VERSION = 'job-match-rules-v1';
const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };
const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
const READY_THRESHOLD = 70; // self-rated level at/above which a required skill counts as "on track"

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const lookupOf = (skills) => new Map(skills.map((s) => [normalizeKey(s.name), clamp(Number(s.level) || 0)]));

/**
 * Skill gap for a target role.
 *  - state: missing (not on profile), improve (< 70%), ready (>= 70%)
 *  - readiness  = average self-rated level over all role skills (missing = 0)  [matches the existing UI]
 *  - coverage   = % of role skills present on the profile
 *  - score      = priority-weighted readiness: Σ(weight × level) / Σ(weight × 100), weights High 3 / Medium 2 / Low 1
 */
function analyzeSkillGap(targetRole, studentSkills) {
  const role = roles[targetRole];
  if (!role) return null;
  const lookup = lookupOf(studentSkills);
  const items = role.skills.map(({ name, priority, summary, steps }) => {
    const key = normalizeKey(name);
    const present = lookup.has(key);
    const level = present ? lookup.get(key) : 0;
    return { name, key, priority, summary, steps, level, state: !present ? 'missing' : level >= READY_THRESHOLD ? 'ready' : 'improve' };
  });
  const have = items.filter((i) => i.state !== 'missing');
  const weightTotal = items.reduce((s, i) => s + PRIORITY_WEIGHT[i.priority] * 100, 0);
  const weighted = items.reduce((s, i) => s + PRIORITY_WEIGHT[i.priority] * i.level, 0);
  const gaps = items
    .filter((i) => i.state !== 'ready')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.state === 'missing' ? -1 : 1));
  return {
    targetRole,
    category: role.category,
    subtitle: role.subtitle,
    scoringVersion: SKILL_GAP_VERSION,
    items,
    matchedSkills: have.map((i) => i.name),
    missingSkills: items.filter((i) => i.state === 'missing').map((i) => i.name),
    improveSkills: items.filter((i) => i.state === 'improve').map((i) => i.name),
    readySkills: items.filter((i) => i.state === 'ready').map((i) => i.name),
    readiness: clamp(items.reduce((s, i) => s + i.level, 0) / items.length),
    coverage: clamp((have.length / items.length) * 100),
    score: clamp((weighted / weightTotal) * 100),
    gaps,
  };
}

/**
 * Job match (same formula the Opportunities page always displayed):
 *  each listed skill contributes 0.7 for being present + 0.3 × (self-rated level / 100);
 *  score = 80% required-skill average + 20% preferred-skill average (100% required if no preferred skills).
 */
function jobMatch(job, studentSkills) {
  const lookup = lookupOf(studentSkills);
  const required = job.requirements || [];
  const preferred = job.preferredSkills || [];
  const has = (s) => lookup.has(normalizeKey(s));
  const avg = (list) => (list.length
    ? list.reduce((a, s) => a + (has(s) ? 0.7 + 0.3 * (lookup.get(normalizeKey(s)) / 100) : 0), 0) / list.length
    : 0);
  const raw = preferred.length ? 0.8 * avg(required) + 0.2 * avg(preferred) : avg(required);
  return {
    score: clamp(raw * 100),
    present: required.filter(has),
    missing: required.filter((s) => !has(s)),
    prefPresent: preferred.filter(has),
    version: JOB_MATCH_VERSION,
  };
}

const roleNames = () => Object.keys(roles);
const roleCatalog = () => Object.entries(roles).map(([name, r]) => ({ name, category: r.category, subtitle: r.subtitle, skills: r.skills.map((s) => ({ name: s.name, priority: s.priority })) }));

module.exports = { analyzeSkillGap, jobMatch, roleNames, roleCatalog, SKILL_GAP_VERSION, JOB_MATCH_VERSION, PRIORITY_WEIGHT, READY_THRESHOLD };
