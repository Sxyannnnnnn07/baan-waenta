// Baan Waenta - Dedicated Login Page Script
let currentMode = 'login';
let csrfToken = null;
let googleClientId = null;
let googleTokenClient = null;

// 1. Initialize Page
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initPasswordStrengthListener();
    initForgotPasswordListeners();
    loadRememberedCredentials();
    await checkInitialSession();
    initGoogleAuth();
});

// Load Remembered Credentials
function loadRememberedCredentials() {
    const rememberedUser = localStorage.getItem('baan_waenta_remember_user');
    const rememberedPass = localStorage.getItem('baan_waenta_remember_pass');
    const rememberCheckbox = document.getElementById('remember-me-checkbox');
    const usernameInput = document.getElementById('auth-username');
    const passwordInput = document.getElementById('auth-password');

    if (rememberedUser && rememberCheckbox && usernameInput) {
        usernameInput.value = rememberedUser;
        rememberCheckbox.checked = true;
        if (rememberedPass && passwordInput) {
            try {
                passwordInput.value = atob(rememberedPass);
            } catch (_) {
                passwordInput.value = rememberedPass;
            }
        }
    }
}

// 2. Theme Handling
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
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.setAttribute('name', theme === 'dark' ? 'sunny-outline' : 'moon-outline');
    }
}

// 3. Check Initial Session (If already logged in, redirect)
async function checkInitialSession() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (response.ok) {
            const data = await response.json();
            if (data && data.user) {
                showAlert('success', `ยินดีต้อนรับคุณ ${data.user.name} กำลังพาเข้าสู่เว็บไซต์...`);
                setTimeout(() => {
                    if (data.user.role === 'admin') {
                        window.location.href = '/admin.html';
                    } else {
                        window.location.href = '/';
                    }
                }, 800);
            }
        }
    } catch (_) {
        // Not logged in or offline, continue on login page
    }
}

// 4. Tab Switcher
function setAuthTab(mode) {
    currentMode = mode;
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const emailGroup = document.getElementById('email-field-group');
    const emailInput = document.getElementById('auth-email');
    const submitBtn = document.getElementById('auth-submit-btn');
    const usernameLabel = document.getElementById('auth-username-label');
    const strengthContainer = document.getElementById('password-strength-container');
    const googleBtnText = document.getElementById('google-btn-text');
    const alertBox = document.getElementById('auth-alert-box');

    if (alertBox) alertBox.style.display = 'none';

    if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        emailGroup.style.display = 'none';
        emailInput.removeAttribute('required');
        usernameLabel.innerText = 'ชื่อผู้ใช้งาน หรือ อีเมล';
        submitBtn.innerHTML = '<ion-icon name="log-in-outline"></ion-icon> เข้าสู่ระบบ';
        if (googleBtnText) googleBtnText.innerText = 'เข้าสู่ระบบด้วย Google';
        if (strengthContainer) strengthContainer.style.display = 'none';
        const rememberContainer = document.getElementById('remember-me-container');
        if (rememberContainer) rememberContainer.style.display = 'flex';
    } else {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        emailGroup.style.display = 'block';
        emailInput.setAttribute('required', 'true');
        usernameLabel.innerText = 'ชื่อผู้ใช้งาน (Username)';
        submitBtn.innerHTML = '<ion-icon name="person-add-outline"></ion-icon> สมัครสมาชิก';
        if (googleBtnText) googleBtnText.innerText = 'สมัครสมาชิกด้วย Google';
        if (strengthContainer) {
            strengthContainer.style.display = 'block';
            resetStrengthUI();
        }
        const rememberContainer = document.getElementById('remember-me-container');
        if (rememberContainer) rememberContainer.style.display = 'none';
    }
}

// 5. Password Visibility Toggle
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('ion-icon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.setAttribute('name', 'eye-off-outline');
    } else {
        input.type = 'password';
        icon.setAttribute('name', 'eye-outline');
    }
}

