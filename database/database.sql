-- Create Database for Baan Waenta
CREATE DATABASE IF NOT EXISTS baan_waenta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE baan_waenta;

-- 1. Users Table (Customer & Admin)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(255) NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url LONGTEXT NULL,
    google_sub VARCHAR(255) NULL UNIQUE,
    role VARCHAR(50) DEFAULT 'customer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Products Table (Glasses frames)
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- 'Optical' or 'Sunglasses'
    frame_shape VARCHAR(100) NOT NULL, -- 'Round', 'Square', 'Aviator', 'Oval'
    image_url VARCHAR(255) NOT NULL, -- Thumbnail image
    tryon_image_url VARCHAR(255) NOT NULL, -- SVG/PNG frame image for Virtual Try-On
    price DECIMAL(10,2) NOT NULL,
    stock INT NOT NULL
) ENGINE=InnoDB;

-- 3. Prescriptions Table (User lens details)
CREATE TABLE IF NOT EXISTS prescriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    sphere_left DECIMAL(5,2) DEFAULT 0.00,
    sphere_right DECIMAL(5,2) DEFAULT 0.00,
    cylinder_left DECIMAL(5,2) DEFAULT 0.00,
    cylinder_right DECIMAL(5,2) DEFAULT 0.00,
    axis_left INT DEFAULT 0,
    axis_right INT DEFAULT 0,
    pd DECIMAL(5,2) DEFAULT 60.00, -- Pupillary Distance in mm
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Lenses Table (Lens upgrades)
CREATE TABLE IF NOT EXISTS lenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lens_type VARCHAR(100) NOT NULL,
    price_addon DECIMAL(10,2) NOT NULL
) ENGINE=InnoDB;

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- pending, payment_review, paid, shipped, completed, cancelled
    shipping_name VARCHAR(255) NULL,
    shipping_phone VARCHAR(50) NULL,
    shipping_address TEXT NULL,
    payment_method VARCHAR(100) DEFAULT 'COD',
    slip_image VARCHAR(255) NULL,
    tracking_number VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Reviews tied to the authenticated customer when available
CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    user_name VARCHAR(255) NOT NULL,
    rating INT NOT NULL,
    comment TEXT NOT NULL,
    product_name VARCHAR(255) DEFAULT 'แว่นตาทั่วไป',
    avatar_url LONGTEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 8. Server-side browser sessions (stores token hashes, never raw cookies)
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
) ENGINE=InnoDB;

-- 6. Order Items Table
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
) ENGINE=InnoDB;

-- ==========================================
-- Insert Seed Data (Lenses and basic options)
-- ==========================================
INSERT INTO lenses (id, lens_type, price_addon) VALUES
(1, 'เลนส์ธรรมดา (Normal Lens)', 0.00),
(2, 'เลนส์กรองแสงสีฟ้า (Blue Block)', 500.00),
(3, 'เลนส์ปรับแสงออโต้ตามแดด (Photochromic)', 1000.00)
ON DUPLICATE KEY UPDATE lens_type=VALUES(lens_type), price_addon=VALUES(price_addon);
