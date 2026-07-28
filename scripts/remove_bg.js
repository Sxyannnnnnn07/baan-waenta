const Jimp = require('jimp');
const path = require('path');

const logoPath = path.join(__dirname, 'public', 'assets', 'logo.png');

async function removeBackground() {
    console.log('Processing logo at:', logoPath);
    const image = await Jimp.read(logoPath);
    
    // Scan every pixel and set alpha to 0 for all grayish/whitish pixels
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
        const r = this.bitmap.data[idx + 0];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        
        const avg = (r + g + b) / 3;
        // Check if the pixel is grayish/whitish (low difference between R, G, and B)
        const isNeutral = Math.max(r, g, b) - Math.min(r, g, b) < 25;
        
        // Key out anything brighter than 220 (handles off-white textures)
        if (isNeutral && avg > 220) {
            this.bitmap.data[idx + 3] = 0; // Make pixel transparent
        }
    });
    
    // Save as transparent PNG
    await image.writeAsync(logoPath);
    console.log('Background removed successfully! Saved transparent logo.png.');
}

removeBackground().catch(console.error);
