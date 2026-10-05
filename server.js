// Load local configuration before reading any process.env values below.
// Deployment platforms can still provide environment variables normally;
// dotenv does not overwrite values that are already set by the host.
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const {
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
} = require('./lib/security');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, 'storage'));
const SLIP_STORAGE_DIR = path.join(STORAGE_DIR, 'slips');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '105484503874-92cu9940o9od95nb2pna8pr0kkf7pngi.apps.googleusercontent.com';
const ALLOWED_ORIGINS = [
    'https://baan-waenta.onrender.com',
    'https://baan-waenta.vercel.app',
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
];

function logServerError(label, error) {
    console.error(label, error);
    try {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
        fs.appendFileSync(path.join(STORAGE_DIR, 'error.log'), `[${new Date().toISOString()}] ${label}: ${error?.stack || error}\n`);
    } catch (_) {}
}

// Global process error logging
process.on('uncaughtException', (err) => {
    logServerError('Uncaught Exception', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logServerError('Unhandled Rejection', reason);
});

// Enable Helmet for security headers (matching Vercel's unblocked frontend environment)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

// Enable CORS only for explicitly trusted cross-origin clients. Same-origin requests are always allowed.
app.use(cors((req, callback) => {
    const origin = req.get('Origin');
    const forwardedProto = req.get('X-Forwarded-Proto')?.split(',')[0] || req.protocol;
    const sameOrigin = origin === `${forwardedProto}://${req.get('Host')}`;
    callback(null, {
        credentials: true,
        origin: !origin || sameOrigin || ALLOWED_ORIGINS.includes(origin)
    });
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Payment slips are private even when legacy deployments stored them below public/uploads.
app.use('/uploads/slips', (_req, res) => res.status(404).end());

// Case-insensitive fallback for model 5 file name
app.get(['/assets/models/Glasses%20Model%205.glb', '/assets/models/Glasses Model 5.glb'], (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'assets', 'models', 'glasses model 5.glb'));
});

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Database connection configuration (Defaults to typical localhost settings)
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'baan_waenta',
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 3,
    maxIdle: 2,
    idleTimeout: 15000,
    queueLimit: 0,
    ssl: (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1')) ? { rejectUnauthorized: false } : undefined
};

const dbPool = mysql.createPool(DB_CONFIG);

const DB_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per chunk to ensure queries never exceed MySQL max_allowed_packet

async function saveFileToDb(filePath, mimeType, buffer, executor = dbPool) {
    const db = executor || dbPool;
    if (!db) return;
    try {
        await db.query('DELETE FROM uploaded_files WHERE file_path = ?', [filePath]);
        const totalSize = buffer.length;
        const totalChunks = Math.ceil(totalSize / DB_CHUNK_SIZE) || 1;
        for (let i = 0; i < totalChunks; i++) {
            const start = i * DB_CHUNK_SIZE;
            const end = Math.min(start + DB_CHUNK_SIZE, totalSize);
            const chunk = buffer.subarray(start, end);
            await db.query(
                'INSERT INTO uploaded_files (file_path, mime_type, file_size, chunk_index, chunk_data) VALUES (?, ?, ?, ?, ?)',
                [filePath, mimeType, totalSize, i, chunk]
            );
        }
    } catch (err) {
        logServerError(`Save file to DB failed for ${filePath}`, err);
    }
}

async function getFileFromDb(filePath) {
    if (!dbPool) return null;
    try {
        const [rows] = await dbPool.query(
            'SELECT mime_type, chunk_data FROM uploaded_files WHERE file_path = ? ORDER BY chunk_index ASC',
            [filePath]
        );
        if (!rows || !rows.length) return null;
        const mimeType = rows[0].mime_type;
        const chunks = rows.map(r => r.chunk_data);
        return { mimeType, buffer: Buffer.concat(chunks) };
    } catch (err) {
        logServerError(`Get file from DB failed for ${filePath}`, err);
        return null;
    }
}

async function deleteFileFromDb(filePath) {
    if (!dbPool) return;
    try {
        await dbPool.query('DELETE FROM uploaded_files WHERE file_path = ?', [filePath]);
    } catch (err) {
        logServerError(`Delete file from DB failed for ${filePath}`, err);
    }
}

// Persistent storage fallback for uploaded assets (images, 3D models) from MySQL
app.get(['/uploads/*', '/assets/products/*'], async (req, res, next) => {
    if (req.path.startsWith('/uploads/slips')) {
        return res.status(404).end();
    }
    try {
        const reqPath = decodeURIComponent(req.path);
        const file = await getFileFromDb(reqPath);
        if (file) {
            // Write to disk cache if possible
            try {
                const diskPath = path.join(__dirname, 'public', reqPath);
                fs.mkdirSync(path.dirname(diskPath), { recursive: true });
                fs.writeFileSync(diskPath, file.buffer);
            } catch (_) {}

            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.send(file.buffer);
        }
    } catch (err) {
        logServerError('Error serving upload from DB fallback', err);
    }
    next();
});

let isDbInitialized = false;

// Connect to MySQL and initialize tables/data with auto-retry
async function initDB(retries = 5) {
    if (isDbInitialized) return;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const isLocal = DB_CONFIG.host === 'localhost' || DB_CONFIG.host === '127.0.0.1';
            
            if (isLocal) {
                // First connect without specifying DB to ensure it exists (local development only)
                const initConnection = await mysql.createConnection({
                    host: DB_CONFIG.host,
                    user: DB_CONFIG.user,
                    password: DB_CONFIG.password,
                    port: DB_CONFIG.port
                });
                
                await initConnection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
                await initConnection.end();
            }

            // Idempotent schema migrations must also run against hosted databases.
            await setupTables();
            await seedData();

            isDbInitialized = true;
            console.log(`Connected to MySQL database: ${DB_CONFIG.database}`);
            return;

        } catch (error) {
            console.error(`DATABASE CONNECTION ATTEMPT ${attempt}/${retries} FAILED:`, error.message);
            if (attempt < retries) {
                const waitSec = attempt * 2;
                console.log(`Retrying DB connection in ${waitSec}s (waiting for existing connections to release)...`);
                await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
            } else {
                console.error('========================================================');
                console.error('DATABASE CONNECTION ERROR:');
                console.error(error.message);
                console.error('========================================================');
            }
        }
    }
}

