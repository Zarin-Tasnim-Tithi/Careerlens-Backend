/**
 * Generates documentation artefacts from src/docs/endpoints.js:
 *   docs/postman/CareerLens.postman_collection.json   (ordered so "Run collection" walks the full scenario)
 *   docs/postman/CareerLens-Local.postman_environment.json / CareerLens-Live.postman_environment.json
 *   docs/ENDPOINTS.md                                  (endpoint-to-screen matrix)
 * Usage: npm run docs
 */
const fs = require('fs');
const path = require('path');
const endpoints = require('../src/docs/endpoints');

const ROOT = path.join(__dirname, '..', '..', 'docs');
fs.mkdirSync(path.join(ROOT, 'postman'), { recursive: true });
const key = (e) => `${e.method} ${e.path}`;
const byKey = new Map(endpoints.map((e) => [key(e), e]));

// Order that lets Postman's collection runner execute the whole acceptance scenario top to bottom.
const SCENARIO = [
  ['1. System & authentication', ['GET /health', 'POST /auth/register', 'LOGIN student', 'LOGIN recruiter', 'LOGIN admin', 'GET /auth/me', 'POST /auth/refresh', 'POST /auth/forgot-password', 'POST /auth/reset-password', 'LOGIN newUser']],
  ['2. Profile', ['GET /users/me', 'PATCH /users/me', 'POST /users/me/password']],
  ['3. Student skills & dashboard', ['GET /skills', 'GET /students/me/skills', 'POST /students/me/skills', 'PATCH /students/me/skills/:skillId', 'GET /students/dashboard', 'GET /students/me/analytics']],
  ['4. Skill gap & learning', ['GET /skill-gap/roles', 'POST /skill-gap/analyze', 'GET /skill-gap/history', 'GET /skill-gap/:id', 'GET /learning/recommendations', 'PATCH /learning/plan']],
  ['5. Resumes & CV improvement', ['POST /resumes/upload', 'GET /resumes', 'GET /resumes/:id', 'POST /resumes/:id/analyze', 'GET /resumes/:id/analysis', 'POST /resumes/:id/improve', 'PATCH /resumes/:id/draft', 'GET /resumes/:id/export']],
  ['6. Recruiter posts a job, admin moderates', ['POST /jobs', 'GET /recruiter/jobs', 'GET /admin/jobs', 'PATCH /admin/jobs/:id/reject', 'PATCH /admin/jobs/:id/approve']],
  ['7. Student browses, saves and applies', ['GET /jobs', 'GET /jobs/:id', 'GET /jobs/recommended', 'POST /jobs/:id/save', 'GET /jobs/saved', 'DELETE /jobs/:id/save', 'POST /applications', 'GET /applications/me', 'GET /applications/:id']],
  ['8. Recruiter reviews applicants', ['GET /recruiter/dashboard', 'GET /recruiter/jobs/:id/applicants', 'GET /recruiter/applicants', 'GET /recruiter/applicants/:id', 'PATCH /recruiter/applicants/:id/status', 'PATCH /applications/:id/status', 'PATCH /recruiter/applicants/:id/save', 'PUT /recruiter/applicants/:id/interview', 'GET /recruiter/interviews', 'DELETE /recruiter/applicants/:id/interview', 'GET /recruiter/applicants/:id/resume', 'GET /recruiter/analytics']],
  ['9. Notifications', ['GET /notifications', 'PATCH /notifications/:id/read', 'PATCH /notifications/read-all']],
  ['10. Admin', ['GET /admin/dashboard', 'GET /admin/users', 'GET /admin/users/:id', 'PATCH /admin/users/:id/status', 'GET /admin/analytics', 'GET /admin/activity-logs']],
  ['11. Clean-up', ['PATCH /applications/:id/withdraw', 'PATCH /jobs/:id', 'DELETE /students/me/skills/:skillId', 'DELETE /resumes/:id', 'DELETE /jobs/:id', 'POST /auth/logout']],
];

