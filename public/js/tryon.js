// Try-On State variables
let products = [];
let selectedProduct = null;
let webcamStream = null;
let isWebcamActive = false;
let isModelsLoaded = false;
let isDetectionLoopRunning = false;

// User Image / Canvas variables
let uploadedImage = null;
let glassesImage = new Image();
let isGlassesLoaded = false;

// Glasses positioning properties (Defaults)
let glassesState = {
    x: 200,          // Canvas X coordinate
    y: 150,          // Canvas Y coordinate
    scale: 130,      // Width of glasses
    rotation: 0,     // In degrees
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0
};

// Elements
let canvas, ctx, video;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    canvas = document.getElementById('tryon-canvas');
    ctx = canvas.getContext('2d');
    video = document.getElementById('webcam-video');
    video.addEventListener('loadedmetadata', () => {
        adjustCanvasSize();
    });

    checkUserLogin();
    fetchTryOnProducts();
    setupCanvasInteractivity();
    initScrollEffects();
    
    // Check URL parameters for pre-selected product
    const urlParams = new URLSearchParams(window.location.search);
    const prodId = urlParams.get('product');
    if (prodId) {
        // Wait a brief moment for products to load before selecting
        setTimeout(() => selectProduct(parseInt(prodId)), 600);
    }
});

// Check user login to update nav links
function checkUserLogin() {
    const savedUser = localStorage.getItem('baan_waenta_user');
    const adminNav = document.getElementById('admin-nav');
    if (savedUser) {
        const user = JSON.parse(savedUser);
        if (user.role === 'admin') {
            adminNav.style.display = 'block';
        }
    }
}

// Fetch products for sidebar list
async function fetchTryOnProducts() {
    try {
        const res = await fetch('/api/products');
        const data = await res.json();
        if (data.success) {
            products = data.products;
            renderTryOnProducts(products);
        }
    } catch (error) {
        console.error('Error fetching tryon products:', error);
    }
}

function renderTryOnProducts(prods) {
    const listDiv = document.getElementById('tryon-products-list');
    listDiv.innerHTML = '';

    prods.forEach(prod => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '1rem';
        item.style.padding = '0.8rem';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = '12px';
        item.style.cursor = 'pointer';
        item.style.backgroundColor = 'var(--bg-secondary)';
        item.style.transition = 'var(--transition)';
        item.id = `vto-prod-${prod.id}`;

        item.onclick = () => selectProduct(prod.id);

        item.innerHTML = `
            <div style="width: 60px; height: 40px; background-color: var(--bg-primary); border-radius: 8px; padding: 0.2rem; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                <img src="${prod.image_url}" alt="${prod.name}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
            </div>
            <div style="flex: 1;">
                <h4 style="font-size: 0.85rem; font-weight: 600;">${prod.name}</h4>
                <p style="font-size: 0.75rem; color: var(--text-secondary);">${prod.brand}</p>
            </div>
            <div style="font-weight: 700; font-size: 0.9rem; font-family: var(--font-heading);">${parseFloat(prod.price).toLocaleString()} ฿</div>
        `;
        listDiv.appendChild(item);
    });
}

function selectProduct(productId) {
    // Highlights the selected product item
    const items = document.querySelectorAll('#tryon-products-list > div');
    items.forEach(it => it.style.borderColor = 'var(--border-color)');
    
    const activeItem = document.getElementById(`vto-prod-${productId}`);
    if (activeItem) {
        activeItem.style.borderColor = 'var(--accent)';
    }

    selectedProduct = products.find(p => p.id === productId);
    if (!selectedProduct) return;

    // Load Glasses Image
    glassesImage.src = selectedProduct.tryon_image_url;
    glassesImage.onload = () => {
        isGlassesLoaded = true;
        drawCanvas();
    };

    // Update bottom panel info
    document.getElementById('selected-frame-title').innerText = selectedProduct.name;
    document.getElementById('selected-frame-price').innerText = `${parseFloat(selectedProduct.price).toLocaleString()} ฿`;
    
    // Enable order button
    const orderBtn = document.getElementById('vto-order-btn');
    orderBtn.disabled = false;
}

