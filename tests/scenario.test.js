/**
 * Full acceptance scenario from the handover spec:
 * register student -> login -> add skills -> upload/analyze resume -> see skill gaps -> recruiter creates job ->
 * admin approves -> student views/saves/applies -> recruiter reviews -> dashboard counts reflect MongoDB.
 */
const { setup, teardown, api, register, createAdmin, auth, PASSWORD, makePdf, makeDocx } = require('./helpers');

let student; let recruiter; let admin; let jobId; let resumeId; let applicationId;

beforeAll(async () => {
  await setup();
  student = await register('student', { university: 'CareerLens University' });
  recruiter = await register('recruiter', { companyName: 'Nexora Labs' });
  admin = await createAdmin();
});
afterAll(teardown);

describe('End-to-end scenario', () => {
  test('1. student logs in', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: student.email, password: PASSWORD, role: 'student' });
    expect(res.status).toBe(200);
    student.token = res.body.data.accessToken;
  });

  test('2. student adds skills (duplicates rejected, aliases resolved)', async () => {
    for (const [name, level] of [['JavaScript', 86], ['React', 74], ['HTML', 92], ['CSS', 84], ['Node.js', 59]]) {
      expect((await api().post('/api/v1/students/me/skills').set(auth(student.token)).send({ name, level })).status).toBe(201);
    }
    const dup = await api().post('/api/v1/students/me/skills').set(auth(student.token)).send({ name: 'reactjs', level: 50 });
    expect(dup.status).toBe(409);
    const list = await api().get('/api/v1/students/me/skills').set(auth(student.token));
    expect(list.body.data.skills).toHaveLength(5);
    const node = list.body.data.skills.find((s) => s.name === 'Node.js');
    const upd = await api().patch(`/api/v1/students/me/skills/${node.id}`).set(auth(student.token)).send({ level: 65 });
    expect(upd.body.data.skill.level).toBe(65);
    expect((await api().post('/api/v1/students/me/skills').set(auth(student.token)).send({ name: 'Bad', level: 140 })).status).toBe(422);
  });

  test('3. upload validation: wrong type 415, fake PDF 415, too large 413', async () => {
    const txt = await api().post('/api/v1/resumes/upload').set(auth(student.token)).attach('file', Buffer.from('hello'), { filename: 'cv.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(415);
    const fake = await api().post('/api/v1/resumes/upload').set(auth(student.token)).attach('file', Buffer.from('not really a pdf'.repeat(10)), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(fake.status).toBe(415);
    expect(fake.body.error.code).toBe('INVALID_FILE_SIGNATURE');
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(9 * 1024 * 1024)]);
    const large = await api().post('/api/v1/resumes/upload').set(auth(student.token)).attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(large.status).toBe(413);
    expect((await api().post('/api/v1/resumes/upload').set(auth(student.token))).status).toBe(422);
  });

  test('4. upload DOCX and PDF resumes; text extracted on the server', async () => {
    const docx = await api().post('/api/v1/resumes/upload').set(auth(student.token))
      .attach('file', await makeDocx(), { filename: 'resume.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(docx.status).toBe(201);
    const pdf = await api().post('/api/v1/resumes/upload').set(auth(student.token)).attach('file', await makePdf(), { filename: 'resume.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(201);
    expect(pdf.body.data.resume.text).toMatch(/Demo Student/);
    resumeId = pdf.body.data.resume.id;
    const list = await api().get('/api/v1/resumes').set(auth(student.token));
    expect(list.body.data.items).toHaveLength(2);
    // delete the DOCX
    expect((await api().delete(`/api/v1/resumes/${docx.body.data.resume.id}`).set(auth(student.token))).status).toBe(204);
  });

  test("5. another student cannot read this resume", async () => {
    const other = await register('student');
    expect((await api().get(`/api/v1/resumes/${resumeId}`).set(auth(other.token))).status).toBe(403);
    expect((await api().get(`/api/v1/resumes/${resumeId}/export`).set(auth(other.token))).status).toBe(403);
  });

  test('6. analyze resume (rule-based) and read the stored result', async () => {
    const res = await api().post(`/api/v1/resumes/${resumeId}/analyze`).set(auth(student.token)).send({ targetRole: 'Software Engineer', jobDescription: 'React developer with testing and docker' });
    expect(res.status).toBe(201);
    const a = res.body.data.analysis;
    expect(a.method).toBe('rule-based-v1');
    expect(a.score).toBeGreaterThanOrEqual(70);
    expect(a.checks).toHaveLength(10);
    expect(a.keywords).toEqual(expect.arrayContaining(['react']));
    expect(a.missingKeywords).toEqual(expect.arrayContaining(['docker']));
    const get = await api().get(`/api/v1/resumes/${resumeId}/analysis`).set(auth(student.token));
    expect(get.body.data.analysis.score).toBe(a.score);
  });

  test('7. improve, save draft and export DOCX/PDF', async () => {
    const imp = await api().post(`/api/v1/resumes/${resumeId}/improve`).set(auth(student.token)).send({ targetRole: 'Software Engineer', level: 'Entry level' });
    expect(imp.status).toBe(201);
    expect(imp.body.data.improvement.improvedText).toMatch(/Contributed to/);
    expect(imp.body.data.improvement.improvedText).not.toMatch(/Responsible for/);
    const draft = await api().patch(`/api/v1/resumes/${resumeId}/draft`).set(auth(student.token)).send({ content: `${imp.body.data.improvement.improvedText}\nEdited by me`, template: 'Minimalist' });
    expect(draft.status).toBe(200);
    expect(draft.body.data.draft.template).toBe('Minimalist');
    const docx = await api().get(`/api/v1/resumes/${resumeId}/export?format=docx`).set(auth(student.token)).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(docx.status).toBe(200);
    expect(docx.headers['content-type']).toMatch(/wordprocessingml/);
    expect(docx.body.subarray(0, 2).toString()).toBe('PK');
    const pdf = await api().get(`/api/v1/resumes/${resumeId}/export?format=pdf`).set(auth(student.token)).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('8. skill gap analysis is saved to history', async () => {
    const res = await api().post('/api/v1/skill-gap/analyze').set(auth(student.token)).send({ targetRole: 'MERN Developer' });
    expect(res.status).toBe(200);
    expect(res.body.data.matchedSkills).toEqual(expect.arrayContaining(['JavaScript', 'React', 'Node.js']));
    expect(res.body.data.missingSkills).toEqual(expect.arrayContaining(['MongoDB', 'Express.js']));
    expect(res.body.data.readiness).toBeGreaterThan(0);
    const hist = await api().get('/api/v1/skill-gap/history').set(auth(student.token));
    expect(hist.body.data.items).toHaveLength(1);
    expect((await api().get(`/api/v1/skill-gap/${res.body.data.id}`).set(auth(student.token))).status).toBe(200);
    const bad = await api().post('/api/v1/skill-gap/analyze').set(auth(student.token)).send({ targetRole: 'Astronaut' });
    expect(bad.status).toBe(422);
    const rec = await api().get('/api/v1/learning/recommendations').set(auth(student.token));
    expect(rec.body.data.items[0].priority).toBe('High');
    const plan = await api().patch('/api/v1/learning/plan').set(auth(student.token)).send({ skill: 'Express.js', inPlan: true });
    expect(plan.body.data.learningPlan).toContain('expressjs');
  });

  test('9. recruiter creates a job -> pending and invisible to students', async () => {
    const res = await api().post('/api/v1/jobs').set(auth(recruiter.token)).send({
      title: 'Frontend Developer Intern', company: 'Nexora Labs', type: 'Internship', mode: 'Hybrid', location: 'Dhaka', experience: 'Student',
      pay: '৳18k–25k /mo', description: 'Help craft fast, accessible React interfaces with the product team.',
      requirements: ['React', 'JavaScript', 'HTML', 'CSS', 'Git & GitHub'], preferredSkills: ['TypeScript'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.job.status).toBe('pending');
    jobId = res.body.data.job.id;
    const list = await api().get('/api/v1/jobs').set(auth(student.token));
    expect(list.body.data.items.find((j) => j.id === jobId)).toBeUndefined();
  });

  test('10. admin sees it in moderation queue and approves it', async () => {
    const queue = await api().get('/api/v1/admin/jobs?status=pending').set(auth(admin.token));
    expect(queue.body.data.items.map((j) => j.id)).toContain(jobId);
    const res = await api().patch(`/api/v1/admin/jobs/${jobId}/approve`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.job.status).toBe('approved');
    expect((await api().patch(`/api/v1/admin/jobs/${jobId}/approve`).set(auth(admin.token))).status).toBe(409);
    const notes = await api().get('/api/v1/notifications').set(auth(recruiter.token));
    expect(notes.body.data.items.map((n) => n.type)).toContain('job.approved');
  });

  test('11. student finds the job with a rule-based match score, filters work', async () => {
    const res = await api().get('/api/v1/jobs?q=frontend&type=Internship&sort=match').set(auth(student.token));
    const found = res.body.data.items.find((j) => j.id === jobId);
    expect(found).toBeTruthy();
    // required: 4 of 5 present; preferred TypeScript missing -> 0.8 * avg(required)
    expect(found.match.present).toHaveLength(4);
    expect(found.match.missing).toEqual(['Git & GitHub']);
    expect(found.match.score).toBeGreaterThan(50);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
    const none = await api().get('/api/v1/jobs?mode=Remote&q=frontend').set(auth(student.token));
    expect(none.body.data.items).toHaveLength(0);
  });

  test('12. save (no duplicates) and apply (no duplicates)', async () => {
    expect((await api().post(`/api/v1/jobs/${jobId}/save`).set(auth(student.token))).status).toBe(201);
    expect((await api().post(`/api/v1/jobs/${jobId}/save`).set(auth(student.token))).status).toBe(409);
    const saved = await api().get('/api/v1/jobs/saved').set(auth(student.token));
    expect(saved.body.data.items.map((j) => j.id)).toEqual([jobId]);
    const app = await api().post('/api/v1/applications').set(auth(student.token)).send({ jobId, resumeId, coverNote: 'Excited to apply' });
    expect(app.status).toBe(201);
    applicationId = app.body.data.application.id;
    const dup = await api().post('/api/v1/applications').set(auth(student.token)).send({ jobId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_APPLIED');
    const mine = await api().get('/api/v1/applications/me').set(auth(student.token));
    expect(mine.body.data.items[0]).toMatchObject({ status: 'applied', job: { title: 'Frontend Developer Intern' } });
  });

  test('13. recruiter reviews: applicants, shortlist, invalid transition, interview, resume download', async () => {
    const list = await api().get(`/api/v1/recruiter/jobs/${jobId}/applicants`).set(auth(recruiter.token));
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].skills).toEqual(expect.arrayContaining(['React']));
    const sl = await api().patch(`/api/v1/recruiter/applicants/${applicationId}/status`).set(auth(recruiter.token)).send({ status: 'shortlisted' });
    expect(sl.body.data.application.status).toBe('shortlisted');
    const offer = await api().patch(`/api/v1/applications/${applicationId}/status`).set(auth(recruiter.token)).send({ status: 'offered' });
    expect(offer.status).toBe(200);
    const bad = await api().patch(`/api/v1/applications/${applicationId}/status`).set(auth(recruiter.token)).send({ status: 'interview' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');
    const detail = await api().get(`/api/v1/recruiter/applicants/${applicationId}`).set(auth(recruiter.token));
    expect(detail.body.data.applicant.resume.filename).toBe('resume.pdf');
    const file = await api().get(`/api/v1/recruiter/applicants/${applicationId}/resume`).set(auth(recruiter.token));
    expect(file.status).toBe(200);
    const save = await api().patch(`/api/v1/recruiter/applicants/${applicationId}/save`).set(auth(recruiter.token)).send({ saved: true });
    expect(save.body.data.saved).toBe(true);
    const notes = await api().get('/api/v1/notifications?unread=true').set(auth(student.token));
    expect(notes.body.data.items.some((n) => n.type === 'application.status')).toBe(true);
    expect((await api().patch('/api/v1/notifications/read-all').set(auth(student.token))).body.data.updated).toBeGreaterThan(0);
  });

  test('14. dashboards reflect MongoDB', async () => {
    const sd = await api().get('/api/v1/students/dashboard').set(auth(student.token));
    expect(sd.body.data.stats).toMatchObject({ skills: 5, applications: 1, savedJobs: 1 });
    expect(sd.body.data.recentActivity.length).toBeGreaterThan(0);
    const sa = await api().get('/api/v1/students/me/analytics').set(auth(student.token));
    expect(sa.body.data.applications.offers).toBe(1);
    const rd = await api().get('/api/v1/recruiter/dashboard').set(auth(recruiter.token));
    expect(rd.body.data.stats).toMatchObject({ opportunities: 1, activeListings: 1, applicants: 1, savedCandidates: 1 });
    const ra = await api().get('/api/v1/recruiter/analytics').set(auth(recruiter.token));
    expect(ra.body.data.byJob[0].applicants).toBe(1);
    const ad = await api().get('/api/v1/admin/dashboard').set(auth(admin.token));
    expect(ad.body.data.metrics.approvedJobs).toBe(1);
    expect(ad.body.data.metrics.applications).toBe(1);
    expect(ad.body.data.userGrowth).toHaveLength(6);
    const logs = await api().get('/api/v1/admin/activity-logs').set(auth(admin.token));
    expect(logs.body.data.items.map((l) => l.action)).toEqual(expect.arrayContaining(['job.approved', 'application.submitted', 'user.registered']));
    const users = await api().get('/api/v1/admin/users?role=student&limit=1&page=1').set(auth(admin.token));
    expect(users.body.data.items).toHaveLength(1);
    expect(users.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  test('15. withdraw, then pause and edit job (edit sends it back to moderation)', async () => {
    const w = await api().patch(`/api/v1/applications/${applicationId}/withdraw`).set(auth(student.token));
    expect(w.body.data.application.status).toBe('withdrawn');
    expect((await api().patch(`/api/v1/applications/${applicationId}/withdraw`).set(auth(student.token))).status).toBe(409);
    const pause = await api().patch(`/api/v1/jobs/${jobId}`).set(auth(recruiter.token)).send({ isActive: false });
    expect(pause.body.data.job.status).toBe('approved');
    expect((await api().get('/api/v1/jobs').set(auth(student.token))).body.data.items).toHaveLength(0);
    const edit = await api().patch(`/api/v1/jobs/${jobId}`).set(auth(recruiter.token)).send({ title: 'Frontend Engineer Intern', isActive: true });
    expect(edit.body.data.job.status).toBe('pending');
    const reject = await api().patch(`/api/v1/admin/jobs/${jobId}/reject`).set(auth(admin.token)).send({ reason: 'Please add the stipend details.' });
    expect(reject.body.data.job.rejectionReason).toMatch(/stipend/);
    expect((await api().patch(`/api/v1/admin/jobs/${jobId}/reject`).set(auth(admin.token)).send({})).status).toBe(422);
  });

  test('16. recruiter deletes the job; applications are closed', async () => {
    expect((await api().delete(`/api/v1/jobs/${jobId}`).set(auth(recruiter.token))).status).toBe(204);
    expect((await api().get('/api/v1/applications/me').set(auth(student.token))).body.data.items).toHaveLength(0);
  });
});