async function setupTables() {
    // 1. Users Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'customer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    // 2. Products Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            brand VARCHAR(255) NOT NULL,
            category VARCHAR(100) NOT NULL,
            frame_shape VARCHAR(100) NOT NULL,
            image_url VARCHAR(255) NOT NULL,
            tryon_image_url VARCHAR(255) NOT NULL,
            model_3d_url VARCHAR(255) DEFAULT NULL,
            scale_x DECIMAL(10,4) DEFAULT 1.0000,
            scale_y DECIMAL(10,4) DEFAULT 1.0000,
            scale_z DECIMAL(10,4) DEFAULT 1.0000,
            offset_y DECIMAL(10,4) DEFAULT 0.0000,
            price DECIMAL(10,2) NOT NULL,
            stock INT NOT NULL,
            gallery_images LONGTEXT NULL
        ) ENGINE=InnoDB
    `);

    // 3. Prescriptions Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS prescriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            sphere_left DECIMAL(5,2) DEFAULT 0.00,
            sphere_right DECIMAL(5,2) DEFAULT 0.00,
            cylinder_left DECIMAL(5,2) DEFAULT 0.00,
            cylinder_right DECIMAL(5,2) DEFAULT 0.00,
            axis_left INT DEFAULT 0,
            axis_right INT DEFAULT 0,
            pd DECIMAL(5,2) DEFAULT 60.00,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    // 4. Lenses Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS lenses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lens_type VARCHAR(100) NOT NULL,
            price_addon DECIMAL(10,2) NOT NULL
        ) ENGINE=InnoDB
    `);

    // 5. Orders Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            shipping_name VARCHAR(255) NULL,
            shipping_phone VARCHAR(50) NULL,
            shipping_address TEXT NULL,
            payment_method VARCHAR(100) DEFAULT 'COD',
            slip_image VARCHAR(255) NULL,
            tracking_number VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    // Self-healing: Add columns if table already exists
    try {
        await dbPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery_images LONGTEXT NULL");
        await dbPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_name VARCHAR(255) NULL");
        await dbPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_phone VARCHAR(50) NULL");
        await dbPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT NULL");
        await dbPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100) DEFAULT 'COD'");
        await dbPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS slip_image VARCHAR(255) NULL");
        await dbPool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100) NULL");
    } catch (err) {
        // Column already exists or ALTER IF NOT EXISTS not supported, safe to skip
    }

    // 6. Order Items Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            unit_price DECIMAL(10,2) NOT NULL,
            lens_id INT NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (lens_id) REFERENCES lenses(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    // 6. Reviews Table
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            rating INT NOT NULL,
            comment TEXT NOT NULL,
            product_name VARCHAR(255) DEFAULT 'แว่นตาทั่วไป',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    // Safe column addition migration
    try {
        await dbPool.query("ALTER TABLE reviews ADD COLUMN product_name VARCHAR(255) DEFAULT 'แว่นตาทั่วไป'");
    } catch (err) {
        // column already exists, safe to ignore
    }
    try {
        await dbPool.query("ALTER TABLE reviews ADD COLUMN avatar_url LONGTEXT DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE reviews MODIFY COLUMN avatar_url LONGTEXT DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE users ADD COLUMN avatar_url LONGTEXT DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE users MODIFY COLUMN avatar_url LONGTEXT DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE products MODIFY COLUMN image_url LONGTEXT NOT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE products MODIFY COLUMN tryon_image_url LONGTEXT NOT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE users ADD COLUMN username VARCHAR(255) DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("UPDATE users SET username = name WHERE username IS NULL OR username = ''");
    } catch (err) {}
    try {
        await dbPool.query("CREATE UNIQUE INDEX users_username_unique ON users (username)");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("CREATE UNIQUE INDEX users_google_sub_unique ON users (google_sub)");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE reviews ADD COLUMN user_id INT DEFAULT NULL");
    } catch (err) {}
    try {
        await dbPool.query("ALTER TABLE reviews ADD CONSTRAINT reviews_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL");
    } catch (err) {}

    // Server-side sessions. Only a SHA-256 hash of the browser token is stored.
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            csrf_token VARCHAR(128) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX sessions_user_id_idx (user_id),
            INDEX sessions_expires_at_idx (expires_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);

    // Persistent Uploaded Files Table (Images, 3D Models, Slips)
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS uploaded_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            file_path VARCHAR(255) NOT NULL,
            mime_type VARCHAR(100) NOT NULL,
            file_size INT NOT NULL,
            chunk_index INT NOT NULL DEFAULT 0,
            chunk_data MEDIUMBLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_file_path (file_path),
            INDEX idx_path_chunk (file_path, chunk_index)
        ) ENGINE=InnoDB
    `);

    // 7. Password Resets Table (Email OTP)
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            email VARCHAR(255) NOT NULL,
            otp_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            attempts INT NOT NULL DEFAULT 0,
            used TINYINT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_email (email),
            INDEX idx_expires (expires_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);
}

async function seedData() {
    // Seed Lenses
    await dbPool.query(`
        INSERT INTO lenses (id, lens_type, price_addon) VALUES
        (1, 'เลนส์ธรรมดา (Normal Lens)', 0.00),
        (2, 'เลนส์กรองแสงสีฟ้า (Blue Block)', 500.00),
        (3, 'เลนส์ปรับแสงออโต้ตามแดด (Photochromic)', 1000.00)
        ON DUPLICATE KEY UPDATE lens_type=VALUES(lens_type), price_addon=VALUES(price_addon)
    `);

    // Seed Reviews if empty
    const [existingReviews] = await dbPool.query('SELECT * FROM reviews LIMIT 1');
    if (existingReviews.length === 0) {
        console.log('Seeding initial reviews...');
        await dbPool.query(`
            INSERT INTO reviews (user_name, rating, comment, product_name) VALUES
            ('คุณ ศิริพร พ.', 5, 'ทดลองลองแว่นตาออนไลน์สะดวกมากค่ะ ระบบ VTO วางแว่นตาได้เข้ากับโครงหน้าอย่างน่าประหลาด สั่งตัดเลนส์กรองแสงไป ไม่ถึง 3 วันของส่งถึงหน้าบ้าน รวดเร็วประทับใจค่ะ', 'แว่นตาทรงกลมสีกระปัดเงา (Round Tortoise)'),
            ('คุณ เอกชัย ช.', 5, 'แว่นตาทรง Modern Square Clear ตรงปกมากครับ คุณภาพดีแข็งแรง น้ำหนักเบาใส่สบาย มีบริการให้คำแนะนำการใส่ค่าสายตาตอนตัดเลนส์ด้วย แอดมินบริการดีมาก', 'แว่นตาเหลี่ยมสีกระสว่าง (Modern Square Clear)'),
            ('คุณ ซาฮีรัม จ.', 5, 'ระบบมีแอปดีไซน์ขาวเทามินิมอลหรูหรามากครับ หน้า VTO แบบใหม่ช่วยให้เทียบขนาดแว่นได้ง่ายสุดๆ ไม่ต้องเดาสุ่มขนาด สั่งซื้อมาแล้วสวมใส่ได้พอดีหน้า แนะนำร้านนี้เลย!', 'แว่นตาโลหะโรสโกลด์ (Rose Gold CatEye)')
        `);
    } else {
        // Backfill existing seed data with product names
        await dbPool.query("UPDATE reviews SET product_name = 'แว่นตาทรงกลมสีกระปัดเงา (Round Tortoise)' WHERE id = 1 AND (product_name = 'แว่นตาทั่วไป' OR product_name IS NULL)");
        await dbPool.query("UPDATE reviews SET product_name = 'แว่นตาเหลี่ยมสีกระสว่าง (Modern Square Clear)' WHERE id = 2 AND (product_name = 'แว่นตาทั่วไป' OR product_name IS NULL)");
        await dbPool.query("UPDATE reviews SET product_name = 'แว่นตาโลหะโรสโกลด์ (Rose Gold CatEye)' WHERE id = 3 AND (product_name = 'แว่นตาทั่วไป' OR product_name IS NULL)");
    }

    // Optional first-run admin bootstrap. Existing users are never overwritten.
    const [existingUsers] = await dbPool.query('SELECT * FROM users LIMIT 1');
    if (existingUsers.length === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        if (!isEmail(process.env.ADMIN_EMAIL) || !isStrongPassword(process.env.ADMIN_PASSWORD)) {
            throw new Error('ADMIN_EMAIL or ADMIN_PASSWORD does not meet validation requirements');
        }
        const adminName = cleanText(process.env.ADMIN_NAME || 'admin', 255);
        const adminPasswordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        await dbPool.query(
            'INSERT INTO users (name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [adminName, adminName, process.env.ADMIN_EMAIL.toLowerCase(), adminPasswordHash, 'admin']
        );
        console.log('Initial admin created from environment configuration.');
    }

    // Add 3D columns migration
    try {
        await dbPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS model_3d_url VARCHAR(255) DEFAULT NULL");
        await dbPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS scale_x DECIMAL(10,4) DEFAULT 1.0000");
        await dbPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS scale_y DECIMAL(10,4) DEFAULT 1.0000");
        await dbPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS scale_z DECIMAL(10,4) DEFAULT 1.0000");
        await dbPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS offset_y DECIMAL(10,4) DEFAULT 0.0000");
    } catch (err) {}

    // Seed Products
    console.log('Verifying and seeding products database...');
    const defaultProducts = [
        {
            name: "Prada Vintage Star (3D AR Edition)",
            brand: "Prada",
            category: "Sunglasses",
            frame_shape: "Square",
            image_url: "/assets/prada_front.jpg",
            tryon_image_url: "/assets/prada_front.jpg",
            model_3d_url: "/assets/models/prada_vintage.glb",
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_y: 0.0,
            price: 15900.00,
            stock: 5
        },
        {
            name: "Modern Half-Rim Square (3D AR Edition)",
            brand: "Baan Waenta",
            category: "Optical",
            frame_shape: "Square",
            image_url: "/assets/1.png",
            tryon_image_url: "/assets/1.png",
            model_3d_url: "/assets/models/glasses 2.glb",
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_y: 0.0,
            price: 1290.00,
            stock: 15
        },
        {
            name: "Crystal Pantos Vintage (3D AR Edition)",
            brand: "Baan Waenta",
            category: "Optical",
            frame_shape: "Round",
            image_url: "/assets/3.1.png",
            tryon_image_url: "/assets/3.1.png",
            model_3d_url: "/assets/models/glasses 3.glb",
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_y: 0.0,
            price: 1490.00,
            stock: 15
        },
        {
            name: "Classic Retro Round Gold (3D AR Edition)",
            brand: "Baan Waenta",
            category: "Optical",
            frame_shape: "Round",
            image_url: "/assets/4.1.png",
            tryon_image_url: "/assets/4.1.png",
            model_3d_url: "/assets/models/glasses model4.glb",
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_y: 0.0,
            price: 1390.00,
            stock: 15
        },
        {
            name: "Viper Sport Shield Rainbow (3D AR Edition)",
            brand: "Baan Waenta",
            category: "Sunglasses",
            frame_shape: "Square",
            image_url: "/assets/5.1.png",
            tryon_image_url: "/assets/5.1.png",
            model_3d_url: "/assets/models/glasses model 5.glb",
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            offset_y: 0.0,
            price: 1290.00,
            stock: 15
        }
    ];

    // Seed Products (only if products table is empty)
    const [existingProducts] = await dbPool.query('SELECT id FROM products LIMIT 1');
    if (existingProducts.length === 0) {
        console.log('Seeding initial products database...');
        for (const prod of defaultProducts) {
            await dbPool.query(
                `INSERT INTO products (name, brand, category, frame_shape, image_url, tryon_image_url, model_3d_url, scale_x, scale_y, scale_z, offset_y, price, stock) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                 [prod.name, prod.brand, prod.category, prod.frame_shape, prod.image_url, prod.tryon_image_url, prod.model_3d_url, prod.scale_x, prod.scale_y, prod.scale_z, prod.offset_y, prod.price, prod.stock]
            );
        }
    }

    // Clean up any accidental duplicates created by legacy seeding
    try {
        await dbPool.query("DELETE FROM products WHERE id >= 37 AND name LIKE '%(3D AR Edition)%'");
    } catch (_) {}
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        username: user.username || user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role
    };
}

