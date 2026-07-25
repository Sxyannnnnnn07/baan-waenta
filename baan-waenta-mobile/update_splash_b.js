const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const JimpLib = require('jimp');
    const Jimp = JimpLib.Jimp || JimpLib;
    
    // โหลดรูปที่สอง (รูปโลโก้วงกลมดำ ตัวบีขาว)
    const sourcePath = 'C:\\Users\\acer\\.gemini\\antigravity\\brain\\734881c9-c5da-45f7-841e-98dad2cee95a\\.user_uploaded\\media__1784979878795.png';
    const image = await Jimp.read(sourcePath);
    console.log('Source image loaded successfully.');
    
    // ลบพื้นหลังสีขาวออก (ทำให้โปร่งแสง)
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      
      // ถ้าเป็นสีขาวหรือใกล้เคียง (ค่ามากกว่า 240) ให้ทำให้โปร่งแสง (Alpha = 0)
      if (r > 240 && g > 240 && b > 240) {
        this.bitmap.data[idx + 3] = 0;
      }
    });
    console.log('Background transparency processed.');
    
    // บันทึกและ resize รูปภาพไปยัง assets
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
    
    console.log('Logo update completed successfully!');
  } catch (err) {
    console.error('Error updating logo:', err);
  }
}

run();
