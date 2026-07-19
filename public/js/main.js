// Global State
let allProducts = [];
let cart = [];
let currentUser = null;
let activeLensProduct = null;
let uploadedSlipBase64 = null;

// Initialize on Page Load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    checkLoginStatus();
    fetchProducts();
    initSlideshow();
    initScrollEffects();
    
    // Load reviews on home page
    if (document.getElementById('reviews-list-grid')) {
        loadAndRenderReviews();
    }
});

// 1. Check Login Status from localStorage
function checkLoginStatus() {
    const savedUser = localStorage.getItem('baan_waenta_user');
    const authStatusDiv = document.getElementById('auth-status');
    const adminNav = document.getElementById('admin-nav');
    const ordersHistoryBtn = document.getElementById('orders-history-btn');
    const reviewAuthPrompt = document.getElementById('review-auth-prompt');
    const reviewForm = document.getElementById('review-form');

    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        
        // Update Nav UI
        authStatusDiv.innerHTML = `
            <div class="user-nav-profile" onclick="openUserProfileModal()" style="margin-left: 0.5rem; padding: 0.3rem 0.7rem;">
                <div style="width: 32px; height: 32px; border-radius: 50%; background-color: var(--text-primary); color: var(--bg-primary); display: flex; align-items: center; justify-content: center; font-size: 0.95rem; font-weight: 700; border: 1px solid var(--border-color); overflow: hidden; flex-shrink: 0;">
                    ${currentUser.avatar_url 
                        ? `<img src="${currentUser.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;" referrerpolicy="no-referrer">` 
                        : `<ion-icon name="person-outline" style="font-size: 1.1rem; color: var(--bg-primary);"></ion-icon>`
                    }
                </div>
                <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary);">
                    ${currentUser.name}
                </span>
            </div>
        `;

        if (ordersHistoryBtn) {
            ordersHistoryBtn.style.display = 'inline-flex';
        }

        // Show Admin Nav if user is admin
        if (currentUser.role === 'admin') {
            if (adminNav) adminNav.style.display = 'block';
        } else {
            if (adminNav) adminNav.style.display = 'none';
        }

        // Toggle review submission UI
        if (reviewAuthPrompt && reviewForm) {
            reviewAuthPrompt.style.display = 'none';
            reviewForm.style.display = 'flex';
        }
    } else {
        currentUser = null;
        if (adminNav) adminNav.style.display = 'none';
        if (ordersHistoryBtn) ordersHistoryBtn.style.display = 'none';
        authStatusDiv.innerHTML = `
            <button class="btn btn-primary" onclick="openAuthModal('login')">เข้าสู่ระบบ</button>
        `;

        // Toggle review submission UI
        if (reviewAuthPrompt && reviewForm) {
            reviewAuthPrompt.style.display = 'block';
            reviewForm.style.display = 'none';
        }
    }
}

// 2. Fetch and Render Products
async function fetchProducts() {
    const productsList = document.getElementById('products-list');
    try {
        const response = await fetch('/api/products');
        const data = await response.json();
        
        if (data.success) {
            allProducts = data.products;
            renderProducts(allProducts);
            populateReviewProductSelect();
        } else {
            productsList.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: red;">เกิดข้อผิดพลาดในการโหลดสินค้า</div>`;
        }
    } catch (error) {
        console.error('Fetch error:', error);
        productsList.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: red;">ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้</div>`;
    }
}

function renderProducts(products) {
    const productsList = document.getElementById('products-list');
    productsList.innerHTML = '';
    
    if (products.length === 0) {
        productsList.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 3rem 0;">ไม่มีสินค้าในประเภทนี้</div>`;
        return;
    }

    products.forEach((prod, index) => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.setAttribute('data-aos', 'fade-up');
        // Stagger animation delays for the catalog grid
        card.setAttribute('data-aos-delay', (index % 4) * 100);
        
        // Premium Badges based on product name
        let badgeHtml = '';
        if (prod.name.includes("Modern Square")) {
            badgeHtml = `<span class="product-badge badge-popular"><ion-icon name="star" style="font-size: 0.8rem;"></ion-icon> ยอดนิยม</span>`;
        } else if (prod.name.includes("Rose Gold")) {
            badgeHtml = `<span class="product-badge badge-new"><ion-icon name="sparkles" style="font-size: 0.8rem;"></ion-icon> มาใหม่</span>`;
        } else if (prod.name.includes("Classic Black")) {
            badgeHtml = `<span class="product-badge badge-hot"><ion-icon name="flame" style="font-size: 0.8rem;"></ion-icon> HOT</span>`;
        }

        // Dynamic stock indicator logic
        let stockHtml = '';
        let buttonHtml = '';
        
        if (parseInt(prod.stock) <= 0) {
            stockHtml = `
                <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; font-weight: 600;">
                    <ion-icon name="close-circle-outline" style="font-size: 0.95rem; color: #e53e3e;"></ion-icon>
                    สินค้าหมดชั่วคราว
                </span>
            `;
            buttonHtml = `
                <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.8rem; cursor: not-allowed; opacity: 0.6;" disabled>
                    สินค้าหมด
                </button>
            `;
        } else if (parseInt(prod.stock) < 5) {
            stockHtml = `
                <span style="color: #e53e3e; display: flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; font-weight: 700; animation: blinkAnimation 1.5s infinite;">
                    <ion-icon name="alert-circle-outline" style="font-size: 0.95rem;"></ion-icon>
                    สินค้าใกล้หมด! เหลือเพียง ${prod.stock} ชิ้น
                </span>
            `;
            buttonHtml = `
                <button class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="openLensModal(${prod.id})">
                    ซื้อเลย
                </button>
            `;
        } else {
            stockHtml = `
                <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; font-weight: 500;">
                    <ion-icon name="cube-outline" style="font-size: 0.95rem; color: #4a5568;"></ion-icon>
                    คงเหลือในคลัง: ${prod.stock} ชิ้น
                </span>
            `;
            buttonHtml = `
                <button class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="openLensModal(${prod.id})">
                    ซื้อเลย
                </button>
            `;
        }

        card.innerHTML = `
            ${badgeHtml}
            <div class="product-image-container">
                <img src="${prod.image_url}" alt="${prod.name}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
            </div>
            <div class="product-brand">${prod.brand}</div>
            <div class="product-name">${prod.name}</div>
            <div class="product-meta" style="margin-bottom: 0.4rem;">ทรง: ${getThaiShape(prod.frame_shape)} | ประเภท: ${prod.category === 'Optical' ? 'สายตา' : 'กันแดด'}</div>
            <div style="margin-bottom: 1rem; min-height: 20px; display: flex; align-items: center;">
                ${stockHtml}
            </div>
            <div class="product-footer">
                <div class="product-price">${parseFloat(prod.price).toLocaleString()} ฿</div>
                <div style="display: flex; gap: 0.5rem;">
                    <a href="/tryon.html?product=${prod.id}" class="btn btn-outline" style="padding: 0.5rem 0.8rem; font-size: 0.8rem;" title="ลองแว่น">
                        <ion-icon name="camera-outline" style="font-size: 1.2rem;"></ion-icon>
                    </a>
                    ${buttonHtml}
                </div>
            </div>
        `;
        productsList.appendChild(card);
    });

    // Refresh AOS animations after DOM updates
    if (typeof AOS !== 'undefined') {
        AOS.refresh();
    }
}

