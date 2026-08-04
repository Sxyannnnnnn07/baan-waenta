const mysql = require('mysql2/promise');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'baan_waenta',
    port: process.env.DB_PORT || 3306
};

async function test() {
    try {
        console.log('Connecting to database...');
        const conn = await mysql.createConnection(DB_CONFIG);
        console.log('Connected successfully!');

        console.log('\n--- Describing products table ---');
        const [desc] = await conn.query('DESCRIBE products');
        console.log(desc);

        console.log('\n--- Trying insert with empty image paths ---');
        try {
            const [result] = await conn.query(
                `INSERT INTO products (name, brand, category, frame_shape, image_url, tryon_image_url, price, stock) 
                 VALUES (?, ?, ?, ?, '', '', ?, ?)`,
                ['Test Frame', 'Test Brand', 'Optical', 'Round', 999.00, 10]
            );
            console.log('Insert successful! ID:', result.insertId);
            
            // Clean up
            await conn.query('DELETE FROM products WHERE id = ?', [result.insertId]);
            console.log('Cleaned up test row.');
        } catch (err) {
            console.error('Insert failed:', err.message);
        }

        await conn.end();
    } catch (e) {
        console.error('Database connection test failed:', e);
    }
}

test();