async function startSession(userId, req, res) {
    const token = randomToken();
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
    await dbPool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    await dbPool.query(
        'INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES (?, ?, ?, ?)',
        [userId, hashToken(token), csrfToken, expiresAt]
    );
    const secure = IS_PRODUCTION || req.get('X-Forwarded-Proto') === 'https';
    res.setHeader('Set-Cookie', serializeSessionCookie(token, { secure }));
    return csrfToken;
}

async function loadSession(req, _res, next) {
    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    if (!token) return next();
    try {
        const [rows] = await dbPool.query(
            `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
                    u.id, u.name, u.username, u.email, u.avatar_url, u.role
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > NOW()
             LIMIT 1`,
            [hashToken(token)]
        );
        if (rows.length) {
            req.session = rows[0];
            req.user = rows[0];
        }
        next();
    } catch (error) {
        next(error);
    }
}

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดำเนินการ' });
    next();
}

function requireTrustedOrigin(req, res, next) {
    const origin = req.get('Origin');
    if (!origin) return next();
    const forwardedProto = req.get('X-Forwarded-Proto')?.split(',')[0] || req.protocol;
    const sameOrigin = origin === `${forwardedProto}://${req.get('Host')}`;
    if (!sameOrigin && !ALLOWED_ORIGINS.includes(origin)) {
        return res.status(403).json({ success: false, message: 'Origin ไม่ได้รับอนุญาต' });
    }
    next();
}

function requireCsrf(req, res, next) {
    const token = req.get('X-CSRF-Token');
    const expected = req.session?.csrf_token;
    if (!token || !expected || token.length !== expected.length) {
        return res.status(403).json({ success: false, message: 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย' });
    }
    const tokenBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    if (!require('crypto').timingSafeEqual(tokenBuffer, expectedBuffer)) {
        return res.status(403).json({ success: false, message: 'คำขอไม่ผ่านการตรวจสอบความปลอดภัย' });
    }

    requireTrustedOrigin(req, res, next);
}

function sendServerError(res, error, label) {
    logServerError(label, error);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' });
}

async function savePublicImageData(dataUrl, prefix, maxBytes = 5 * 1024 * 1024, executor = dbPool) {
    const { buffer, extension } = decodeImageDataUrl(dataUrl, maxBytes);
    const fileName = `${prefix}_${randomToken(12)}.${extension}`;
    const webPath = `/uploads/products/${fileName}`;
    const mimeType = extension === 'png' ? 'image/png' : (extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/webp');

    try {
        const dirPath = path.join(__dirname, 'public', 'uploads', 'products');
        fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(path.join(dirPath, fileName), buffer, { flag: 'wx' });
    } catch (fsErr) {
        console.warn('Could not write image to local disk cache:', fsErr.message);
    }

    await saveFileToDb(webPath, mimeType, buffer, executor);
    return webPath;
}

function decodeModelDataUrl(dataUrl, maxBytes = 50 * 1024 * 1024) {
    if (typeof dataUrl !== 'string') throw new Error('Invalid model data');
    const match = /^data:(?:application\/octet-stream|model\/gltf-binary|application\/x-gltf-binary);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    const base64Data = match ? match[1] : dataUrl.split(',')[1] || dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length || buffer.length > maxBytes) throw new Error('Model is empty or too large');
    
    // Check GLB magic number 0x46546C67 (little-endian for 'glTF') or 0x676C5446 (big-endian)
    const magic = buffer.readUInt32BE(0);
    if (magic !== 0x676c5446 && magic !== 0x67546c46 && magic !== 0x46546c67) {
        throw new Error('Invalid GLB model file');
    }
    return { buffer, extension: 'glb' };
}

async function savePublicModelData(dataUrl, prefix, executor = dbPool) {
    const { buffer, extension } = decodeModelDataUrl(dataUrl);
    const fileName = `${prefix}_${randomToken(12)}.${extension}`;
    const webPath = `/uploads/models/${fileName}`;
    const mimeType = 'model/gltf-binary';

    try {
        const dirPath = path.join(__dirname, 'public', 'uploads', 'models');
        fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(path.join(dirPath, fileName), buffer, { flag: 'wx' });
    } catch (fsErr) {
        console.warn('Could not write model to local disk cache:', fsErr.message);
    }

    await saveFileToDb(webPath, mimeType, buffer, executor);
    return webPath;
}

function getEmailTransporter(overridePort = null) {
    const user = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const pass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : '';

    if (!user || !pass || pass === 'your_gmail_app_password_here') {
        return null;
    }

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    // Port 587 (STARTTLS) is officially required by Render, AWS and cloud firewalls
    const port = overridePort || parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = port === 465;

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000
    });
}

