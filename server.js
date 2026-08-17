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
if (IS_PRODUCTION) app.set('trust proxy', 1);
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, 'storage'));
const SLIP_STORAGE_DIR = path.join(STORAGE_DIR, 'slips');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '105484503874-92cu9940o9od95nb2pna8pr0kkf7pngi.apps.googleusercontent.com';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

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

// Enable Helmet for security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net", "blob:", "https://accounts.google.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https://*"],
            connectSrc: ["'self'", "https://*", "wss://*"],
            mediaSrc: ["'self'", "blob:", "data:", "mediastream:", "https://*"],
            workerSrc: ["'self'", "blob:"],
            childSrc: ["'self'", "blob:"],
            frameSrc: ["'self'", "https://www.google.com", "https://maps.google.com", "https://accounts.google.com"],
            objectSrc: ["'none'"]
        }
    }
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Payment slips are private even when legacy deployments stored them below public/uploads.
app.use('/uploads/slips', (_req, res) => res.status(404).end());

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
    connectionLimit: 1,
    queueLimit: 0,
    ssl: (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1')) ? { rejectUnauthorized: false } : undefined
};

const dbPool = mysql.createPool(DB_CONFIG);

let isDbInitialized = false;

// Connect to MySQL and initialize tables/data
async function initDB() {
    if (isDbInitialized) return;
    isDbInitialized = true;

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

        console.log(`Connected to MySQL database: ${DB_CONFIG.database}`);

    } catch (error) {
        console.error('========================================================');
        console.error('DATABASE CONNECTION ERROR:');
        console.error(error.message);
        console.error('========================================================');
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
            price DECIMAL(10,2) NOT NULL,
            stock INT NOT NULL
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

    // Self-healing: Add shipping, payment and slip columns if table already exists
    try {
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

    // Seed Products
    console.log('Verifying and seeding products database...');
    const defaultProducts = [
        // Original 6
        {
            name: "แว่นตาทรงกลมสีกระปัดเงา (Round Tortoise)",
            brand: "บ้านแว่นตา",
            category: "Optical",
            frame_shape: "Round",
            image_url: "/assets/p1.jpg",
            tryon_image_url: "/assets/vto_p1.png", // Real transparent VTO image
            price: 1490.00,
            stock: 15
        },
        {
            name: "แว่นตาทรงกลมดำคลาสสิก (Round Black Metal)",
            brand: "บ้านแว่นตา",
            category: "Optical",
            frame_shape: "Round",
            image_url: "/assets/p2.jpg",
            tryon_image_url: "/assets/vto_p2.png", // Real transparent VTO image
            price: 1990.00,
            stock: 4
        },
        {
            name: "แว่นตาเหลี่ยมสีกระสว่าง (Modern Square Clear)",
            brand: "บ้านแว่นตา",
            category: "Optical",
            frame_shape: "Square",
            image_url: "/assets/p3.jpg",
            tryon_image_url: "/assets/vto_p3.png", // Real transparent VTO image
            price: 2490.00,
            stock: 20
        },
        {
            name: "แว่นตาโลหะโรสโกลด์ (Rose Gold CatEye)",
            brand: "บ้านแว่นตา",
            category: "Optical",
            frame_shape: "CatEye",
            image_url: "/assets/p4.jpg",
            tryon_image_url: "/assets/vto_p4.png", // Real transparent VTO image
            price: 3490.00,
            stock: 10
        },
        {
            name: "แว่นตากันแดดเหลี่ยมดำเข้ม (Classic Black Sunglasses)",
            brand: "บ้านแว่นตา",
            category: "Sunglasses",
            frame_shape: "Square",
            image_url: "/assets/p5.jpg",
            tryon_image_url: "/assets/vto_p5.png", // Real transparent VTO image
            price: 2290.00,
            stock: 3
        },
        {
            name: "แว่นตาทรงรีเงินมินิมอล (Minimal Oval Silver)",
            brand: "บ้านแว่นตา",
            category: "Optical",
            frame_shape: "Oval",
            image_url: "/assets/p6.jpg",
            tryon_image_url: "/assets/vto_p6.png", // Real transparent VTO image
            price: 1300.00,
            stock: 12
        }
    ];

    let seededCount = 0;
    let updatedCount = 0;
    for (const prod of defaultProducts) {
        const [existing] = await dbPool.query('SELECT id, image_url, tryon_image_url FROM products WHERE name = ?', [prod.name]);
        if (existing.length === 0) {
            await dbPool.query(
                `INSERT INTO products (name, brand, category, frame_shape, image_url, tryon_image_url, price, stock) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                 [prod.name, prod.brand, prod.category, prod.frame_shape, prod.image_url, prod.tryon_image_url, prod.price, prod.stock]
            );
            seededCount++;
        } else {
            // Update image URLs if they changed (to support transparent PNG paths)
            if (existing[0].image_url !== prod.image_url || existing[0].tryon_image_url !== prod.tryon_image_url) {
                await dbPool.query(
                    'UPDATE products SET image_url = ?, tryon_image_url = ? WHERE id = ?',
                    [prod.image_url, prod.tryon_image_url, existing[0].id]
                );
                updatedCount++;
            }
        }
    }
    if (seededCount > 0 || updatedCount > 0) {
        console.log(`Products seeding complete. Seeded: ${seededCount}, Updated Image Paths: ${updatedCount}`);
    }
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

function savePublicImageData(dataUrl, prefix, maxBytes = 5 * 1024 * 1024) {
    const { buffer, extension } = decodeImageDataUrl(dataUrl, maxBytes);
    const dirPath = path.join(__dirname, 'public', 'uploads', 'products');
    fs.mkdirSync(dirPath, { recursive: true });
    const fileName = `${prefix}_${randomToken(12)}.${extension}`;
    fs.writeFileSync(path.join(dirPath, fileName), buffer, { flag: 'wx' });
    return `/uploads/products/${fileName}`;
}

const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
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
        if (tokenInfo.aud !== GOOGLE_CLIENT_ID || Number(tokenInfo.expires_in) <= 0) {
            return res.status(401).json({ success: false, message: 'Google token ไม่ได้ออกให้แอปนี้' });
        }

        const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000)
        });
        if (!profileResponse.ok) return res.status(401).json({ success: false, message: 'ไม่สามารถยืนยันบัญชี Google ได้' });
        const profile = await profileResponse.json();
        const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
        const name = cleanText(profile.name, 255);
        const googleSub = cleanText(profile.sub, 255);
        const avatar = typeof profile.picture === 'string' && profile.picture.length <= 2048 ? profile.picture : null;
        if (!isEmail(email) || !name || !googleSub || profile.email_verified !== true) {
            return res.status(401).json({ success: false, message: 'บัญชี Google ต้องมีอีเมลที่ยืนยันแล้ว' });
        }

        const [users] = await dbPool.query('SELECT * FROM users WHERE google_sub = ? OR email = ? LIMIT 1', [googleSub, email]);
        let user = users[0];
        let generatedUsername = `${email.split('@')[0]}_${googleSub.slice(-8)}_google`;
        if (generatedUsername.length > 80) generatedUsername = generatedUsername.slice(0, 80);

        if (user) {
            if (user.google_sub && user.google_sub !== googleSub) {
                return res.status(409).json({ success: false, message: 'อีเมลนี้เชื่อมกับบัญชี Google อื่นแล้ว' });
            }
            await dbPool.query(
                'UPDATE users SET google_sub = ?, name = ?, avatar_url = ?, username = COALESCE(username, ?) WHERE id = ?',
                [googleSub, name, avatar, generatedUsername, user.id]
            );
            [user] = (await dbPool.query('SELECT * FROM users WHERE id = ?', [user.id]))[0];
        } else {
            const dummyPassword = await bcrypt.hash(randomToken(), 12);
            const [result] = await dbPool.query(
                'INSERT INTO users (name, email, password_hash, avatar_url, username, google_sub, role) VALUES (?, ?, ?, ?, ?, ?, "customer")',
                [name, email, dummyPassword, avatar, generatedUsername, googleSub]
            );
            [user] = (await dbPool.query('SELECT * FROM users WHERE id = ?', [result.insertId]))[0];
        }

        const csrfToken = await startSession(user.id, req, res);
        res.json({ success: true, user: publicUser(user), csrfToken });
    } catch (error) {
        sendServerError(res, error, 'Google authentication failed');
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
    if (!name || !brand || !category || !frameShape || price === null || stock === null) {
        return res.status(400).json({ success: false, message: 'ข้อมูลสินค้าไม่ถูกต้อง' });
    }
    try {
        const conn = await dbPool.getConnection();
        await conn.beginTransaction();

        try {
            // Insert product with temporary empty image values to get insertId
            const [result] = await conn.query(
                `INSERT INTO products (name, brand, category, frame_shape, image_url, tryon_image_url, price, stock) 
                 VALUES (?, ?, ?, ?, '', '', ?, ?)`,
                [name, brand, category, frameShape, price, stock]
            );
            const productId = result.insertId;

            let finalImageUrl = '/assets/round.svg';
            let finalTryonUrl = '/assets/round.svg';

            // Save main image to disk if it is base64
            if (imageUrl && imageUrl.startsWith('data:image/')) {
                try {
                    finalImageUrl = savePublicImageData(imageUrl, `product_${productId}`);
                } catch (imgErr) {
                    throw new Error(`Invalid product image: ${imgErr.message}`);
                }
            } else if (typeof imageUrl === 'string' && imageUrl.startsWith('/assets/')) {
                finalImageUrl = imageUrl;
            }

            // Save tryon image to disk if it is base64
            if (tryonImageUrl && tryonImageUrl.startsWith('data:image/')) {
                if (tryonImageUrl === imageUrl) {
                    finalTryonUrl = finalImageUrl;
                } else {
                    try {
                        finalTryonUrl = savePublicImageData(tryonImageUrl, `product_tryon_${productId}`);
                    } catch (imgErr) {
                        throw new Error(`Invalid try-on image: ${imgErr.message}`);
                    }
                }
            } else if (typeof tryonImageUrl === 'string' && tryonImageUrl.startsWith('/assets/')) {
                finalTryonUrl = tryonImageUrl;
            }

            // Update database with the finalized upload file paths
            await conn.query(
                'UPDATE products SET image_url = ?, tryon_image_url = ? WHERE id = ?',
                [finalImageUrl, finalTryonUrl, productId]
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
        if (/Invalid product image|Invalid try-on image/.test(error.message)) {
            return res.status(400).json({ success: false, message: 'รูปสินค้าไม่ถูกต้องหรือมีขนาดเกิน 5 MB' });
        }
        sendServerError(res, error, 'Add product failed');
    }
});

// 5. Products: Delete (Admin Only)
app.delete('/api/products/:id', requireAdmin, requireCsrf, async (req, res) => {
    const productId = integerInRange(req.params.id, 1, Number.MAX_SAFE_INTEGER);
    if (!productId) return res.status(400).json({ success: false, message: 'หมายเลขสินค้าไม่ถูกต้อง' });
    try {
        await dbPool.query('DELETE FROM products WHERE id = ?', [productId]);
        res.json({ success: true, message: 'ลบสินค้าสำเร็จ' });
    } catch (error) {
        sendServerError(res, error, 'Delete product failed');
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
            fs.writeFileSync(slipDiskPath, slipImage.buffer, { flag: 'wx' });
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
                   oi.quantity, oi.unit_price, p.name as product_name, l.lens_type,
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

// 11. Admin: Analytics (Page views mockup, conversions, and popular try-on shapes)
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
    try {
        const [userCount] = await dbPool.query('SELECT COUNT(*) as count FROM users WHERE role = "customer"');
        const [productCount] = await dbPool.query('SELECT COUNT(*) as count FROM products');
        const [orderCount] = await dbPool.query(`
            SELECT COUNT(*) as count,
                   SUM(CASE WHEN status IN ('paid', 'shipped', 'completed') THEN total_amount ELSE 0 END) as sales
            FROM orders
        `);
        
        // Return analytical metrics
        res.json({
            success: true,
            metrics: {
                totalCustomers: userCount[0].count,
                totalProducts: productCount[0].count,
                totalOrders: orderCount[0].count || 0,
                totalSales: orderCount[0].sales || 0,
                conversionRate: orderCount[0].count ? ((orderCount[0].count / 50) * 100).toFixed(1) : 0, // mock traffic
                // Mock trends for chart
                salesTrend: [
                    { date: 'จันทร์', sales: (orderCount[0].sales * 0.1).toFixed(2) },
                    { date: 'อังคาร', sales: (orderCount[0].sales * 0.15).toFixed(2) },
                    { date: 'พุธ', sales: (orderCount[0].sales * 0.2).toFixed(2) },
                    { date: 'พฤหัสบดี', sales: (orderCount[0].sales * 0.12).toFixed(2) },
                    { date: 'ศุกร์', sales: (orderCount[0].sales * 0.18).toFixed(2) },
                    { date: 'เสาร์', sales: (orderCount[0].sales * 0.25).toFixed(2) }
                ],
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
                   oi.quantity, oi.unit_price, p.name as product_name, l.lens_type,
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
        if (!fs.existsSync(filePath)) return res.status(404).end();
        res.setHeader('Cache-Control', 'private, no-store');
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
        fs.writeFileSync(path.join(dirPath, outputName), image.buffer);
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
module.exports._test = { requireAuth, requireAdmin, requireCsrf, requireTrustedOrigin, publicUser };
