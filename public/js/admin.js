// Admin State
let adminUser = null;
let csrfToken = null;
let topProductsChartInstance = null;
let popularLensesChartInstance = null;
let cachedMetrics = null;

// Sync theme from localStorage if available
try {
    const savedAdminTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedAdminTheme);
} catch (_) {}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!await checkAdminAccess()) return;
    fetchDashboardMetrics();
    fetchOrdersList();
    fetchStockProducts();
    fetchReviewsList();
    setupAdminFormListeners();
});

function setupAdminFormListeners() {
    // Validate that only .png files are selected for the 5 image inputs
    for (let i = 1; i <= 5; i++) {
        const input = document.getElementById(`prod-image-${i}`);
        if (input) {
            input.addEventListener('change', () => {
                if (input.files.length > 0) {
                    const file = input.files[0];
                    if (!file.name.toLowerCase().endsWith('.png') && file.type !== 'image/png') {
                        alert(`ช่องที่ ${i}: กรุณาเลือกเฉพาะไฟล์รูปภาพนามสกุล .png เท่านั้นครับ`);
                        input.value = '';
                    }
                }
            });
        }
    }

    // Validate that 3D model is .glb
    const modelInput = document.getElementById('prod-model-3d');
    if (modelInput) {
        modelInput.addEventListener('change', () => {
            if (modelInput.files.length > 0) {
                const file = modelInput.files[0];
                if (!file.name.toLowerCase().endsWith('.glb')) {
                    alert('กรุณาเลือกไฟล์โมเดล 3D นามสกุล .glb เท่านั้นครับ');
                    modelInput.value = '';
                }
            }
        });
    }
}

async function adminApiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
    }
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    if (response.status === 401 || response.status === 403) {
        adminUser = null;
        csrfToken = null;
    }
    return response;
}

// 1. Guard check for Admin Role using the server-side session.
async function checkAdminAccess() {
    try {
        const response = await adminApiFetch('/api/auth/me');
        if (!response.ok) throw new Error('Not signed in');
        const data = await response.json();
        adminUser = data.user;
        csrfToken = data.csrfToken;
    } catch (_) {
        alert('กรุณาเข้าสู่ระบบในฐานะผู้ดูแลระบบก่อนครับ');
        window.location.href = '/';
        return false;
    }
    if (adminUser.role !== 'admin') {
        alert('บัญชีนี้ไม่มีสิทธิ์เข้าถึงแดชบอร์ดหลังบ้าน');
        window.location.href = '/';
        return false;
    }
    return true;
}

// 2. Fetch and render Analytics Indicators & Charts
async function fetchDashboardMetrics() {
    try {
        const res = await adminApiFetch('/api/admin/analytics');
        const data = await res.json();
        
        if (data.success) {
            const m = data.metrics;
            cachedMetrics = m;
            document.getElementById('metric-sales').innerText = `${parseFloat(m.totalSales).toLocaleString()} ฿`;
            
            const ordersElem = document.getElementById('metric-orders');
            if (ordersElem) {
                ordersElem.innerText = m.completedOrders ?? m.totalOrders;
            }
            const ordersSub = document.getElementById('metric-orders-subtext');
            if (ordersSub) {
                ordersSub.innerText = m.totalOrders > 0 
                    ? `สำเร็จ ${m.completedOrders} จาก ${m.totalOrders} รายการ`
                    : 'ยังไม่มีคำสั่งซื้อ';
            }

            const stockElem = document.getElementById('metric-stock');
            if (stockElem) {
                stockElem.innerText = `${m.totalStock || 0} ชิ้น`;
            }
            const stockSub = document.getElementById('metric-stock-subtext');
            if (stockSub) {
                stockSub.innerText = `พร้อมจำหน่าย (รวม ${m.totalProducts || 0} รุ่น)`;
            }

            const convElem = document.getElementById('metric-conversion');
            if (convElem) {
                convElem.innerText = `${m.conversionRate}%`;
            }

            document.getElementById('metric-customers').innerText = m.totalCustomers;

            // Render analytics charts
            renderTopProductsChart(m.topProducts || []);
            renderPopularLensesChart(m.popularLenses || []);
        }
    } catch (error) {
        console.error('Error fetching analytics:', error);
    }
}

