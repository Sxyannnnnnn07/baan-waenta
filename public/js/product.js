// Baan Waenta - Dedicated Product Detail Page Logic
let currentProduct = null;
let currentProductGallery = [];
let currentGalleryIdx = 0;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get product ID from URL query string
    const urlParams = new URLSearchParams(window.location.search);
    const productId = parseInt(urlParams.get('id'));

    if (!productId) {
        window.location.replace('/#catalog');
        return;
    }

    // 2. Fetch product information from allProducts or API
    await loadProductPageData(productId);
});

async function loadProductPageData(productId) {
    try {
        const res = await apiFetch('/api/products');
        const data = await res.json();
        
        if (data.success && data.products) {
            allProducts = data.products;
            currentProduct = allProducts.find(p => p.id === productId);
            if (currentProduct && (currentProduct.name.includes('Prada') || currentProduct.brand === 'Prada' || currentProduct.id === 23)) {
                currentProduct.image_url = '/assets/prada_front.jpg';
                currentProduct.tryon_image_url = '/assets/prada_front.jpg';
            }
        }

        if (!currentProduct) {
            alert('ไม่พบข้อมูลแว่นตารุ่นนี้');
            window.location.replace('/#catalog');
            return;
        }

        // Assign to global activeLensProduct for cart compatibility
        activeLensProduct = currentProduct;

        // Set document title
        document.title = `${currentProduct.name} - ${currentProduct.brand} | บ้านแว่นตา Store`;

        // Update Text & Meta Elements
        const breadcrumbEl = document.getElementById('breadcrumb-prod-name');
        const nameEl = document.getElementById('product-name');
        const brandEl = document.getElementById('product-brand');
        const catBadge = document.getElementById('product-category-badge');
        const shapeTag = document.getElementById('product-shape-tag');
        const skuTag = document.getElementById('product-sku-tag');
        const descEl = document.getElementById('product-description');
        const stockBadge = document.getElementById('product-stock-badge');
        const vtoLink = document.getElementById('product-vto-link');

        if (breadcrumbEl) breadcrumbEl.innerText = currentProduct.name;
        if (nameEl) nameEl.innerText = currentProduct.name;
        if (brandEl) brandEl.innerText = currentProduct.brand || 'Baan Waenta';
        if (catBadge) catBadge.innerText = currentProduct.category === 'Optical' ? 'แว่นสายตา' : 'แว่นกันแดด';
        if (shapeTag) shapeTag.innerText = `ทรง: ${getThaiShape(currentProduct.frame_shape)}`;
        if (skuTag) skuTag.innerText = `รหัสสินค้า: #BW-${String(currentProduct.id).padStart(3, '0')}`;
        if (vtoLink) vtoLink.href = `/tryon.html?product=${currentProduct.id}`;
        
        if (descEl) {
            descEl.innerText = `กรอบแว่นตาแบรนด์ ${currentProduct.brand || ''} รุ่น ${currentProduct.name} ทรง ${getThaiShape(currentProduct.frame_shape)} ผลิตจากวัสดุคุณภาพสูง ทนทาน น้ำหนักเบา สวมใส่สบาย ออกแบบตามหลักสรีรศาสตร์ เหมาะสำหรับสวมใส่ในชีวิตประจำวันและการทำงาน`;
        }

        if (stockBadge) {
            if (parseInt(currentProduct.stock) <= 0) {
                stockBadge.innerText = 'สินค้าหมดชั่วคราว';
                stockBadge.style.background = '#e53e3e';
                const addBtn = document.getElementById('product-add-cart-btn');
                if (addBtn) {
                    addBtn.disabled = true;
                    addBtn.innerText = 'สินค้าหมดชั่วคราว';
                    addBtn.style.opacity = '0.6';
                    addBtn.style.cursor = 'not-allowed';
                }
            } else if (parseInt(currentProduct.stock) < 5) {
                stockBadge.innerText = `เหลือเพียง ${currentProduct.stock} ชิ้นสุดท้าย`;
                stockBadge.style.background = '#dd6b20';
            } else {
                stockBadge.innerText = `มีสินค้าพร้อมส่งในคลัง ${currentProduct.stock} ชิ้น`;
                stockBadge.style.background = '#2f855a';
            }
        }

        // Setup Carousel Images (5 angles for Prada / dynamic products)
        if (currentProduct.name && (currentProduct.name.includes('Prada') || currentProduct.brand === 'Prada')) {
            currentProductGallery = [
                { src: '/assets/prada_front.jpg', label: 'ด้านหน้า' },
                { src: '/assets/prada_angle1.jpg', label: 'มุม 1' },
                { src: '/assets/prada_detail.jpg', label: 'รายละเอียด' },
                { src: '/assets/prada_angle2.jpg', label: 'ด้านข้าง' },
                { src: '/assets/prada_model.jpg', label: 'นายแบบสวมใส่จริง' }
            ];
        } else {
            let modelImg = '/assets/model1.jpg';
            if (currentProduct.id % 3 === 1) modelImg = '/assets/model2.jpg';
            if (currentProduct.id % 3 === 2) modelImg = '/assets/model3.jpg';

            let sideImg = '/assets/vto_model.jpg';
            if (currentProduct.id % 2 === 0) sideImg = '/assets/p1.jpg';

            currentProductGallery = [
                { src: currentProduct.image_url, label: 'มุมตรง' },
                { src: modelImg, label: 'ขณะสวมใส่' },
                { src: sideImg, label: 'มุมเฉียง' }
            ];
        }
        currentGalleryIdx = 0;
        renderProductGallery();

        // Lens selection & Simulator reset
        selectPageLens(1);

        // Sunglasses check
        const isSunglasses = currentProduct.category === 'Sunglasses';
        const lensGroup = document.getElementById('product-lens-selection-group');
        const simContainer = document.getElementById('lens-simulator-container');
        const prescGroup = document.getElementById('prescription-toggle-group');

        if (isSunglasses) {
            if (lensGroup) lensGroup.style.display = 'none';
            if (simContainer) simContainer.style.display = 'none';
            if (prescGroup) prescGroup.style.display = 'none';
        } else {
            if (lensGroup) lensGroup.style.display = 'block';
            if (simContainer) simContainer.style.display = 'block';
            if (prescGroup) prescGroup.style.display = 'block';
        }

        // Wishlist state
        updateProductPageWishlistUI();

        // Check if user has prescription history
        if (currentUser && !isSunglasses) {
            try {
                const prescRes = await apiFetch(`/api/prescriptions/${currentUser.id}`);
                const prescData = await prescRes.json();
                if (prescData.success && prescData.prescription) {
                    const presc = prescData.prescription;
                    document.getElementById('sph-left').value = presc.sphere_left;
                    document.getElementById('sph-right').value = presc.sphere_right;
                    document.getElementById('cyl-left').value = presc.cylinder_left;
                    document.getElementById('cyl-right').value = presc.cylinder_right;
                    document.getElementById('axis-left').value = presc.axis_left;
                    document.getElementById('axis-right').value = presc.axis_right;
                    document.getElementById('pd-value').value = presc.pd;

                    const pCheck = document.getElementById('enter-presc-check');
                    const pFields = document.getElementById('prescription-fields');
                    if (pCheck) pCheck.checked = true;
                    if (pFields) pFields.style.display = 'block';
                }
            } catch (err) {
                console.warn('Could not load user prescription history', err);
            }
        }
        
        // Setup 3D Viewer if available
        const btn3D = document.getElementById('product-3d-btn');
        const view3D = document.getElementById('product-3d-view');
        const viewCarousel = document.getElementById('product-carousel-view');
        const modelViewer = document.getElementById('product-model-viewer');
        
        // Always reset to 2D view on page load
        if (viewCarousel) viewCarousel.style.display = 'block';
        if (view3D) view3D.style.display = 'none';
        if (btn3D) {
            if (currentProduct.model_3d_url) {
                btn3D.style.display = 'flex';
                btn3D.classList.remove('disabled-card');
                if (modelViewer) {
                    modelViewer.src = currentProduct.model_3d_url;
                }
            } else {
                btn3D.style.display = 'none';
            }
        }

    } catch (error) {
        console.error('Error loading product page:', error);
        alert('เกิดข้อผิดพลาดในการโหลดข้อมูลสินค้า');
    }
}

