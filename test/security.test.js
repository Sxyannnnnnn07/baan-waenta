const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SESSION_COOKIE,
    randomToken,
    hashToken,
    parseCookies,
    serializeSessionCookie,
    clearSessionCookie,
    cleanText,
    isEmail,
    isStrongPassword,
    numberInRange,
    integerInRange,
    decodeImageDataUrl,
    createRateLimiter
} = require('../lib/security');

test('session tokens are random and only deterministic after hashing', () => {
    const first = randomToken();
    const second = randomToken();
    assert.notEqual(first, second);
    assert.equal(hashToken(first), hashToken(first));
    assert.notEqual(hashToken(first), first);
    assert.match(hashToken(first), /^[a-f0-9]{64}$/);
});

test('session cookies use browser security attributes', () => {
    const cookie = serializeSessionCookie('secret token', { secure: true });
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.equal(parseCookies(cookie)[SESSION_COOKIE], 'secret token');
    assert.match(clearSessionCookie(true), /Max-Age=0/);
});

test('text, email, password, and number validation rejects unsafe shapes', () => {
    assert.equal(cleanText('  hello  ', 10), 'hello');
    assert.equal(cleanText('too long', 3), null);
    assert.equal(isEmail('person@example.com'), true);
    assert.equal(isEmail('not-an-email'), false);
    assert.equal(isStrongPassword('StrongPass1!'), true);
    assert.equal(isStrongPassword('password'), false);
    assert.equal(numberInRange('2.5', 0, 3), 2.5);
    assert.equal(numberInRange(4, 0, 3), null);
    assert.equal(integerInRange('2', 1, 3), 2);
    assert.equal(integerInRange('2.5', 1, 3), null);
});

test('image validation checks MIME, signature, and size', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8)]);
    const decoded = decodeImageDataUrl(`data:image/png;base64,${png.toString('base64')}`, 32);
    assert.equal(decoded.extension, 'png');
    assert.deepEqual(decoded.buffer, png);
    assert.throws(() => decodeImageDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`, 32), /match/);
    assert.throws(() => decodeImageDataUrl(`data:image/png;base64,${png.toString('base64')}`, 4), /large/);
    assert.throws(() => decodeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 32), /format/);
});

test('rate limiter blocks requests after the configured threshold', () => {
    const middleware = createRateLimiter({ windowMs: 10000, max: 2 });
    const req = { ip: '127.0.0.1' };
    let nextCalls = 0;
    const response = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
    middleware(req, response, () => { nextCalls += 1; });
    middleware(req, response, () => { nextCalls += 1; });
    middleware(req, response, () => { nextCalls += 1; });
    assert.equal(nextCalls, 2);
    assert.equal(response.statusCode, 429);
    assert.equal(response.payload.success, false);
});