// Render Top 5 Best-Selling Frames (Horizontal Bar Chart)
function renderTopProductsChart(items) {
    const canvas = document.getElementById('top-products-chart');
    if (!canvas) return;

    if (topProductsChartInstance) {
        topProductsChartInstance.destroy();
        topProductsChartInstance = null;
    }

    if (!window.Chart) {
        console.warn('Chart.js is not loaded');
        return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#1e2022';
    const subtleColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

    const validItems = (items && items.length > 0) ? items : [{ name: 'ยังไม่มีข้อมูลสินค้า', brand: '', total_sold: 0 }];

    const labels = validItems.map(item => {
        let name = item.name || 'ไม่ระบุชื่อ';
        if (name.length > 22) name = name.substring(0, 20) + '...';
        return name;
    });

    const dataValues = validItems.map(item => Number(item.total_sold) || 0);

    const barColors = [
        '#3b82f6', // Sapphire Blue
        '#10b981', // Emerald Green
        '#f59e0b', // Amber
        '#8b5cf6', // Violet
        '#ec4899'  // Rose Pink
    ];

    const ctx = canvas.getContext('2d');
    topProductsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'จำนวนที่ขายได้ (ชิ้น)',
                data: dataValues,
                backgroundColor: barColors.slice(0, labels.length),
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 18,
                maxBarThickness: 24
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: (tooltipItems) => {
                            const index = tooltipItems[0].dataIndex;
                            const item = validItems[index];
                            return item ? `${item.name} (${item.brand || 'ร้านค้า'})` : tooltipItems[0].label;
                        },
                        label: (context) => ` ขายได้แล้ว: ${context.parsed.x} ชิ้น`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: subtleColor,
                        stepSize: 1,
                        precision: 0,
                        font: { family: "'IBM Plex Sans Thai', sans-serif" }
                    },
                    grid: {
                        color: gridColor
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        font: { family: "'IBM Plex Sans Thai', sans-serif", size: 12 }
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Render Popular Lens Types (Doughnut Chart)
function renderPopularLensesChart(items) {
    const canvas = document.getElementById('popular-lenses-chart');
    if (!canvas) return;

    if (popularLensesChartInstance) {
        popularLensesChartInstance.destroy();
        popularLensesChartInstance = null;
    }

    if (!window.Chart) {
        console.warn('Chart.js is not loaded');
        return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#1e2022';

    const validItems = (items && items.length > 0) ? items : [
        { lens_type: 'เลนส์ธรรมดา', count: 0 },
        { lens_type: 'เลนส์กรองแสงฟ้า', count: 0 },
        { lens_type: 'เลนส์ปรับแสงออโต้', count: 0 }
    ];

    const labels = validItems.map(item => item.lens_type || 'เลนส์ทั่วไป');
    const dataValues = validItems.map(item => Number(item.count) || 0);
    const totalCount = dataValues.reduce((a, b) => a + b, 0);

    const palette = [
        '#6366f1', // Indigo
        '#06b6d4', // Cyan
        '#f59e0b', // Amber
        '#10b981', // Emerald
        '#ec4899'  // Pink
    ];

    const ctx = canvas.getContext('2d');
    popularLensesChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: totalCount === 0 ? validItems.map(() => 1) : dataValues,
                backgroundColor: totalCount === 0
                    ? (isDark ? ['#334155', '#475569', '#64748b'] : ['#e2e8f0', '#cbd5e1', '#94a3b8'])
                    : palette.slice(0, labels.length),
                borderWidth: 2,
                borderColor: isDark ? '#1a1b1e' : '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: textColor,
                        font: { family: "'IBM Plex Sans Thai', sans-serif", size: 12 },
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            if (totalCount === 0) return ' ยังไม่มีรายการสั่งตัดเลนส์';
                            const val = dataValues[context.dataIndex];
                            const pct = totalCount > 0 ? ((val / totalCount) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${val} ครั้ง (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '62%'
        }
    });
}

// Observe theme attribute changes to automatically re-render charts
if (typeof MutationObserver !== 'undefined') {
    const themeObserver = new MutationObserver(() => {
        if (cachedMetrics) {
            renderTopProductsChart(cachedMetrics.topProducts || []);
            renderPopularLensesChart(cachedMetrics.popularLenses || []);
        }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// 3. Fetch and Render Customer Orders
async function fetchOrdersList() {
    const tableBody = document.getElementById('orders-list-table');
    try {
        const res = await adminApiFetch('/api/admin/orders');
        const data = await res.json();
        
        if (data.success) {
            tableBody.innerHTML = '';
            
            if (data.orders.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 2rem;">ยังไม่มีรายการสั่งซื้อในระบบ</td></tr>`;
                return;
            }

            // Group orders by order ID since JOIN queries duplicate order headers per item
            const grouped = {};
            data.orders.forEach(row => {
                if (!grouped[row.order_id]) {
                    grouped[row.order_id] = {
                        id: row.order_id,
                        customer: row.customer_name,
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
                const tr = document.createElement('tr');
                
                let badgeClass = 'badge-pending';
                let statusText = 'รอดำเนินการ';
                if (order.status === 'paid') {
                    badgeClass = 'badge-paid';
                    statusText = 'ชำระเงินแล้ว / เตรียมส่ง';
                } else if (order.status === 'payment_review') {
                    badgeClass = 'badge-pending';
                    statusText = 'รอตรวจสอบการชำระเงิน';
                } else if (order.status === 'shipped') {
                    badgeClass = 'badge-shipped';
                    statusText = 'จัดส่งเรียบร้อย';
                } else if (order.status === 'completed') {
                    badgeClass = 'badge-shipped';
                    statusText = 'สำเร็จ';
                } else if (order.status === 'cancelled') {
                    badgeClass = 'badge-pending';
                    statusText = 'ยกเลิกแล้ว';
                }

                let actionHtml = '';
                if (order.status === 'pending' || order.status === 'payment_review') {
                    actionHtml = `
                        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;" onclick="updateOrderStatus(${order.id}, 'paid')">ยืนยันชำระเงิน</button>
                        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;color:#c53030;" onclick="updateOrderStatus(${order.id}, 'cancelled')">ยกเลิก</button>`;
                } else if (order.status === 'paid') {
                    actionHtml = `
                        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;" onclick="updateOrderStatus(${order.id}, 'shipped')">ส่งสินค้าแล้ว</button>
                        <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;color:#c53030;" onclick="updateOrderStatus(${order.id}, 'cancelled')">ยกเลิก</button>`;
                } else if (order.status === 'shipped') {
                    actionHtml = `<button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;" onclick="updateOrderStatus(${order.id}, 'completed')">ปิดงาน</button>`;
                } else {
                    actionHtml = `<span style="font-size:0.8rem;font-weight:600;">${statusText}</span>`;
                }

                let slipAdminHtml = '';
                if (order.slip_image) {
                    slipAdminHtml = `<div style="margin-top:0.4rem;">
                        <a href="javascript:void(0)" onclick="viewOrderSlip('${order.slip_image}')" style="display:inline-flex; align-items:center; gap:0.25rem; background-color:#ebf8ff; border:1px solid #bee3f8; color:#2b6cb0; border-radius:4px; padding:0.2rem 0.5rem; font-size:0.7rem; font-weight:600; text-decoration:none; cursor:pointer;">
                            <ion-icon name="image-outline"></ion-icon> ดูสลิปโอนเงิน
                        </a>
                    </div>`;
                }

                let trackingAdminHtml = '';
                if (order.tracking_number) {
                    trackingAdminHtml = `<div style="margin-top:0.35rem; font-size:0.75rem; color:#2d3748; background:#edf2f7; border:1px solid var(--border-color); padding:0.2rem 0.5rem; border-radius:6px; display:inline-flex; align-items:center; gap:0.25rem; font-weight:600;">
                        <ion-icon name="paper-plane-outline" style="color:#4a5568;"></ion-icon> เลขพัสดุ: ${escapeHtml(order.tracking_number)}
                    </div>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: 600;">#${order.id}</td>
                    <td>
                        <strong>${escapeHtml(order.customer)}</strong>
                        ${order.shipping_name ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.25rem; font-weight:normal; line-height:1.4;">
                            ชื่อผู้รับ: ${escapeHtml(order.shipping_name)}<br>
                            เบอร์โทร: ${escapeHtml(order.shipping_phone)}<br>
                            ที่อยู่: ${escapeHtml(order.shipping_address)}<br>
                            วิธีชำระเงิน: <span style="color:var(--accent); font-weight:600;">${order.payment_method === 'BankTransfer' ? 'โอนผ่านธนาคาร' : (order.payment_method === 'QRCode' ? 'สแกน QR-code' : (order.payment_method === 'CreditCard' ? 'บัตรเครดิต / เดบิต (จำลอง)' : 'เก็บเงินปลายทาง'))}</span>
                            ${slipAdminHtml}
                            ${trackingAdminHtml}
                        </div>` : ''}
                    </td>
                    <td>${order.items.map(escapeHtml).join('<br>')}</td>
                    <td>เลนส์สั่งตัดพิเศษ</td>
                    <td style="font-weight: 700; font-family: var(--font-heading);">${parseFloat(order.total).toLocaleString()} ฿</td>
                    <td><span class="badge ${badgeClass}">${statusText}</span></td>
                    <td>${actionHtml}</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Error fetching orders:', error);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red; padding: 2rem;">เกิดข้อผิดพลาดในการโหลดข้อมูลคำสั่งซื้อ</td></tr>`;
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        if (status === 'cancelled' && !confirm('ยืนยันยกเลิกออเดอร์และคืนสต็อกสินค้า?')) return;
        let trackingNumber = '';
        if (status === 'shipped') {
            trackingNumber = prompt('กรุณากรอกเลขพัสดุสำหรับออเดอร์นี้ (เช่น Flash Express: TH0123456789):');
            if (trackingNumber === null) return; // cancel
            trackingNumber = trackingNumber.trim();
        }

        const res = await adminApiFetch(`/api/admin/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, tracking_number: trackingNumber || null })
        });
        const data = await res.json();
        if (data.success) {
            alert('อัปเดตสถานะการส่งสินค้าสำเร็จ!');
            fetchOrdersList();
            fetchDashboardMetrics();
        } else {
            alert(data.message || 'ไม่สามารถอัปเดตสถานะออเดอร์ได้');
        }
    } catch (error) {
        console.error('Error updating order:', error);
    }
}

// 4. Fetch Stock Items
async function fetchStockProducts() {
    const tableBody = document.getElementById('products-list-table');
    try {
        const res = await adminApiFetch('/api/products');
        const data = await res.json();
        if (data.success) {
            tableBody.innerHTML = '';
            data.products.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${p.id}</td>
                    <td style="font-weight: 600;">${escapeHtml(p.name)}</td>
                    <td>${escapeHtml(p.brand)}</td>
                    <td>${p.category === 'Optical' ? 'แว่นสายตา' : 'แว่นกันแดด'}</td>
                    <td style="font-family: var(--font-heading);">${parseFloat(p.price).toLocaleString()} ฿</td>
                    <td style="font-weight: 600; color: ${p.stock <= 5 ? '#e53e3e' : 'inherit'}">${p.stock} ชิ้น</td>
                    <td>
                        <button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; border-color: red; color: red;" onclick="deleteProduct(${p.id})">
                            ลบออก
                        </button>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error('Error fetching stock:', error);
    }
}

// 5. Add New Product
async function addNewProduct(e) {
    e.preventDefault();
    
    const name = document.getElementById('prod-name').value.trim();
    const brand = document.getElementById('prod-brand').value.trim();
    const category = document.getElementById('prod-category').value;
    const frame_shape = document.getElementById('prod-shape').value;
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseInt(document.getElementById('prod-stock').value, 10);

    const imgInput1 = document.getElementById('prod-image-1');
    if (!imgInput1 || imgInput1.files.length === 0) {
        alert('กรุณาเลือกรูปภาพปกของแว่นตา (ช่องที่ 1) ก่อนบันทึกครับ');
        return;
    }

    // Helper to read file as Data URL
    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });

    // 1. Process 3D Model if provided (.glb only)
    const modelFileInput = document.getElementById('prod-model-3d');
    let model3dBase64 = null;
    if (modelFileInput && modelFileInput.files.length > 0) {
        const file = modelFileInput.files[0];
        if (!file.name.toLowerCase().endsWith('.glb')) {
            alert('กรุณาเลือกเฉพาะไฟล์โมเดล .glb เท่านั้นครับ');
            return;
        }
        try {
            model3dBase64 = await readFileAsDataUrl(file);
        } catch (err) {
            alert('ไม่สามารถอ่านไฟล์โมเดล 3D ได้: ' + err.message);
            return;
        }
    }

    // 2. Process all 5 image inputs (.png only)
    const galleryBase64 = [];
    for (let i = 1; i <= 5; i++) {
        const input = document.getElementById(`prod-image-${i}`);
        if (input && input.files.length > 0) {
            const file = input.files[0];
            if (!file.name.toLowerCase().endsWith('.png') && file.type !== 'image/png') {
                alert(`ช่องที่ ${i}: กรุณาอัปโหลดเฉพาะไฟล์นามสกุล .png เท่านั้นครับ`);
                return;
            }
            try {
                const dataUrl = await readFileAsDataUrl(file);
                galleryBase64.push(dataUrl);
            } catch (err) {
                alert(`เกิดข้อผิดพลาดในการอ่านไฟล์รูปช่องที่ ${i}: ` + err.message);
                return;
            }
        }
    }

    if (galleryBase64.length === 0) {
        alert('กรุณาอัปโหลดรูปภาพปกแว่นตา (ช่องที่ 1) ครับ');
        return;
    }

    // Show loading indicator
    if (typeof showToast === 'function') showToast('กำลังประมวลผลและอัปโหลดรูปภาพสินค้า...', 'info');

    const payload = {
        name,
        brand,
        category,
        frame_shape,
        price,
        stock,
        image_url: galleryBase64[0],
        tryon_image_url: galleryBase64[0],
        gallery_images: galleryBase64,
        model_3d: model3dBase64
    };

    try {
        const res = await adminApiFetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            alert('ลงขายแว่นตารุ่นใหม่เรียบร้อยแล้ว! รูปภาพทั้ง 5 มุมจะแสดงในหน้ารายละเอียดสินค้าอัตโนมัติ');
            document.getElementById('add-product-form').reset();
            fetchStockProducts();
            fetchDashboardMetrics();
        } else {
            alert('ไม่สามารถเพิ่มแว่นตาได้: ' + (data.message || data.error));
        }
    } catch (error) {
        console.error('Error adding product:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + error.message);
    }
}

// 6. Delete Product
async function deleteProduct(id) {
    if (!confirm('ยืนยันที่จะลบกรอบแว่นตานี้ออกจากระบบขายจริง?')) return;
    
    try {
        const res = await adminApiFetch(`/api/products/${id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            alert('ลบแว่นตาออกจากระบบคลังเรียบร้อย');
            fetchStockProducts();
            fetchDashboardMetrics();
        }
    } catch (error) {
        console.error('Error deleting product:', error);
    }
}

// Logout
async function handleLogout() {
    try {
        await adminApiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
        adminUser = null;
        csrfToken = null;
        alert('ออกจากระบบแอดมินแล้ว');
        window.location.href = '/';
    }
}

// 7. Fetch and Render Reviews for Management
async function fetchReviewsList() {
    const tableBody = document.getElementById('reviews-list-table');
    if (!tableBody) return;
    
    try {
        const res = await adminApiFetch('/api/reviews');
        const data = await res.json();
        
        if (data.success) {
            tableBody.innerHTML = '';
            
            if (data.reviews.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 2rem;">ไม่มีความคิดเห็นในระบบ</td></tr>`;
                return;
            }
            
            data.reviews.forEach(rev => {
                const row = document.createElement('tr');
                
                // Construct stars text
                let stars = '';
                for(let i=0; i<rev.rating; i++) stars += '⭐';
                
                row.innerHTML = `
                    <td style="font-weight: 600;">#REV-${rev.id}</td>
                    <td>${escapeHtml(rev.user_name)}</td>
                    <td style="font-weight: 500;">${escapeHtml(rev.product_name || 'แว่นตาทั่วไป')}</td>
                    <td><span style="color: #f6ad55;">${stars}</span> (${rev.rating}/5)</td>
                    <td style="max-width: 300px; white-space: normal; line-height: 1.4;">${escapeHtml(rev.comment)}</td>
                    <td>${new Date(rev.created_at).toLocaleString('th-TH')}</td>
                    <td>
                        <button class="btn btn-outline" style="color: #e53e3e; border-color: #feb2b2; padding: 0.35rem 0.7rem; font-size: 0.78rem;" onclick="deleteReview(${rev.id})">
                            <ion-icon name="trash-outline" style="vertical-align: middle; margin-right: 0.1rem;"></ion-icon> ลบความคิดเห็น
                        </button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error fetching reviews:', error);
    }
}

// 8. Delete Customer Review
async function deleteReview(id) {
    if (!confirm('คุณแน่ใจหรือไม่ที่จะลบรีวิวนี้อย่างถาวร? การลบนี้เพื่อป้องกันข้อมูลเท็จ')) return;
    
    try {
        const res = await adminApiFetch(`/api/reviews/${id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            alert('ลบความคิดเห็นของลูกค้าเรียบร้อยแล้ว');
            fetchReviewsList();
        } else {
            alert(data.error || 'เกิดข้อผิดพลาดในการลบความคิดเห็น');
        }
    } catch (error) {
        console.error('Error deleting review:', error);
        alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    }
}

let adminSavedScrollY = 0;
let isAdminScrollLocked = false;

function lockModalScroll() {
    if (isAdminScrollLocked) return;
    adminSavedScrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    document.documentElement.classList.add('modal-locked');
    document.body.classList.add('modal-locked');
    document.body.style.top = `-${adminSavedScrollY}px`;
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    isAdminScrollLocked = true;
}

function unlockModalScroll() {
    const anyModalOpen = Array.from(document.querySelectorAll('.modal')).some(m => {
        return m.style.display && m.style.display !== 'none';
    });
    if (anyModalOpen || !isAdminScrollLocked) return;

    document.documentElement.classList.remove('modal-locked');
    document.body.classList.remove('modal-locked');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    isAdminScrollLocked = false;
    window.scrollTo(0, adminSavedScrollY);
}

function viewOrderSlip(slipUrl) {
    const modal = document.getElementById('view-slip-modal');
    if (!modal) return;
    const img = document.getElementById('view-slip-modal-img');
    const dl = document.getElementById('view-slip-modal-download');
    if (img) img.src = slipUrl;
    if (dl) dl.href = slipUrl;
    modal.style.display = 'flex';
    lockModalScroll();
}
window.viewOrderSlip = viewOrderSlip;

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
    unlockModalScroll();
}
window.closeModal = closeModal;

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = 'none';
            unlockModalScroll();
        }
    });
});
