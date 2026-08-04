// Admin State
let adminUser = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminAccess();
    fetchDashboardMetrics();
    fetchOrdersList();
    fetchStockProducts();
    fetchReviewsList();
});

// 1. Guard check for Admin Role
function checkAdminAccess() {
    const savedUser = localStorage.getItem('baan_waenta_user');
    if (!savedUser) {
        alert('กรุณาเข้าสู่ระบบในฐานะผู้ดูแลระบบก่อนครับ');
        window.location.href = '/';
        return;
    }
    
    adminUser = JSON.parse(savedUser);
    if (adminUser.role !== 'admin') {
        alert('บัญชีนี้ไม่มีสิทธิ์เข้าถึงแดชบอร์ดหลังบ้าน');
        window.location.href = '/';
        return;
    }
}

// 2. Fetch and render Analytics Indicators
async function fetchDashboardMetrics() {
    try {
        const res = await fetch('/api/admin/analytics');
        const data = await res.json();
        
        if (data.success) {
            const m = data.metrics;
            document.getElementById('metric-sales').innerText = `${parseFloat(m.totalSales).toLocaleString()} ฿`;
            document.getElementById('metric-orders').innerText = m.totalOrders;
            document.getElementById('metric-conversion').innerText = `${m.conversionRate}%`;
            document.getElementById('metric-customers').innerText = m.totalCustomers;

            // Render popular try-on list
            renderPopularTryOnList(m.popularTryOn);
        }
    } catch (error) {
        console.error('Error fetching analytics:', error);
    }
}

function renderPopularTryOnList(popularItems) {
    const listDiv = document.getElementById('popular-tryon-list');
    listDiv.innerHTML = '';

    // Calculate max count for rendering progress bars
    const maxCount = Math.max(...popularItems.map(i => i.count)) || 1;

    popularItems.forEach(item => {
        const row = document.createElement('div');
        row.style.marginBottom = '1rem';
        
        const pct = (item.count / maxCount) * 100;

        row.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem;">
                <span>${item.shape}</span>
                <span style="font-weight: 600;">${item.count} ครั้ง</span>
            </div>
            <div style="width: 100%; height: 8px; background-color: var(--accent-light); border-radius: 4px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background-color: var(--accent); border-radius: 4px;"></div>
            </div>
        `;
        listDiv.appendChild(row);
    });
}

// 3. Fetch and Render Customer Orders
async function fetchOrdersList() {
    const tableBody = document.getElementById('orders-list-table');
    try {
        const res = await fetch('/api/admin/orders');
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
                } else if (order.status === 'shipped') {
                    badgeClass = 'badge-shipped';
                    statusText = 'จัดส่งเรียบร้อย';
                }

                // Dropdown to update order status
                const actionHtml = order.status !== 'shipped' 
                    ? `<button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="updateOrderStatus(${order.id}, 'shipped')">ส่งสินค้าแล้ว</button>`
                    : `<span style="color: green; font-size: 0.8rem; font-weight: 600;">ส่งแล้ว</span>`;

                let slipAdminHtml = '';
                if (order.slip_image) {
                    slipAdminHtml = `<div style="margin-top:0.4rem;">
                        <a href="${order.slip_image}" target="_blank" style="display:inline-flex; align-items:center; gap:0.25rem; background-color:#ebf8ff; border:1px solid #bee3f8; color:#2b6cb0; border-radius:4px; padding:0.2rem 0.5rem; font-size:0.7rem; font-weight:600; text-decoration:none;">
                            <ion-icon name="image-outline"></ion-icon> ดูสลิปโอนเงิน
                        </a>
                    </div>`;
                }

                let trackingAdminHtml = '';
                if (order.tracking_number) {
                    trackingAdminHtml = `<div style="margin-top:0.35rem; font-size:0.75rem; color:#2d3748; background:#edf2f7; border:1px solid var(--border-color); padding:0.2rem 0.5rem; border-radius:6px; display:inline-flex; align-items:center; gap:0.25rem; font-weight:600;">
                        <ion-icon name="paper-plane-outline" style="color:#4a5568;"></ion-icon> เลขพัสดุ: ${order.tracking_number}
                    </div>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: 600;">#${order.id}</td>
                    <td>
                        <strong>${order.customer}</strong>
                        ${order.shipping_name ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.25rem; font-weight:normal; line-height:1.4;">
                            ชื่อผู้รับ: ${order.shipping_name}<br>
                            เบอร์โทร: ${order.shipping_phone}<br>
                            ที่อยู่: ${order.shipping_address}<br>
                            วิธีชำระเงิน: <span style="color:var(--accent); font-weight:600;">${order.payment_method === 'BankTransfer' ? 'โอนผ่านธนาคาร' : (order.payment_method === 'QRCode' ? 'สแกน QR-code' : 'เก็บเงินปลายทาง')}</span>
                            ${slipAdminHtml}
                            ${trackingAdminHtml}
                        </div>` : ''}
                    </td>
                    <td>${order.items.join('<br>')}</td>
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
        let trackingNumber = '';
        if (status === 'shipped') {
            trackingNumber = prompt('กรุณากรอกเลขพัสดุสำหรับออเดอร์นี้ (เช่น Flash Express: TH0123456789):');
            if (trackingNumber === null) return; // cancel
            trackingNumber = trackingNumber.trim();
        }

        const res = await fetch(`/api/admin/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, tracking_number: trackingNumber || null })
        });
        const data = await res.json();
        if (data.success) {
            alert('อัปเดตสถานะการส่งสินค้าสำเร็จ!');
            fetchOrdersList();
            fetchDashboardMetrics();
        }
    } catch (error) {
        console.error('Error updating order:', error);
    }
}

