// Builds an OpenAPI 3 document from the endpoint registry.
const endpoints = require('./endpoints');

const ACCESS_TEXT = {
  public: 'Public', auth: 'Any signed-in user', student: 'Student only', recruiter: 'Recruiter only', admin: 'Admin only',
  'refresh-cookie': 'Requires the HttpOnly refresh cookie set by login', 'reset-token': 'Requires a reset token',
};

const errorSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    error: { type: 'object', properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } } },
  },
};

function buildOpenApi() {
  const paths = {};
  for (const e of endpoints) {
    if (e.path === '/api-docs') continue;
    const oaPath = e.path.replace(/:(\w+)/g, '{$1}');
    const params = [...e.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    for (const [k, v] of Object.entries(e.query || {})) params.push({ name: k, in: 'query', required: false, schema: { type: 'string' }, example: v });
    const op = {
      tags: [e.tag],
      summary: e.summary,
      description: [`**Access:** ${ACCESS_TEXT[e.access]}`, e.spec ? '' : '_Addition to the handover spec (required by an existing screen)._',
        `**Collections:** ${e.collections || '—'}`, `**Frontend:** ${e.screen || '—'}`, e.errors ? `**Typical errors:** ${e.errors.join(', ')}` : ''].filter(Boolean).join('\n\n'),
      parameters: params,
      responses: {
        [e.status || 200]: e.status === 204 ? { description: 'No content' } : {
          description: 'Success',
          content: e.binary
            ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
            : { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, message: { type: 'string' }, data: { type: 'object' }, meta: { type: 'object' } } } } },
        },
        400: { $ref: '#/components/responses/Error' },
        ...(e.access !== 'public' ? { 401: { $ref: '#/components/responses/Error' } } : {}),
        ...(['student', 'recruiter', 'admin'].includes(e.access) ? { 403: { $ref: '#/components/responses/Error' } } : {}),
        422: { $ref: '#/components/responses/Error' },
      },
    };
    if (['student', 'recruiter', 'admin', 'auth'].includes(e.access)) op.security = [{ bearerAuth: [] }];
    if (e.access === 'refresh-cookie') op.security = [{ refreshCookie: [] }];
    if (e.multipart) {
      op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } } } };
    } else if (e.body) {
      op.requestBody = { required: true, content: { 'application/json': { example: e.body, schema: { type: 'object' } } } };
    }
    paths[oaPath] = paths[oaPath] || {};
    paths[oaPath][e.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'CareerLens API',
      version: '1.0.0',
      description: 'REST API for the CareerLens student career platform. All responses use `{ success, message?, data, meta? }` or `{ success:false, error:{ code, message, details } }`.\n\n'
        + 'Authenticate with **POST /auth/login**, then click **Authorize** and paste `data.accessToken`. Access tokens expire after 15 minutes; the refresh cookie renews them.\n\n'
        + 'Resume analysis, skill gap and job matching are **transparent rule-based** calculations — not AI, ATS or hiring predictions.',
    },
    servers: [{ url: '/api/v1', description: 'This server' }],
    tags: [...new Set(endpoints.map((e) => e.tag))].map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'cl_refresh' },
      },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: errorSchema } } } },
    },
    paths,
  };
}

module.exports = { buildOpenApi };
