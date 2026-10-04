// Admin State
let adminUser = null;
let csrfToken = null;
let topProductsChartInstance = null;
let popularLensesChartInstance = null;
let cachedMetrics = null;

// Theme Management (Light / Dark Mode)
function initTheme() {
    const savedTheme = localStorage.getItem('baan_waenta_theme') || localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('baan_waenta_theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.setAttribute('name', theme === 'dark' ? 'sunny-outline' : 'moon-outline');
    }
}
window.toggleTheme = toggleTheme;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
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
            
            if (!data.orders || data.orders.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 3rem;">ยังไม่มีรายการสั่งซื้อในระบบ</td></tr>`;
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
                        date: new Date(row.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
                        shipping_name: row.shipping_name,
                        shipping_phone: row.shipping_phone,
                        shipping_address: row.shipping_address,
                        payment_method: row.payment_method,
                        slip_image: row.slip_image,
                        tracking_number: row.tracking_number,
                        items: []
                    };
                }
                if (row.product_name) {
                    grouped[row.order_id].items.push({
                        name: row.product_name,
                        image: row.product_image,
                        quantity: row.quantity,
                        lens_type: row.lens_type,
                        unit_price: row.unit_price
                    });
                }
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
                    badgeClass = 'badge-completed';
                    statusText = 'สำเร็จ';
                } else if (order.status === 'cancelled') {
                    badgeClass = 'badge-cancelled';
                    statusText = 'ยกเลิกแล้ว';
                }

                let primaryActionHtml = '';
                let cancelActionHtml = '';

                if (order.status === 'pending' || order.status === 'payment_review') {
                    primaryActionHtml = `<button class="btn-order-action btn-confirm" onclick="updateOrderStatus(${order.id}, 'paid')"><ion-icon name="checkmark-outline"></ion-icon> ยืนยันชำระเงิน</button>`;
                    cancelActionHtml = `<button class="btn-order-action btn-cancel" onclick="updateOrderStatus(${order.id}, 'cancelled')"><ion-icon name="close-outline"></ion-icon> ยกเลิก</button>`;
                } else if (order.status === 'paid') {
                    primaryActionHtml = `<button class="btn-order-action btn-ship" onclick="updateOrderStatus(${order.id}, 'shipped')"><ion-icon name="paper-plane-outline"></ion-icon> ส่งสินค้าแล้ว</button>`;
                    cancelActionHtml = `<button class="btn-order-action btn-cancel" onclick="updateOrderStatus(${order.id}, 'cancelled')"><ion-icon name="close-outline"></ion-icon> ยกเลิก</button>`;
                } else if (order.status === 'shipped') {
                    primaryActionHtml = `<button class="btn-order-action btn-confirm" onclick="updateOrderStatus(${order.id}, 'completed')"><ion-icon name="checkmark-done-outline"></ion-icon> ปิดงานสำเร็จ</button>`;
                }

                // Delete order button available for all orders (especially cancelled orders)
                const deleteActionHtml = `<button class="btn-order-action btn-delete" onclick="deleteOrder(${order.id})" title="ลบคำสั่งซื้อ #${order.id} ออกจากระบบ"><ion-icon name="trash-outline"></ion-icon> ลบออเดอร์</button>`;

                let slipAdminHtml = '';
                if (order.slip_image) {
                    slipAdminHtml = `
                        <a href="javascript:void(0)" onclick="viewOrderSlip('${order.slip_image}')" style="display:inline-flex; align-items:center; gap:0.25rem; background-color:#ebf8ff; border:1px solid #bee3f8; color:#2b6cb0; border-radius:6px; padding:0.2rem 0.5rem; font-size:0.75rem; font-weight:600; text-decoration:none; cursor:pointer; white-space:nowrap;">
                            <ion-icon name="image-outline"></ion-icon> ดูสลิปโอนเงิน
                        </a>`;
                }

                let trackingAdminHtml = '';
                if (order.tracking_number) {
                    trackingAdminHtml = `
                        <span style="font-size:0.75rem; color:#2d3748; background:#edf2f7; border:1px solid var(--border-color); padding:0.2rem 0.5rem; border-radius:6px; display:inline-flex; align-items:center; gap:0.25rem; font-weight:600; white-space:nowrap;">
                            <ion-icon name="paper-plane-outline" style="color:#4a5568;"></ion-icon> เลขพัสดุ: ${escapeHtml(order.tracking_number)}
                        </span>`;
                }

                let paymentText = 'เก็บเงินปลายทาง';
                let paymentIcon = '💵';
                if (order.payment_method === 'BankTransfer') {
                    paymentText = 'โอนผ่านธนาคาร';
                    paymentIcon = '🏦';
                } else if (order.payment_method === 'QRCode') {
                    paymentText = 'สแกน QR-code';
                    paymentIcon = '📱';
                } else if (order.payment_method === 'CreditCard') {
                    paymentText = 'บัตรเครดิต / เดบิต';
                    paymentIcon = '💳';
                }

                const glassesHtml = order.items.length > 0
                    ? order.items.map(item => `
                        <div class="order-glasses-item">
                            <div class="order-glasses-thumb">
                                <img src="${escapeHtml(item.image || '/assets/round.svg')}" alt="${escapeHtml(item.name)}">
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div class="order-glasses-name">${escapeHtml(item.name)}</div>
                                <span class="order-glasses-qty">จำนวน: <strong>${item.quantity}</strong> ชิ้น</span>
                            </div>
                        </div>
                    `).join('')
                    : '<span style="color:var(--text-secondary); font-size:0.8rem;">- ไม่มีข้อมูลสินค้า -</span>';

                const lensesHtml = order.items.length > 0
                    ? order.items.map(item => `
                        <div class="order-lens-item">
                            <span class="order-lens-tag">
                                <ion-icon name="sparkles-outline" style="color: #3b82f6;"></ion-icon>
                                <span>${escapeHtml(item.lens_type || 'เลนส์ทั่วไป')}</span>
                            </span>
                        </div>
                    `).join('')
                    : '<span style="color:var(--text-secondary); font-size:0.8rem;">-</span>';

                tr.innerHTML = `
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <span class="order-id-badge">#${order.id}</span>
                        <div class="order-date-text">${order.date}</div>
                    </td>
                    <td style="vertical-align: top;">
                        <div class="order-customer-box">
                            <div class="order-customer-title">
                                <ion-icon name="person-circle-outline" style="font-size: 1.15rem; color: var(--accent); flex-shrink: 0;"></ion-icon>
                                <span>${escapeHtml(order.customer)}</span>
                            </div>
                            ${order.shipping_name ? `
                            <div class="order-meta-info">
                                <div style="margin-bottom: 0.2rem;">
                                    <strong style="color: var(--text-primary);">ผู้รับ:</strong> ${escapeHtml(order.shipping_name)} 
                                    <span style="color: var(--text-secondary); margin-left: 0.35rem;">(${escapeHtml(order.shipping_phone)})</span>
                                </div>
                                <div style="margin-bottom: 0.35rem; color: var(--text-secondary); line-height: 1.4;">
                                    <strong style="color: var(--text-primary);">ที่อยู่:</strong> ${escapeHtml(order.shipping_address)}
                                </div>
                                <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-top: 0.35rem;">
                                    <span class="order-payment-pill">
                                        <span>${paymentIcon}</span> <span>${paymentText}</span>
                                    </span>
                                    ${slipAdminHtml}
                                    ${trackingAdminHtml}
                                </div>
                            </div>
                            ` : ''}
                        </div>
                    </td>
                    <td style="vertical-align: top;">
                        ${glassesHtml}
                    </td>
                    <td style="vertical-align: top;">
                        ${lensesHtml}
                    </td>
                    <td style="text-align: right; vertical-align: top; white-space: nowrap;">
                        <div style="font-weight: 700; font-family: var(--font-heading); font-size: 1rem; color: var(--text-primary);">
                            ${parseFloat(order.total).toLocaleString()} ฿
                        </div>
                    </td>
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <span class="badge ${badgeClass}">${statusText}</span>
                    </td>
                    <td style="vertical-align: top;">
                        <div class="order-action-btns">
                            ${primaryActionHtml}
                            ${cancelActionHtml}
                            ${deleteActionHtml}
                        </div>
                    </td>
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

async function deleteOrder(orderId) {
    if (!confirm(`คุณต้องการลบคำสั่งซื้อ #${orderId} ออกจากระบบอย่างถาวรใช่หรือไม่?\n\n* ข้อมูลจะถูกลบออกทั้งหมด และจะคืนสต็อกสินค้าอัตโนมัติหากออเดอร์ยังไม่ถูกยกเลิก`)) {
        return;
    }
    try {
        const res = await adminApiFetch(`/api/admin/orders/${orderId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            alert('ลบคำสั่งซื้อเรียบร้อยแล้ว');
            fetchOrdersList();
            fetchDashboardMetrics();
        } else {
            alert(data.message || 'ไม่สามารถลบคำสั่งซื้อได้');
        }
    } catch (error) {
        console.error('Error deleting order:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
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
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <span class="order-id-badge">#${p.id}</span>
                    </td>
                    <td style="vertical-align: top;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
                            <span style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">${escapeHtml(p.name)}</span>
                            <button class="btn-stock-edit" onclick="editProductName(${p.id}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')" title="เปลี่ยนชื่อแว่นตานี้">
                                <ion-icon name="pencil-outline"></ion-icon> แก้ไขชื่อ
                            </button>
                        </div>
                    </td>
                    <td style="vertical-align: top; color: var(--text-secondary);">${escapeHtml(p.brand)}</td>
                    <td style="vertical-align: top; white-space: nowrap;">${p.category === 'Optical' ? 'แว่นสายตา' : 'แว่นกันแดด'}</td>
                    <td style="vertical-align: top; font-family: var(--font-heading); text-align: right; font-weight: 700; white-space: nowrap;">${parseFloat(p.price).toLocaleString()} ฿</td>
                    <td style="vertical-align: top; text-align: center; white-space: nowrap;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
                            <span class="badge ${p.stock <= 5 ? 'badge-cancelled' : 'badge-paid'}" style="font-size: 0.78rem;">${p.stock} ชิ้น</span>
                            <button class="btn-stock-edit" onclick="editProductStock(${p.id}, ${p.stock}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')" title="แก้ไขจำนวนสินค้าคงเหลือ">
                                <ion-icon name="sync-outline"></ion-icon> แก้สต็อก
                            </button>
                        </div>
                    </td>
                    <td style="vertical-align: top; text-align: center; white-space: nowrap;">
                        <button class="btn-order-action btn-delete" onclick="deleteProduct(${p.id})" title="ลบสินค้าออกจากระบบ">
                            <ion-icon name="trash-outline"></ion-icon> ลบออก
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

async function editProductName(productId, currentName) {
    const newName = prompt(`แก้ไขชื่อรุ่นแว่นตา (รหัส #${productId}):`, currentName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) {
        alert('กรุณากรอกชื่อแว่นตา');
        return;
    }
    if (trimmed === currentName) return;

    try {
        const res = await adminApiFetch(`/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed })
        });
        const data = await res.json();
        if (data.success) {
            alert('เปลี่ยนชื่อแว่นตาสำเร็จ! ชื่อใหม่จะแสดงผลเชื่อมโยงกันทุกหน้าในระบบทันที');
            fetchStockProducts();
            fetchDashboardMetrics();
        } else {
            alert(data.message || 'ไม่สามารถแก้ไขชื่อแว่นตาได้');
        }
    } catch (error) {
        console.error('Error editing product name:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
}
window.editProductName = editProductName;

async function editProductStock(productId, currentStock, productName) {
    const newStockStr = prompt(`แก้ไขจำนวนคงเหลือในสต็อกของ "${productName}" (รหัส #${productId}):`, currentStock);
    if (newStockStr === null) return;
    const stockVal = parseInt(newStockStr.trim(), 10);
    if (isNaN(stockVal) || stockVal < 0) {
        alert('กรุณากรอกจำนวนสต็อกเป็นตัวเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
        return;
    }
    if (stockVal === currentStock) return;

    try {
        const res = await adminApiFetch(`/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: stockVal })
        });
        const data = await res.json();
        if (data.success) {
            alert(`อัปเดตสต็อกแว่นตา "${productName}" เป็น ${stockVal} ชิ้น เรียบร้อยแล้ว!`);
            fetchStockProducts();
            fetchDashboardMetrics();
        } else {
            alert(data.message || 'ไม่สามารถแก้ไขสต็อกสินค้าได้');
        }
    } catch (error) {
        console.error('Error editing product stock:', error);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
}
window.editProductStock = editProductStock;

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
            
            if (!data.reviews || data.reviews.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 3rem;">ยังไม่มีความคิดเห็นของลูกค้าในระบบ</td></tr>`;
                return;
            }
            
            data.reviews.forEach(rev => {
                const row = document.createElement('tr');
                
                // Construct stars text
                let stars = '';
                for (let i = 0; i < rev.rating; i++) stars += '⭐';

                const avatarSrc = rev.avatar_url && rev.avatar_url.startsWith('data:image/')
                    ? rev.avatar_url
                    : (rev.avatar_url && (rev.avatar_url.startsWith('/uploads/') || rev.avatar_url.startsWith('/assets/'))
                        ? rev.avatar_url
                        : '/assets/logo-192.png');

                const dateObj = new Date(rev.created_at);
                const dateStr = dateObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
                const timeStr = dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
                
                row.innerHTML = `
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <span class="order-id-badge">#REV-${rev.id}</span>
                    </td>
                    <td style="vertical-align: top; white-space: nowrap;">
                        <div class="review-user-box">
                            <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(rev.user_name)}" class="review-user-avatar" onerror="this.src='/assets/logo-192.png'">
                            <span class="review-user-name">${escapeHtml(rev.user_name)}</span>
                        </div>
                    </td>
                    <td style="vertical-align: top;">
                        <div style="font-weight: 600; font-size: 0.86rem; color: var(--text-primary); line-height: 1.35; word-break: keep-all;">
                            ${escapeHtml(rev.product_name || 'แว่นตาทั่วไป')}
                        </div>
                    </td>
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <span class="review-stars-badge">
                            <span style="letter-spacing: -1px;">${stars}</span>
                            <span style="color: var(--text-secondary); font-size: 0.72rem; margin-left: 0.2rem;">(${rev.rating}/5)</span>
                        </span>
                    </td>
                    <td style="vertical-align: top;">
                        <div class="review-comment-box">
                            <ion-icon name="chatbubble-ellipses-outline"></ion-icon>
                            <div class="review-comment-content">${escapeHtml(rev.comment || 'ไม่มีข้อความ')}</div>
                        </div>
                    </td>
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <div style="font-size: 0.82rem; font-weight: 500; color: var(--text-primary);">${dateStr}</div>
                        <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.15rem;">${timeStr}</div>
                    </td>
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <button class="btn-order-action btn-delete" onclick="deleteReview(${rev.id})" title="ลบความคิดเห็นนี้">
                            <ion-icon name="trash-outline"></ion-icon> ลบความคิดเห็น
                        </button>
                    </td>
                `;
                tableBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error fetching reviews:', error);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red; padding: 2rem;">เกิดข้อผิดพลาดในการโหลดข้อมูลรีวิว</td></tr>`;
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