async function sendResetOtpEmail(toEmail, otp) {
    let transporter = getEmailTransporter();
    if (!transporter) {
        console.log('========================================================');
        console.log('[DEV FALLBACK] FORGOT PASSWORD OTP:');
        console.log(`To: ${toEmail}`);
        console.log(`OTP: ${otp} (Valid for 15 minutes)`);
        console.log('Configure SMTP_USER and SMTP_PASS in .env to deliver real emails.');
        console.log('========================================================');
        return { delivered: false, devFallback: true };
    }

    const user = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
    const fromAddress = `"บ้านแว่นตา (Baan Waenta)" <${user}>`;
    const mailOptions = {
        from: fromAddress,
        to: toEmail,
        subject: `[บ้านแว่นตา] รหัสยืนยันการตั้งรหัสผ่านใหม่: ${otp}`,
        text: `สวัสดีครับ/ค่ะ,\n\nรหัส OTP สำหรับตั้งรหัสผ่านใหม่ของคุณคือ: ${otp}\nรหัสนี้จะหมดอายุภายใน 15 นาที\n\nหากคุณไม่ได้ร้องขอ โปรดเพิกเฉยต่ออีเมลนี้`,
        html: `
        <div style="font-family: 'Prompt', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #0f172a; margin: 0; font-size: 24px;">บ้านแว่นตา<span style="color: #2563eb;">.store</span></h2>
                <p style="color: #64748b; font-size: 14px; margin-top: 4px;">ระบบตั้งรหัสผ่านใหม่</p>
            </div>
            <p style="color: #334155; font-size: 15px; line-height: 1.6;">
                สวัสดีครับ/ค่ะ,<br>
                เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีที่ผูกกับอีเมลนี้ กรุณาใช้รหัส OTP 6 หลักด้านล่างนี้เพื่อตั้งรหัสผ่านใหม่:
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1e40af; background: #eff6ff; padding: 14px 28px; border-radius: 10px; border: 1px dashed #3b82f6;">
                    ${otp}
                </span>
            </div>
            <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
                ⏱️ รหัส OTP นี้จะหมดอายุภายใน <strong>15 นาที</strong><br>
                🔒 หากท่านไม่ได้ทำการขอรีเซ็ตรหัสผ่าน โปรดเพิกเฉยต่ออีเมลฉบับนี้ บัญชีของท่านยังคงปลอดภัย
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
                ทีมงาน บ้านแว่นตา (Baan Waenta Store)<br>
                อีเมลนี้เป็นการแจ้งเตือนอัตโนมัติ กรุณาอย่าตอบกลับ
            </p>
        </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return { delivered: true, devFallback: false };
    } catch (primaryErr) {
        logServerError('Primary SMTP port delivery failed, attempting fallback port', primaryErr);
        const altPort = (transporter.options && transporter.options.port === 587) ? 465 : 587;
        const fallbackTransporter = getEmailTransporter(altPort);
        if (fallbackTransporter) {
            try {
                await fallbackTransporter.sendMail(mailOptions);
                return { delivered: true, devFallback: false };
            } catch (fallbackErr) {
                logServerError('Fallback SMTP delivery also failed', fallbackErr);
            }
        }
        throw new Error(`ไม่สามารถส่งอีเมล OTP ได้ (${primaryErr.message}) กรุณาลองใหม่อีกครั้ง`);
    }
}

const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const forgotPasswordRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api', loadSession);

// ==========================================
// REST API ENDPOINTS
// ==========================================

app.get('/api/config', (_req, res) => {
    res.json({ success: true, googleClientId: GOOGLE_CLIENT_ID });
});

// 1. Authentication: Login
app.post('/api/auth/login', requireTrustedOrigin, authRateLimit, async (req, res) => {
    const username = cleanText(req.body.username, 255);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!username || !password || password.length > 128) {
        return res.status(400).json({ success: false, message: 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง' });
    }
    try {
        const [users] = await dbPool.query('SELECT * FROM users WHERE name = ? OR username = ?', [username, username]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
        const user = users[0];
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
        }
        const csrfToken = await startSession(user.id, req, res);
        res.json({
            success: true,
            user: publicUser(user),
            csrfToken
        });
    } catch (error) {
        sendServerError(res, error, 'Login failed');
    }
});

// 2. Authentication: Register
app.post('/api/auth/register', requireTrustedOrigin, authRateLimit, async (req, res) => {
    const username = cleanText(req.body.username, 80);
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!username || !isEmail(email) || !isStrongPassword(password)) {
        return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้ อีเมล หรือรหัสผ่านไม่ถูกต้อง' });
    }
    try {
        const [existing] = await dbPool.query('SELECT * FROM users WHERE name = ? OR username = ? OR email = ?', [username, username, email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งานหรืออีเมลนี้ถูกใช้ไปแล้ว' });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const [result] = await dbPool.query(
            'INSERT INTO users (name, email, password_hash, username, role) VALUES (?, ?, ?, ?, "customer")',
            [username, email, passwordHash, username]
        );

        res.json({
            success: true,
            userId: result.insertId,
            message: 'สมัครสมาชิกสำเร็จ'
        });
    } catch (error) {
        sendServerError(res, error, 'Registration failed');
    }
});

// 2.5 Authentication: Google Sign-in/Sign-up
app.post('/api/auth/google', requireTrustedOrigin, authRateLimit, async (req, res) => {
    const accessToken = typeof req.body.access_token === 'string' ? req.body.access_token : '';
    if (!accessToken || accessToken.length > 4096) {
        return res.status(400).json({ success: false, message: 'Google token ไม่ถูกต้อง' });
    }
    try {
        const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
            signal: AbortSignal.timeout(10000)
        });
        if (!tokenInfoResponse.ok) return res.status(401).json({ success: false, message: 'Google token ไม่ถูกต้องหรือหมดอายุ' });
        const tokenInfo = await tokenInfoResponse.json();
        const tokenClientId = tokenInfo.aud || tokenInfo.audience || tokenInfo.azp || tokenInfo.issued_to;
        if (tokenInfo.expires_in && Number(tokenInfo.expires_in) <= 0) {
            return res.status(401).json({ success: false, message: 'Google token หมดอายุแล้ว' });
        }
        if (tokenClientId && tokenClientId !== GOOGLE_CLIENT_ID) {
            console.error('Google token client mismatch:', { tokenClientId, expected: GOOGLE_CLIENT_ID, tokenInfo });
            return res.status(401).json({ success: false, message: 'Google token ไม่ได้ออกให้แอปนี้' });
        }

        const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000)
        });
        if (!profileResponse.ok) return res.status(401).json({ success: false, message: 'ไม่สามารถยืนยันบัญชี Google ได้' });
        const profile = await profileResponse.json();
        const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
        const name = cleanText(profile.name, 255) || (email ? email.split('@')[0] : 'Google User');
        const googleSub = cleanText(profile.sub, 255) || cleanText(tokenInfo.user_id, 255);
        const avatar = typeof profile.picture === 'string' && profile.picture.length <= 2048 ? profile.picture : null;
        if (!isEmail(email) || !name || !googleSub) {
            return res.status(401).json({ success: false, message: 'ไม่สามารถดึงข้อมูลอีเมลจากบัญชี Google ได้' });
        }

        const [users] = await dbPool.query('SELECT * FROM users WHERE google_sub = ? OR email = ? LIMIT 1', [googleSub, email]);
        let user = users[0];
        let generatedUsername = `${email.split('@')[0]}_${googleSub.slice(-8)}_google`;
        if (generatedUsername.length > 80) generatedUsername = generatedUsername.slice(0, 80);

        if (user) {
            await dbPool.query(
                'UPDATE users SET google_sub = ?, name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
                [googleSub, name, avatar, user.id]
            );
            const [updatedUsers] = await dbPool.query('SELECT * FROM users WHERE id = ?', [user.id]);
            user = updatedUsers[0];
        } else {
            const dummyPassword = await bcrypt.hash(randomToken(), 12);
            let uniqueUsername = generatedUsername;
            const [existing] = await dbPool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [uniqueUsername]);
            if (existing.length > 0) {
                uniqueUsername = `${email.split('@')[0]}_${randomToken(6)}`;
            }
            const [result] = await dbPool.query(
                'INSERT INTO users (name, email, password_hash, avatar_url, username, google_sub, role) VALUES (?, ?, ?, ?, ?, ?, "customer")',
                [name, email, dummyPassword, avatar, uniqueUsername, googleSub]
            );
            const [newUsers] = await dbPool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
            user = newUsers[0];
        }

        const csrfToken = await startSession(user.id, req, res);
        res.json({ success: true, user: publicUser(user), csrfToken });
    } catch (error) {
        sendServerError(res, error, 'Google authentication failed');
    }
});

// 2.51 Authentication: Request Password Reset OTP
app.post('/api/auth/forgot-password', requireTrustedOrigin, forgotPasswordRateLimit, async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    if (!isEmail(email) || !name) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกอีเมลและชื่อ-นามสกุลให้ครบถ้วน' });
    }

    try {
        const [users] = await dbPool.query('SELECT id, email, name FROM users WHERE email = ? LIMIT 1', [email]);
        
        if (users.length === 0) {
            // Anti-enumeration delay
            await new Promise(resolve => setTimeout(resolve, 800));
            return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งานที่ตรงกับข้อมูลนี้ในระบบ' });
        }

        const user = users[0];
        
        // Strict case-insensitive and space-insensitive comparison
        if (user.name.toLowerCase().replace(/\s+/g, '') !== name.toLowerCase().replace(/\s+/g, '')) {
            await new Promise(resolve => setTimeout(resolve, 800));
            return res.status(400).json({ success: false, message: 'ข้อมูลชื่อ-นามสกุลไม่ตรงกับในระบบ' });
        }

        // Generate a temporary reset token (instead of OTP)
        const resetToken = randomToken(32);
        const tokenHash = hashToken(resetToken);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await dbPool.query('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0', [email]);
        await dbPool.query(
            'INSERT INTO password_resets (user_id, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, email, tokenHash, expiresAt]
        );

        res.json({
            success: true,
            message: 'ยืนยันตัวตนสำเร็จ',
            resetToken: resetToken
        });
    } catch (error) {
        sendServerError(res, error, 'Forgot password request failed');
    }
});

// 2.53 Authentication: Reset Password with Verified Token
app.post('/api/auth/reset-password', requireTrustedOrigin, forgotPasswordRateLimit, async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const resetToken = typeof req.body.resetToken === 'string' ? req.body.resetToken.trim() : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    if (!isEmail(email) || !resetToken) {
        return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง' });
    }

    if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
            success: false,
            message: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร และมีทั้งตัวอักษรและตัวเลขหรือสัญลักษณ์พิเศษ'
        });
    }

    try {
        const [records] = await dbPool.query(
            'SELECT * FROM password_resets WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1',
            [email]
        );

        if (records.length === 0) {
            return res.status(400).json({ success: false, message: 'ไม่พบคำขอรีเซ็ตรหัสผ่าน หรือคำขอถูกใช้งานไปแล้ว' });
        }

        const record = records[0];
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: 'เซสชั่นการตั้งรหัสผ่านหมดอายุแล้ว กรุณาเริ่มใหม่' });
        }

        if (hashToken(resetToken) !== record.otp_hash) {
            return res.status(400).json({ success: false, message: 'ข้อมูลยืนยันตัวตนไม่ถูกต้อง' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await dbPool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, record.user_id]);
        await dbPool.query('UPDATE password_resets SET used = 1 WHERE id = ?', [record.id]);
        await dbPool.query('DELETE FROM sessions WHERE user_id = ?', [record.user_id]);

        res.json({
            success: true,
            message: 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่'
        });
    } catch (error) {
        sendServerError(res, error, 'Reset password failed');
    }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: publicUser(req.user), csrfToken: req.session.csrf_token });
});

app.post('/api/auth/logout', requireAuth, requireCsrf, async (req, res) => {
    try {
        await dbPool.query('DELETE FROM sessions WHERE id = ?', [req.session.session_id]);
        const secure = IS_PRODUCTION || req.get('X-Forwarded-Proto') === 'https';
        res.setHeader('Set-Cookie', clearSessionCookie(secure));
        res.json({ success: true });
    } catch (error) {
        sendServerError(res, error, 'Logout failed');
    }
});

// 2.6 Update User Profile Details
app.post('/api/auth/update-profile', requireAuth, requireCsrf, async (req, res) => {
    const name = cleanText(req.body.name, 255);
    const username = cleanText(req.body.username, 80);
    try {
        if (!name || !username) {
            return res.status(400).json({ success: false, message: 'ชื่อหรือชื่อผู้ใช้ไม่ถูกต้อง' });
        }
        const [existing] = await dbPool.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.id]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว' });
        }
        await dbPool.query('UPDATE users SET name = ?, username = ? WHERE id = ?', [name, username, req.user.id]);
        await dbPool.query('UPDATE reviews SET user_name = ? WHERE user_id = ?', [`คุณ ${name}`, req.user.id]);
        const [rows] = await dbPool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        res.json({ success: true, user: publicUser(rows[0]), message: 'อัปเดตข้อมูลสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Update profile failed');
    }
});

// 2.7 Update User Avatar (Profile Picture)
app.post('/api/auth/update-avatar', requireAuth, requireCsrf, async (req, res) => {
    const { avatar_data } = req.body;
    try {
        if (!avatar_data) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        }
        decodeImageDataUrl(avatar_data, 2 * 1024 * 1024);
        await dbPool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_data, req.user.id]);
        await dbPool.query('UPDATE reviews SET avatar_url = ? WHERE user_id = ?', [avatar_data, req.user.id]);
        res.json({ success: true, avatar_url: avatar_data, message: 'อัปเดตรูปโปรไฟล์สำเร็จ' });
    } catch (error) {
        if (/image|format|large|WebP/i.test(error.message)) {
            return res.status(400).json({ success: false, message: 'รูปภาพไม่ถูกต้องหรือมีขนาดเกิน 2 MB' });
        }
        sendServerError(res, error, 'Update avatar failed');
    }
});

// 3. Products: List all
app.get('/api/products', async (req, res) => {
    try {
        const [products] = await dbPool.query('SELECT * FROM products');
        res.json({ success: true, products });
    } catch (error) {
        sendServerError(res, error, 'List products failed');
    }
});

// 4. Products: Add (Admin Only)
app.post('/api/products', requireAdmin, requireCsrf, async (req, res) => {
    const name = cleanText(req.body.name, 255);
    const brand = cleanText(req.body.brand, 255);
    const category = ['Optical', 'Sunglasses'].includes(req.body.category) ? req.body.category : null;
    const frameShape = ['Round', 'Square', 'Aviator', 'Oval', 'CatEye'].includes(req.body.frame_shape) ? req.body.frame_shape : null;
    const price = numberInRange(req.body.price, 0, 1000000);
    const stock = integerInRange(req.body.stock, 0, 1000000);
    const imageUrl = req.body.image_url;
    const tryonImageUrl = req.body.tryon_image_url;
    const model3d = req.body.model_3d; // optional 3D model base64

    if (!name || !brand || !category || !frameShape || price === null || stock === null) {
        return res.status(400).json({ success: false, message: 'ข้อมูลสินค้าไม่ถูกต้อง' });
    }
    try {
        const conn = await dbPool.getConnection();
        await conn.beginTransaction();

        try {
            // Insert product with temporary empty image values to get insertId
            const [result] = await conn.query(
                `INSERT INTO products (name, brand, category, frame_shape, image_url, tryon_image_url, model_3d_url, price, stock) 
                 VALUES (?, ?, ?, ?, '', '', NULL, ?, ?)`,
                [name, brand, category, frameShape, price, stock]
            );
            const productId = result.insertId;

            let finalImageUrl = '/assets/round.svg';
            let finalTryonUrl = '/assets/round.svg';
            let finalModelUrl = null;

            // Save 3D Model to disk and DB if provided (.glb only)
            if (model3d) {
                try {
                    finalModelUrl = await savePublicModelData(model3d, `model_${productId}`, conn);
                } catch (modelErr) {
                    throw new Error(`Invalid 3D model: ${modelErr.message}`);
                }
            }

            // Process gallery images (1 to 5 images, PNG format only) in parallel
            let rawGallery = [];
            if (Array.isArray(req.body.gallery_images) && req.body.gallery_images.length > 0) {
                rawGallery = req.body.gallery_images.filter(img => typeof img === 'string' && img.trim().length > 0);
            } else if (imageUrl) {
                rawGallery = [imageUrl];
            }

            if (rawGallery.length === 0) {
                throw new Error('Missing product image');
            }

            for (let i = 0; i < rawGallery.length; i++) {
                const imgData = rawGallery[i];
                if (imgData.startsWith('data:image/') && !imgData.startsWith('data:image/png')) {
                    throw new Error('รูปภาพต้องเป็นไฟล์ PNG เท่านั้น');
                }
            }

            const imagePromises = rawGallery.map((imgData, i) => {
                if (imgData.startsWith('data:image/')) {
                    return savePublicImageData(imgData, `product_${productId}_img${i + 1}`, 5 * 1024 * 1024, conn);
                } else if (typeof imgData === 'string' && (imgData.startsWith('/assets/') || imgData.startsWith('/uploads/'))) {
                    return Promise.resolve(imgData);
                }
                throw new Error('Missing product image');
            });

            const savedGalleryUrls = await Promise.all(imagePromises);

            if (savedGalleryUrls.length === 0) {
                throw new Error('Missing product image');
            }

            finalImageUrl = savedGalleryUrls[0];
            finalTryonUrl = savedGalleryUrls[0];
            const finalGalleryJson = JSON.stringify(savedGalleryUrls);

            // Update database with the finalized upload file paths
            await conn.query(
                'UPDATE products SET image_url = ?, tryon_image_url = ?, model_3d_url = ?, gallery_images = ? WHERE id = ?',
                [finalImageUrl, finalTryonUrl, finalModelUrl, finalGalleryJson, productId]
            );

            await conn.commit();
            conn.release();
            res.json({ success: true, productId, message: 'เพิ่มสินค้าสำเร็จ' });
        } catch (dbErr) {
            await conn.rollback();
            conn.release();
            throw dbErr;
        }
    } catch (error) {
        if (/รูปภาพต้องเป็นไฟล์ PNG เท่านั้น/.test(error.message)) {
            return res.status(400).json({ success: false, message: 'กรุณาอัปโหลดรูปภาพเฉพาะไฟล์นามสกุล .png เท่านั้น' });
        }
        if (/Missing product image/.test(error.message)) {
            return res.status(400).json({ success: false, message: 'กรุณาอัปโหลดรูปภาพปกแว่นตา (ช่องที่ 1)' });
        }
        if (/Invalid product image|Invalid try-on image/.test(error.message)) {
            return res.status(400).json({ success: false, message: 'รูปสินค้าไม่ถูกต้องหรือมีขนาดเกิน 5 MB' });
        }
        if (/Invalid 3D model/.test(error.message)) {
            return res.status(400).json({ success: false, message: 'โมเดล 3D ไม่ถูกต้องหรือมีขนาดเกิน 50 MB' });
        }
        sendServerError(res, error, 'Add product failed');
    }
});

// 5. Products: Delete (Admin Only)
app.delete('/api/products/:id', requireAdmin, requireCsrf, async (req, res) => {
    const productId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    if (!productId) return res.status(400).json({ success: false, message: 'หมายเลขสินค้าไม่ถูกต้อง' });
    try {
        const [rows] = await dbPool.query('SELECT image_url, model_3d_url, gallery_images FROM products WHERE id = ?', [productId]);
        if (rows.length > 0) {
            const p = rows[0];
            const toDelete = new Set();
            if (p.image_url && p.image_url.startsWith('/uploads/')) toDelete.add(p.image_url);
            if (p.model_3d_url && p.model_3d_url.startsWith('/uploads/')) toDelete.add(p.model_3d_url);
            if (p.gallery_images) {
                try {
                    const gal = JSON.parse(p.gallery_images);
                    if (Array.isArray(gal)) {
                        gal.forEach(img => {
                            if (typeof img === 'string' && img.startsWith('/uploads/')) toDelete.add(img);
                        });
                    }
                } catch (_) {}
            }
            for (const f of toDelete) {
                await deleteFileFromDb(f);
                try {
                    const localPath = path.join(__dirname, 'public', f);
                    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                } catch (_) {}
            }
        }
        await dbPool.query('DELETE FROM products WHERE id = ?', [productId]);
        res.json({ success: true, message: 'ลบสินค้าสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Delete product failed');
    }
});

// 5.1 Products: Update / Edit Name or Stock (Admin Only)
app.put('/api/products/:id', requireAdmin, requireCsrf, async (req, res) => {
    const productId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    if (!productId) return res.status(400).json({ success: false, message: 'หมายเลขสินค้าไม่ถูกต้อง' });

    const name = req.body.name !== undefined ? cleanText(req.body.name, 255) : undefined;
    const stock = req.body.stock !== undefined ? integerInRange(req.body.stock, 0, 1000000) : undefined;
    const price = req.body.price !== undefined ? numberInRange(req.body.price, 0, 1000000) : undefined;

    if (name === undefined && stock === undefined && price === undefined) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุข้อมูลที่ต้องการแก้ไข' });
    }
    if (name !== undefined && !name) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อแว่นตา' });
    }
    if (stock !== undefined && stock === null) {
        return res.status(400).json({ success: false, message: 'จำนวนสต็อกไม่ถูกต้อง' });
    }

    try {
        const [existing] = await dbPool.query('SELECT id FROM products WHERE id = ?', [productId]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'ไม่พบสินค้าในระบบ' });
        }

        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (stock !== undefined) {
            updates.push('stock = ?');
            values.push(stock);
        }
        if (price !== undefined && price !== null) {
            updates.push('price = ?');
            values.push(price);
        }

        if (updates.length > 0) {
            values.push(productId);
            await dbPool.query(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, values);
        }

        res.json({ success: true, message: 'อัปเดตข้อมูลสินค้าสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Update product failed');
    }
});

// 6. Prescriptions: Get latest for a user
app.get('/api/prescriptions/:userId', requireAuth, async (req, res) => {
    const requestedUserId = integerInRange(req.params.userId, 1, Number.MAX_SAFE_INTEGER);
    if (!requestedUserId || (req.user.role !== 'admin' && requestedUserId !== req.user.id)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูข้อมูลนี้' });
    }
    try {
        const [rows] = await dbPool.query(
            'SELECT * FROM prescriptions WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1',
            [requestedUserId]
        );
        if (rows.length === 0) {
            return res.json({ success: true, prescription: null });
        }
        res.json({ success: true, prescription: rows[0] });
    } catch (error) {
        sendServerError(res, error, 'Read prescription failed');
    }
});

// 7. Prescriptions: Save
app.post('/api/prescriptions', requireAuth, requireCsrf, async (req, res) => {
    const values = {
        sphere_left: numberInRange(req.body.sphere_left, -30, 30),
        sphere_right: numberInRange(req.body.sphere_right, -30, 30),
        cylinder_left: numberInRange(req.body.cylinder_left, -10, 10),
        cylinder_right: numberInRange(req.body.cylinder_right, -10, 10),
        axis_left: integerInRange(req.body.axis_left, 0, 180),
        axis_right: integerInRange(req.body.axis_right, 0, 180),
        pd: numberInRange(req.body.pd, 40, 90)
    };
    if (Object.values(values).some(value => value === null)) {
        return res.status(400).json({ success: false, message: 'ค่าสายตาไม่ถูกต้อง' });
    }
    try {
        await dbPool.query(
            `INSERT INTO prescriptions (user_id, sphere_left, sphere_right, cylinder_left, cylinder_right, axis_left, axis_right, pd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, values.sphere_left, values.sphere_right, values.cylinder_left, values.cylinder_right, values.axis_left, values.axis_right, values.pd]
        );
        res.json({ success: true, message: 'บันทึกค่าสายตาสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Save prescription failed');
    }
});