function getThaiShape(shape) {
    const shapes = {
        'Round': 'ทรงกลม',
        'Square': 'ทรงเหลี่ยม',
        'Aviator': 'ทรงนักบิน',
        'Oval': 'ทรงรี',
        'CatEye': 'ทรงแคทอาย'
    };
    return shapes[shape] || shape;
}

// 3. Product Multi-Filtering
const filterState = {
    category: 'All',
    shape: 'All',
    search: ''
};

function filterCategory(category, btnElement) {
    const buttons = document.querySelectorAll('.category-filter-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    filterState.category = category;
    applyFilters();
}

function filterShape(shape, btnElement) {
    const buttons = document.querySelectorAll('.shape-filter-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    filterState.shape = shape;
    applyFilters();
}

function handleSearchInput(e) {
    filterState.search = e.target.value.toLowerCase().trim();
    applyFilters();
}

function applyFilters() {
    let filtered = allProducts;

    // 1. Category Filter
    if (filterState.category !== 'All') {
        filtered = filtered.filter(p => p.category === filterState.category);
    }

    // 2. Frame Shape Filter
    if (filterState.shape !== 'All') {
        filtered = filtered.filter(p => p.frame_shape === filterState.shape);
    }

    // 3. Text Search Query
    if (filterState.search !== '') {
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(filterState.search) || 
            p.brand.toLowerCase().includes(filterState.search) || 
            getThaiShape(p.frame_shape).includes(filterState.search)
        );
    }

    renderProducts(filtered);
}

// ==========================================
// AUTHENTICATION MODAL FUNCTIONS
// ==========================================
let currentAuthMode = 'login';

function openAuthModal(mode = 'login') {
    currentAuthMode = mode;
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('auth-title');
    const emailGroup = document.getElementById('email-group');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleText = document.getElementById('auth-toggle-text');
    
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-email').value = '';

    const googleBtnSpan = document.querySelector('#auth-google-btn span');

    if (mode === 'login') {
        title.innerText = 'เข้าสู่ระบบ';
        emailGroup.style.display = 'none';
        submitBtn.innerText = 'เข้าสู่ระบบ';
        toggleText.innerHTML = 'ยังไม่มีบัญชีผู้ใช้งาน? <a href="#" onclick="toggleAuthMode()">สมัครสมาชิกที่นี่</a>';
        if (googleBtnSpan) googleBtnSpan.innerText = 'เข้าสู่ระบบด้วย Google';
    } else {
        title.innerText = 'สมัครสมาชิก';
        emailGroup.style.display = 'block';
        submitBtn.innerText = 'สมัครสมาชิก';
        toggleText.innerHTML = 'มีบัญชีอยู่แล้ว? <a href="#" onclick="toggleAuthMode()">เข้าสู่ระบบที่นี่</a>';
        if (googleBtnSpan) googleBtnSpan.innerText = 'สมัครสมาชิกด้วย Google';
    }

    modal.style.display = 'flex';
}

function toggleAuthMode() {
    openAuthModal(currentAuthMode === 'login' ? 'register' : 'login');
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    const email = document.getElementById('auth-email').value;

    const url = currentAuthMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = currentAuthMode === 'login' 
        ? { username, password } 
        : { username, email, password };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();

        if (data.success) {
            alert(currentAuthMode === 'login' ? 'เข้าสู่ระบบสำเร็จ!' : 'สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบด้วยบัญชีใหม่');
            closeModal('auth-modal');
            
            if (currentAuthMode === 'login') {
                localStorage.setItem('baan_waenta_user', JSON.stringify(data.user));
                checkLoginStatus();
            } else {
                openAuthModal('login');
            }
        } else {
            alert(data.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
        }
    } catch (error) {
        console.error('Auth error:', error);
        alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อทำการตรวจสอบสิทธิ์ได้');
    }
}

function handleLogout() {
    localStorage.removeItem('baan_waenta_user');
    checkLoginStatus();
    alert('ออกจากระบบแล้ว');
    window.location.reload();
}

// Load Google Identity Services SDK dynamically
(function() {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
})();

let googleTokenClient = null;

function initGoogleAuth() {
    if (typeof google === 'undefined') {
        setTimeout(initGoogleAuth, 100);
        return;
    }
    googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '105484503874-92cu9940o9od95nb2pna8pr0kkf7pngi.apps.googleusercontent.com',
        scope: 'email profile openid',
        callback: async (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                try {
                    // Fetch profile info from Google API
                    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
                    });
                    const googleInfo = await userInfoRes.json();
                    
                    // Call backend to authenticate this Google user
                    const authRes = await fetch('/api/auth/google', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: googleInfo.email,
                            name: googleInfo.name,
                            avatar: googleInfo.picture,
                            google_id: googleInfo.sub
                        })
                    });
                    const authData = await authRes.json();
                    
                    if (authData.success) {
                        localStorage.setItem('baan_waenta_user', JSON.stringify(authData.user));
                        checkLoginStatus();
                        closeModal('auth-modal');
                        alert(`เข้าสู่ระบบด้วย Google สำเร็จ!\nยินดีต้อนรับ คุณ ${authData.user.name}`);
                        window.location.reload();
                    } else {
                        alert(authData.message || 'เกิดข้อผิดพลาดในการยืนยันตัวตนกับระบบ');
                    }
                } catch (err) {
                    console.error('Google profile fetch error:', err);
                    alert('เกิดข้อผิดพลาดในการโหลดโปรไฟล์ Google');
                }
            }
        }
    });
}