// 6. Form Submission
async function handleAuthSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const email = document.getElementById('auth-email').value.trim();

    if (currentMode === 'register') {
        // Registration validations
        if (password.length < 8) {
            showAlert('error', 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป');
            return;
        }
        if (!(/[a-z]/.test(password) && /[A-Z]/.test(password))) {
            showAlert('error', 'รหัสผ่านต้องประกอบด้วยตัวอักษรพิมพ์ใหญ่ (A-Z) และพิมพ์เล็ก (a-z)');
            return;
        }
        if (!(/\d/.test(password) || /[!-/:-@[-`{-~]/.test(password))) {
            showAlert('error', 'รหัสผ่านต้องมีตัวเลขหรืออักขระพิเศษอย่างน้อย 1 ตัว');
            return;
        }
    }

    const url = currentMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = currentMode === 'login' 
        ? { username, password } 
        : { username, email, password };

    const submitBtn = document.getElementById('auth-submit-btn');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<ion-icon name="sync-outline" class="spin"></ion-icon> กำลังตรวจสอบ...';

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.success) {
            if (currentMode === 'login') {
                const rememberCheckbox = document.getElementById('remember-me-checkbox');
                if (rememberCheckbox && rememberCheckbox.checked) {
                    localStorage.setItem('baan_waenta_remember_user', username);
                    localStorage.setItem('baan_waenta_remember_pass', btoa(password));
                } else {
                    localStorage.removeItem('baan_waenta_remember_user');
                    localStorage.removeItem('baan_waenta_remember_pass');
                }

                showAlert('success', 'เข้าสู่ระบบสำเร็จ! กำลังพาท่านไปหน้าหลัก...');
                setTimeout(() => {
                    if (data.user && data.user.role === 'admin') {
                        window.location.href = '/admin.html';
                    } else {
                        window.location.href = '/';
                    }
                }, 700);
            } else {
                showAlert('success', 'สมัครสมาชิกสำเร็จเรียบร้อย! กำลังสลับไปหน้าเข้าสู่ระบบ...');
                setTimeout(() => {
                    setAuthTab('login');
                    document.getElementById('auth-username').value = username;
                    document.getElementById('auth-password').value = '';
                }, 1200);
            }
        } else {
            showAlert('error', data.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        }
    } catch (error) {
        console.error('Auth error:', error);
        showAlert('error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อตรวจสอบสิทธิ์ได้');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// 7. Alert Helper
function showAlert(type, message) {
    const alertBox = document.getElementById('auth-alert-box');
    const alertMsg = document.getElementById('auth-alert-message');
    const alertIcon = document.getElementById('auth-alert-icon');
    
    if (!alertBox || !alertMsg) return;

    alertBox.className = `auth-alert ${type}`;
    alertMsg.innerText = message;
    if (alertIcon) {
        alertIcon.setAttribute('name', type === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline');
    }
    alertBox.style.display = 'flex';
}

// 8. Password Strength Meter
function initPasswordStrengthListener() {
    const passwordInput = document.getElementById('auth-password');
    if (!passwordInput) return;

    passwordInput.addEventListener('input', (e) => {
        if (currentMode !== 'register') return;
        const val = e.target.value;
        const result = evaluatePasswordStrength(val);
        updateStrengthUI(result);
    });
}

function evaluatePasswordStrength(password) {
    let score = 0;
    const rules = {
        length: password.length >= 8,
        hasCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
        hasDigitOrSymbol: /\d/.test(password) || /[!-/:-@[-`{-~]/.test(password)
    };

    if (rules.length) score += 1;
    if (rules.hasCase) score += 1;
    if (rules.hasDigitOrSymbol) score += 1;
    if (password.length >= 12 && rules.hasCase && rules.hasDigitOrSymbol) score += 1;

    return { score, rules };
}

function updateStrengthUI(result) {
    const label = document.getElementById('strength-label');
    const bars = document.querySelectorAll('.strength-bar');

    updateRuleItem(document.getElementById('rule-length'), result.rules.length);
    updateRuleItem(document.getElementById('rule-case'), result.rules.hasCase);
    updateRuleItem(document.getElementById('rule-digit-symbol'), result.rules.hasDigitOrSymbol);

    const labels = ['ว่างเปล่า', 'ง่ายมาก', 'ปานกลาง', 'ปลอดภัย', 'แข็งแรงมาก'];
    const colors = ['var(--border-color)', '#ef4444', '#f59e0b', '#10b981', '#059669'];

    if (label) {
        label.innerText = labels[result.score] || 'ว่างเปล่า';
        label.style.color = colors[result.score] || 'var(--text-secondary)';
    }

    bars.forEach((bar, idx) => {
        if (idx < result.score) {
            bar.style.backgroundColor = colors[result.score];
        } else {
            bar.style.backgroundColor = 'var(--border-color)';
        }
    });
}

function updateRuleItem(el, isMet) {
    if (!el) return;
    const icon = el.querySelector('ion-icon');
    if (isMet) {
        el.style.color = '#10b981';
        if (icon) icon.setAttribute('name', 'checkmark-circle');
    } else {
        el.style.color = 'var(--text-secondary)';
        if (icon) icon.setAttribute('name', 'ellipse-outline');
    }
}

function resetStrengthUI() {
    const label = document.getElementById('strength-label');
    const bars = document.querySelectorAll('.strength-bar');
    if (label) {
        label.innerText = 'ว่างเปล่า';
        label.style.color = 'var(--text-secondary)';
    }
    bars.forEach(b => b.style.backgroundColor = 'var(--border-color)');
    updateRuleItem(document.getElementById('rule-length'), false);
    updateRuleItem(document.getElementById('rule-case'), false);
    updateRuleItem(document.getElementById('rule-digit-symbol'), false);
}

// 9. Google Sign-In SDK
(function() {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
})();

async function initGoogleAuth() {
    if (typeof google === 'undefined') {
        setTimeout(initGoogleAuth, 150);
        return;
    }
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            googleClientId = config.googleClientId;
            if (googleClientId && window.google) {
                googleTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: googleClientId,
                    scope: 'email profile openid',
                    callback: handleGoogleTokenResponse,
                    error_callback: (err) => {
                        console.error('Google OAuth error_callback:', err);
                        let msg = 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Google';
                        const errType = err ? (err.type || err.error || '') : '';
                        const errMsg = err ? (err.message || '') : '';
                        if (errType === 'popup_closed' || errMsg.includes('Popup window closed') || errMsg.includes('popup_closed')) {
                            msg = 'หน้าต่างเลือกบัญชี Google ถูกปิดก่อนดำเนินการเสร็จสิ้น (หากไม่ได้ปิดเอง โปรดตรวจสอบว่าเบราว์เซอร์หรือ AdBlock ไม่ได้บล็อกหน้าต่าง)';
                        } else if (errType === 'popup_failed_to_open' || errMsg.includes('popup_failed_to_open')) {
                            msg = 'เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัปสำหรับเว็บไซต์นี้';
                        } else if (errType === 'access_denied') {
                            msg = 'คุณยกเลิกการให้สิทธิ์เข้าสู่ระบบ Google';
                        } else if (errMsg) {
                            msg = errMsg;
                        }
                        showAlert('error', msg);
                    }
                });
            }
        }
    } catch (e) {
        console.warn('initGoogleAuth failed:', e);
    }
}