// ==========================================
// IMAGE & CAMERA CONTROLS
// ==========================================
function loadUploadedImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        uploadedImage = new Image();
        uploadedImage.src = e.target.result;
        uploadedImage.onload = function() {
            // Hide camera view, show canvas
            stopWebcam();
            document.getElementById('upload-panel').style.display = 'none';
            document.getElementById('manual-controls').style.display = 'block';
            document.getElementById('clear-photo-btn').style.display = 'block';
            
            // Adjust canvas dimensions to fit image aspect ratio
            adjustCanvasSize();
            
            // Draw
            drawCanvas();
        };
    };
    reader.readAsDataURL(file);
}

function adjustCanvasSize() {
    const wrapper = document.getElementById('video-wrapper');
    const width = wrapper.clientWidth;
    
    if (uploadedImage && !isWebcamActive) {
        // Calculate height dynamically to match the image's original aspect ratio (naturalHeight / naturalWidth)
        const aspectRatio = uploadedImage.naturalHeight / uploadedImage.naturalWidth || 1;
        const height = width * aspectRatio;
        
        wrapper.style.aspectRatio = 'auto';
        wrapper.style.height = `${height}px`;
        
        canvas.width = width;
        canvas.height = height;
    } else if (isWebcamActive && video.videoWidth > 0) {
        // Explicitly set DOM width/height properties on the video element for face-api stability on mobile
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        
        // Calculate aspect ratio dynamically from the camera stream resolution
        const aspectRatio = video.videoHeight / video.videoWidth;
        wrapper.style.aspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        wrapper.style.height = 'auto';
        
        const height = width * aspectRatio;
        canvas.width = width;
        canvas.height = height;
    } else {
        // Reset to default 4:3 aspect ratio for default view
        wrapper.style.aspectRatio = '4/3';
        wrapper.style.height = 'auto';
        
        const height = wrapper.clientHeight;
        canvas.width = width;
        canvas.height = height;
    }

    // Set initial glasses position to the center of the canvas
    if (glassesState.x === 0 || glassesState.x === 200 || glassesState.x === canvas.width / 2) {
        glassesState.x = canvas.width / 2;
        glassesState.y = canvas.height / 2.2;
    }
}

function resetToUploadPanel() {
    uploadedImage = null;
    const wrapper = document.getElementById('video-wrapper');
    
    // Reset canvas to normal when resetting panels
    canvas.style.transform = 'none';
    wrapper.style.aspectRatio = '4/3';
    wrapper.style.height = 'auto';
    
    document.getElementById('upload-panel').style.display = 'flex';
    document.getElementById('manual-controls').style.display = 'none';
    document.getElementById('clear-photo-btn').style.display = 'none';
    
    // Recalculate canvas size
    adjustCanvasSize();
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Start Webcam Video
async function startWebcam() {
    const cameraBtn = document.getElementById('toggle-camera-btn');
    
    if (isWebcamActive) {
        stopWebcam();
        return;
    }

    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            }, 
            audio: false 
        });
        video.srcObject = webcamStream;
        video.style.display = 'block';
        document.getElementById('upload-panel').style.display = 'none';
        document.getElementById('clear-photo-btn').style.display = 'none';
        
        // Mirror the canvas for natural webcam view
        canvas.style.transform = 'scaleX(-1)';
        
        isWebcamActive = true;
        cameraBtn.innerHTML = `<ion-icon name="videocam-off-outline"></ion-icon> ปิดกล้องเว็บแคม`;
        cameraBtn.className = 'btn btn-secondary';

        // Show camera viewfinder overlay
        const vfOverlay = document.getElementById('viewfinder-overlay');
        if (vfOverlay) vfOverlay.style.display = 'block';

        adjustCanvasSize();
        
        // Start continuous redraw loop for camera feed
        requestAnimationFrame(cameraLoop);

        // Attempt automated tracking if face-api.js is loaded
        if (typeof faceapi !== 'undefined') {
            initFaceDetection();
        } else {
            // Show manual controls for camera if AI tracking is not available
            document.getElementById('manual-controls').style.display = 'block';
        }

    } catch (error) {
        console.error('Camera access error:', error);
        alert('ไม่สามารถเปิดใช้งานกล้องเว็บแคมได้ กรุณาให้อนุญาตสิทธิ์เข้าถึงกล้อง หรือเลือกอัปโหลดรูปภาพใบหน้าแทน');
    }
}

