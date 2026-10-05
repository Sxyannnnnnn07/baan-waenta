const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = require('../server');

test('Forgot password with Email OTP integration flow', async (t) => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    await app.initialization;
    const pool = app._test.dbPool;

    const testEmail = `forgot_test_${Date.now()}@teststore.com`;
    const testUsername = `user_fp_${Date.now()}`;
    const initialPassword = 'Initial#Pass123';
    const newPassword = 'BrandNew#Pass2026';

    let testUserId = null;
    let generatedDevOtp = null;

    // Create test user
    const initialHash = await bcrypt.hash(initialPassword, 12);
    const [userInsert] = await pool.query(
        'INSERT INTO users (name, email, password_hash, username, role) VALUES (?, ?, ?, ?, "customer")',
        ['Forgot Test User', testEmail, initialHash, testUsername]
    );
    testUserId = userInsert.insertId;

    t.after(async () => {
        try {
            await pool.query('DELETE FROM password_resets WHERE user_id = ?', [testUserId]);
            await pool.query('DELETE FROM sessions WHERE user_id = ?', [testUserId]);
            await pool.query('DELETE FROM users WHERE id = ?', [testUserId]);
        } catch (_) {}
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        if (app._test?.dbPool) {
            await app._test.dbPool.end();
        }
    });

    await t.test('1. Rejects invalid email format', async () => {
        const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'not-an-email' })
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
    });

    await t.test('2. Safely handles non-existent email without error', async () => {
        const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'non_existent_random_person@example.com' })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
    });

    await t.test('3. Successfully requests OTP for existing user and stores hashed OTP in DB', async () => {
        const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.devOtp, 'In dev/test environment without real SMTP, devOtp should be provided');
        generatedDevOtp = data.devOtp;

        // Verify database entry
        const [rows] = await pool.query('SELECT * FROM password_resets WHERE user_id = ? AND used = 0', [testUserId]);
        assert.equal(rows.length, 1, 'Should have 1 active reset request');
        assert.equal(rows[0].email, testEmail);
        assert.equal(rows[0].attempts, 0);
        assert.equal(rows[0].used, 0);
        assert.ok(rows[0].otp_hash && rows[0].otp_hash.length === 64, 'OTP must be hashed with sha256 (64 hex chars)');
    });

    await t.test('4. Rejects wrong OTP and increments attempts count', async () => {
        const res = await fetch(`${baseUrl}/api/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: '999999' })
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);

        const [rows] = await pool.query('SELECT attempts FROM password_resets WHERE user_id = ? AND used = 0', [testUserId]);
        assert.equal(rows[0].attempts, 1, 'Attempts counter must be incremented');
    });

    await t.test('5. Successfully verifies correct OTP', async () => {
        const res = await fetch(`${baseUrl}/api/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: generatedDevOtp })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
    });

    await t.test('6. Rejects weak password on reset', async () => {
        const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                otp: generatedDevOtp,
                newPassword: 'weak'
            })
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
    });

    await t.test('7. Successfully resets password with valid OTP and strong password', async () => {
        const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                otp: generatedDevOtp,
                newPassword: newPassword
            })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);

        // Verify password_resets marked as used
        const [rows] = await pool.query('SELECT used FROM password_resets WHERE user_id = ?', [testUserId]);
        assert.equal(rows[0].used, 1, 'Reset record must be marked as used');
    });

    await t.test('8. Rejects reusing the already-used OTP', async () => {
        const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                otp: generatedDevOtp,
                newPassword: 'Another#Pass2026'
            })
        });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.success, false);
    });

    await t.test('9. Can successfully login with the new password', async () => {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: testUsername,
                password: newPassword
            })
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.user.email, testEmail);
    });
});