function handleGoogleSignIn() {
    if (googleTokenClient) {
        googleTokenClient.requestAccessToken();
    } else {
        showAlert('error', 'ระบบล็อกอิน Google กำลังเตรียมพร้อม กรุณาลองใหม่อีกครั้ง');
        initGoogleAuth();
    }
}

async function handleGoogleTokenResponse(tokenResponse) {
    console.log('Google Auth Response:', tokenResponse);
    if (!tokenResponse) {
        showAlert('error', 'ไม่ได้รับการตอบกลับจาก Google');
        return;
    }
    if (tokenResponse.error) {
        console.error('Google token error:', tokenResponse.error);
        if (tokenResponse.error === 'popup_closed_by_user' || tokenResponse.error === 'popup_closed') {
            showAlert('error', 'หน้าต่างเลือกบัญชี Google ถูกปิดก่อนดำเนินการเสร็จสิ้น');
        } else if (tokenResponse.error === 'access_denied') {
            showAlert('error', 'คุณยกเลิกการให้สิทธิ์เข้าสู่ระบบ Google');
        } else {
            showAlert('error', 'Google Error: ' + (tokenResponse.error_description || tokenResponse.error));
        }
        return;
    }
    if (!tokenResponse.access_token) {
        showAlert('error', 'ไม่ได้รับ Access Token จาก Google');
        return;
    }

    try {
        showAlert('info', 'ยืนยันตัวตนผ่าน Google สำเร็จ กำลังเข้าสู่ระบบ...');
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ access_token: tokenResponse.access_token })
        });
        const data = await res.json();
        if (data.success) {
            showAlert('success', 'เข้าสู่ระบบสำเร็จ! กำลังไปหน้าหลัก...');
            sessionStorage.removeItem('baan_waenta_guest');
            if (data.user) {
                localStorage.setItem('baan_waenta_user', JSON.stringify(data.user));
            }
            setTimeout(() => {
                const targetUrl = (data.user && data.user.role === 'admin') ? '/admin.html' : '/';
                window.location.replace(targetUrl);
            }, 500);
        } else {
            console.error('Server /api/auth/google rejected:', data);
            showAlert('error', data.message || 'การเข้าสู่ระบบด้วย Google ไม่สำเร็จ');
        }
    } catch (e) {
        console.error('Google token exchange error:', e);
        showAlert('error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ผ่าน Google ได้ (' + (e.message || 'network error') + ')');
    }
}