function stopWebcam() {
    if (!isWebcamActive) return;

    const cameraBtn = document.getElementById('toggle-camera-btn');
    
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
    }
    
    video.srcObject = null;
    video.style.display = 'none';
    isWebcamActive = false;
    
    // Reset canvas to normal for uploaded photos
    canvas.style.transform = 'none';
    
    cameraBtn.innerHTML = `<ion-icon name="videocam-outline"></ion-icon> เปิดใช้งานกล้องสด`;
    cameraBtn.className = 'btn btn-primary';

    // Hide camera viewfinder overlay
    const vfOverlay = document.getElementById('viewfinder-overlay');
    if (vfOverlay) vfOverlay.style.display = 'none';
    
    resetToUploadPanel();
}

// Camera feed animation frame loop
function cameraLoop() {
    if (!isWebcamActive) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw video stream frame normally (no mirroring here; CSS handles it)
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (videoWidth > 0 && videoHeight > 0) {
        const videoRatio = videoWidth / videoHeight;
        const canvasRatio = canvas.width / canvas.height;
        
        let sx = 0, sy = 0, sWidth = videoWidth, sHeight = videoHeight;
        
        if (videoRatio > canvasRatio) {
            // Video is wider than canvas: crop the sides
            sWidth = videoHeight * canvasRatio;
            sx = (videoWidth - sWidth) / 2;
        } else {
            // Video is taller than canvas: crop top/bottom
            sHeight = videoWidth / canvasRatio;
            sy = (videoHeight - sHeight) / 2;
        }
        
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    // Draw the glasses frame on top
    if (isGlassesLoaded && selectedProduct) {
        drawGlasses();
    }
    
    requestAnimationFrame(cameraLoop);
}

// ==========================================
// CANVAS INTERACTIVITY & DRAWING
// ==========================================
function drawCanvas() {
    if (isWebcamActive) return; // Managed by cameraLoop

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background uploaded user image
    if (uploadedImage) {
        ctx.drawImage(uploadedImage, 0, 0, canvas.width, canvas.height);
    }

    // Draw glasses overlay
    if (isGlassesLoaded && selectedProduct) {
        drawGlasses();
    }
}

// Helper offscreen canvas to perform real-time background keying (filtering out white background)
let offscreenCanvas = null;
let offscreenCtx = null;

function drawGlasses() {
    const scaleSlider = document.getElementById('scale-slider');
    const xSlider = document.getElementById('x-slider');
    const ySlider = document.getElementById('y-slider');
    const rotationSlider = document.getElementById('rotation-slider');

    const scale = parseInt(scaleSlider.value);
    const rotation = parseInt(rotationSlider.value) * Math.PI / 180;
    
    const x = glassesState.x + parseInt(xSlider.value);
    const y = glassesState.y + parseInt(ySlider.value);

    const aspectRatio = glassesImage.height / glassesImage.width || 0.5; // default square aspect ratio
    const glassesHeight = scale * aspectRatio;

    // Create offscreen canvas if it doesn't exist
    if (!offscreenCanvas) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCtx = offscreenCanvas.getContext('2d');
    }

    // Set offscreen dimensions to draw the current scaled frame
    offscreenCanvas.width = scale;
    offscreenCanvas.height = glassesHeight;
    offscreenCtx.clearRect(0, 0, scale, glassesHeight);
    
    // Draw raw glasses image to offscreen canvas
    offscreenCtx.drawImage(glassesImage, 0, 0, scale, glassesHeight);

    // Apply soft color keying: loop through pixels and feather white background borders
    const isPNG = selectedProduct.tryon_image_url.toLowerCase().endsWith('.png');
    if (!isPNG) {
        try {
            const imgData = offscreenCtx.getImageData(0, 0, scale, glassesHeight);
            const data = imgData.data;
            
            // Define soft-keying white thresholds
            const minWhite = 200; // start fading out transparency here
            const maxWhite = 248; // fully transparent here
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                const a = data[i+3];
                
                const avg = (r + g + b) / 3;
                // Ensure the pixel is a neutral color (gray/white) and not a vibrant frame color
                const isNeutral = Math.max(r, g, b) - Math.min(r, g, b) < 30;
                
                if (isNeutral && avg > minWhite) {
                    if (avg >= maxWhite) {
                        data[i+3] = 0; // Completely transparent
                    } else {
                        // Smoothly interpolate alpha to feather the edge
                        const factor = (avg - minWhite) / (maxWhite - minWhite);
                        data[i+3] = Math.min(a, a * (1 - factor));
                    }
                }
            }
            offscreenCtx.putImageData(imgData, 0, 0);
        } catch (e) {
            console.error("Canvas pixel manipulation error (possibly CORS issue):", e);
        }
    }

    // Draw the keyed offscreen image onto the main canvas with rotation
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(offscreenCanvas, -scale / 2, -glassesHeight / 2);
    ctx.restore();
}