const LOGINS = {
  'LOGIN student': { method: 'POST', path: '/auth/login', tag: 'Authentication', access: 'public', summary: 'Login as the demo student', body: { email: '{{studentEmail}}', password: '{{studentPassword}}', role: 'student' }, saveToken: 'student' },
  'LOGIN recruiter': { method: 'POST', path: '/auth/login', tag: 'Authentication', access: 'public', summary: 'Login as the demo recruiter', body: { email: '{{recruiterEmail}}', password: '{{recruiterPassword}}', role: 'recruiter' }, saveToken: 'recruiter' },
  'LOGIN newUser': { method: 'POST', path: '/auth/login', tag: 'Authentication', access: 'public', summary: 'Login again with the new password (reset revoked old sessions)', body: { email: '{{newUserEmail}}', password: 'NewPass123!' }, saveToken: 'newUser' },
  'LOGIN admin': { method: 'POST', path: '/auth/login', tag: 'Authentication', access: 'public', summary: 'Login as the admin', body: { email: '{{adminEmail}}', password: '{{adminPassword}}', role: 'admin' }, saveToken: 'admin' },
};

// Some endpoints need specific bodies/actors when run in sequence.
const OVERRIDES = {
  'POST /auth/register': { body: { name: 'Postman Student', email: 'postman{{$timestamp}}@example.com', password: 'ExamplePass123!', role: 'student', university: 'CareerLens University' }, saveToken: 'newUser' },
  'POST /auth/forgot-password': { body: { email: '{{newUserEmail}}' } },
  'POST /auth/reset-password': { body: { token: '{{resetToken}}', password: 'NewPass123!' } },
  'POST /auth/refresh': { saveToken: 'admin', note: 'Uses the HttpOnly cl_refresh cookie Postman stored from the most recent login (the admin login in this folder).' },
  'PATCH /recruiter/applicants/:id/status': { body: { status: 'shortlisted' } },
  'PATCH /applications/:id/status': { body: { status: 'interview' } },
  'PATCH /jobs/:id': { body: { isActive: false }, summaryNote: '(pauses the listing)' },
  'POST /users/me/password': { body: { currentPassword: 'NewPass123!', newPassword: 'NewPass456!' }, as: 'newUser' },
  'PATCH /admin/users/:id/status': { body: { status: 'suspended', reason: 'Postman demo' } },
  'GET /auth/me': { as: 'student' },
  'POST /auth/logout': { as: 'student' },
};

const SAVE = {
  skillId: "pm.environment.set('skillId', json.data.skill.id);",
  resumeId: "pm.environment.set('resumeId', json.data.resume.id);",
  gapId: "pm.environment.set('gapId', json.data.id);",
  jobId: "pm.environment.set('jobId', json.data.job.id);",
  applicationId: "pm.environment.set('applicationId', json.data.application.id);",
};

const tokenVar = (e, ov) => {
  if (ov.as) return `${ov.as}Token`;
  if (['student', 'recruiter', 'admin'].includes(e.access)) return `${e.access}Token`;
  if (e.access === 'auth') {
    if (e.path.startsWith('/users/me') || e.path.startsWith('/skills') || e.path.startsWith('/skill-gap/roles') || e.path.startsWith('/jobs') || e.path.startsWith('/applications') || e.path.startsWith('/notifications')) return 'studentToken';
    return 'studentToken';
  }
  return null;
};

function testScript(e, ov) {
  const lines = [
    `pm.test('status is ${e.status || '2xx'}', () => ${e.status ? `pm.response.to.have.status(${e.status})` : 'pm.expect(pm.response.code).to.be.within(200, 299)'});`,
  ];
  if (e.status === 204 || e.binary) return lines;
  lines.push('const json = pm.response.json();', "pm.test('success envelope', () => pm.expect(json.success).to.eql(true));");
  const save = ov.saveToken || e.saveToken;
  if (save === true || typeof save === 'string') {
    const who = typeof save === 'string' ? save : 'student';
    lines.push(`pm.environment.set('${who}Token', json.data.accessToken);`);
    if (who === 'newUser') lines.push("pm.environment.set('newUserEmail', json.data.user.email);", "pm.environment.set('targetUserId', json.data.user.id);");
  }
  if (e.saveId && SAVE[e.saveId]) lines.push(SAVE[e.saveId]);
  if (key(e) === 'POST /auth/forgot-password') lines.push("if (json.data.resetToken) pm.environment.set('resetToken', json.data.resetToken);");
  if (key(e) === 'GET /notifications') lines.push("if (json.data.items.length) pm.environment.set('notificationId', json.data.items[0].id);");
  return lines;
}