function renderProductGallery() {
    const mainImg = document.getElementById('product-page-main-img');
    const thumbsContainer = document.getElementById('product-page-thumbs');

    if (mainImg && currentProductGallery.length > 0) {
        mainImg.style.opacity = '0';
        setTimeout(() => {
            mainImg.src = currentProductGallery[currentGalleryIdx].src;
            mainImg.style.opacity = '1';
        }, 150);
    }

    if (thumbsContainer) {
        thumbsContainer.innerHTML = currentProductGallery.map((img, idx) => `
            <div class="gallery-thumb-item ${idx === currentGalleryIdx ? 'active' : ''}" onclick="setProductImageIndex(${idx})" title="${img.label}">
                <img src="${img.src}" alt="${img.label}">
            </div>
        `).join('');
    }
}

function navigateProductImage(direction) {
    if (!currentProductGallery.length) return;
    currentGalleryIdx = (currentGalleryIdx + direction + currentProductGallery.length) % currentProductGallery.length;
    renderProductGallery();
}

function setProductImageIndex(index) {
    if (index >= 0 && index < currentProductGallery.length) {
        currentGalleryIdx = index;
        renderProductGallery();
    }
}

function selectPageLens(lensVal) {
    const lensSelect = document.getElementById('lens-type-select');
    if (lensSelect) lensSelect.value = String(lensVal);

    [1, 2, 3].forEach(id => {
        const card = document.getElementById(`page-lens-card-${id}`);
        if (card) {
            if (id === lensVal) card.classList.add('active');
            else card.classList.remove('active');
        }
    });

    const labelMap = {
        1: 'เลนส์ธรรมดา (+0฿)',
        2: 'เลนส์กรองแสงสีฟ้า (+500฿)',
        3: 'เลนส์ปรับแสงออโต้ตามแดด (+1,000฿)'
    };
    const activeLabel = document.getElementById('product-active-lens-name');
    if (activeLabel) activeLabel.innerText = labelMap[lensVal] || '';

    updatePageLensPricing();
}