// 4. Fetch Stock Items
async function fetchStockProducts() {
    const tableBody = document.getElementById('products-list-table');
    try {
        const res = await fetch('/api/products');
        const data = await res.json();
        if (data.success) {
            tableBody.innerHTML = '';
            data.products.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${p.id}</td>
                    <td style="font-weight: 600;">${p.name}</td>
                    <td>${p.brand}</td>
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
    
    const name = document.getElementById('prod-name').value;
    const brand = document.getElementById('prod-brand').value;
    const category = document.getElementById('prod-category').value;
    const frame_shape = document.getElementById('prod-shape').value;
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseInt(document.getElementById('prod-stock').value);

    // Read the uploaded image file and convert to Base64
    const imageFileInput = document.getElementById('prod-image');
    let imgUrl = '';

    if (imageFileInput.files.length > 0) {
        const file = imageFileInput.files[0];
        imgUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.readAsDataURL(file);
        });
    } else {
        alert('กรุณาเลือกรูปภาพของแว่นตาด้วยครับ');
        return;
    }

    const payload = {
        name, brand, category, frame_shape,
        price, stock,
        image_url: imgUrl,
        tryon_image_url: imgUrl
    };

    try {
        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            alert('ลงขายแว่นตารุ่นใหม่เรียบร้อยแล้ว!');
            document.getElementById('add-product-form').reset();
            fetchStockProducts();
            fetchDashboardMetrics();
        } else {
            alert('ไม่สามารถเพิ่มแว่นตาได้: ' + data.error);
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
        const res = await fetch(`/api/products/${id}`, {
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
function handleLogout() {
    localStorage.removeItem('baan_waenta_user');
    alert('ออกจากระบบแอดมินแล้ว');
    window.location.href = '/';
}

// 7. Fetch and Render Reviews for Management
async function fetchReviewsList() {
    const tableBody = document.getElementById('reviews-list-table');
    if (!tableBody) return;
    
    try {
        const res = await fetch('/api/reviews');
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
                    <td>${rev.user_name}</td>
                    <td style="font-weight: 500;">${rev.product_name || 'แว่นตาทั่วไป'}</td>
                    <td><span style="color: #f6ad55;">${stars}</span> (${rev.rating}/5)</td>
                    <td style="max-width: 300px; white-space: normal; line-height: 1.4;">${rev.comment}</td>
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
        const res = await fetch(`/api/reviews/${id}`, {
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