window.addEventListener('load', initGoogleAuth);

async function loginWithGoogle() {
    if (!googleTokenClient) {
        alert('ระบบล็อกอิน Google กำลังเตรียมการ กรุณารอ 1-2 วินาทีแล้วลองใหม่อีกครั้ง');
        return;
    }
    googleTokenClient.requestAccessToken();
}

// ==========================================
// LENS CONFIGURATOR & CUSTOM ORDERS
// ==========================================
async function openLensModal(productId) {
    activeLensProduct = allProducts.find(p => p.id === productId);
    if (!activeLensProduct) return;

    document.getElementById('lens-prod-name').innerText = activeLensProduct.name;
    document.getElementById('lens-prod-price').innerText = `ราคากรอบแว่น: ${parseFloat(activeLensProduct.price).toLocaleString()} บาท`;
    document.getElementById('lens-type-select').value = "1";
    document.getElementById('enter-presc-check').checked = false;
    document.getElementById('prescription-fields').style.display = 'none';

    // Sunglasses specific visibility toggles
    const isSunglasses = activeLensProduct.category === 'Sunglasses';
    if (isSunglasses) {
        document.getElementById('lens-type-group').style.display = 'none';
        document.getElementById('lens-simulator-container').style.display = 'none';
        document.getElementById('prescription-toggle-group').style.display = 'none';
    } else {
        document.getElementById('lens-type-group').style.display = 'block';
        document.getElementById('lens-simulator-container').style.display = 'flex';
        document.getElementById('prescription-toggle-group').style.display = 'block';
    }

    updateLensPricing();

    // If logged in, fetch user's last prescription to prepopulate fields (only if NOT sunglasses)
    if (currentUser && !isSunglasses) {
        try {
            const res = await fetch(`/api/prescriptions/${currentUser.id}`);
            const data = await res.json();
            if (data.success && data.prescription) {
                const presc = data.prescription;
                document.getElementById('sph-left').value = presc.sphere_left;
                document.getElementById('sph-right').value = presc.sphere_right;
                document.getElementById('cyl-left').value = presc.cylinder_left;
                document.getElementById('cyl-right').value = presc.cylinder_right;
                document.getElementById('axis-left').value = presc.axis_left;
                document.getElementById('axis-right').value = presc.axis_right;
                document.getElementById('pd-value').value = presc.pd;
                
                // Auto enable check box since they have prescription history
                document.getElementById('enter-presc-check').checked = true;
                document.getElementById('prescription-fields').style.display = 'block';
            }
        } catch (err) {
            console.warn('Could not load user prescription history', err);
        }
    }

    // Set Add button click action
    document.getElementById('confirm-add-cart-btn').onclick = addActiveProductToCart;

    document.getElementById('lens-modal').style.display = 'flex';
}

function updateLensPricing() {
    const lensSelect = document.getElementById('lens-type-select');
    const activeOption = lensSelect.options[lensSelect.selectedIndex];
    const addonPrice = parseFloat(activeOption.getAttribute('data-addon'));
    const totalPrice = parseFloat(activeLensProduct.price) + addonPrice;
    
    document.getElementById('lens-total-price').innerText = totalPrice.toLocaleString();

    // Update Interactive Lens Simulator
    if (typeof updateLensSimulation === 'function') {
        updateLensSimulation(parseInt(lensSelect.value));
    }
}

function togglePrescriptionFields() {
    const check = document.getElementById('enter-presc-check');
    const fieldsDiv = document.getElementById('prescription-fields');
    fieldsDiv.style.display = check.checked ? 'block' : 'none';
}

function addActiveProductToCart() {
    const lensSelect = document.getElementById('lens-type-select');
    const selectedOption = lensSelect.options[lensSelect.selectedIndex];
    
    let lensId = parseInt(lensSelect.value);
    let lensType = selectedOption.text.split(' +')[0];
    let priceAddon = parseFloat(selectedOption.getAttribute('data-addon'));
    
    let hasPrescription = document.getElementById('enter-presc-check').checked;
    let prescription = null;

    // Sunglasses specific settings override
    if (activeLensProduct.category === 'Sunglasses') {
        lensId = 1;
        lensType = "เลนส์กันแดดในตัว (Default Tinted Lens)";
        priceAddon = 0;
        hasPrescription = false;
    }

    if (hasPrescription) {
        prescription = {
            sphere_left: parseFloat(document.getElementById('sph-left').value) || 0,
            sphere_right: parseFloat(document.getElementById('sph-right').value) || 0,
            cylinder_left: parseFloat(document.getElementById('cyl-left').value) || 0,
            cylinder_right: parseFloat(document.getElementById('cyl-right').value) || 0,
            axis_left: parseInt(document.getElementById('axis-left').value) || 0,
            axis_right: parseInt(document.getElementById('axis-right').value) || 0,
            pd: parseFloat(document.getElementById('pd-value').value) || 62
        };
    }

    const itemPrice = parseFloat(activeLensProduct.price) + priceAddon;

    cart.push({
        product_id: activeLensProduct.id,
        name: activeLensProduct.name,
        brand: activeLensProduct.brand,
        image_url: activeLensProduct.image_url,
        lens_id: lensId,
        lens_type: lensType,
        unit_price: itemPrice,
        quantity: 1,
        prescription: prescription
    });

    updateCartUI();
    closeModal('lens-modal');
    alert('เพิ่มสินค้าลงในตะกร้าเรียบร้อยแล้ว!');
}

function updateCartUI() {
    document.getElementById('cart-count').innerText = cart.length;
}

