/**
 * Rule-based resume quality checks and conservative wording improvements.
 * Ported from the original frontend (cvUtils.js) so results are identical, now executed on the server.
 * This is NOT an AI model, an ATS scan, or a hiring prediction.
 */
const METHOD = 'rule-based-v1';
const HEADINGS = ['summary', 'profile', 'objective', 'experience', 'employment', 'education', 'skills', 'projects', 'certifications', 'awards', 'volunteer', 'achievements'];
const STOP = new Set('the and for with you your are will from that this have our who job work role can must should using use experience team strong ability good skills knowledge required preferred as all not but into over including their other'.split(' '));

function analyzeResume(text, role = '', jobDescription = '') {
  const lower = text.toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = text.split(/\n/).map((x) => x.trim()).filter(Boolean);
  const checks = [
    ['Contact email', /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(text), 'Add a professional contact email.'],
    ['Contact phone', /(?:\+?\d[\d\s().-]{7,}\d)/.test(text), 'Include a contact number.'],
    ['Professional summary', /\b(summary|profile|objective)\b/i.test(text), 'Include a short professional summary.'],
    ['Experience section', /\b(experience|employment|work history|internship)\b/i.test(text), 'Add an experience section, even for internships.'],
    ['Education section', /\b(education|university|bachelor|master|diploma|college)\b/i.test(text), 'Describe your education and qualifications.'],
    ['Skills section', /\b(skills|technologies|competencies)\b/i.test(text), 'Add a clearly labeled skills section.'],
    ['Projects or achievements', /\b(projects?|achievements?|awards?|portfolio)\b/i.test(text), 'List relevant projects and outcomes.'],
    ['Action-oriented bullet points', /\b(built|developed|designed|delivered|implemented|improved|led|created|managed|optimized|analysed|analyzed)\b/i.test(text), 'Use action verbs in your experience bullet points.'],
    ['Measurable outcomes', /\b\d+(?:\.\d+)?\s*(?:%|percent|hours?|days?|users?|projects?|people|clients?|weeks?|months?|\$|kpi)\b/i.test(text), 'Add measurable results only where you can verify them.'],
    ['Appropriate length', words.length >= 150 && words.length <= 1100, 'Aim for roughly 150–1,100 words depending on career level.'],
  ].map(([label, passed, advice]) => ({ label, passed, advice }));

  const relevant = String(jobDescription).toLowerCase().match(/\b[a-z][a-z+#.]{2,}\b/g) || [];
  const unique = [...new Set(relevant.filter((k) => !STOP.has(k) && k.length > 3))].slice(0, 40);
  const present = unique.filter((w) => lower.includes(w));
  const missing = unique.filter((w) => !lower.includes(w));

  const passed = checks.filter((c) => c.passed).length;
  // 90 points from the 10-item checklist + 10 points when the document has at least 150 words.
  const score = Math.min(100, Math.max(0, Math.round((passed / checks.length) * 90 + (words.length >= 150 ? 10 : 0))));
  return {
    method: METHOD,
    score,
    rating: score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Average' : 'Needs improvement',
    words: words.length,
    lines: lines.length,
    sections: HEADINGS.filter((h) => lower.includes(h)),
    checks,
    strengths: checks.filter((c) => c.passed).map((c) => c.label),
    suggestions: checks.filter((c) => !c.passed).map((c) => c.advice),
    keywordMatch: unique.length ? Math.round((present.length / unique.length) * 100) : null,
    keywords: present,
    missingKeywords: missing,
    targetRole: role,
  };
}

const REPLACEMENTS = [
  [/\bresponsible for\b/gi, 'Contributed to'],
  [/\bworked on\b/gi, 'Supported'],
  [/\bhelped with\b/gi, 'Assisted with'],
  [/\bwas involved in\b/gi, 'Participated in'],
  [/\bgood at\b/gi, 'Skilled in'],
  [/\bI am a\b/gi, 'Professional with a background as a'],
];

/** Conservative, transparent wording substitutions. Never invents achievements or qualifications. */
function improveResume(text) {
  let result = text.trim();
  const changes = [];
  for (const [pattern, replacement] of REPLACEMENTS) {
    const matches = result.match(pattern);
    if (matches) changes.push({ from: matches[0], to: replacement, count: matches.length });
    result = result.replace(pattern, replacement);
  }
  result = result.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return { method: METHOD, improvedText: result, changes, unchanged: changes.length === 0 };
}

module.exports = { analyzeResume, improveResume, METHOD };