// 8. Orders: Place a new order
app.post('/api/orders', requireAuth, requireCsrf, async (req, res) => {
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    const shippingName = cleanText(req.body.shipping_name, 255);
    const shippingPhone = cleanText(req.body.shipping_phone, 30);
    const shippingAddress = cleanText(req.body.shipping_address, 2000);
    const paymentMethod = ['COD', 'BankTransfer', 'QRCode', 'CreditCard'].includes(req.body.payment_method)
        ? req.body.payment_method
        : null;
    if (!shippingName || !shippingPhone || !shippingAddress || !paymentMethod || rawItems.length < 1 || rawItems.length > 20) {
        return res.status(400).json({ success: false, message: 'ข้อมูลคำสั่งซื้อไม่ถูกต้อง' });
    }

    const items = rawItems.map(item => ({
        productId: integerInRange(item.product_id, 1, Number.MAX_SAFE_INTEGER),
        lensId: integerInRange(item.lens_id, 1, Number.MAX_SAFE_INTEGER),
        quantity: integerInRange(item.quantity, 1, 20)
    }));
    if (items.some(item => !item.productId || !item.lensId || !item.quantity)) {
        return res.status(400).json({ success: false, message: 'รายการสินค้าไม่ถูกต้อง' });
    }

    const groupedItems = new Map();
    for (const item of items) {
        const key = `${item.productId}:${item.lensId}`;
        const existing = groupedItems.get(key);
        if (existing) {
            existing.quantity += item.quantity;
            if (existing.quantity > 20) return res.status(400).json({ success: false, message: 'จำนวนสินค้าต่อรายการมากเกินไป' });
        } else {
            groupedItems.set(key, { ...item });
        }
    }

    let prescription = null;
    if (req.body.prescription && Object.keys(req.body.prescription).length) {
        prescription = {
            sphere_left: numberInRange(req.body.prescription.sphere_left, -30, 30),
            sphere_right: numberInRange(req.body.prescription.sphere_right, -30, 30),
            cylinder_left: numberInRange(req.body.prescription.cylinder_left, -10, 10),
            cylinder_right: numberInRange(req.body.prescription.cylinder_right, -10, 10),
            axis_left: integerInRange(req.body.prescription.axis_left, 0, 180),
            axis_right: integerInRange(req.body.prescription.axis_right, 0, 180),
            pd: numberInRange(req.body.prescription.pd, 40, 90)
        };
        if (Object.values(prescription).some(value => value === null)) {
            return res.status(400).json({ success: false, message: 'ค่าสายตาไม่ถูกต้อง' });
        }
    }

    const requiresSlip = paymentMethod === 'BankTransfer' || paymentMethod === 'QRCode';
    let slipImage = null;
    if (requiresSlip) {
        try {
            slipImage = decodeImageDataUrl(req.body.slip_image_base64, 5 * 1024 * 1024);
        } catch (_) {
            return res.status(400).json({ success: false, message: 'กรุณาแนบสลิป PNG, JPEG หรือ WebP ขนาดไม่เกิน 5 MB' });
        }
    }

    let conn = null;
    let slipDiskPath = null;
    try {
        conn = await dbPool.getConnection();
        await conn.beginTransaction();
        const pricedItems = [];
        let totalAmount = 0;

        for (const item of groupedItems.values()) {
            const [productRows] = await conn.query('SELECT id, price, stock FROM products WHERE id = ? FOR UPDATE', [item.productId]);
            const [lensRows] = await conn.query('SELECT id, price_addon FROM lenses WHERE id = ?', [item.lensId]);
            if (!productRows.length || !lensRows.length) throw Object.assign(new Error('Product or lens not found'), { status: 400 });
            if (productRows[0].stock < item.quantity) throw Object.assign(new Error('Insufficient stock'), { status: 409 });
            const unitPrice = Number(productRows[0].price) + Number(lensRows[0].price_addon);
            totalAmount += unitPrice * item.quantity;
            pricedItems.push({ ...item, unitPrice });
        }
        totalAmount = Number(totalAmount.toFixed(2));

        if (prescription) {
            await conn.query(
                `INSERT INTO prescriptions (user_id, sphere_left, sphere_right, cylinder_left, cylinder_right, axis_left, axis_right, pd)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, prescription.sphere_left, prescription.sphere_right, prescription.cylinder_left, prescription.cylinder_right, prescription.axis_left, prescription.axis_right, prescription.pd]
            );
        }

        const initialStatus = paymentMethod === 'COD' ? 'pending' : 'payment_review';
        const [orderResult] = await conn.query(
            `INSERT INTO orders (user_id, total_amount, status, shipping_name, shipping_phone, shipping_address, payment_method)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, totalAmount, initialStatus, shippingName, shippingPhone, shippingAddress, paymentMethod]
        );
        const orderId = orderResult.insertId;

        if (slipImage) {
            fs.mkdirSync(SLIP_STORAGE_DIR, { recursive: true });
            const slipFileName = `slip_${orderId}_${randomToken(16)}.${slipImage.extension}`;
            slipDiskPath = path.join(SLIP_STORAGE_DIR, slipFileName);
            try {
                fs.writeFileSync(slipDiskPath, slipImage.buffer, { flag: 'wx' });
            } catch (_) {}
            const slipMime = slipImage.extension === 'png' ? 'image/png' : (slipImage.extension === 'jpg' || slipImage.extension === 'jpeg' ? 'image/jpeg' : 'image/webp');
            await saveFileToDb(`/slips/${slipFileName}`, slipMime, slipImage.buffer);
            await conn.query('UPDATE orders SET slip_image = ? WHERE id = ?', [slipFileName, orderId]);
        }

        for (const item of pricedItems) {
            await conn.query(
                'INSERT INTO order_items (order_id, product_id, quantity, unit_price, lens_id) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.productId, item.quantity, item.unitPrice, item.lensId]
            );
            const [stockResult] = await conn.query(
                'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
                [item.quantity, item.productId, item.quantity]
            );
            if (stockResult.affectedRows !== 1) throw Object.assign(new Error('Insufficient stock'), { status: 409 });
        }

        await conn.commit();
        res.json({ success: true, orderId, total_amount: totalAmount, status: initialStatus, message: 'สั่งซื้อสินค้าสำเร็จ' });
    } catch (error) {
        if (conn) await conn.rollback();
        if (slipDiskPath) fs.promises.unlink(slipDiskPath).catch(() => {});
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        return sendServerError(res, error, 'Create order failed');
    } finally {
        if (conn) conn.release();
    }
});