// ==========================================
// CART & CHECKOUT FLOW
// ==========================================
function openCartModal() {
    const modal = document.getElementById('cart-modal');
    const listDiv = document.getElementById('cart-items-list');
    
    listDiv.innerHTML = '';
    let total = 0;

    // Reset shipping form state
    const formDiv = document.getElementById('shipping-info-form');
    const actionBtn = document.getElementById('checkout-action-btn');
    if (formDiv) formDiv.style.display = 'none';
    if (actionBtn) {
        actionBtn.innerText = 'ดำเนินการสั่งซื้อสินค้า';
        actionBtn.style.backgroundColor = ''; // Reset to default CSS variables
        actionBtn.style.borderColor = '';
    }

    // Reset payment method selection
    const codRadio = document.querySelector('input[name="payment-method"][value="COD"]');
    if (codRadio) codRadio.checked = true;
    const bankDetails = document.getElementById('bank-transfer-details');
    if (bankDetails) bankDetails.style.display = 'none';
    const qrDetails = document.getElementById('qr-code-details');
    if (qrDetails) qrDetails.style.display = 'none';
    const slipUploadBox = document.getElementById('slip-upload-section');
    if (slipUploadBox) slipUploadBox.style.display = 'none';

    // Reset slip upload input and state
    uploadedSlipBase64 = null;
    const slipInput = document.getElementById('slip-file-input');
    if (slipInput) slipInput.value = '';
    const previewContainer = document.getElementById('slip-preview-container');
    if (previewContainer) previewContainer.style.display = 'none';

    if (cart.length === 0) {
        listDiv.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 2rem 0;">ไม่มีสินค้าในตะกร้า</div>`;
        document.getElementById('cart-total-price').innerText = '0';
        modal.style.display = 'flex';
        return;
    }

    cart.forEach((item, index) => {
        total += item.unit_price;
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '1rem';
        row.style.marginBottom = '1.2rem';
        row.style.borderBottom = '1px solid var(--border-color)';
        row.style.paddingBottom = '1rem';
        row.style.alignItems = 'center';

        let prescHtml = '';
        if (item.prescription) {
            const p = item.prescription;
            prescHtml = `
                <div style="font-size: 0.75rem; background-color: var(--bg-primary); padding: 0.4rem; border-radius: 6px; margin-top: 0.4rem;">
                    <strong>ค่าสายตา:</strong> L SPH:${p.sphere_left} CYL:${p.cylinder_left} | R SPH:${p.sphere_right} CYL:${p.cylinder_right} | PD: ${p.pd}mm
                </div>
            `;
        }

        row.innerHTML = `
            <div style="width: 70px; height: 50px; background-color: var(--bg-primary); border-radius: 8px; padding: 0.2rem; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                <img src="${item.image_url}" alt="${item.name}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
            </div>
            <div style="flex: 1;">
                <h4 style="font-size: 0.95rem; font-weight: 600;">${item.name}</h4>
                <p style="font-size: 0.8rem; color: var(--text-secondary);">${item.lens_type}</p>
                ${prescHtml}
            </div>
            <div style="text-align: right;">
                <div style="font-weight: 700; font-family: var(--font-heading);">${item.unit_price.toLocaleString()} ฿</div>
                <button onclick="removeFromCart(${index})" style="background: none; border: none; color: #e53e3e; font-size: 0.8rem; cursor: pointer; text-decoration: underline; margin-top: 0.25rem;">
                    ลบ
                </button>
            </div>
        `;
        listDiv.appendChild(row);
    });

    document.getElementById('cart-total-price').innerText = total.toLocaleString();
    modal.style.display = 'flex';
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
    openCartModal();
}

function handleCheckoutClick() {
    if (!currentUser) {
        alert('กรุณาเข้าสู่ระบบก่อนทำการสั่งซื้อสินค้าครับ');
        closeModal('cart-modal');
        openAuthModal('login');
        return;
    }

    if (cart.length === 0) {
        alert('ไม่มีสินค้าในตะกร้า');
        return;
    }

    const formDiv = document.getElementById('shipping-info-form');
    const actionBtn = document.getElementById('checkout-action-btn');

    if (formDiv.style.display === 'none') {
        formDiv.style.display = 'block';
        actionBtn.innerHTML = '<ion-icon name="checkmark-circle-outline"></ion-icon> ยืนยันการสั่งซื้อและชำระเงิน';
        actionBtn.style.backgroundColor = '#2f855a'; // Soft green for confirmation
        actionBtn.style.borderColor = '#2f855a';
        actionBtn.style.color = '#ffffff';
    } else {
        const shipName = document.getElementById('ship-name').value.trim();
        const shipPhone = document.getElementById('ship-phone').value.trim();
        const shipAddress = document.getElementById('ship-address').value.trim();

        if (!shipName || !shipPhone || !shipAddress) {
            alert('กรุณากรอกข้อมูลและที่อยู่การจัดส่งสินค้าให้ครบถ้วนเพื่อดำเนินการต่อครับ');
            return;
        }

        // Get selected payment method
        const paymentRadios = document.getElementsByName('payment-method');
        let selectedPayment = 'COD';
        for (const radio of paymentRadios) {
            if (radio.checked) {
                selectedPayment = radio.value;
                break;
            }
        }

        if ((selectedPayment === 'BankTransfer' || selectedPayment === 'QRCode') && !uploadedSlipBase64) {
            alert('กรุณาแนบรูปภาพสลิปหลักฐานการชำระเงินเพื่อดำเนินการสั่งซื้อครับ');
            return;
        }

        checkoutOrder(shipName, shipPhone, shipAddress, selectedPayment, uploadedSlipBase64);
    }
}

