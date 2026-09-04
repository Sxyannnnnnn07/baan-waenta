const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SKIP_DB_INIT = '1';
const app = require('../server');
const { requireCsrf } = app._test;

let server;
let baseUrl;

test.before(async () => {
    await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

test.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
});

for (const route of [
    ['POST', '/api/orders'],
    ['POST', '/api/products'],
    ['DELETE', '/api/products/1'],
    ['GET', '/api/admin/orders'],
    ['GET', '/api/admin/analytics'],
    ['POST', '/api/reviews'],
    ['DELETE', '/api/reviews/1']
]) {
    test(`${route[0]} ${route[1]} rejects anonymous access`, async () => {
        const response = await fetch(`${baseUrl}${route[1]}`, {
            method: route[0],
            headers: { 'Content-Type': 'application/json' },
            body: ['GET', 'HEAD'].includes(route[0]) ? undefined : '{}'
        });
        assert.equal(response.status, 401);
        const payload = await response.json();
        assert.equal(payload.success, false);
    });
}

test('legacy public slip URL is blocked', async () => {
    const response = await fetch(`${baseUrl}/uploads/slips/example.png`);
    assert.equal(response.status, 404);
});

test('security headers allow OAuth popup communication', async () => {
    const response = await fetch(`${baseUrl}/login.html`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
});

test('unknown API route returns a safe JSON error', async () => {
    const response = await fetch(`${baseUrl}/api/not-real`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { success: false, message: 'ไม่พบ API ที่เรียก' });
});

test('CSRF middleware accepts the session token only from an allowed origin', () => {
    const token = 'fixed-test-token';
    const makeResponse = () => ({
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    });
    const validRequest = {
        session: { csrf_token: token },
        protocol: 'http',
        get(name) {
            return {
                'X-CSRF-Token': token,
                Origin: 'http://example.test',
                Host: 'example.test'
            }[name];
        }
    };
    let nextCalled = false;
    requireCsrf(validRequest, makeResponse(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    const invalidRequest = {
        ...validRequest,
        get(name) { return name === 'X-CSRF-Token' ? 'wrong-token-value' : validRequest.get(name); }
    };
    const response = makeResponse();
    requireCsrf(invalidRequest, response, () => {});
    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.success, false);
});