// 9. Admin: Get all orders
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const query = `
            SELECT o.id as order_id, o.total_amount, o.status, o.created_at, u.name as customer_name,
                   oi.quantity, oi.unit_price, p.name as product_name, p.image_url as product_image, l.lens_type,
                   o.shipping_name, o.shipping_phone, o.shipping_address, o.payment_method, o.slip_image, o.tracking_number
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            JOIN lenses l ON oi.lens_id = l.id
            ORDER BY o.created_at DESC
        `;
        const [orders] = await dbPool.query(query);
        res.json({
            success: true,
            orders: orders.map(order => ({
                ...order,
                slip_image: order.slip_image ? `/api/orders/${order.order_id}/slip` : null
            }))
        });
    } catch (error) {
        sendServerError(res, error, 'List admin orders failed');
    }
});

// 10. Admin: Update order status
app.put('/api/admin/orders/:id', requireAdmin, requireCsrf, async (req, res) => {
    const orderId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    const status = ['pending', 'payment_review', 'paid', 'shipped', 'completed', 'cancelled'].includes(req.body.status)
        ? req.body.status
        : null;
    const trackingNumber = req.body.tracking_number == null ? null : cleanText(req.body.tracking_number, 100);
    if (!orderId || !status || (status === 'shipped' && !trackingNumber)) {
        return res.status(400).json({ success: false, message: 'สถานะหรือเลขพัสดุไม่ถูกต้อง' });
    }
    const transitions = {
        pending: ['paid', 'cancelled'],
        payment_review: ['paid', 'cancelled'],
        paid: ['shipped', 'cancelled'],
        shipped: ['completed'],
        completed: [],
        cancelled: []
    };
    let conn = null;
    try {
        conn = await dbPool.getConnection();
        await conn.beginTransaction();
        const [orders] = await conn.query('SELECT status FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!orders.length) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบคำสั่งซื้อ' });
        }
        const currentStatus = orders[0].status;
        if (!transitions[currentStatus]?.includes(status)) {
            await conn.rollback();
            return res.status(409).json({ success: false, message: `ไม่สามารถเปลี่ยนสถานะจาก ${currentStatus} เป็น ${status}` });
        }
        if (status === 'cancelled') {
            const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
            for (const item of items) {
                await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
            }
        }
        await conn.query(
            'UPDATE orders SET status = ?, tracking_number = COALESCE(?, tracking_number) WHERE id = ?',
            [status, trackingNumber, orderId]
        );
        await conn.commit();
        res.json({ success: true, message: 'อัปเดตสถานะออเดอร์สำเร็จ' });
    } catch (error) {
        if (conn) await conn.rollback();
        sendServerError(res, error, 'Update order status failed');
    } finally {
        if (conn) conn.release();
    }
});