async function checkoutOrder(shipName, shipPhone, shipAddress, paymentMethod, slipBase64) {
    const totalAmount = cart.reduce((sum, item) => sum + item.unit_price, 0);
    const itemWithPresc = cart.find(item => item.prescription !== null);
    const prescToSave = itemWithPresc ? itemWithPresc.prescription : null;

    const orderPayload = {
        user_id: currentUser.id,
        total_amount: totalAmount,
        shipping_name: shipName,
        shipping_phone: shipPhone,
        shipping_address: shipAddress,
        payment_method: paymentMethod,
        slip_image_base64: slipBase64,
        items: cart.map(item => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            lens_id: item.lens_id
        })),
        prescription: prescToSave
    };

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderPayload)
        });
        const data = await response.json();

        if (data.success) {
            alert('สั่งซื้อสินค้าสำเร็จ! ระบบได้บันทึกที่อยู่จัดส่ง หลักฐานการโอนเงิน และชำระเงินเรียบร้อย คุณสามารถดูประวัติการสั่งซื้อได้ทันทีครับ');
            cart = [];
            updateCartUI();
            closeModal('cart-modal');
            
            // Clear input fields
            document.getElementById('ship-name').value = '';
            document.getElementById('ship-phone').value = '';
            document.getElementById('ship-address').value = '';
            
            // Open orders modal directly for amazing UX
            openOrdersModal();
        } else {
            alert('เกิดข้อผิดพลาดในการสั่งซื้อ: ' + data.error);
        }
    } catch (error) {
        console.error('Checkout error:', error);
        alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อดำเนินการสั่งซื้อได้');
    }
}

