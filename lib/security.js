const crypto = require('crypto');

const SESSION_COOKIE = 'baan_waenta_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_IMAGE_TYPES = Object.freeze({
    'image/png': { extension: 'png', signature: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    'image/jpeg': { extension: 'jpg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    'image/webp': { extension: 'webp', signature: Buffer.from('RIFF') }
});

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function parseCookies(header = '') {
    return header.split(';').reduce((cookies, entry) => {
        const separator = entry.indexOf('=');
        if (separator < 1) return cookies;
        const key = entry.slice(0, separator).trim();
        const value = entry.slice(separator + 1).trim();
        try {
            cookies[key] = decodeURIComponent(value);
        } catch (_) {
            cookies[key] = value;
        }
        return cookies;
    }, {});
}

function serializeSessionCookie(token, options = {}) {
    const secure = options.secure === true;
    const maxAge = Math.floor((options.maxAgeMs || SESSION_MAX_AGE_MS) / 1000);
    return [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAge}`,
        secure ? 'Secure' : null
    ].filter(Boolean).join('; ');
}

function clearSessionCookie(secure = false) {
    return [
        `${SESSION_COOKIE}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0',
        secure ? 'Secure' : null
    ].filter(Boolean).join('; ');
}

function cleanText(value, maxLength, { allowEmpty = false } = {}) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    if ((!allowEmpty && !cleaned) || cleaned.length > maxLength) return null;
    return cleaned;
}

function isEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongPassword(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) return false;
    return /[a-z]/.test(value) && /[A-Z]/.test(value) && /[\d!-/:-@[-`{-~]/.test(value);
}

function numberInRange(value, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function integerInRange(value, min, max) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function decodeImageDataUrl(dataUrl, maxBytes = 5 * 1024 * 1024) {
    if (typeof dataUrl !== 'string') throw new Error('Invalid image data');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error('Unsupported image format');

    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > maxBytes) throw new Error('Image is empty or too large');

    const expected = SAFE_IMAGE_TYPES[mimeType];
    if (!buffer.subarray(0, expected.signature.length).equals(expected.signature)) {
        throw new Error('Image content does not match its declared type');
    }
    if (mimeType === 'image/webp' && buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
        throw new Error('Invalid WebP image');
    }

    return { buffer, mimeType, extension: expected.extension };
}

function createRateLimiter({ windowMs, max }) {
    const attempts = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        const existing = attempts.get(key);
        const entry = !existing || existing.resetAt <= now
            ? { count: 0, resetAt: now + windowMs }
            : existing;
        entry.count += 1;
        attempts.set(key, entry);

        if (entry.count > max) {
            res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
            return res.status(429).json({ success: false, message: 'ลองใหม่อีกครั้งในภายหลัง' });
        }
        if (attempts.size > 10000) {
            for (const [attemptKey, value] of attempts) {
                if (value.resetAt <= now) attempts.delete(attemptKey);
            }
        }
        next();
    };
}

module.exports = {
    SESSION_COOKIE,
    SESSION_MAX_AGE_MS,
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
};