function updatePageLensPricing() {
    if (!currentProduct) return;
    const lensSelect = document.getElementById('lens-type-select');
    let addonPrice = 0;
    if (lensSelect) {
        const activeOption = lensSelect.options[lensSelect.selectedIndex];
        if (activeOption) {
            addonPrice = parseFloat(activeOption.getAttribute('data-addon')) || 0;
        }
    }
    const totalPrice = parseFloat(currentProduct.price) + addonPrice;

    const priceDisplay = document.getElementById('product-total-price');
    const legacyTotal = document.getElementById('lens-total-price');
    if (priceDisplay) priceDisplay.innerText = totalPrice.toLocaleString();
    if (legacyTotal) legacyTotal.innerText = totalPrice.toLocaleString();

    if (typeof updateLensSimulation === 'function' && lensSelect) {
        updateLensSimulation(parseInt(lensSelect.value));
    }
}

function toggleProductWishlist() {
    if (!currentProduct) return;
    const prodId = currentProduct.id;
    let localWishlist = JSON.parse(localStorage.getItem('baan_waenta_wishlist') || '[]');
    const idx = localWishlist.indexOf(prodId);

    if (idx > -1) {
        localWishlist.splice(idx, 1);
        showToast(`นำ "${currentProduct.name}" ออกจากรายการโปรดแล้ว`, 'info');
    } else {
        localWishlist.push(prodId);
        showToast(`บันทึก "${currentProduct.name}" ลงรายการโปรดเรียบร้อย ❤️`, 'success');
    }

    localStorage.setItem('baan_waenta_wishlist', JSON.stringify(localWishlist));
    updateProductPageWishlistUI();
}