async function openOrdersModal() {
    if (!currentUser) return;
    
    const modal = document.getElementById('orders-modal');
    const listDiv = document.getElementById('orders-history-list');
    listDiv.innerHTML = '<div style="text-align: center; padding: 2rem;">กำลังโหลดประวัติการสั่งซื้อ...</div>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/api/orders/user/${currentUser.id}`);
        const data = await res.json();
        
        if (data.success) {
            listDiv.innerHTML = '';
            
            if (data.orders.length === 0) {
                listDiv.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">คุณยังไม่มีประวัติการสั่งซื้อสินค้ากับทางร้าน</div>';
                return;
            }

            // Group items by order_id
            const grouped = {};
            data.orders.forEach(row => {
                if (!grouped[row.order_id]) {
                    grouped[row.order_id] = {
                        id: row.order_id,
                        total: row.total_amount,
                        status: row.status,
                        date: new Date(row.created_at).toLocaleDateString('th-TH'),
                        shipping_name: row.shipping_name,
                        shipping_phone: row.shipping_phone,
                        shipping_address: row.shipping_address,
                        payment_method: row.payment_method,
                        slip_image: row.slip_image,
                        tracking_number: row.tracking_number,
                        items: []
                    };
                }
                grouped[row.order_id].items.push(`${row.product_name} x${row.quantity} (${row.lens_type})`);
            });

            Object.values(grouped).forEach(order => {
                const card = document.createElement('div');
                card.style.border = '1px solid var(--border-color)';
                card.style.borderRadius = '12px';
                card.style.padding = '1.2rem';
                card.style.backgroundColor = 'var(--bg-secondary)';

                let badgeClass = 'badge-pending';
                let statusText = 'รอดำเนินการ';
                if (order.status === 'paid') {
                    badgeClass = 'badge-paid';
                    statusText = 'ชำระเงินแล้ว / เตรียมส่ง';
                } else if (order.status === 'shipped') {
                    badgeClass = 'badge-shipped';
                    statusText = 'จัดส่งเรียบร้อย';
                }

                let slipHtml = '';
                if (order.slip_image) {
                    slipHtml = `<br><strong>หลักฐานการโอนเงิน:</strong> <a href="${order.slip_image}" target="_blank" style="color: #2b6cb0; text-decoration: underline; font-weight: 600;">เปิดดูสลิปโอนเงิน</a>`;
                }

                let trackingHtml = '';
                if (order.tracking_number) {
                    trackingHtml = `<br><strong>เลขพัสดุจัดส่ง:</strong> <span style="background-color: #ebf8ff; border: 1px solid #bee3f8; color: #2b6cb0; font-weight: 700; font-family: monospace; padding: 0.1rem 0.45rem; border-radius: 4px; margin-top: 0.25rem; display: inline-flex; align-items: center; gap: 0.2rem;"><ion-icon name="paper-plane-outline"></ion-icon> ${order.tracking_number}</span>`;
                }

                let paymentMethodText = 'เก็บเงินปลายทาง (COD)';
                if (order.payment_method === 'BankTransfer') {
                    paymentMethodText = 'โอนผ่านบัญชีธนาคาร (กสิกรไทย)';
                } else if (order.payment_method === 'QRCode') {
                    paymentMethodText = 'สแกน QR-code (PromptPay)';
                }

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.6rem; margin-bottom: 0.6rem; flex-wrap: wrap; gap: 0.5rem;">
                        <span style="font-weight: 700;">หมายเลขออเดอร์ #${order.id}</span>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <span style="font-size: 0.8rem; color: var(--text-secondary);">${order.date}</span>
                            <span class="badge ${badgeClass}" style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">${statusText}</span>
                        </div>
                    </div>
                    <div style="font-size: 0.9rem; margin-bottom: 0.8rem; line-height: 1.5;">
                        ${order.items.map(item => `<div style="color: var(--text-primary); font-weight: 500;">• ${item}</div>`).join('')}
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); background-color: var(--bg-primary); padding: 0.6rem; border-radius: 8px; margin-bottom: 0.6rem; line-height: 1.5;">
                        <strong>ที่อยู่จัดส่ง:</strong> ${order.shipping_name || 'ไม่ระบุ'} (${order.shipping_phone || 'ไม่ระบุ'})<br>
                        ${order.shipping_address || 'ไม่ระบุที่อยู่'}<br>
                        <strong>ช่องทางการชำระเงิน:</strong> ${paymentMethodText}
                        ${slipHtml}
                        ${trackingHtml}
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.85rem; color: var(--text-secondary);">ยอดรวมทั้งสิ้น:</span>
                        <span style="font-weight: 700; color: var(--accent); font-size: 1.1rem; font-family: var(--font-heading);">${parseFloat(order.total).toLocaleString()} ฿</span>
                    </div>
                `;
                listDiv.appendChild(card);
            });

        } else {
            listDiv.innerHTML = '<div style="text-align: center; color: red; padding: 2rem;">ไม่สามารถโหลดประวัติการสั่งซื้อได้</div>';
        }
    } catch (err) {
        console.error(err);
        listDiv.innerHTML = '<div style="text-align: center; color: red; padding: 2rem;">เกิดข้อผิดพลาดในการดึงข้อมูล</div>';
    }
}

function copyBankAccount() {
    const accNo = document.getElementById('bank-acc-no').innerText;
    navigator.clipboard.writeText(accNo.replace(/-/g, '')).then(() => {
        alert('คัดลอกเลขที่บัญชี กสิกรไทย 157-1-2-6845-7 เรียบร้อยแล้ว! (คัดลอกแบบลบขีดกลางออก เพื่อให้คุณนำไปวางในแอปธนาคารได้ทันทีครับ)');
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

function togglePaymentDetails() {
    const paymentRadios = document.getElementsByName('payment-method');
    let selected = 'COD';
    for (const radio of paymentRadios) {
        if (radio.checked) {
            selected = radio.value;
            break;
        }
    }
    
    const bankBox = document.getElementById('bank-transfer-details');
    const qrBox = document.getElementById('qr-code-details');
    const slipUploadBox = document.getElementById('slip-upload-section');
    
    if (bankBox) bankBox.style.display = selected === 'BankTransfer' ? 'block' : 'none';
    if (qrBox) qrBox.style.display = selected === 'QRCode' ? 'block' : 'none';
    if (slipUploadBox) slipUploadBox.style.display = (selected === 'BankTransfer' || selected === 'QRCode') ? 'block' : 'none';
}

function previewSlipImage(event) {
    const file = event.target.files[0];
    const previewContainer = document.getElementById('slip-preview-container');
    const previewImg = document.getElementById('slip-preview');
    
    if (!file) {
        uploadedSlipBase64 = null;
        previewContainer.style.display = 'none';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        uploadedSlipBase64 = e.target.result;
        previewImg.src = uploadedSlipBase64;
        previewContainer.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

// Helper: Close Modals
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// ==========================================
// AUTOMATIC IMAGE SLIDESHOW (CAROUSEL)
// ==========================================
let currentSlide = 0;
const totalSlides = 3;
let slideshowInterval;

function initSlideshow() {
    const container = document.querySelector('.slides-container');
    const dots = document.querySelectorAll('.dot');
    if (!container || dots.length === 0) return;

    // Start auto slide every 4 seconds
    slideshowInterval = setInterval(() => {
        currentSlide = (currentSlide + 1) % totalSlides;
        updateSlidePosition(container, dots);
    }, 4000);
}

function setSlide(index) {
    // Reset interval when user clicks manually to avoid fast double-skipping
    clearInterval(slideshowInterval);
    
    currentSlide = index;
    const container = document.querySelector('.slides-container');
    const dots = document.querySelectorAll('.dot');
    
    if (container && dots.length > 0) {
        updateSlidePosition(container, dots);
        // Restart interval
        slideshowInterval = setInterval(() => {
            currentSlide = (currentSlide + 1) % totalSlides;
            updateSlidePosition(container, dots);
        }, 4000);
    }
}

function updateSlidePosition(container, dots) {
    // Translate the container: Slide 0 = 0%, Slide 1 = -33.3333%, Slide 2 = -66.6666%
    const offset = currentSlide * 33.3333;
    container.style.transform = `translateX(-${offset}%)`;
    
    // Update active dots
    dots.forEach((dot, idx) => {
        dot.style.opacity = idx === currentSlide ? '1' : '0.5';
    });
}

// ==========================================================================
// PREMIUM UX/UI UPGRADES: THEMING, SCROLL EFFECTS, ACCORDION, SIMULATOR, TILT
// ==========================================================================

// 1. Theme Configuration (Dark / Light Mode)
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

// 2. Scroll Progress & Floating Back-to-Top Button
function initScrollEffects() {
    window.addEventListener('scroll', () => {
        // Scroll Progress Bar calculation
        const scrollBar = document.getElementById('scroll-progress');
        if (scrollBar) {
            const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = height > 0 ? (winScroll / height) * 100 : 0;
            scrollBar.style.width = scrolled + "%";
        }

        // Back-to-Top Button display toggle
        const backToTopBtn = document.getElementById('back-to-top-btn');
        if (backToTopBtn) {
            if (document.body.scrollTop > 300 || document.documentElement.scrollTop > 300) {
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

// 3. Interactive FAQ Accordion
function toggleFaq(element) {
    const faqItem = element.parentElement;
    const isActive = faqItem.classList.contains('active');

    // Close all other FAQ items first for Accordion behavior
    const allItems = document.querySelectorAll('.faq-item');
    allItems.forEach(item => {
        item.classList.remove('active');
    });

    if (!isActive) {
        faqItem.classList.add('active');
    }
}

// 4. 3D Tilt Effect for Customer Review Cards
function handleTilt(e, card) {
    const cardRect = card.getBoundingClientRect();
    const cardWidth = cardRect.width;
    const cardHeight = cardRect.height;
    
    // Mouse coordinates relative to card center
    const mouseX = e.clientX - cardRect.left - cardWidth / 2;
    const mouseY = e.clientY - cardRect.top - cardHeight / 2;
    
    // Calculate rotation angles (max 12 degrees)
    const rotateX = -(mouseY / (cardHeight / 2)) * 12;
    const rotateY = (mouseX / (cardWidth / 2)) * 12;
    
    // Apply 3D transformations
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
}

function resetTilt(card) {
    card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
}

// 5. Interactive Lens Simulator Logic
function updateLensSimulation(lensValue) {
    const tintOverlay = document.getElementById('lens-sim-tint');
    const blueBeam = document.getElementById('lens-sim-blue-beam');
    const blockedLabel = document.getElementById('lens-sim-blocked-label');
    const simText = document.getElementById('lens-sim-text');
    const sliderGroup = document.getElementById('lens-sim-slider-group');
    const uvSlider = document.getElementById('lens-uv-slider');
    const bgImage = document.getElementById('lens-sim-bg');

    if (!tintOverlay || !blueBeam || !simText || !sliderGroup) return;

    // Reset default states
    tintOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    blueBeam.style.opacity = '0';
    blockedLabel.style.opacity = '0';
    sliderGroup.style.display = 'none';
    if (bgImage) bgImage.style.filter = 'brightness(1.05)';

    switch(lensValue) {
        case 1: // Normal Lens
            simText.innerText = "เลนส์ธรรมดา (Normal Lens) : รับภาพปกติทั่วไป";
            break;
        case 2: // Blue Block Lens
            // Amber tint overlay and sepia photo warming effect (subtle/natural warming)
            tintOverlay.style.backgroundColor = 'rgba(217, 119, 6, 0.07)';
            blueBeam.style.opacity = '1';
            blockedLabel.style.opacity = '1';
            if (bgImage) bgImage.style.filter = 'sepia(0.20) saturate(1.1) brightness(1.01)';
            simText.innerText = "เลนส์กรองแสงสีฟ้า : ตัดแสงสีฟ้า 95% ปกป้องสายตา";
            break;
        case 3: // Photochromic Auto Lens
            sliderGroup.style.display = 'flex';
            if (uvSlider) {
                uvSlider.value = 0; // reset
                updateLensSimulationSlider(0);
            }
            break;
    }
}

function updateLensSimulationSlider(uvValue) {
    const tintOverlay = document.getElementById('lens-sim-tint');
    const simText = document.getElementById('lens-sim-text');
    const bgImage = document.getElementById('lens-sim-bg');

    if (!tintOverlay || !simText) return;

    const parsedVal = parseInt(uvValue);
    
    // Darken lens based on UV intensity slider (from transparent to very dark sunglasses tint)
    const opacityFactor = (parsedVal / 100) * 0.85; // max opacity 0.85 (very dark sunglasses filter)
    tintOverlay.style.backgroundColor = `rgba(26, 27, 30, ${opacityFactor})`;
    
    // Dim the background significantly as the lens gets darker (heavy sun glass effect)
    if (bgImage) {
        const brightnessFactor = 1.05 - (parsedVal / 100) * 0.40; // drop brightness to 0.40 for strong sunlight filtering
        bgImage.style.filter = `brightness(${brightnessFactor})`;
    }

    if (parsedVal === 0) {
        simText.innerText = "เลนส์ปรับแสงออโต้ : ในร่มเลนส์ใสเคลียร์";
    } else {
        simText.innerText = `เลนส์เข้มขึ้นเป็นเลนส์กันแดด (UV ${parsedVal}% • ปรับความเข้มระดับพอเหมาะ)`;
    }
}

// ==========================================
// CUSTOMER REVIEWS DYNAMIC SYSTEM
// ==========================================
async function loadAndRenderReviews() {
    try {
        const res = await fetch('/api/reviews');
        const data = await res.json();
        if (data.success) {
            renderReviewsGrid(data.reviews);
        }
    } catch (error) {
        console.error('Error fetching reviews:', error);
    }
}

function renderReviewsGrid(reviews) {
    const grid = document.getElementById('reviews-list-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    reviews.forEach((rev, idx) => {
        // Generate stars
        let starsHtml = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= rev.rating) {
                starsHtml += '<ion-icon name="star"></ion-icon>';
            } else {
                starsHtml += '<ion-icon name="star-outline"></ion-icon>';
            }
        }
        
        const card = document.createElement('div');
        card.className = 'review-card';
        card.setAttribute('data-aos', 'fade-up');
        card.setAttribute('data-aos-delay', (idx % 3) * 100);
        
        // Bind tilt effects
        card.addEventListener('mousemove', (e) => handleTilt(e, card));
        card.addEventListener('mouseleave', () => resetTilt(card));
        
        card.innerHTML = `
            <div class="review-stars" style="color: #f6ad55; display: flex; gap: 0.2rem; margin-bottom: 1rem;">
                ${starsHtml}
            </div>
            <p class="review-text" style="font-size: 0.92rem; line-height: 1.6; font-style: italic; margin-bottom: 1.5rem;">
                "${rev.comment}"
            </p>
            <div class="review-user" style="display: flex; align-items: center; gap: 0.8rem;">
                <div class="review-avatar" style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; background-color: var(--text-primary); color: var(--bg-primary); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; border: 1px solid var(--border-color); transition: background-color 0.3s ease, color 0.3s ease; overflow: hidden;">
                    ${rev.avatar_url 
                        ? `<img src="${rev.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;" referrerpolicy="no-referrer">` 
                        : '<ion-icon name="person"></ion-icon>'
                    }
                </div>
                <div class="review-details">
                    <h5 style="margin: 0 0 0.4rem 0; font-size: 0.95rem; font-weight: 600;">${rev.user_name}</h5>
                    <span style="font-size: 0.75rem; color: var(--text-secondary); display: block;">${rev.product_name || 'แว่นตาทั่วไป'}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function populateReviewProductSelect() {
    const select = document.getElementById('review-product-select');
    if (!select) return;
    select.innerHTML = '<option value="แว่นตาทั่วไป">-- เลือกแว่นตาที่สั่งซื้อ --</option>';
    allProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.innerText = p.name;
        select.appendChild(opt);
    });
}

function setFormRating(rating) {
    document.getElementById('review-rating-value').value = rating;
    const stars = document.querySelectorAll('.star-rating-selector .form-star');
    stars.forEach((star, idx) => {
        if (idx < rating) {
            star.setAttribute('name', 'star');
            star.style.color = '#f6ad55';
        } else {
            star.setAttribute('name', 'star-outline');
            star.style.color = '#cbd5e0';
        }
    });
}

async function submitReview(e) {
    e.preventDefault();
    if (!currentUser) return alert('กรุณาเข้าสู่ระบบก่อนแสดงความคิดเห็น');
    
    const rating = parseInt(document.getElementById('review-rating-value').value) || 5;
    const comment = document.getElementById('review-comment').value.trim();
    const productSelect = document.getElementById('review-product-select');
    const product_name = productSelect ? productSelect.value : 'แว่นตาทั่วไป';
    
    if (!comment) return alert('กรุณากรอกข้อความรีวิว');
    
    try {
        const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_name: `คุณ ${currentUser.name}`,
                rating,
                comment,
                product_name,
                avatar_url: currentUser.avatar_url || null
            })
        });
        const data = await res.json();
        if (data.success) {
            alert('บันทึกความเห็นของคุณเรียบร้อยแล้ว ขอบคุณสำหรับรีวิวครับ!');
            document.getElementById('review-comment').value = '';
            if (productSelect) productSelect.value = 'แว่นตาทั่วไป';
            setFormRating(5);
            loadAndRenderReviews();
        } else {
            alert(data.error || 'เกิดข้อผิดพลาดในการบันทึกความคิดเห็น');
        }
    } catch (err) {
        console.error('Error submitting review:', err);
        alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    }
}