function setupCanvasInteractivity() {
    // Canvas mouse events for dragging glasses frame on picture
    canvas.addEventListener('mousedown', (e) => {
        if (!selectedProduct) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Check if clicked near the glasses coordinate (bounding box check)
        const scaleVal = parseInt(document.getElementById('scale-slider').value);
        const yOffsetVal = parseInt(document.getElementById('y-slider').value);
        const xOffsetVal = parseInt(document.getElementById('x-slider').value);
        
        // Mirror currentX to screen coordinates since the canvas is mirrored with scaleX(-1) in CSS
        const currentX = canvas.width - (glassesState.x + xOffsetVal);
        const currentY = glassesState.y + yOffsetVal;
        
        const dist = Math.sqrt((mouseX - currentX) ** 2 + (mouseY - currentY) ** 2);
        
        if (dist < scaleVal / 2) {
            glassesState.isDragging = true;
            // dragStartX stores (mouseX + xOffsetVal) for mirrored drag mapping
            glassesState.dragStartX = mouseX + xOffsetVal;
            glassesState.dragStartY = mouseY - yOffsetVal;
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!glassesState.isDragging) return;
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Update offsets on sliders directly (X is inverted for mirrored dragging)
        const newXOffset = Math.max(-400, Math.min(400, glassesState.dragStartX - mouseX));
        const newYOffset = Math.max(-400, Math.min(400, mouseY - glassesState.dragStartY));

        document.getElementById('x-slider').value = newXOffset;
        document.getElementById('y-slider').value = newYOffset;

        drawCanvas();
    });

    canvas.addEventListener('mouseup', () => {
        glassesState.isDragging = false;
    });

    canvas.addEventListener('mouseleave', () => {
        glassesState.isDragging = false;
    });

    // Touch events for mobile screens
    canvas.addEventListener('touchstart', (e) => {
        if (!selectedProduct || e.touches.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;

        const scaleVal = parseInt(document.getElementById('scale-slider').value);
        const yOffsetVal = parseInt(document.getElementById('y-slider').value);
        const xOffsetVal = parseInt(document.getElementById('x-slider').value);
        
        // Mirror currentX to screen coordinates since the canvas is mirrored with scaleX(-1) in CSS
        const currentX = canvas.width - (glassesState.x + xOffsetVal);
        const currentY = glassesState.y + yOffsetVal;
        
        const dist = Math.sqrt((touchX - currentX) ** 2 + (touchY - currentY) ** 2);
        
        if (dist < scaleVal / 2) {
            glassesState.isDragging = true;
            // dragStartX stores (touchX + xOffsetVal) for mirrored drag mapping
            glassesState.dragStartX = touchX + xOffsetVal;
            glassesState.dragStartY = touchY - yOffsetVal;
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        if (!glassesState.isDragging || e.touches.length === 0) return;
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;

        // X is inverted for mirrored dragging
        const newXOffset = Math.max(-400, Math.min(400, glassesState.dragStartX - touchX));
        const newYOffset = Math.max(-400, Math.min(400, touchY - glassesState.dragStartY));

        document.getElementById('x-slider').value = newXOffset;
        document.getElementById('y-slider').value = newYOffset;

        drawCanvas();
    });

    canvas.addEventListener('touchend', () => {
        glassesState.isDragging = false;
    });
}

// Redirects to shop index with the item configured
function orderFromVTO() {
    if (!selectedProduct) return;
    // We can simulate adding this frame to cart. First redirect to home, and trigger purchase configuration.
    window.location.href = `/?product=${selectedProduct.id}`;
}

// ==========================================
// OPTIONAL AUTOMATED FACE DETECTION (AI)
// ==========================================
async function initFaceDetection() {
    if (isModelsLoaded) {
        if (!isDetectionLoopRunning) {
            isDetectionLoopRunning = true;
            runDetection();
        }
        return;
    }
    
    console.log("Loading Face Detection Models...");
    try {
        // Load tiny face detector and landmarks model from CDN
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        console.log("Face API Models loaded successfully");
        isModelsLoaded = true;
        
        if (!isDetectionLoopRunning) {
            isDetectionLoopRunning = true;
            runDetection();
        }
    } catch (err) {
        console.warn("Could not load face-api.js model from CDN. Reverting to 100% manual overlay mode", err);
    }
}

async function runDetection() {
    if (!isWebcamActive) {
        isDetectionLoopRunning = false;
        return;
    }

    // Guard against zero dimensions during initial webcam spin-up
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
        setTimeout(runDetection, 100);
        return;
    }

    try {
        // Detect face landmarks
        const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 })).withFaceLandmarks();

        if (detections) {
            const landmarks = detections.landmarks;
            
            // Find left and right eye coordinates
            const leftEye = landmarks.getLeftEye();
            const rightEye = landmarks.getRightEye();
            
            // Calculate center of eyes
            const leftEyeCenter = getFeatureCenter(leftEye);
            const rightEyeCenter = getFeatureCenter(rightEye);
            
            // Calculate crop factor just like in cameraLoop
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            const videoRatio = videoWidth / videoHeight;
            const canvasRatio = canvas.width / canvas.height;
            
            let sx = 0, sy = 0, sWidth = videoWidth, sHeight = videoHeight;
            if (videoRatio > canvasRatio) {
                sWidth = videoHeight * canvasRatio;
                sx = (videoWidth - sWidth) / 2;
            } else {
                sHeight = videoWidth / canvasRatio;
                sy = (videoHeight - sHeight) / 2;
            }
            
            const scaleX = canvas.width / sWidth;
            const scaleY = canvas.height / sHeight;
            
            // Calculate eye center coordinates in video space
            const rawEyeX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
            const rawEyeY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
            
            // Mapped positions directly (no inversion since CSS scales/mirrors the canvas)
            const eyeX = (rawEyeX - sx) * scaleX;
            const eyeY = (rawEyeY - sy) * scaleY;
            
            // Calculate distance between eyes to scale glasses
            const dx = rightEyeCenter.x - leftEyeCenter.x;
            const dy = rightEyeCenter.y - leftEyeCenter.y;
            const eyeDist = Math.sqrt(dx*dx + dy*dy);
            
            // Calculate tilt rotation angle in degrees
            const angleRad = Math.atan2(dy, dx);
            const angleDeg = angleRad * (180 / Math.PI);
            
            // Autoupdate states and sliders directly
            // We set glasses width to roughly 2.2 times the eye distance
            document.getElementById('scale-slider').value = Math.round(eyeDist * 2.2 * scaleX);
            document.getElementById('rotation-slider').value = Math.round(-angleDeg); // negative due to canvas mirroring
            
            // Directly map position coordinates
            glassesState.x = eyeX;
            glassesState.y = eyeY;
            
            // Set manual offsets to 0 since tracking handles it
            document.getElementById('x-slider').value = 0;
            document.getElementById('y-slider').value = 0;
        }
    } catch (error) {
        console.error("Face detection loop error:", error);
    }

    setTimeout(runDetection, 100); // Check every 100ms
}

function getFeatureCenter(featurePoints) {
    let sumX = 0, sumY = 0;
    featurePoints.forEach(p => {
        sumX += p.x;
        sumY += p.y;
    });
    return { x: sumX / featurePoints.length, y: sumY / featurePoints.length };
}

// ==========================================================================
// VTO THEMING & SCROLL HELPER UPGRADES
// ==========================================================================
function initTheme() {
    const savedTheme = localStorage.getItem('baan_waenta_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('baan_waenta_theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    if (!themeIcon) return;
    if (theme === 'dark') {
        themeIcon.setAttribute('name', 'sunny-outline');
    } else {
        themeIcon.setAttribute('name', 'moon-outline');
    }
}

function initScrollEffects() {
    window.addEventListener('scroll', () => {
        // Back-to-Top Button display toggle
        const backToTopBtn = document.getElementById('back-to-top-btn');
        if (backToTopBtn) {
            if (document.body.scrollTop > 200 || document.documentElement.scrollTop > 200) {
                backToTopBtn.classList.add('show');
            } else {
                backToTopBtn.classList.remove('show');
            }
        }
    });
}

function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}