function updateProductPageWishlistUI() {
    if (!currentProduct) return;
    const localWishlist = JSON.parse(localStorage.getItem('baan_waenta_wishlist') || '[]');
    const isFav = localWishlist.includes(currentProduct.id);
    const btn = document.getElementById('product-wishlist-btn');
    const icon = document.getElementById('product-wishlist-icon');

    if (btn && icon) {
        if (isFav) {
            btn.classList.add('wishlist-active');
            icon.setAttribute('name', 'heart');
        } else {
            btn.classList.remove('wishlist-active');
            icon.setAttribute('name', 'heart-outline');
        }
    }
}

function addProductPageToCart() {
    if (!currentProduct) return;
    activeLensProduct = currentProduct;
    addActiveProductToCart();
}

// AR/3D Modal State
let modalCameraStream = null;

function openAR3DModal(mode = '3d') {
    if (!currentProduct) return;
    
    const modal = document.getElementById('ar-3d-modal');
    if (!modal) return;
    
    // Populate Right Side Details
    const brandEl = document.getElementById('modal-product-brand');
    const titleEl = document.getElementById('modal-product-title');
    const skuEl = document.getElementById('modal-product-sku');
    if (brandEl) brandEl.textContent = currentProduct.brand || 'PRADA';
    if (titleEl) titleEl.textContent = currentProduct.name;
    if (skuEl) skuEl.textContent = `SKU: #BW-${currentProduct.id.toString().padStart(3, '0')}`;
    
    // Set Price (Calculate with current lens selection)
    const lensSelect = document.getElementById('lens-type-select');
    let addon = 0;
    if (lensSelect) {
        const selectedOption = lensSelect.options[lensSelect.selectedIndex];
        if (selectedOption) addon = parseInt(selectedOption.getAttribute('data-addon') || 0);
    }
    const basePrice = typeof currentProduct.price === 'string' ? parseFloat(currentProduct.price.replace(/,/g, '')) : currentProduct.price;
    const totalPrice = basePrice + addon;
    const priceEl = document.getElementById('modal-product-price');
    if (priceEl) {
        priceEl.textContent = `THB ${totalPrice.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
    }
    
    // Set 3D Model in model-viewer for both 3D Viewer and AR Overlay
    const modelViewer = document.getElementById('product-model-viewer');
    const arModelViewer = document.getElementById('modal-ar-glasses-3d');
    const modelUrl = currentProduct.model_3d_url || currentProduct.model3d || '/assets/models/prada_vintage.glb';
    if (modelViewer && modelUrl) {
        modelViewer.src = modelUrl;
    }
    if (arModelViewer && modelUrl) {
        arModelViewer.src = modelUrl;
    }
    
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    switchAR3DView(mode);
}

function closeAR3DModal() {
    const modal = document.getElementById('ar-3d-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Stop camera stream if active
    stopModalCamera();
    document.body.style.overflow = '';
}

async function switchAR3DView(mode) {
    const arContainer = document.getElementById('modal-ar-view-container');
    const tdContainer = document.getElementById('modal-3d-view-container');
    const arBtn = document.getElementById('ar-toggle-btn');
    const tdBtn = document.getElementById('3d-toggle-btn');
    const resetBtn = document.querySelector('.ar-reset-btn');
    
    if (mode === 'ar') {
        if (arContainer) arContainer.classList.add('active');
        if (tdContainer) tdContainer.classList.remove('active');
        if (arBtn) arBtn.classList.add('active');
        if (tdBtn) tdBtn.classList.remove('active');
        if (resetBtn) resetBtn.style.display = 'flex';
        
        // Start Camera and Face Tracking
        const videoEl = document.getElementById('modal-ar-video');
        if (videoEl && !modalCameraStream) {
            try {
                modalCameraStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false
                });
                videoEl.srcObject = modalCameraStream;
                videoEl.play();
                
                initFaceTracking(videoEl);
            } catch (err) {
                console.error('Camera access error:', err);
            }
        }
    } else {
        if (arContainer) arContainer.classList.remove('active');
        if (tdContainer) tdContainer.classList.add('active');
        if (arBtn) arBtn.classList.remove('active');
        if (tdBtn) tdBtn.classList.add('active');
        if (resetBtn) resetBtn.style.display = 'none';
        
        // Pause camera stream when in 3D mode
        stopModalCamera();
    }
}

// Lightweight Face Tracking for AR Modal
let modalFaceMesh = null;
let modalCameraUtils = null;

function initFaceTracking(videoEl) {
    if (typeof FaceMesh === 'undefined') return;
    
    const arModelViewer = document.getElementById('modal-ar-glasses-3d');
    if (arModelViewer) {
        arModelViewer.style.opacity = '0'; // Hide until face is detected
        arModelViewer.style.transition = 'opacity 0.3s ease';
    }

    if (!modalFaceMesh) {
        modalFaceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`});
        modalFaceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        modalFaceMesh.onResults(onModalFaceMeshResults);
    }
    
    if (!modalCameraUtils && typeof Camera !== 'undefined') {
        modalCameraUtils = new Camera(videoEl, {
            onFrame: async () => {
                if (modalFaceMesh && videoEl.videoWidth > 0) {
                    await modalFaceMesh.send({image: videoEl});
                }
            },
            width: 1280,
            height: 720
        });
        modalCameraUtils.start();
    }
}