function openUserProfileModal() {
    if (!currentUser) return;
    
    toggleProfileEdit(false);
    
    // Set avatar with hover upload icon layer
    const avatarContainer = document.getElementById('profile-avatar-container');
    if (avatarContainer) {
        avatarContainer.innerHTML = (currentUser.avatar_url 
            ? `<img src="${currentUser.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;" referrerpolicy="no-referrer">` 
            : `<ion-icon name="person-outline" style="color: var(--bg-primary);"></ion-icon>`) + `
            <div class="avatar-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.7rem; opacity: 0; transition: opacity 0.2s ease;">
                <ion-icon name="camera-outline" style="font-size: 1.4rem; margin-bottom: 0.15rem;"></ion-icon>
                เปลี่ยนรูป
            </div>`;
    }
    
    // Set text details
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('profile-username').innerText = currentUser.username || currentUser.name.split(' ')[0];
    document.getElementById('profile-email').innerText = currentUser.email || 'ไม่ได้ระบุ';
    
    const roleSpan = document.getElementById('profile-role');
    if (roleSpan) {
        if (currentUser.role === 'admin') {
            roleSpan.innerText = 'ผู้ดูแลระบบ (Admin)';
            roleSpan.style.color = '#c53030';
            roleSpan.style.backgroundColor = '#fed7d7';
        } else {
            roleSpan.innerText = 'ลูกค้าทั่วไป (Customer)';
            roleSpan.style.color = '#2b6cb0';
            roleSpan.style.backgroundColor = '#ebf8ff';
        }
    }
    
    // Open modal
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'flex';
}

