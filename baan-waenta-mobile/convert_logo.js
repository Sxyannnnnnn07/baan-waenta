const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const JimpLib = require('jimp');
    // ดึง Jimp class จาก exports
    const Jimp = JimpLib.Jimp || JimpLib;
    console.log('Jimp class loaded.');
    
    const sourcePath = path.join(__dirname, '..', 'baan_waenta_logo.jpg');
    
    // โหลดรูปภาพ
    const image = await Jimp.read(sourcePath);
    console.log('Source image loaded.');
    
    // ฟังก์ชันเขียนไฟล์แบบยืดหยุ่นรองรับ Jimp หลายเวอร์ชัน
    const saveImage = async (img, destName) => {
      const destPath = path.join(__dirname, 'assets', destName);
      const resized = img.clone().resize({ w: 1024, h: 1024 });
      if (typeof resized.write === 'function') {
        await resized.write(destPath);
      } else {
        await resized.writeAsync(destPath);
      }
      console.log(`Saved ${destName}`);
    };
    
    await saveImage(image, 'icon.png');
    await saveImage(image, 'splash-icon.png');
    await saveImage(image, 'android-icon-foreground.png');
    
    console.log('All logos updated successfully!');
  } catch (err) {
    console.error('Failed to convert image:', err);
  }
}

run();
