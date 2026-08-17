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
                stockBadge.innerText = 'มีสินค้าพร้อมส่งในคลัง';
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

// AR/3D Modal Logic
function openAR3DModal(mode = 'ar') {
    if (!currentProduct) return;
    
    const modal = document.getElementById('ar-3d-modal');
    if (!modal) return;
    
    // Populate Right Side Details
    document.getElementById('modal-product-brand').textContent = currentProduct.brand;
    document.getElementById('modal-product-title').textContent = currentProduct.name;
    document.getElementById('modal-product-sku').textContent = `SKU: #${currentProduct.id.toString().padStart(3, '0')}`;
    
    // Set Price (Calculate with current lens selection)
    const lensSelect = document.getElementById('lens-type-select');
    let addon = 0;
    if (lensSelect) {
        const selectedOption = lensSelect.options[lensSelect.selectedIndex];
        if (selectedOption) addon = parseInt(selectedOption.getAttribute('data-addon') || 0);
    }
    const basePrice = typeof currentProduct.price === 'string' ? parseFloat(currentProduct.price.replace(/,/g, '')) : currentProduct.price;
    const totalPrice = basePrice + addon;
    document.getElementById('modal-product-price').textContent = `THB ${totalPrice.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
    
    // Check if 3D model exists
    const modelViewer = document.getElementById('product-model-viewer');
    if (modelViewer && currentProduct.model3d) {
        modelViewer.src = currentProduct.model3d;
    }
    
    // Set iframe for AR
    const arIframe = document.getElementById('ar-tryon-iframe');
    if (arIframe) {
        // Load the iframe only when modal opens to save resources
        if (!arIframe.src || !arIframe.src.includes('embed=true')) {
            arIframe.src = `/tryon.html?embed=true&id=${currentProduct.id}`;
        }
    }
    
    modal.style.display = 'block';
    
    // Lock body scroll
    document.body.style.overflow = 'hidden';
    
    switchAR3DView(mode);
}

function closeAR3DModal() {
    const modal = document.getElementById('ar-3d-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Release body scroll lock
    document.body.style.overflow = '';
}

function switchAR3DView(mode) {
    const arContainer = document.getElementById('modal-ar-view-container');
    const tdContainer = document.getElementById('modal-3d-view-container');
    const arBtn = document.getElementById('ar-toggle-btn');
    const tdBtn = document.getElementById('3d-toggle-btn');
    
    if (mode === 'ar') {
        if(arContainer) arContainer.classList.add('active');
        if(tdContainer) tdContainer.classList.remove('active');
        if(arBtn) arBtn.classList.add('active');
        if(tdBtn) tdBtn.classList.remove('active');
    } else {
        if(arContainer) arContainer.classList.remove('active');
        if(tdContainer) tdContainer.classList.add('active');
        if(arBtn) arBtn.classList.remove('active');
        if(tdBtn) tdBtn.classList.add('active');
    }
}

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    const modal = document.getElementById('ar-3d-modal');
    if (event.target === modal) {
        closeAR3DModal();
    }
});