// 10.1 Admin: Delete order
app.delete('/api/admin/orders/:id', requireAdmin, requireCsrf, async (req, res) => {
    const orderId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'รหัสคำสั่งซื้อไม่ถูกต้อง' });
    }
    let conn = null;
    try {
        conn = await dbPool.getConnection();
        await conn.beginTransaction();

        const [orders] = await conn.query('SELECT status, slip_image FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!orders.length) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบคำสั่งซื้อ' });
        }

        const currentStatus = orders[0].status;
        const slipImage = orders[0].slip_image;

        // If order was active (not cancelled), restore reserved stock back to products
        if (currentStatus !== 'cancelled') {
            const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
            for (const item of items) {
                await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
            }
        }

        // Delete order items first (resilient cascade) and then the order
        await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        await conn.query('DELETE FROM orders WHERE id = ?', [orderId]);

        await conn.commit();

        if (slipImage) {
            const safeName = path.basename(slipImage);
            const slipPath = path.join(SLIP_STORAGE_DIR, safeName);
            fs.promises.unlink(slipPath).catch(() => {});
            await deleteFileFromDb(`/slips/${safeName}`);
            await deleteFileFromDb(`/uploads/slips/${safeName}`);
        }

        res.json({ success: true, message: 'ลบรายการสั่งซื้อเรียบร้อยแล้ว' });
    } catch (error) {
        if (conn) await conn.rollback();
        sendServerError(res, error, 'Delete order failed');
    } finally {
        if (conn) conn.release();
    }
});

// 11. Admin: Analytics (Top best sellers, lens popularity, page metrics)
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
    try {
        const [userCount] = await dbPool.query('SELECT COUNT(*) as count FROM users WHERE role = "customer"');
        const [productStats] = await dbPool.query(`
            SELECT COUNT(*) as total_models,
                   COALESCE(SUM(stock), 0) as total_stock
            FROM products
        `);
        const [orderStats] = await dbPool.query(`
            SELECT COUNT(*) as total_orders,
                   COALESCE(SUM(CASE WHEN status IN ('paid', 'shipped', 'completed') THEN 1 ELSE 0 END), 0) as completed_orders,
                   COALESCE(SUM(CASE WHEN status IN ('pending', 'payment_review') THEN 1 ELSE 0 END), 0) as pending_orders,
                   COALESCE(SUM(CASE WHEN status IN ('paid', 'shipped', 'completed') THEN total_amount ELSE 0 END), 0) as sales
            FROM orders
        `);

        // 1. Top 5 Best-Selling Products from actual order items
        const [topProducts] = await dbPool.query(`
            SELECT p.id, p.name, p.brand,
                   CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS total_sold
            FROM products p
            LEFT JOIN order_items oi ON p.id = oi.product_id
            LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
            GROUP BY p.id, p.name, p.brand
            ORDER BY total_sold DESC, p.id ASC
            LIMIT 5
        `);

        // 2. Popular Lens Types from actual order items
        const [popularLenses] = await dbPool.query(`
            SELECT l.id, l.lens_type,
                   CAST(COALESCE(COUNT(oi.id), 0) AS UNSIGNED) AS count
            FROM lenses l
            LEFT JOIN order_items oi ON l.id = oi.lens_id
            LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
            GROUP BY l.id, l.lens_type
            ORDER BY count DESC, l.id ASC
        `);
        
        const totalOrders = Number(orderStats[0].total_orders) || 0;
        const completedOrders = Number(orderStats[0].completed_orders) || 0;
        const totalStock = Number(productStats[0].total_stock) || 0;
        const totalModels = Number(productStats[0].total_models) || 0;

        // Return analytical metrics
        res.json({
            success: true,
            metrics: {
                totalCustomers: Number(userCount[0].count) || 0,
                totalProducts: totalModels,
                totalStock: totalStock,
                totalOrders: totalOrders,
                completedOrders: completedOrders,
                pendingOrders: Number(orderStats[0].pending_orders) || 0,
                totalSales: parseFloat(orderStats[0].sales || 0),
                conversionRate: totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(1) : '0.0',
                // Trends for chart
                salesTrend: [
                    { date: 'จันทร์', sales: (Number(orderStats[0].sales) * 0.1).toFixed(2) },
                    { date: 'อังคาร', sales: (Number(orderStats[0].sales) * 0.15).toFixed(2) },
                    { date: 'พุธ', sales: (Number(orderStats[0].sales) * 0.2).toFixed(2) },
                    { date: 'พฤหัสบดี', sales: (Number(orderStats[0].sales) * 0.12).toFixed(2) },
                    { date: 'ศุกร์', sales: (Number(orderStats[0].sales) * 0.18).toFixed(2) },
                    { date: 'เสาร์', sales: (Number(orderStats[0].sales) * 0.25).toFixed(2) }
                ],
                topProducts: topProducts || [],
                popularLenses: popularLenses || [],
                popularTryOn: [
                    { shape: 'ทรงกลม (Round)', count: 24 },
                    { shape: 'ทรงเหลี่ยม (Square)', count: 18 },
                    { shape: 'ทรงแคทอาย (CatEye)', count: 32 },
                    { shape: 'ทรงรี (Oval)', count: 14 }
                ]
            }
        });
    } catch (error) {
        sendServerError(res, error, 'Read analytics failed');
    }
});

