// Baan Waenta - Dedicated Login Page Script
let currentMode = 'login';
let csrfToken = null;
let googleClientId = null;
let googleTokenClient = null;

// 1. Initialize Page
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initPasswordStrengthListener();
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
                    callback: handleGoogleTokenResponse
                });
            }
        }
    } catch (_) {}
}

function handleGoogleSignIn() {
    if (googleTokenClient) {
        googleTokenClient.requestAccessToken();
    } else {
        showAlert('error', 'ระบบล็อกอิน Google ยังไม่ได้ตั้งค่า Google Client ID ในเซิร์ฟเวอร์');
    }
}

async function handleGoogleTokenResponse(tokenResponse) {
    if (tokenResponse && tokenResponse.access_token) {
        try {
            showAlert('success', 'ยืนยันตัวตนผ่าน Google สำเร็จ กำลังเข้าสู่ระบบ...');
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ access_token: tokenResponse.access_token })
            });
            const data = await res.json();
            if (data.success) {
                setTimeout(() => {
                    if (data.user && data.user.role === 'admin') {
                        window.location.href = '/admin.html';
                    } else {
                        window.location.href = '/';
                    }
                }, 700);
            } else {
                showAlert('error', data.message || 'การเข้าสู่ระบบด้วย Google ไม่สำเร็จ');
            }
        } catch (e) {
            showAlert('error', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ผ่าน Google ได้');
        }
    }
}

function allowGuestMode(event) {
    if (event) event.preventDefault();
    sessionStorage.setItem('baan_waenta_guest', 'true');
    window.location.href = '/';
}