function allowGuestMode(event) {
    if (event) event.preventDefault();
    sessionStorage.setItem('baan_waenta_guest', 'true');
    window.location.href = '/';
}

// ==========================================
// 12. Forgot Password (Email OTP) Flow
// ==========================================
let forgotPasswordEmail = '';
let forgotOtpExpiryTimer = null;
let forgotResendCooldownTimer = null;

function initForgotPasswordListeners() {
    const newPassInput = document.getElementById('forgot-new-password');
    const confirmPassInput = document.getElementById('forgot-confirm-password');

    if (newPassInput) {
        newPassInput.addEventListener('input', updateForgotStrengthUI);
    }
    if (confirmPassInput) {
        confirmPassInput.addEventListener('input', updateForgotStrengthUI);
    }
}

function openForgotPasswordModal() {
    const backdrop = document.getElementById('forgot-modal-backdrop');
    if (!backdrop) return;

    // Reset steps
    document.getElementById('forgot-step-1').style.display = 'block';
    document.getElementById('forgot-step-2').style.display = 'none';
    document.getElementById('forgot-step-3').style.display = 'none';
    hideForgotModalAlert();

    // Reset inputs
    const emailInput = document.getElementById('forgot-email-input');
    const otpInput = document.getElementById('forgot-otp-input');
    const newPass = document.getElementById('forgot-new-password');
    const confirmPass = document.getElementById('forgot-confirm-password');
    if (otpInput) otpInput.value = '';
    if (newPass) newPass.value = '';
    if (confirmPass) confirmPass.value = '';

    // If login input has an email, pre-fill it
    const loginUserVal = document.getElementById('auth-username')?.value.trim() || '';
    if (emailInput) {
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginUserVal)) {
            emailInput.value = loginUserVal;
        } else {
            emailInput.value = '';
        }
    }

    // Reset strength UI
    resetForgotStrengthUI();

    backdrop.style.display = 'flex';
    requestAnimationFrame(() => {
        backdrop.classList.add('show');
    });

    setTimeout(() => {
        if (emailInput && !emailInput.value) emailInput.focus();
    }, 100);
}

