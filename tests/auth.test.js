const { setup, teardown, api, register, createAdmin, auth, PASSWORD } = require('./helpers');

beforeAll(setup);
afterAll(teardown);

describe('Authentication', () => {
  test('registers a student and returns user + access token (201)', async () => {
    const res = await api().post('/api/v1/auth/register').send({ name: 'Demo Student', email: 'Student@Example.com', password: PASSWORD, role: 'student' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ name: 'Demo Student', role: 'student', email: 'student@example.com' });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers['set-cookie'].join(';')).toMatch(/cl_refresh=.*HttpOnly/i);
  });

  test('rejects duplicate email (409) case-insensitively', async () => {
    const res = await api().post('/api/v1/auth/register').send({ name: 'Again', email: 'student@example.com', password: PASSWORD, role: 'student' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('validates input and blocks self-registration as admin (422)', async () => {
    const res = await api().post('/api/v1/auth/register').send({ name: '', email: 'nope', password: 'short', role: 'admin' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password', 'role']));
  });

  test('login: wrong password 401, role mismatch 403, success 200', async () => {
    const bad = await api().post('/api/v1/auth/login').send({ email: 'student@example.com', password: 'WrongPass123' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const mismatch = await api().post('/api/v1/auth/login').send({ email: 'student@example.com', password: PASSWORD, role: 'recruiter' });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('ROLE_MISMATCH');
    const good = await api().post('/api/v1/auth/login').send({ email: 'student@example.com', password: PASSWORD, role: 'student' });
    expect(good.status).toBe(200);
  });

  test('GET /auth/me requires a valid token', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set(auth('garbage'))).body.error.code).toBe('INVALID_TOKEN');
    const { token } = await register('recruiter');
    const me = await api().get('/api/v1/auth/me').set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('recruiter');
  });

  test('refresh rotates the cookie; logout revokes the session', async () => {
    const { agent } = await register('student');
    const r1 = await agent.post('/api/v1/auth/refresh');
    expect(r1.status).toBe(200);
    expect(r1.body.data.accessToken).toBeTruthy();
    const out = await agent.post('/api/v1/auth/logout');
    expect(out.status).toBe(200);
    const r2 = await agent.post('/api/v1/auth/refresh');
    expect(r2.status).toBe(401);
  });

  test('refresh without a cookie is 401', async () => {
    const res = await api().post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_REFRESH_TOKEN');
  });

  test('forgot + reset password flow', async () => {
    const { email } = await register('student');
    const f = await api().post('/api/v1/auth/forgot-password').send({ email });
    expect(f.status).toBe(200);
    const token = f.body.data.resetToken;
    expect(token).toBeTruthy();
    // unknown email gives the same generic answer (no account enumeration)
    const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(unknown.body.message).toBe(f.body.message);
    expect((await api().post('/api/v1/auth/reset-password').send({ token: 'x'.repeat(30), password: 'NewPass123!' })).status).toBe(400);
    expect((await api().post('/api/v1/auth/reset-password').send({ token, password: 'NewPass123!' })).status).toBe(200);
    expect((await api().post('/api/v1/auth/reset-password').send({ token, password: 'NewPass123!' })).status).toBe(400); // single use
    expect((await api().post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email, password: 'NewPass123!' })).status).toBe(200);
  });

  test('suspended users cannot log in or use existing tokens', async () => {
    const admin = await createAdmin();
    const { token, user, email } = await register('student');
    const s = await api().patch(`/api/v1/admin/users/${user.id}/status`).set(auth(admin.token)).send({ status: 'suspended' });
    expect(s.status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(auth(token))).status).toBe(403);
    const login = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await api().patch(`/api/v1/admin/users/${user.id}/status`).set(auth(admin.token)).send({ status: 'active' });
    expect((await api().post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  });
});