function toItem(e, ov = {}) {
  const idVar = e.idVar || 'resumeId';
  const pathFilled = e.path.replace(':skillId', '{{skillId}}').replace(':id', `{{${idVar}}}`);
  const segments = pathFilled.split('/').filter(Boolean);
  const query = Object.entries(e.query || {}).map(([k, v]) => ({ key: k, value: v }));
  const headers = [];
  const token = tokenVar(e, ov);
  const body = ov.body || e.body;
  const request = {
    method: e.method,
    header: headers,
    url: { raw: `{{baseUrl}}${pathFilled}${query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`, host: ['{{baseUrl}}'], path: segments, query },
    description: [`${e.summary}${ov.summaryNote ? ` ${ov.summaryNote}` : ''}`, `Access: ${e.access}${e.spec === false ? ' · addition to the handover spec' : ''}`,
      `Collections: ${e.collections || '—'}`, `Frontend: ${e.screen || '—'}`, e.errors ? `Typical errors: ${e.errors.join(', ')}` : '', ov.note || ''].filter(Boolean).join('\n\n'),
  };
  if (token) request.auth = { type: 'bearer', bearer: [{ key: 'token', value: `{{${token}}}`, type: 'string' }] };
  else request.auth = { type: 'noauth' };
  if (e.multipart) {
    request.body = { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: 'sample-resume.pdf', description: 'Select docs/postman/sample-resume.pdf (or any PDF/DOCX under 8 MB)' }] };
  } else if (body) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
  }
  return { name: `${e.method} ${e.path}${ov.title ? ` — ${ov.title}` : ''}`, request, event: [{ listen: 'test', script: { type: 'text/javascript', exec: testScript(e, ov) } }] };
}

// ---------- Collection ----------
const used = new Set();
const folders = SCENARIO.map(([name, keys]) => ({
  name,
  item: keys.map((k) => {
    if (LOGINS[k]) return toItem(LOGINS[k], { title: k.replace('LOGIN ', '') });
    const e = byKey.get(k);
    if (!e) throw new Error(`Scenario references unknown endpoint ${k}`);
    used.add(k);
    return toItem(e, OVERRIDES[k] || {});
  }),
}));
const leftovers = endpoints.filter((e) => !used.has(key(e)) && !e.noPostman);
if (leftovers.length) folders.push({ name: '12. Other', item: leftovers.map((e) => toItem(e, OVERRIDES[key(e)] || {})) });

const negative = [
  ['Duplicate registration -> 409', 'POST', '/auth/register', null, { name: 'Demo Student', email: '{{studentEmail}}', password: 'ExamplePass123!', role: 'student' }, 409],
  ['Invalid registration -> 422', 'POST', '/auth/register', null, { name: '', email: 'not-an-email', password: '123', role: 'admin' }, 422],
  ['Wrong password -> 401', 'POST', '/auth/login', null, { email: '{{studentEmail}}', password: 'WrongPass000' }, 401],
  ['Role mismatch -> 403', 'POST', '/auth/login', null, { email: '{{studentEmail}}', password: '{{studentPassword}}', role: 'recruiter' }, 403],
  ['No token -> 401', 'GET', '/students/dashboard', null, null, 401],
  ['Student calls admin API -> 403', 'GET', '/admin/users', 'studentToken', null, 403],
  ['Student creates job -> 403', 'POST', '/jobs', 'studentToken', { title: 'X', company: 'Y', location: 'Z', description: 'Not allowed for students at all.' }, 403],
  ['Duplicate skill -> 409', 'POST', '/students/me/skills', 'studentToken', { name: 'JavaScript', level: 50 }, 409],
  ['Invalid skill level -> 422', 'POST', '/students/me/skills', 'studentToken', { name: 'Rust', level: 150 }, 422],
  ['Unknown job id -> 404', 'GET', '/jobs/64b000000000000000000000', 'studentToken', null, 404],
  ['Reject without reason -> 422', 'PATCH', '/admin/jobs/{{jobId}}/reject', 'adminToken', {}, 422],
  ['Unknown route -> 404', 'GET', '/does-not-exist', null, null, 404],
].map(([name, method, p, token, body, status]) => ({
  name,
  request: {
    method,
    header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
    auth: token ? { type: 'bearer', bearer: [{ key: 'token', value: `{{${token}}}`, type: 'string' }] } : { type: 'noauth' },
    url: { raw: `{{baseUrl}}${p}`, host: ['{{baseUrl}}'], path: p.split('/').filter(Boolean) },
    ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } } : {}),
  },
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [`pm.test('status is ${status}', () => pm.response.to.have.status(${status}));`, "pm.test('error envelope', () => pm.expect(pm.response.json().success).to.eql(false));"] } }],
}));
folders.push({ name: '13. Negative tests (expected failures)', item: negative });

