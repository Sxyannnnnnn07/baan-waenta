const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');

const app = express();
const PORT = 3000;

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

// Enable CORS and body parsers
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Database connection configuration (Defaults to typical localhost settings)
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'baan_waenta',
    port: process.env.DB_PORT || 3306,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

let dbPool;

// Connect to MySQL and initialize tables/data
async function initDB() {
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

        // Now connect to the database pool
        dbPool = mysql.createPool(DB_CONFIG);
        console.log(`Connected to MySQL database: ${DB_CONFIG.database}`);

        // Run schema setup if tables don't exist
        await setupTables();

        // Seed initial data
        await seedData();

    } catch (error) {
        console.error('========================================================');
        console.error('DATABASE CONNECTION ERROR:');
        console.error(error.message);
        console.error('Please make sure MySQL is running (e.g. XAMPP Control Panel) and credentials in server.js match.');
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
        await dbPool.query("UPDATE users SET username = name WHERE username IS NULL OR username = ''");
    } catch (err) {}
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

    // Seed Users
    const [existingUsers] = await dbPool.query('SELECT * FROM users LIMIT 1');
    if (existingUsers.length === 0) {
        console.log('Seeding initial users...');
        const userPasswordHash = bcrypt.hashSync('12345zx', 10);
        const adminPasswordHash = bcrypt.hashSync('admin12345zx', 10);

        // Yang12345
        await dbPool.query(
            'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ['Yang12345', 'sahiramm12345@gmail.com', userPasswordHash, 'customer']
        );
        // admin
        await dbPool.query(
            'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ['admin', 'admin@baanwaenta.com', adminPasswordHash, 'admin']
        );
        console.log('Initial test users created successfully.');
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

    // Clean up database by deleting all other products
    const originalNames = defaultProducts.map(p => p.name);
    await dbPool.query('DELETE FROM products WHERE name NOT IN (?)', [originalNames]);

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

// ==========================================
// REST API ENDPOINTS
// ==========================================

// 1. Authentication: Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await dbPool.query('SELECT * FROM users WHERE name = ? OR username = ?', [username, username]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'ไม่พบผู้ใช้นี้ในระบบ' });
        }
        const user = users[0];
        const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                username: user.username || user.name,
                email: user.email,
                avatar_url: user.avatar_url,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Authentication: Register
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const [existing] = await dbPool.query('SELECT * FROM users WHERE name = ? OR username = ? OR email = ?', [username, username, email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งานหรืออีเมลนี้ถูกใช้ไปแล้ว' });
        }
        const passwordHash = bcrypt.hashSync(password, 10);
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2.5 Authentication: Google Sign-in/Sign-up
app.post('/api/auth/google', async (req, res) => {
    const { email, name, avatar, google_id } = req.body;
    try {
        if (!email || !name) {
            return res.status(400).json({ success: false, message: 'ข้อมูล Google ไม่ครบถ้วน' });
        }
        
        // Find if user already exists with this email
        const [users] = await dbPool.query('SELECT * FROM users WHERE email = ?', [email]);
        let user;
        const generatedUsername = email.split('@')[0] + '_google';
        
        if (users.length > 0) {
            user = users[0];
            // Update avatar or name if changed
            await dbPool.query(
                'UPDATE users SET name = ?, avatar_url = ? WHERE id = ?',
                [name, avatar, user.id]
            );
            user.name = name;
            user.avatar_url = avatar;
            if (!user.username) {
                await dbPool.query('UPDATE users SET username = ? WHERE id = ?', [generatedUsername, user.id]);
                user.username = generatedUsername;
            }
        } else {
            // Register a new user
            const dummyPassword = bcrypt.hashSync(google_id || 'google_dummy_secret', 10);
            const [result] = await dbPool.query(
                'INSERT INTO users (name, email, password_hash, avatar_url, username, role) VALUES (?, ?, ?, ?, ?, "customer")',
                [name, email, dummyPassword, avatar, generatedUsername]
            );
            
            user = {
                id: result.insertId,
                name: name,
                email: email,
                avatar_url: avatar,
                username: generatedUsername,
                role: 'customer'
            };
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                avatar_url: user.avatar_url,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2.6 Update User Profile Details
app.post('/api/auth/update-profile', async (req, res) => {
    const { user_id, name, username } = req.body;
    try {
        if (!user_id || !name || !username) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        }
        
        // Check if username is already taken by another user
        const [existing] = await dbPool.query('SELECT * FROM users WHERE username = ? AND id != ?', [username, user_id]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว' });
        }
        
        // Get old name first to update reviews
        const [userRows] = await dbPool.query('SELECT name FROM users WHERE id = ?', [user_id]);
        if (userRows.length > 0) {
            const oldName = userRows[0].name;
            
            // Update database
            await dbPool.query('UPDATE users SET name = ?, username = ? WHERE id = ?', [name, username, user_id]);
            
            // Sync reviews
            await dbPool.query('UPDATE reviews SET user_name = ? WHERE user_name = ?', [`คุณ ${name}`, `คุณ ${oldName}`]);
        }
        
        res.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2.7 Update User Avatar (Profile Picture)
app.post('/api/auth/update-avatar', async (req, res) => {
    const { user_id, avatar_data } = req.body;
    try {
        if (!user_id || !avatar_data) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        }
        
        // Update database directly with base64 data
        await dbPool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_data, user_id]);
        
        // Optionally update any reviews by this user to keep avatars in sync
        const [userRows] = await dbPool.query('SELECT name FROM users WHERE id = ?', [user_id]);
        if (userRows.length > 0) {
            const userName = userRows[0].name;
            await dbPool.query('UPDATE reviews SET avatar_url = ? WHERE user_name = ?', [avatar_data, `คุณ ${userName}`]);
        }
        
        res.json({ success: true, avatar_url: avatar_data, message: 'อัปเดตรูปโปรไฟล์สำเร็จ' });
    } catch (error) {
        console.error('Update avatar error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Products: List all
app.get('/api/products', async (req, res) => {
    try {
        const [products] = await dbPool.query('SELECT * FROM products');
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Products: Add (Admin Only)
app.post('/api/products', async (req, res) => {
    const { name, brand, category, frame_shape, image_url, tryon_image_url, price, stock } = req.body;
    try {
        const conn = await dbPool.getConnection();
        await conn.beginTransaction();

        try {
            // Insert product with temporary empty image values to get insertId
            const [result] = await conn.query(
                `INSERT INTO products (name, brand, category, frame_shape, image_url, tryon_image_url, price, stock) 
                 VALUES (?, ?, ?, ?, '', '', ?, ?)`,
                [name, brand, category, frame_shape, price, stock]
            );
            const productId = result.insertId;

            let finalImageUrl = '/assets/round.svg';
            let finalTryonUrl = '/assets/round.svg';

            // Save main image to disk if it is base64
            if (image_url && image_url.startsWith('data:image/')) {
                try {
                    const base64Data = image_url.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    const ext = image_url.substring("data:image/".length, image_url.indexOf(";base64")).split('+')[0] || 'png';
                    const fileName = `product_${productId}_${Date.now()}.${ext}`;
                    const dirPath = path.join(__dirname, 'public', 'uploads', 'products');
                    
                    if (!fs.existsSync(dirPath)){
                        fs.mkdirSync(dirPath, { recursive: true });
                    }
                    
                    fs.writeFileSync(path.join(dirPath, fileName), buffer);
                    finalImageUrl = `/uploads/products/${fileName}`;
                } catch (imgErr) {
                    console.error('Failed to save product image file:', imgErr);
                }
            } else if (image_url) {
                finalImageUrl = image_url;
            }

            // Save tryon image to disk if it is base64
            if (tryon_image_url && tryon_image_url.startsWith('data:image/')) {
                if (tryon_image_url === image_url) {
                    finalTryonUrl = finalImageUrl;
                } else {
                    try {
                        const base64Data = tryon_image_url.replace(/^data:image\/\w+;base64,/, "");
                        const buffer = Buffer.from(base64Data, 'base64');
                        const ext = tryon_image_url.substring("data:image/".length, tryon_image_url.indexOf(";base64")).split('+')[0] || 'png';
                        const fileName = `product_tryon_${productId}_${Date.now()}.${ext}`;
                        const dirPath = path.join(__dirname, 'public', 'uploads', 'products');
                        
                        if (!fs.existsSync(dirPath)){
                            fs.mkdirSync(dirPath, { recursive: true });
                        }
                        
                        fs.writeFileSync(path.join(dirPath, fileName), buffer);
                        finalTryonUrl = `/uploads/products/${fileName}`;
                    } catch (imgErr) {
                        console.error('Failed to save tryon image file:', imgErr);
                    }
                }
            } else if (tryon_image_url) {
                finalTryonUrl = tryon_image_url;
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
        console.error('Add product failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Products: Delete (Admin Only)
app.delete('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        await dbPool.query('DELETE FROM products WHERE id = ?', [productId]);
        res.json({ success: true, message: 'ลบสินค้าสำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Prescriptions: Get latest for a user
app.get('/api/prescriptions/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const [rows] = await dbPool.query(
            'SELECT * FROM prescriptions WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1',
            [userId]
        );
        if (rows.length === 0) {
            return res.json({ success: true, prescription: null });
        }
        res.json({ success: true, prescription: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Prescriptions: Save
app.post('/api/prescriptions', async (req, res) => {
    const { user_id, sphere_left, sphere_right, cylinder_left, cylinder_right, axis_left, axis_right, pd } = req.body;
    try {
        await dbPool.query(
            `INSERT INTO prescriptions (user_id, sphere_left, sphere_right, cylinder_left, cylinder_right, axis_left, axis_right, pd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user_id, sphere_left, sphere_right, cylinder_left, cylinder_right, axis_left, axis_right, pd]
        );
        res.json({ success: true, message: 'บันทึกค่าสายตาสำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8. Orders: Place a new order
app.post('/api/orders', async (req, res) => {
    const { user_id, items, total_amount, prescription, shipping_name, shipping_phone, shipping_address, payment_method, slip_image_base64 } = req.body;
    
    // items is array: [{ product_id, quantity, unit_price, lens_id }]
    try {
        // Start Transaction
        const conn = await dbPool.getConnection();
        await conn.beginTransaction();

        try {
            // Save prescription if provided
            if (prescription && Object.keys(prescription).length > 0) {
                await conn.query(
                    `INSERT INTO prescriptions (user_id, sphere_left, sphere_right, cylinder_left, cylinder_right, axis_left, axis_right, pd)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user_id, prescription.sphere_left, prescription.sphere_right, prescription.cylinder_left, prescription.cylinder_right, prescription.axis_left, prescription.axis_right, prescription.pd]
                );
            }

            // Create Order
            const [orderRes] = await conn.query(
                'INSERT INTO orders (user_id, total_amount, status, shipping_name, shipping_phone, shipping_address, payment_method) VALUES (?, ?, "paid", ?, ?, ?, ?)', // Auto marked as paid for mock order flow
                [user_id, total_amount, shipping_name || null, shipping_phone || null, shipping_address || null, payment_method || 'COD']
            );
            const orderId = orderRes.insertId;

            // Save slip image if provided
            if ((payment_method === 'BankTransfer' || payment_method === 'QRCode') && slip_image_base64) {
                try {
                    const base64Data = slip_image_base64.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(base64Data, 'base64');
                    const fileName = `slip_${orderId}_${Date.now()}.png`;
                    const dirPath = path.join(__dirname, 'public', 'uploads', 'slips');
                    
                    if (!fs.existsSync(dirPath)){
                        fs.mkdirSync(dirPath, { recursive: true });
                    }
                    
                    fs.writeFileSync(path.join(dirPath, fileName), buffer);
                    const slipUrl = `/uploads/slips/${fileName}`;
                    
                    await conn.query('UPDATE orders SET slip_image = ? WHERE id = ?', [slipUrl, orderId]);
                } catch (imgErr) {
                    console.error('Failed to save slip image:', imgErr);
                }
            }

            // Create Order Items and decrease stock
            for (const item of items) {
                await conn.query(
                    `INSERT INTO order_items (order_id, product_id, quantity, unit_price, lens_id)
                     VALUES (?, ?, ?, ?, ?)`,
                    [orderId, item.product_id, item.quantity, item.unit_price, item.lens_id]
                );

                // Decrease stock
                await conn.query(
                    'UPDATE products SET stock = stock - ? WHERE id = ?',
                    [item.quantity, item.product_id]
                );
            }

            await conn.commit();
            conn.release();

            res.json({ success: true, orderId, message: 'สั่งซื้อสินค้าสำเร็จ' });

        } catch (txError) {
            await conn.rollback();
            conn.release();
            throw txError;
        }

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Admin: Get all orders
app.get('/api/admin/orders', async (req, res) => {
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
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10. Admin: Update order status
app.put('/api/admin/orders/:id', async (req, res) => {
    const orderId = req.params.id;
    const { status, tracking_number } = req.body;
    try {
        if (tracking_number !== undefined) {
            await dbPool.query('UPDATE orders SET status = ?, tracking_number = ? WHERE id = ?', [status, tracking_number, orderId]);
        } else {
            await dbPool.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
        }
        res.json({ success: true, message: 'อัปเดตสถานะออเดอร์สำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 11. Admin: Analytics (Page views mockup, conversions, and popular try-on shapes)
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const [userCount] = await dbPool.query('SELECT COUNT(*) as count FROM users WHERE role = "customer"');
        const [productCount] = await dbPool.query('SELECT COUNT(*) as count FROM products');
        const [orderCount] = await dbPool.query('SELECT COUNT(*) as count, SUM(total_amount) as sales FROM orders');
        
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// 12. Admin: DB Backup endpoint (Outputs schema + data as text file)
app.get('/api/admin/backup', async (req, res) => {
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// 13. Orders: Get orders for a specific user (Customer History)
app.get('/api/orders/user/:userId', async (req, res) => {
    const userId = req.params.userId;
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
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 14. Admin: Save client-side generated product image
app.post('/api/admin/save-generated-image', async (req, res) => {
    const { filename, image_base64 } = req.body;
    try {
        if (!filename || !image_base64) {
            return res.status(400).json({ success: false, error: 'Missing filename or image data' });
        }
        const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const dirPath = path.join(__dirname, 'public', 'assets', 'products');
        
        if (!fs.existsSync(dirPath)){
            fs.mkdirSync(dirPath, { recursive: true });
        }
        
        fs.writeFileSync(path.join(dirPath, filename), buffer);
        res.json({ success: true, message: `Successfully saved ${filename}` });
    } catch (error) {
        console.error('Failed to save generated product image:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 15. Reviews API: Get all reviews
app.get('/api/reviews', async (req, res) => {
    try {
        const [reviews] = await dbPool.query('SELECT * FROM reviews ORDER BY created_at DESC');
        res.json({ success: true, reviews });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 16. Reviews API: Post a new review
app.post('/api/reviews', async (req, res) => {
    const { user_name, rating, comment, product_name, avatar_url } = req.body;
    try {
        if (!user_name || !rating || !comment) {
            return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
        }
        await dbPool.query(
            'INSERT INTO reviews (user_name, rating, comment, product_name, avatar_url) VALUES (?, ?, ?, ?, ?)',
            [user_name, rating, comment, product_name || 'แว่นตาทั่วไป', avatar_url || null]
        );
        res.json({ success: true, message: 'บันทึกรีวิวสำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 17. Reviews API: Delete a review (Admin action)
app.delete('/api/reviews/:id', async (req, res) => {
    const reviewId = req.params.id;
    try {
        await dbPool.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        res.json({ success: true, message: 'ลบรีวิวสำเร็จ' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start initialization and server
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
});