function triggerAvatarUpload() {
    const fileInput = document.getElementById('avatar-file-input');
    if (fileInput) fileInput.click();
}

async function handleAvatarFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        const base64Data = event.target.result;
        
        const avatarContainer = document.getElementById('profile-avatar-container');
        const originalHTML = avatarContainer.innerHTML;
        avatarContainer.innerHTML = `<div style="font-size: 0.8rem; color: #fff; background-color: rgba(0,0,0,0.5); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">อัปโหลด...</div>`;
        
        try {
            const res = await fetch('/api/auth/update-avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: currentUser.id,
                    avatar_data: base64Data
                })
            });
            const data = await res.json();
            
            if (data.success) {
                // Update local session
                currentUser.avatar_url = data.avatar_url;
                localStorage.setItem('baan_waenta_user', JSON.stringify(currentUser));
                
                // Re-sync navbar
                checkLoginStatus();
                
                // Re-render modal avatar
                avatarContainer.innerHTML = `<img src="${data.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;" referrerpolicy="no-referrer">
                    <div class="avatar-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.7rem; opacity: 0; transition: opacity 0.2s ease;">
                        <ion-icon name="camera-outline" style="font-size: 1.4rem; margin-bottom: 0.15rem;"></ion-icon>
                        เปลี่ยนรูป
                    </div>`;
                
                // Refresh home reviews if present
                if (document.getElementById('reviews-list-grid')) {
                    loadAndRenderReviews();
                }
                
                alert('เปลี่ยนรูปโปรไฟล์ของคุณสำเร็จแล้ว!');
            } else {
                alert(data.message || 'เกิดข้อผิดพลาดในการบันทึกรูปโปรไฟล์');
                avatarContainer.innerHTML = originalHTML;
            }
        } catch (err) {
            console.error('Update avatar error:', err);
            alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่ออัปเดตรูปโปรไฟล์ได้');
            avatarContainer.innerHTML = originalHTML;
        }
    };
    reader.readAsDataURL(file);
}

function toggleProfileEdit(isEdit) {
    const nameSpan = document.getElementById('profile-name');
    const nameInput = document.getElementById('edit-profile-name');
    const usernameSpan = document.getElementById('profile-username');
    const usernameInput = document.getElementById('edit-profile-username');
    
    const viewActions = document.getElementById('profile-view-actions');
    const editActions = document.getElementById('profile-edit-actions');
    const logoutBtn = document.getElementById('profile-logout-btn');
    
    if (isEdit) {
        // Switch to edit mode
        nameSpan.style.display = 'none';
        nameInput.style.display = 'block';
        nameInput.value = currentUser.name;
        
        usernameSpan.style.display = 'none';
        usernameInput.style.display = 'block';
        usernameInput.value = currentUser.username || currentUser.name;
        
        viewActions.style.display = 'none';
        editActions.style.display = 'flex';
        logoutBtn.style.display = 'none';
    } else {
        // Switch to view mode
        nameSpan.style.display = 'block';
        nameInput.style.display = 'none';
        
        usernameSpan.style.display = 'block';
        usernameInput.style.display = 'none';
        
        viewActions.style.display = 'flex';
        editActions.style.display = 'none';
        logoutBtn.style.display = 'block';
    }
}

async function saveProfileChanges() {
    const newName = document.getElementById('edit-profile-name').value.trim();
    const newUsername = document.getElementById('edit-profile-username').value.trim();
    
    if (!newName || !newUsername) {
        alert('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }
    
    try {
        const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                name: newName,
                username: newUsername
            })
        });
        const data = await res.json();
        
        if (data.success) {
            // Update local session
            currentUser.name = newName;
            currentUser.username = newUsername;
            localStorage.setItem('baan_waenta_user', JSON.stringify(currentUser));
            
            // Sync UI displays
            checkLoginStatus();
            
            document.getElementById('profile-name').innerText = newName;
            document.getElementById('profile-username').innerText = newUsername;
            
            // Switch back to view mode
            toggleProfileEdit(false);
            
            // Refresh home page reviews if present to show updated name
            if (document.getElementById('reviews-list-grid')) {
                loadAndRenderReviews();
            }
            
            alert('อัปเดตข้อมูลโปรไฟล์เรียบร้อยแล้ว!');
        } else {
            alert(data.message || 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
        }
    } catch (err) {
        console.error('Error updating profile:', err);
        alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่ออัปเดตข้อมูลโปรไฟล์ได้');
    }
}
