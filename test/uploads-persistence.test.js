const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');

test('Uploaded assets DB persistence and retrieval', async (t) => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const mysql = require('mysql2/promise');
    require('dotenv').config();
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT,
        ssl: { rejectUnauthorized: false }
    });

    await t.test('serves uploaded image from MySQL database when missing on disk', async () => {
        const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
        const testFileName = `test_persist_${Date.now()}.png`;
        const webPath = `/uploads/products/${testFileName}`;

        const diskPath = path.join(__dirname, '..', 'public', 'uploads', 'products', testFileName);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);

        await pool.query(
            'INSERT INTO uploaded_files (file_path, mime_type, file_size, chunk_index, chunk_data) VALUES (?, ?, ?, ?, ?)',
            [webPath, 'image/png', pngHeader.length, 0, pngHeader]
        );

        const res = await fetch(`http://localhost:${port}${webPath}`);
        assert.equal(res.status, 200, 'Should return 200 OK');
        assert.equal(res.headers.get('content-type'), 'image/png', 'Should have image/png content type');

        const arrayBuf = await res.arrayBuffer();
        const resBuf = Buffer.from(arrayBuf);
        assert.deepEqual(resBuf, pngHeader, 'Returned buffer must match stored buffer');

        await pool.query('DELETE FROM uploaded_files WHERE file_path = ?', [webPath]);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    });

    await t.test('serves 3D GLB model from MySQL database with model/gltf-binary content-type', async () => {
        const glbHeader = Buffer.from([0x67, 0x6C, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00]);
        const testModelName = `test_model_${Date.now()}.glb`;
        const webPath = `/uploads/models/${testModelName}`;

        const diskPath = path.join(__dirname, '..', 'public', 'uploads', 'models', testModelName);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);

        await pool.query(
            'INSERT INTO uploaded_files (file_path, mime_type, file_size, chunk_index, chunk_data) VALUES (?, ?, ?, ?, ?)',
            [webPath, 'model/gltf-binary', glbHeader.length, 0, glbHeader]
        );

        const res = await fetch(`http://localhost:${port}${webPath}`);
        assert.equal(res.status, 200, 'Should return 200 OK');
        assert.equal(res.headers.get('content-type'), 'model/gltf-binary', 'Should have model/gltf-binary content type');

        const arrayBuf = await res.arrayBuffer();
        const resBuf = Buffer.from(arrayBuf);
        assert.deepEqual(resBuf, glbHeader, 'Returned model buffer must match stored buffer');

        await pool.query('DELETE FROM uploaded_files WHERE file_path = ?', [webPath]);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    });

    await pool.end();
    await new Promise(resolve => server.close(resolve));
    if (app._test?.dbPool) {
        await app._test.dbPool.end();
    }
});