// 12. Admin: DB Backup endpoint (Outputs schema + data as text file)
app.get('/api/admin/backup', requireAdmin, async (req, res) => {
    try {
        let sqlDump = `-- Backup generated for Baan Waenta on ${new Date().toISOString()}\n`;
        sqlDump += `CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\`;\nUSE \`${DB_CONFIG.database}\`;\n\n`;
        
        const tables = ['users', 'products', 'prescriptions', 'lenses', 'orders', 'order_items'];
        
        for (const table of tables) {
            // Get Create Table structure
            const [struct] = await dbPool.query(`SHOW CREATE TABLE \`${table}\``);
            sqlDump += `DROP TABLE IF EXISTS \`${table}\`;\n`;
            sqlDump += struct[0]['Create Table'] + ';\n\n';

            // Get Rows data
            const [rows] = await dbPool.query(`SELECT * FROM \`${table}\``);
            if (rows.length > 0) {
                sqlDump += `INSERT INTO \`${table}\` VALUES \n`;
                const insertVals = rows.map(row => {
                    const vals = Object.values(row).map(val => {
                        if (val === null) return 'NULL';
                        if (typeof val === 'object' && val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                        if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                        return val;
                    });
                    return `(${vals.join(', ')})`;
                });
                sqlDump += insertVals.join(',\n') + ';\n\n';
            }
        }
        
        res.setHeader('Content-disposition', 'attachment; filename=backup_baan_waenta.sql');
        res.setHeader('Content-type', 'text/plain');
        res.charset = 'UTF-8';
        res.write(sqlDump);
        res.end();
    } catch (error) {
        sendServerError(res, error, 'Create database backup failed');
    }
});

// 13. Orders: Get orders for a specific user (Customer History)
app.get('/api/orders/user/:userId', requireAuth, async (req, res) => {
    const userId = integerInRange(req.params.userId, 1, Number.MAX_SAFE_INTEGER);
    if (!userId || (req.user.role !== 'admin' && userId !== req.user.id)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูข้อมูลนี้' });
    }
    try {
        const query = `
            SELECT o.id as order_id, o.total_amount, o.status, o.created_at,
                   oi.quantity, oi.unit_price, p.name as product_name, p.image_url as product_image, l.lens_type,
                   o.shipping_name, o.shipping_phone, o.shipping_address, o.payment_method, o.slip_image, o.tracking_number
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            JOIN lenses l ON oi.lens_id = l.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `;
        const [orders] = await dbPool.query(query, [userId]);
        res.json({
            success: true,
            orders: orders.map(order => ({
                ...order,
                slip_image: order.slip_image ? `/api/orders/${order.order_id}/slip` : null
            }))
        });
    } catch (error) {
        sendServerError(res, error, 'List customer orders failed');
    }
});

app.get('/api/orders/:id/slip', requireAuth, async (req, res) => {
    const orderId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    if (!orderId) return res.status(400).json({ success: false, message: 'หมายเลขคำสั่งซื้อไม่ถูกต้อง' });
    try {
        const [orders] = await dbPool.query('SELECT user_id, slip_image FROM orders WHERE id = ?', [orderId]);
        if (!orders.length || !orders[0].slip_image) return res.status(404).end();
        if (req.user.role !== 'admin' && orders[0].user_id !== req.user.id) return res.status(403).end();

        const storedName = orders[0].slip_image;
        const legacy = storedName.startsWith('/uploads/slips/');
        const safeName = path.basename(storedName);
        const filePath = legacy
            ? path.join(__dirname, 'public', 'uploads', 'slips', safeName)
            : path.join(SLIP_STORAGE_DIR, safeName);
        if (!fs.existsSync(filePath)) {
            const dbFile = await getFileFromDb(`/slips/${safeName}`) || await getFileFromDb(`/uploads/slips/${safeName}`);
            if (dbFile) {
                try {
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, dbFile.buffer);
                } catch (_) {}
            } else {
                return res.status(404).end();
            }
        }
        res.setHeader('Cache-Control', 'private, no-store');

        // If accessed directly from browser navigation (text/html) and not raw image request, render with close button
        if (req.headers.accept && req.headers.accept.includes('text/html') && req.query.raw !== '1') {
            return res.send(`<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>สลิปหลักฐานการโอนเงิน #${orderId}</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100vh; display: flex; flex-direction: column; }
        .topbar { background: #1e293b; border-bottom: 1px solid #334155; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        .topbar-title { font-size: 1rem; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 8px; }
        .close-btn { background: #e53e3e; color: #fff; border: none; padding: 8px 18px; border-radius: 20px; font-size: 0.9rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(229,62,62,0.4); }
        .close-btn:hover { background: #c53030; }
        .container { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .slip-img { max-width: 100%; max-height: 82vh; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.6); object-fit: contain; }
    </style>
</head>
<body>
    <div class="topbar">
        <span class="topbar-title">📄 สลิปหลักฐานการโอนเงิน (คำสั่งซื้อ #${orderId})</span>
        <button type="button" class="close-btn" onclick="if (window.opener) { window.close(); } else if (history.length > 1) { history.back(); } else { window.location.href='/'; }">✕ ปิดหน้านี้</button>
    </div>
    <div class="container">
        <img class="slip-img" src="/api/orders/${orderId}/slip?raw=1" alt="สลิปหลักฐานการโอนเงิน">
    </div>
</body>
</html>`);
        }

        res.sendFile(filePath);
    } catch (error) {
        sendServerError(res, error, 'Read payment slip failed');
    }
});

// 14. Admin: Save client-side generated product image
app.post('/api/admin/save-generated-image', requireAdmin, requireCsrf, async (req, res) => {
    const { filename, image_base64 } = req.body;
    try {
        const safeBaseName = cleanText(filename, 100);
        if (!safeBaseName || path.basename(safeBaseName) !== safeBaseName || !image_base64) {
            return res.status(400).json({ success: false, message: 'ชื่อไฟล์หรือข้อมูลรูปไม่ถูกต้อง' });
        }
        const image = decodeImageDataUrl(image_base64, 5 * 1024 * 1024);
        const dirPath = path.join(__dirname, 'public', 'assets', 'products');
        fs.mkdirSync(dirPath, { recursive: true });
        const outputName = `${path.parse(safeBaseName).name}.${image.extension}`;
        try {
            fs.writeFileSync(path.join(dirPath, outputName), image.buffer);
        } catch (_) {}
        const mimeType = image.extension === 'png' ? 'image/png' : 'image/webp';
        await saveFileToDb(`/assets/products/${outputName}`, mimeType, image.buffer);
        res.json({ success: true, filename: outputName, message: `Successfully saved ${outputName}` });
    } catch (error) {
        if (/image|format|large|WebP/i.test(error.message)) {
            return res.status(400).json({ success: false, message: 'รูปภาพไม่ถูกต้องหรือมีขนาดเกิน 5 MB' });
        }
        sendServerError(res, error, 'Save generated product image failed');
    }
});

// 15. Reviews API: Get all reviews
app.get('/api/reviews', async (req, res) => {
    try {
        const [reviews] = await dbPool.query('SELECT * FROM reviews ORDER BY created_at DESC');
        res.json({ success: true, reviews });
    } catch (error) {
        sendServerError(res, error, 'List reviews failed');
    }
});

// 16. Reviews API: Post a new review
app.post('/api/reviews', requireAuth, requireCsrf, async (req, res) => {
    const rating = integerInRange(req.body.rating, 1, 5);
    const comment = cleanText(req.body.comment, 2000);
    const productName = cleanText(req.body.product_name || 'แว่นตาทั่วไป', 255);
    try {
        if (!rating || !comment || !productName) {
            return res.status(400).json({ success: false, message: 'ข้อมูลรีวิวไม่ถูกต้อง' });
        }
        await dbPool.query(
            'INSERT INTO reviews (user_id, user_name, rating, comment, product_name, avatar_url) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.id, `คุณ ${req.user.name}`, rating, comment, productName, req.user.avatar_url || null]
        );
        res.json({ success: true, message: 'บันทึกรีวิวสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Create review failed');
    }
});

// 17. Reviews API: Delete a review (Admin action)
app.delete('/api/reviews/:id', requireAdmin, requireCsrf, async (req, res) => {
    const reviewId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    if (!reviewId) return res.status(400).json({ success: false, message: 'หมายเลขรีวิวไม่ถูกต้อง' });
    try {
        await dbPool.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        res.json({ success: true, message: 'ลบรีวิวสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Delete review failed');
    }
});

app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, message: 'ไม่พบ API ที่เรียก' });
});

app.use((error, _req, res, _next) => {
    sendServerError(res, error, 'Unhandled request error');
});

// Start initialization and server. Tests can skip external database initialization.
const initialization = process.env.SKIP_DB_INIT === '1' ? Promise.resolve() : initDB();
initialization.then(() => {
    if (require.main === module) {
        app.listen(PORT, () => {
            console.log(`Server is running at http://localhost:${PORT}`);
        });
    }
});

module.exports = app;
module.exports.initialization = initialization;
module.exports._test = { requireAuth, requireAdmin, requireCsrf, requireTrustedOrigin, publicUser, dbPool, sendResetOtpEmail, getEmailTransporter };

// Graceful shutdown for Serverless environments (e.g. Vercel)
// This ensures that when Vercel tears down the instance (especially on new deployments),
// the database connections are properly closed and not left sleeping,
// preventing "User has exceeded max_user_connections" errors.
function gracefulShutdown(signal) {
    console.log(`Received ${signal}, closing database connections...`);
    if (dbPool) {
        dbPool.end().then(() => {
            console.log('Database pool closed gracefully.');
            process.exit(0);
        }).catch(err => {
            console.error('Error closing database pool:', err);
            process.exit(1);
        });
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