function closeForgotPasswordModal() {
    const backdrop = document.getElementById('forgot-modal-backdrop');
    if (!backdrop) return;

    backdrop.classList.remove('show');
    setTimeout(() => {
        backdrop.style.display = 'none';
    }, 250);

    if (forgotOtpExpiryTimer) {
        clearInterval(forgotOtpExpiryTimer);
        forgotOtpExpiryTimer = null;
    }
    if (forgotResendCooldownTimer) {
        clearInterval(forgotResendCooldownTimer);
        forgotResendCooldownTimer = null;
    }
}

function handleBackdropClick(event) {
    if (event.target && event.target.id === 'forgot-modal-backdrop') {
        closeForgotPasswordModal();
    }
}

function showForgotModalAlert(type, message) {
    const box = document.getElementById('forgot-modal-alert');
    const msg = document.getElementById('forgot-modal-alert-msg');
    const icon = document.getElementById('forgot-modal-alert-icon');
    if (!box || !msg) return;

    box.className = `auth-alert ${type}`;
    msg.innerText = message;
    if (icon) {
        icon.setAttribute('name', type === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline');
    }
    box.style.display = 'flex';
}

function hideForgotModalAlert() {
    const box = document.getElementById('forgot-modal-alert');
    if (box) box.style.display = 'none';
}

async function handleRequestOtp(e) {
    if (e) e.preventDefault();
    const emailInput = document.getElementById('forgot-email-input');
    const email = emailInput?.value.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showForgotModalAlert('error', 'กรุณากรอกรูปแบบอีเมลให้ถูกต้อง');
        return;
    }

    const btn = document.getElementById('forgot-request-otp-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<ion-icon name="sync-outline" class="spin"></ion-icon> กำลังส่งรหัส OTP...';
    hideForgotModalAlert();

    try {
        const response = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email })
        });
        const data = await response.json();

        if (data.success) {
            forgotPasswordEmail = email;
            document.getElementById('forgot-step-1').style.display = 'none';
            document.getElementById('forgot-step-2').style.display = 'block';
            document.getElementById('forgot-target-email-display').innerText = email;

            startOtpCountdown(15 * 60);
            startResendCooldown(60);

            if (data.devOtp) {
                console.log('%c[DEV MODE] Password Reset OTP: ' + data.devOtp, 'background: #2563eb; color: #fff; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
                showForgotModalAlert('success', `ส่งรหัส OTP เรียบร้อยแล้ว (โหมดทดสอบ Dev OTP: ${data.devOtp})`);
                const otpInput = document.getElementById('forgot-otp-input');
                if (otpInput) otpInput.value = data.devOtp;
            } else {
                showForgotModalAlert('success', 'เราได้ส่งรหัส OTP 6 หลักไปยังอีเมลของคุณเรียบร้อยแล้ว');
            }

            setTimeout(() => {
                document.getElementById('forgot-otp-input')?.focus();
            }, 100);
        } else {
            showForgotModalAlert('error', data.message || 'ไม่สามารถส่งรหัส OTP ได้');
        }
    } catch (err) {
        console.error('Request OTP error:', err);
        showForgotModalAlert('error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function startOtpCountdown(durationSeconds) {
    if (forgotOtpExpiryTimer) clearInterval(forgotOtpExpiryTimer);
    let remaining = durationSeconds;
    const display = document.getElementById('forgot-countdown-display');

    function update() {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        if (display) {
            display.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        if (remaining <= 0) {
            clearInterval(forgotOtpExpiryTimer);
            forgotOtpExpiryTimer = null;
            if (display) display.innerText = 'หมดอายุแล้ว';
            showForgotModalAlert('error', 'รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่อีกครั้ง');
        }
        remaining--;
    }

    update();
    forgotOtpExpiryTimer = setInterval(update, 1000);
}

function startResendCooldown(cooldownSeconds) {
    if (forgotResendCooldownTimer) clearInterval(forgotResendCooldownTimer);
    let remaining = cooldownSeconds;
    const resendBtn = document.getElementById('forgot-resend-otp-btn');
    if (!resendBtn) return;

    resendBtn.disabled = true;

    function update() {
        if (remaining <= 0) {
            clearInterval(forgotResendCooldownTimer);
            forgotResendCooldownTimer = null;
            resendBtn.disabled = false;
            resendBtn.innerText = 'ส่งรหัสอีกครั้ง';
        } else {
            resendBtn.innerText = `ส่งรหัสอีกครั้ง (${remaining}s)`;
            remaining--;
        }
    }

    update();
    forgotResendCooldownTimer = setInterval(update, 1000);
}

async function handleResendOtp() {
    if (!forgotPasswordEmail) return;
    const resendBtn = document.getElementById('forgot-resend-otp-btn');
    if (resendBtn) resendBtn.disabled = true;

    try {
        const response = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email: forgotPasswordEmail })
        });
        const data = await response.json();
        if (data.success) {
            startOtpCountdown(15 * 60);
            startResendCooldown(60);
            if (data.devOtp) {
                console.log('%c[DEV MODE] Resent Password Reset OTP: ' + data.devOtp, 'background: #2563eb; color: #fff; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
                showForgotModalAlert('success', `ส่งรหัส OTP ใหม่เรียบร้อยแล้ว (Dev OTP: ${data.devOtp})`);
                const otpInput = document.getElementById('forgot-otp-input');
                if (otpInput) otpInput.value = data.devOtp;
            } else {
                showForgotModalAlert('success', 'ส่งรหัส OTP ใหม่อีกครั้งแล้ว กรุณาตรวจสอบอีเมล');
            }
        } else {
            showForgotModalAlert('error', data.message || 'ไม่สามารถส่งรหัสใหม่ได้');
            if (resendBtn) resendBtn.disabled = false;
        }
    } catch (err) {
        showForgotModalAlert('error', 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
        if (resendBtn) resendBtn.disabled = false;
    }
}

