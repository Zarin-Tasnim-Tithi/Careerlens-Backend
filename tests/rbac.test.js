const { setup, teardown, api, register, createAdmin, auth } = require('./helpers');

let student; let student2; let recruiter; let recruiter2; let admin; let jobId;

const job = { title: 'Backend Intern', company: 'Acme', location: 'Remote', description: 'Help build Express APIs with MongoDB and tests.', requirements: ['Node.js', 'MongoDB'] };

beforeAll(async () => {
  await setup();
  [student, student2, recruiter, recruiter2] = await Promise.all([register('student'), register('student'), register('recruiter'), register('recruiter')]);
  admin = await createAdmin();
  jobId = (await api().post('/api/v1/jobs').set(auth(recruiter.token)).send(job)).body.data.job.id;
});
afterAll(teardown);

describe('Role-based access control', () => {
  test.each([
    ['student cannot create jobs', 'post', '/api/v1/jobs', () => student, 403],
    ['student cannot open admin dashboard', 'get', '/api/v1/admin/dashboard', () => student, 403],
    ['recruiter cannot open admin users', 'get', '/api/v1/admin/users', () => recruiter, 403],
    ['recruiter cannot use student skills', 'get', '/api/v1/students/me/skills', () => recruiter, 403],
    ['admin cannot apply to jobs', 'post', '/api/v1/applications', () => admin, 403],
    ['student cannot see recruiter dashboard', 'get', '/api/v1/recruiter/dashboard', () => student, 403],
  ])('%s', async (_name, method, url, who, status) => {
    const res = await api()[method](url).set(auth(who().token)).send(method === 'post' ? job : undefined);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('unauthenticated requests get 401', async () => {
    for (const url of ['/api/v1/jobs', '/api/v1/students/dashboard', '/api/v1/admin/users', '/api/v1/resumes']) {
      expect((await api().get(url)).status).toBe(401);
    }
  });
});

describe('Ownership checks', () => {
  test('another recruiter cannot edit or delete my job', async () => {
    expect((await api().patch(`/api/v1/jobs/${jobId}`).set(auth(recruiter2.token)).send({ title: 'Hacked title' })).status).toBe(403);
    expect((await api().delete(`/api/v1/jobs/${jobId}`).set(auth(recruiter2.token))).status).toBe(403);
    expect((await api().get(`/api/v1/recruiter/jobs/${jobId}/applicants`).set(auth(recruiter2.token))).status).toBe(403);
  });

  test('pending jobs are hidden from students and other recruiters', async () => {
    expect((await api().get(`/api/v1/jobs/${jobId}`).set(auth(student.token))).status).toBe(404);
    expect((await api().get(`/api/v1/jobs/${jobId}`).set(auth(recruiter2.token))).status).toBe(404);
    expect((await api().get(`/api/v1/jobs/${jobId}`).set(auth(recruiter.token))).status).toBe(200);
    expect((await api().get(`/api/v1/jobs/${jobId}`).set(auth(admin.token))).status).toBe(200);
    expect((await api().post('/api/v1/applications').set(auth(student.token)).send({ jobId })).status).toBe(404);
  });

  test("a student cannot change another student's skill", async () => {
    const add = await api().post('/api/v1/students/me/skills').set(auth(student.token)).send({ name: 'React', level: 60 });
    const skillId = add.body.data.skill.id;
    expect((await api().patch(`/api/v1/students/me/skills/${skillId}`).set(auth(student2.token)).send({ level: 1 })).status).toBe(403);
    expect((await api().delete(`/api/v1/students/me/skills/${skillId}`).set(auth(student2.token))).status).toBe(403);
  });

  test('only the owning recruiter can review an application', async () => {
    await api().patch(`/api/v1/admin/jobs/${jobId}/approve`).set(auth(admin.token));
    const app = await api().post('/api/v1/applications').set(auth(student.token)).send({ jobId });
    expect(app.status).toBe(201);
    const appId = app.body.data.application.id;
    expect((await api().patch(`/api/v1/applications/${appId}/status`).set(auth(recruiter2.token)).send({ status: 'shortlisted' })).status).toBe(403);
    expect((await api().get(`/api/v1/applications/${appId}`).set(auth(student2.token))).status).toBe(403);
    expect((await api().patch(`/api/v1/applications/${appId}/withdraw`).set(auth(student2.token))).status).toBe(403);
    expect((await api().get(`/api/v1/applications/${appId}`).set(auth(recruiter.token))).status).toBe(200);
  });

  test('admins cannot suspend themselves', async () => {
    const res = await api().patch(`/api/v1/admin/users/${admin.user.id}/status`).set(auth(admin.token)).send({ status: 'suspended' });
    expect(res.status).toBe(400);
  });

  test('protected fields cannot be set through the API', async () => {
    const res = await api().patch('/api/v1/users/me').set(auth(student.token)).send({ name: 'New Name', role: 'admin', status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('student');
    const job2 = await api().post('/api/v1/jobs').set(auth(recruiter.token)).send({ ...job, status: 'approved', recruiterId: recruiter2.user.id });
    expect(job2.body.data.job.status).toBe('pending');
    expect(job2.body.data.job.recruiterId).toBe(recruiter.user.id);
  });

  test('malformed ids return 404/422 instead of 500', async () => {
    expect((await api().get('/api/v1/jobs/not-an-id').set(auth(student.token))).status).toBe(422);
    expect((await api().get('/api/v1/jobs/64b000000000000000000000').set(auth(student.token))).status).toBe(404);
  });
});