function onModalFaceMeshResults(results) {
    const arModelViewer = document.getElementById('modal-ar-glasses-3d');
    if (!arModelViewer) return;
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        arModelViewer.style.opacity = '0';
        return;
    }
    
    arModelViewer.style.opacity = '1';
    
    const landmarks = results.multiFaceLandmarks[0];
    // Key face points
    const leftEye = landmarks[33];   // left eye center
    const rightEye = landmarks[263]; // right eye center
    const noseBridge = landmarks[168]; // between eyes
    
    // Scale X-coordinates by -1 since we flip the video with transform: scaleX(-1)
    const xPct = (1 - noseBridge.x) * 100;
    const yPct = noseBridge.y * 100;
    
    // Position
    arModelViewer.style.left = `${xPct}%`;
    arModelViewer.style.top = `${yPct}%`;
    
    // Calculate face width based on distance between eyes (very rough approximation)
    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    const eyeDist = Math.sqrt(dx*dx + dy*dy);
    
    // Width of the container (since we use % for left/top, width should be relative to container)
    // To make it responsive, we use vw or % or just compute based on viewport. 
    // Usually eye distance is about 1/4 to 1/5 of face width.
    // Let's use a dynamic pixel width relative to window
    const containerW = document.getElementById('ar-live-viewport').clientWidth;
    const faceWidthPx = (eyeDist * containerW) * 3.2; // 3.2 multiplier to cover eyes properly
    
    arModelViewer.style.width = `${faceWidthPx}px`;
    arModelViewer.style.height = `${faceWidthPx * 0.4}px`; // maintain approx ratio
    
    // Rotation (tilt). Because of video flip, reverse angle.
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    arModelViewer.style.transform = `translate(-50%, -45%) rotateZ(${-angle}deg)`;
}

function stopModalCamera() {
    const videoEl = document.getElementById('modal-ar-video');
    if (videoEl) {
        videoEl.srcObject = null;
    }
    if (modalCameraStream) {
        modalCameraStream.getTracks().forEach(track => track.stop());
        modalCameraStream = null;
    }
    if (modalCameraUtils) {
        modalCameraUtils.stop();
        modalCameraUtils = null;
    }
    // Note: Do not close faceMesh entirely here as it takes time to reload, just stop the camera loop.
}

function resetARView() {
    const arModelViewer = document.getElementById('modal-ar-glasses-3d');
    if (arModelViewer) {
        arModelViewer.cameraOrbit = "0deg 90deg auto";
    }
}

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    const modal = document.getElementById('ar-3d-modal');
    if (event.target === modal) {
        closeAR3DModal();
    }
});