function updateForgotStrengthUI() {
    const password = document.getElementById('forgot-new-password')?.value || '';
    const confirm = document.getElementById('forgot-confirm-password')?.value || '';

    const rules = {
        length: password.length >= 8,
        hasCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
        hasDigitOrSymbol: /\d/.test(password) || /[!-/:-@[-`{-~]/.test(password),
        match: password.length > 0 && password === confirm
    };

    let score = 0;
    if (rules.length) score += 1;
    if (rules.hasCase) score += 1;
    if (rules.hasDigitOrSymbol) score += 1;
    if (password.length >= 12 && rules.hasCase && rules.hasDigitOrSymbol) score += 1;

    const label = document.getElementById('forgot-strength-label');
    const bars = document.querySelectorAll('.forgot-strength-bar');

    updateRuleItem(document.getElementById('forgot-rule-length'), rules.length);
    updateRuleItem(document.getElementById('forgot-rule-case'), rules.hasCase);
    updateRuleItem(document.getElementById('forgot-rule-digit-symbol'), rules.hasDigitOrSymbol);
    updateRuleItem(document.getElementById('forgot-rule-match'), rules.match);

    const labels = ['ว่างเปล่า', 'ง่ายมาก', 'ปานกลาง', 'ปลอดภัย', 'แข็งแรงมาก'];
    const colors = ['var(--border-color)', '#ef4444', '#f59e0b', '#10b981', '#059669'];

    if (label) {
        label.innerText = labels[score] || 'ว่างเปล่า';
        label.style.color = colors[score] || 'var(--text-secondary)';
    }

    bars.forEach((bar, idx) => {
        if (idx < score) {
            bar.style.backgroundColor = colors[score];
        } else {
            bar.style.backgroundColor = 'var(--border-color)';
        }
    });
}

function resetForgotStrengthUI() {
    const label = document.getElementById('forgot-strength-label');
    const bars = document.querySelectorAll('.forgot-strength-bar');
    if (label) {
        label.innerText = 'ว่างเปล่า';
        label.style.color = 'var(--text-secondary)';
    }
    bars.forEach(bar => {
        bar.style.backgroundColor = 'var(--border-color)';
    });
    updateRuleItem(document.getElementById('forgot-rule-length'), false);
    updateRuleItem(document.getElementById('forgot-rule-case'), false);
    updateRuleItem(document.getElementById('forgot-rule-digit-symbol'), false);
    updateRuleItem(document.getElementById('forgot-rule-match'), false);
}

async function handleResetPasswordSubmit(e) {
    if (e) e.preventDefault();
    const otp = document.getElementById('forgot-otp-input')?.value.trim() || '';
    const newPassword = document.getElementById('forgot-new-password')?.value || '';
    const confirmPassword = document.getElementById('forgot-confirm-password')?.value || '';

    if (!/^\d{6}$/.test(otp)) {
        showForgotModalAlert('error', 'กรุณากรอกรหัส OTP เป็นตัวเลข 6 หลัก');
        return;
    }

    if (newPassword.length < 8) {
        showForgotModalAlert('error', 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษรขึ้นไป');
        return;
    }

    if (!(/[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword))) {
        showForgotModalAlert('error', 'รหัสผ่านต้องมีทั้งตัวพิมพ์ใหญ่ (A-Z) และพิมพ์เล็ก (a-z)');
        return;
    }

    if (!(/\d/.test(newPassword) || /[!-/:-@[-`{-~]/.test(newPassword))) {
        showForgotModalAlert('error', 'รหัสผ่านต้องมีตัวเลขหรือสัญลักษณ์พิเศษอย่างน้อย 1 ตัว');
        return;
    }

    if (newPassword !== confirmPassword) {
        showForgotModalAlert('error', 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
        return;
    }

    const btn = document.getElementById('forgot-reset-submit-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<ion-icon name="sync-outline" class="spin"></ion-icon> กำลังตั้งรหัสผ่านใหม่...';
    hideForgotModalAlert();

    try {
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                email: forgotPasswordEmail,
                otp,
                newPassword
            })
        });
        const data = await response.json();

        if (data.success) {
            if (forgotOtpExpiryTimer) clearInterval(forgotOtpExpiryTimer);
            if (forgotResendCooldownTimer) clearInterval(forgotResendCooldownTimer);

            // Switch to Step 3: Success
            document.getElementById('forgot-step-2').style.display = 'none';
            document.getElementById('forgot-step-3').style.display = 'block';
            hideForgotModalAlert();
        } else {
            showForgotModalAlert('error', data.message || 'ไม่สามารถตั้งรหัสผ่านใหม่ได้');
        }
    } catch (err) {
        console.error('Reset password error:', err);
        showForgotModalAlert('error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อเปลี่ยนรหัสผ่านได้');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function finishForgotPasswordAndLogin() {
    closeForgotPasswordModal();
    setAuthTab('login');

    const usernameInput = document.getElementById('auth-username');
    const passwordInput = document.getElementById('auth-password');
    if (usernameInput && forgotPasswordEmail) {
        usernameInput.value = forgotPasswordEmail;
    }
    if (passwordInput) {
        passwordInput.value = '';
        setTimeout(() => passwordInput.focus(), 300);
    }

    showAlert('success', 'เปลี่ยนรหัสผ่านใหม่เรียบร้อยแล้ว กรุณากรอกรหัสผ่านใหม่เพื่อเข้าสู่ระบบ');
}