const collection = {
  info: {
    name: 'CareerLens API',
    description: 'Every CareerLens endpoint with example requests. Choose the Local or Live environment, fill in the demo passwords, then use "Run collection" to execute the full scenario in order. No real secrets are stored in this file.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: folders,
};
fs.writeFileSync(path.join(ROOT, 'postman', 'CareerLens.postman_collection.json'), `${JSON.stringify(collection, null, 2)}\n`);

const envVars = (baseUrl) => [
  ['LOCAL_API_URL', 'http://localhost:5000/api/v1'], ['LIVE_API_URL', 'https://<your-render-service>.onrender.com/api/v1'], ['baseUrl', baseUrl],
  ['studentEmail', 'student@careerlens.demo'], ['studentPassword', ''], ['recruiterEmail', 'recruiter@careerlens.demo'], ['recruiterPassword', ''],
  ['adminEmail', 'admin@careerlens.demo'], ['adminPassword', ''],
  ['studentToken', ''], ['recruiterToken', ''], ['adminToken', ''], ['newUserToken', ''], ['newUserEmail', ''], ['targetUserId', ''], ['resetToken', ''],
  ['skillId', ''], ['resumeId', ''], ['gapId', ''], ['jobId', ''], ['applicationId', ''], ['notificationId', ''],
].map(([k, v]) => ({ key: k, value: v, type: /password|token/i.test(k) ? 'secret' : 'default', enabled: true }));
for (const [name, base] of [['Local', '{{LOCAL_API_URL}}'], ['Live', '{{LIVE_API_URL}}']]) {
  fs.writeFileSync(path.join(ROOT, 'postman', `CareerLens-${name}.postman_environment.json`), `${JSON.stringify({ name: `CareerLens ${name}`, values: envVars(base), _postman_variable_scope: 'environment' }, null, 2)}\n`);
}

// ---------- Endpoint-to-screen matrix ----------
const tags = [...new Set(endpoints.map((e) => e.tag))];
const esc = (s) => String(s || '—').replace(/\|/g, '\\|');
let md = '# CareerLens API — endpoint reference & screen matrix\n\n';
md += '_Generated from `server/src/docs/endpoints.js` by `npm run docs`. Base URL: `/api/v1`. Live, interactive version: `/api/v1/api-docs`._\n\n';
md += `**${endpoints.length} endpoints** — ${endpoints.filter((e) => e.spec).length} from the handover specification, ${endpoints.filter((e) => !e.spec).length} documented additions (marked ➕) that existing screens needed.\n\n`;
md += 'Response envelope: `{ "success": true, "message"?, "data": {...}, "meta"? }` · Errors: `{ "success": false, "error": { "code", "message", "details": [] } }`\n\n';
for (const tag of tags) {
  md += `## ${tag}\n\n| Method | Path | Access | Behaviour | Success | Typical errors | Collections touched | Frontend |\n|---|---|---|---|---|---|---|---|\n`;
  for (const e of endpoints.filter((x) => x.tag === tag)) {
    md += `| ${e.method} | \`${e.path}\`${e.spec ? '' : ' ➕'} | ${e.access} | ${esc(e.summary)} | ${e.status || 200} | ${esc((e.errors || []).join(', '))} | ${esc(e.collections)} | ${esc(e.screen)} |\n`;
  }
  md += '\n';
}
fs.writeFileSync(path.join(ROOT, 'ENDPOINTS.md'), md);
console.log(`[docs] ${endpoints.length} endpoints -> Postman (${folders.length} folders), ENDPOINTS.md`);
