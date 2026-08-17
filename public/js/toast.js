// Baan Waenta - Modern Toast & Custom Notification System

(function() {
    // Create toast container if not present
    function getToastContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Show modern toast notification
     * @param {string} message - Text or HTML message
     * @param {'success'|'error'|'info'|'warning'} type - Notification type
     * @param {number} duration - Auto dismiss duration in ms (default 3500)
     */
    window.showToast = function(message, type = 'info', duration = 3500) {
        const container = getToastContainer();
        const toast = document.createElement('div');
        toast.className = `custom-toast ${type}`;

        let iconName = 'information-circle-outline';
        if (type === 'success') iconName = 'checkmark-circle-outline';
        if (type === 'error') iconName = 'alert-circle-outline';
        if (type === 'warning') iconName = 'warning-outline';

        toast.innerHTML = `
            <div class="toast-icon">
                <ion-icon name="${iconName}"></ion-icon>
            </div>
            <div class="toast-text">${message}</div>
            <button class="toast-close" onclick="this.parentElement.classList.add('hide'); setTimeout(() => this.parentElement.remove(), 300);">
                <ion-icon name="close-outline"></ion-icon>
            </button>
        `;

        container.appendChild(toast);

        if (duration > 0) {
            setTimeout(() => {
                if (toast && toast.parentElement) {
                    toast.classList.add('hide');
                    setTimeout(() => {
                        if (toast.parentElement) toast.remove();
                    }, 300);
                }
            }, duration);
        }
    };

    /**
     * Modern Custom Alert Modal replacing window.alert
     * @param {string} message - Message text
     * @param {string} title - Optional Title
     * @returns {Promise<void>}
     */
    window.customAlert = function(message, title = 'แจ้งเตือน') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-alert-overlay';

            const isSuccess = /สำเร็จ|เรียบร้อย|ยินดีต้อนรับ|ขอบคุณ/i.test(message);
            const isError = /ผิดพลาด|ไม่สำเร็จ|ไม่ถูกต้อง|ล้มเหลว|ถูกปฏิเสธ|ไม่มีสิทธิ์|กรุณา/i.test(message);
            const alertType = isSuccess ? 'success' : (isError ? 'error' : 'info');
            const iconName = isSuccess ? 'checkmark-circle' : (isError ? 'alert-circle' : 'information-circle');

            overlay.innerHTML = `
                <div class="custom-alert-box ${alertType}">
                    <div class="custom-alert-icon">
                        <ion-icon name="${iconName}"></ion-icon>
                    </div>
                    <div class="custom-alert-title">${title}</div>
                    <div class="custom-alert-msg">${message}</div>
                    <div class="custom-alert-actions">
                        <button class="custom-alert-btn primary" id="custom-alert-ok-btn">ตกลง</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const okBtn = overlay.querySelector('#custom-alert-ok-btn');
            const closeDialog = () => {
                overlay.remove();
                resolve();
            };

            okBtn.addEventListener('click', closeDialog);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeDialog();
            });
            okBtn.focus();
        });
    };

    /**
     * Modern Custom Confirm Modal replacing window.confirm
     * @param {string} message - Confirm question
     * @param {string} title - Optional Title
     * @returns {Promise<boolean>}
     */
    window.customConfirm = function(message, title = 'ยืนยันการทำรายการ') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-alert-overlay';

            overlay.innerHTML = `
                <div class="custom-alert-box info">
                    <div class="custom-alert-icon">
                        <ion-icon name="help-circle"></ion-icon>
                    </div>
                    <div class="custom-alert-title">${title}</div>
                    <div class="custom-alert-msg">${message}</div>
                    <div class="custom-alert-actions">
                        <button class="custom-alert-btn cancel" id="custom-confirm-cancel-btn">ยกเลิก</button>
                        <button class="custom-alert-btn primary" id="custom-confirm-ok-btn">ยืนยัน</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const okBtn = overlay.querySelector('#custom-confirm-ok-btn');
            const cancelBtn = overlay.querySelector('#custom-confirm-cancel-btn');

            const handleClose = (result) => {
                overlay.remove();
                resolve(result);
            };

            okBtn.addEventListener('click', () => handleClose(true));
            cancelBtn.addEventListener('click', () => handleClose(false));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) handleClose(false);
            });
            okBtn.focus();
        });
    };

    // Override native alert globally for all scripts
    window.alert = function(message) {
        if (typeof message !== 'string') message = String(message || '');
        const isSuccess = /สำเร็จ|เรียบร้อย|ยินดีต้อนรับ|ขอบคุณ|คัดลอก/i.test(message);
        const isError = /ผิดพลาด|ไม่สำเร็จ|ไม่ถูกต้อง|ล้มเหลว|ถูกปฏิเสธ|ไม่มีสิทธิ์|กรุณา|ระบุ/i.test(message);
        const type = isSuccess ? 'success' : (isError ? 'error' : 'info');
        window.showToast(message, type, 4000);
    };
})();
