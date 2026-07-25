const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const JimpLib = require('jimp');
    const Jimp = JimpLib.Jimp || JimpLib;
    
    // โหลดรูปตัว B วงกลมดำ
    const sourcePath = 'C:\\Users\\acer\\.gemini\\antigravity\\brain\\734881c9-c5da-45f7-841e-98dad2cee95a\\.user_uploaded\\media__1784979878795.png';
    const image = await Jimp.read(sourcePath);
    console.log('Source image loaded.');
    
    // ลบพื้นหลังสีขาวออก
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      if (r > 240 && g > 240 && b > 240) {
        this.bitmap.data[idx + 3] = 0;
      }
    });
    console.log('Background transparency processed.');
    
    // ฟังก์ชันช่วยเขียนไฟล์ภาพขนาดต่างๆ
    const saveResized = async (img, size, destPath) => {
      const resized = img.clone().resize({ w: size, h: size });
      if (typeof resized.write === 'function') {
        await resized.write(destPath);
      } else {
        await resized.writeAsync(destPath);
      }
      console.log(`Saved icon size ${size}x${size} to ${path.basename(destPath)}`);
    };
    
    const publicAssetsDir = path.join(__dirname, '..', 'public', 'assets');
    
    // บันทึกขนาดต่างๆ
    await saveResized(image, 32, path.join(publicAssetsDir, 'favicon.png'));
    await saveResized(image, 180, path.join(publicAssetsDir, 'apple-touch-icon.png'));
    await saveResized(image, 192, path.join(publicAssetsDir, 'logo-192.png'));
    await saveResized(image, 512, path.join(publicAssetsDir, 'logo-512.png'));
    
    console.log('Web icons generated successfully!');
  } catch (err) {
    console.error('Failed to generate web icons:', err);
  }
}

run();
