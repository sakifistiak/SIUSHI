const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const usersService = require('./services/users');
const finance = require('./services/finance');
const dues = require('./services/dues');
const clients = require('./services/clients');
const storage = require('./storage');
const { getWhatsAppStatus, requestNewPairingCode } = require('./whatsapp');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser('siusho_cookie_secret_2026'));

// Auth Middlewares
function requireAdmin(req, res, next) {
    if (req.cookies.siusho_admin === 'authenticated') {
        return next();
    }
    return res.redirect('/admin/login');
}

function requireUser(req, res, next) {
    const userId = req.cookies.siusho_user;
    if (userId) {
        const user = usersService.getUserById(userId);
        if (user && user.status !== 'suspended') {
            req.user = user;
            return next();
        }
    }
    return res.redirect('/?tab=login');
}

// ---------------- 1. PUBLIC ROUTES ----------------

// Landing page with Login / Register tabs
app.get('/', (req, res) => {
    // If already logged in, redirect to user dashboard
    const userId = req.cookies.siusho_user;
    if (userId && usersService.getUserById(userId)) {
        return res.redirect('/dashboard');
    }

    const tab = req.query.tab || 'register';
    const error = req.query.error || '';
    const success = req.query.success || '';
    const settings = usersService.getSettings();

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <title>SIUSHO - All-in-One Personal AI Assistant</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root { --bg: #0b1329; --card: #152243; --card2: #1e293b; --primary: #38bdf8; --primary-hover: #0ea5e9; --text: #f8fafc; --muted: #94a3b8; --border: #334155; --success: #34d399; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
        .container { width: 100%; max-width: 480px; }
        .header { text-align: center; margin-bottom: 24px; }
        .header h1 { font-size: 32px; font-weight: 800; color: var(--primary); letter-spacing: -0.5px; }
        .header p { color: var(--muted); font-size: 14px; margin-top: 6px; }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .tabs { display: flex; background: var(--card2); border-radius: 12px; padding: 4px; margin-bottom: 24px; }
        .tab-btn { flex: 1; padding: 10px; border: none; background: transparent; color: var(--muted); font-weight: 600; font-size: 14px; border-radius: 8px; cursor: pointer; text-decoration: none; text-align: center; }
        .tab-btn.active { background: var(--primary); color: #0b1329; }
        .form-group { margin-bottom: 16px; text-align: left; }
        label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
        input { width: 100%; padding: 12px 14px; background: var(--card2); border: 1px solid var(--border); border-radius: 10px; color: #fff; font-size: 14px; outline: none; transition: 0.2s; }
        input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2); }
        .submit-btn { width: 100%; padding: 12px; background: var(--primary); color: #0b1329; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; transition: 0.2s; margin-top: 8px; }
        .submit-btn:hover { background: var(--primary-hover); }
        .alert-error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; text-align: left; }
        .alert-success { background: rgba(52, 211, 153, 0.15); border: 1px solid var(--success); color: #a7f3d0; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; text-align: left; }
        .features { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 13px; color: var(--muted); line-height: 1.6; text-align: left; }
        .features li { margin-bottom: 6px; list-style: none; display: flex; align-items: center; gap: 8px; }
        .admin-link { display: inline-block; margin-top: 20px; color: #64748b; font-size: 12px; text-decoration: none; }
        .admin-link:hover { color: var(--primary); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 SIUSHO Assistant</h1>
            <p>আপনার ব্যক্তিগত AI এক্সিকিউটিভ অ্যাসিস্ট্যান্ট প্ল্যাটফর্ম</p>
        </div>

        <div class="card">
            ${error ? `<div class="alert-error">⚠️ ${error}</div>` : ''}
            ${success ? `<div class="alert-success">✅ ${success}</div>` : ''}

            <div class="tabs">
                <a href="/?tab=register" class="tab-btn ${tab === 'register' ? 'active' : ''}">রেজিস্ট্রেশন (ফ্রি)</a>
                <a href="/?tab=login" class="tab-btn ${tab === 'login' ? 'active' : ''}">লগইন</a>
            </div>

            ${tab === 'register' ? `
                <form action="/register" method="POST">
                    <div class="form-group">
                        <label>আপনার পুরো নাম</label>
                        <input type="text" name="name" placeholder="যেমন: সাকিব হাসান" required>
                    </div>
                    <div class="form-group">
                        <label>মোবাইল নম্বর (WhatsApp)</label>
                        <input type="text" name="phone" placeholder="যেমন: 017xxxxxxxx" required>
                    </div>
                    <div class="form-group">
                        <label>ইমেইল (ঐচ্ছিক)</label>
                        <input type="email" name="email" placeholder="example@mail.com">
                    </div>
                    <div class="form-group">
                        <label>পাসওয়ার্ড</label>
                        <input type="password" name="password" placeholder="কমপক্ষে ৬ ডিজিটের পাসওয়ার্ড" required>
                    </div>
                    <button type="submit" class="submit-btn">অ্যাকাউন্ট তৈরি করুন (ফ্রি) 🚀</button>
                </form>
            ` : `
                <form action="/login" method="POST">
                    <div class="form-group">
                        <label>মোবাইল নম্বর অথবা ইমেইল</label>
                        <input type="text" name="login" placeholder="017xxxxxxxx বা ইমেইল" required>
                    </div>
                    <div class="form-group">
                        <label>পাসওয়ার্ড</label>
                        <input type="password" name="password" placeholder="আপনার পাসওয়ার্ড" required>
                    </div>
                    <button type="submit" class="submit-btn">ড্যাশবোর্ডে লগইন করুন 🔑</button>
                </form>
            `}

            <div class="features">
                <p style="font-weight: 700; color: #cbd5e1; margin-bottom: 8px;">✨ যা যা করতে পারবেন:</p>
                <li>💸 WhatsApp ও Telegram-এ দৈনিক আয়-ব্যয় ট্র্যাকিং</li>
                <li>🤝 দেনা-পাওনা ও বকেয়া খাতা অটোমেশন</li>
                <li>👤 ক্লায়েন্ট প্রজেক্ট ও ডেলিভারি ডেডলাইন ব্রিফিং</li>
                <li>🚨 পরীক্ষা ও ভাইভার নাছোড়বান্দা অ্যালার্ম</li>
                <li>🎙️ ভয়েস মেসেজ শুনে যেকোনো কাজ পরিচালনা</li>
            </div>
        </div>

        <a href="/admin/login" class="admin-link">🔒 অ্যাডমিন কন্ট্রোল প্যানেল লগইন</a>
    </div>
</body>
</html>`;
    res.send(html);
});

// Process Web User Registration
app.post('/register', (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !phone || !password) {
        return res.redirect('/?tab=register&error=' + encodeURIComponent('দয়া করে নাম, মোবাইল নম্বর এবং পাসওয়ার্ড পূরণ করুন।'));
    }

    const result = usersService.registerWebUser({ name, email, phone, password });
    if (!result.success) {
        return res.redirect('/?tab=register&error=' + encodeURIComponent(result.error));
    }

    // Auto login
    res.cookie('siusho_user', result.user.id, { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true });
    return res.redirect('/dashboard');
});

// Process Web User Login
app.post('/login', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        return res.redirect('/?tab=login&error=' + encodeURIComponent('ইমেইল/নম্বর এবং পাসওয়ার্ড দিন।'));
    }

    const result = usersService.authenticateUser(login, password);
    if (!result.success) {
        return res.redirect('/?tab=login&error=' + encodeURIComponent(result.error));
    }

    res.cookie('siusho_user', result.user.id, { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true });
    return res.redirect('/dashboard');
});

// User Logout
app.get('/logout', (req, res) => {
    res.clearCookie('siusho_user');
    res.redirect('/');
});

// ---------------- 2. USER DASHBOARD (PROTECTED) ----------------
app.get('/dashboard', requireUser, (req, res) => {
    const user = req.user;
    const dailySummary = finance.getDailySummary(user.id);
    const monthlySummary = finance.getMonthlySummary(user.id);
    const duesList = dues.getActiveDues(user.id);
    const pendingProjects = clients.getPendingProjects(user.id);
    const syncCode = usersService.generateLinkCode(user.id);

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <title>User Dashboard - SIUSHO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root { --bg: #0b1329; --card: #152243; --card2: #1e293b; --primary: #38bdf8; --border: #334155; --text: #f8fafc; --muted: #94a3b8; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 20px; line-height: 1.5; }
        .container { max-width: 900px; margin: 0 auto; }
        .navbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 25px; }
        .logo { font-size: 22px; font-weight: 800; color: var(--primary); }
        .nav-right { display: flex; gap: 12px; align-items: center; }
        .badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; background: #065f46; color: #34d399; }
        .logout-btn { color: #f87171; text-decoration: none; font-size: 13px; font-weight: 600; padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
        .card h3 { font-size: 15px; color: var(--muted); margin-bottom: 8px; font-weight: 600; }
        .card .value { font-size: 28px; font-weight: 800; color: #fff; }
        .sync-box { background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid var(--primary); border-radius: 16px; padding: 22px; margin-bottom: 25px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 20px; }
        .code-display { font-size: 32px; font-weight: 900; letter-spacing: 4px; color: var(--primary); background: #0b1329; padding: 8px 18px; border-radius: 10px; border: 1px solid var(--border); }
        .section-title { font-size: 18px; font-weight: 700; margin-bottom: 15px; color: #fff; }
        .item-list { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 15px; margin-bottom: 25px; }
        .item-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
        .item-row:last-child { border-bottom: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="navbar">
            <div class="logo">🤖 SIUSHO Assistant</div>
            <div class="nav-right">
                <span class="badge">প্ল্যান: ${user.plan.toUpperCase()}</span>
                <span>স্বাগতম, <b>${user.name}</b></span>
                <a href="/logout" class="logout-btn">লগআউট 🚪</a>
            </div>
        </div>

        <!-- 6-Digit Sync Box for WhatsApp & Telegram -->
        <div class="sync-box">
            <div>
                <h2 style="font-size: 18px; margin-bottom: 4px;">📲 আপনার WhatsApp ও Telegram সিঙ্ক করুন</h2>
                <p style="font-size: 13px; color: var(--muted);">আপনার WhatsApp বা Telegram থেকে বটকে <b>/link ${syncCode}</b> লিখে পাঠান।</p>
                <div style="margin-top: 8px; font-size: 12px; color: #34d399;">
                    ${user.whatsappJid ? '✅ WhatsApp সংযুক্ত' : '⚠️ WhatsApp সংযুক্ত নয়'} | 
                    ${user.telegramChatId ? '✅ Telegram সংযুক্ত' : '⚠️ Telegram সংযুক্ত নয়'}
                </div>
            </div>
            <div class="code-display">${syncCode}</div>
        </div>

        <!-- Financial Summary Cards -->
        <div class="grid">
            <div class="card">
                <h3>আজকের মোট আয়</h3>
                <div class="value" style="color: #34d399;">+${dailySummary.totalIncome.toLocaleString()} ৳</div>
            </div>
            <div class="card">
                <h3>আজকের মোট ব্যয়</h3>
                <div class="value" style="color: #f87171;">-${dailySummary.totalExpense.toLocaleString()} ৳</div>
            </div>
            <div class="card">
                <h3>আজকের নেট ব্যালেন্স</h3>
                <div class="value" style="color: var(--primary);">${dailySummary.balance >= 0 ? '+' : ''}${dailySummary.balance.toLocaleString()} ৳</div>
            </div>
            <div class="card">
                <h3>চলতি মাসের মোট ব্যয়</h3>
                <div class="value" style="color: #fbbf24;">${monthlySummary.totalExpense.toLocaleString()} ৳</div>
            </div>
        </div>

        <!-- Dues & Loans Overview -->
        <div class="section-title">🤝 সক্রিয় দেনা-পাওনা খাতা (${duesList.length}টি)</div>
        <div class="item-list">
            ${duesList.map(d => `
                <div class="item-row">
                    <span>${d.type === 'receivable' ? '🟢 পাওনা (পাবেন)' : '🔴 দেনা (দিতে হবে)'}: <b>${d.personName}</b> ${d.note ? `(${d.note})` : ''}</span>
                    <span style="font-weight: 700;">${d.amount.toLocaleString()} ৳</span>
                </div>
            `).join('')}
            ${duesList.length === 0 ? '<p style="color: var(--muted); font-size: 13px;">বর্তমানে কোনো পেন্ডিং দেনা বা পাওনা নেই।</p>' : ''}
        </div>

        <!-- Ongoing Client Projects -->
        <div class="section-title">📋 চলমান ক্লায়েন্ট প্রজেক্ট ও ডেডলাইন (${pendingProjects.length}টি)</div>
        <div class="item-list">
            ${pendingProjects.map(p => `
                <div class="item-row">
                    <div>
                        <b>${p.clientName}</b> - ${p.projectTask}
                        <div style="font-size: 12px; color: var(--muted);">ডেডলাইন: ${p.deadlineReadable}</div>
                    </div>
                    <span style="color: #38bdf8; font-weight: 600;">${p.fee ? `${p.fee} ৳` : 'Pending'}</span>
                </div>
            `).join('')}
            ${pendingProjects.length === 0 ? '<p style="color: var(--muted); font-size: 13px;">বর্তমানে কোনো পেন্ডিং প্রজেক্ট নেই।</p>' : ''}
        </div>
    </div>
</body>
</html>`;
    res.send(html);
});

// ---------------- 3. ADMIN PORTAL (SECURED WITH PASSWORD) ----------------

// Admin Login Page
app.get('/admin/login', (req, res) => {
    if (req.cookies.siusho_admin === 'authenticated') {
        return res.redirect('/admin');
    }
    const error = req.query.error || '';

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <title>Admin Login - SIUSHO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #070d1e; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .box { background: #131d36; border: 1px solid #1e293b; border-radius: 20px; padding: 32px; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        h1 { font-size: 24px; color: #38bdf8; margin-bottom: 8px; text-align: center; }
        p { color: #94a3b8; font-size: 13px; margin-bottom: 24px; text-align: center; }
        .field { margin-bottom: 16px; }
        label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #cbd5e1; }
        input { width: 100%; padding: 12px; background: #0b1329; border: 1px solid #334155; border-radius: 10px; color: #fff; font-size: 14px; outline: none; }
        input:focus { border-color: #38bdf8; }
        button { width: 100%; padding: 12px; background: #38bdf8; color: #070d1e; border: none; border-radius: 10px; font-weight: 800; font-size: 15px; cursor: pointer; margin-top: 8px; }
        .error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 10px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
    </style>
</head>
<body>
    <div class="box">
        <h1>🔒 Admin Control</h1>
        <p>সিস্টেম ও WhatsApp হোস্টিং অ্যাডমিন প্যানেল</p>
        ${error ? `<div class="error">⚠️ ${error}</div>` : ''}
        <form action="/admin/login" method="POST">
            <div class="field">
                <label>Admin Username</label>
                <input type="text" name="username" placeholder="admin" required>
            </div>
            <div class="field">
                <label>Admin Password</label>
                <input type="password" name="password" placeholder="••••••••" required>
            </div>
            <button type="submit">লগইন করুন 🔐</button>
        </form>
    </div>
</body>
</html>`;
    res.send(html);
});

// Admin Login Action
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (usersService.authenticateAdmin(username, password)) {
        res.cookie('siusho_admin', 'authenticated', { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true });
        return res.redirect('/admin');
    }
    return res.redirect('/admin/login?error=' + encodeURIComponent('ভুল অ্যাডমিন ইউজারনেম বা পাসওয়ার্ড!'));
});

// Admin Logout
app.get('/admin/logout', (req, res) => {
    res.clearCookie('siusho_admin');
    res.redirect('/admin/login');
});

// Request new pairing code inside Admin Panel
app.get('/admin/request-code', requireAdmin, async (req, res) => {
    const botNumber = process.env.BOT_PHONE_NUMBER;
    await requestNewPairingCode(botNumber);
    res.redirect('/admin');
});

// Update user plan or status from Admin Panel
app.post('/admin/user-update', requireAdmin, (req, res) => {
    const { userId, plan, status } = req.body;
    usersService.updateUserPlan(userId, { plan, status });
    res.redirect('/admin');
});

// Update pricing settings from Admin Panel
app.post('/admin/settings-update', requireAdmin, (req, res) => {
    const { proPrice, businessPrice, adminPassword } = req.body;
    const settings = usersService.getSettings();
    if (proPrice) settings.pricing.pro.price = parseInt(proPrice, 10);
    if (businessPrice) settings.pricing.business.price = parseInt(businessPrice, 10);
    if (adminPassword && adminPassword.trim().length >= 6) {
        usersService.updateSettings({ ...settings, adminPassword: adminPassword.trim() });
    } else {
        usersService.updateSettings(settings);
    }
    res.redirect('/admin?saved=1');
});

// Return live WhatsApp status as JSON for Admin auto-poll
app.get('/admin/status-json', requireAdmin, (req, res) => {
    res.json(getWhatsAppStatus());
});

// Main Admin Panel
app.get('/admin', requireAdmin, (req, res) => {
    const { isConnected, currentPairingCode, currentQRCodeDataUrl, lastPairingError } = getWhatsAppStatus();
    const allUsers = usersService.getAllUsers();
    const settings = usersService.getSettings();
    const saved = req.query.saved === '1';

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <title>Admin Panel - SIUSHO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root { --bg: #070d1e; --card: #111a33; --border: #1e293b; --primary: #38bdf8; --muted: #94a3b8; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: #fff; padding: 25px; }
        .container { max-width: 1100px; margin: 0 auto; }
        .navbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: 800; color: var(--primary); }
        .btn-logout { color: #f87171; text-decoration: none; font-size: 13px; font-weight: 700; padding: 6px 14px; background: rgba(239, 68, 68, 0.15); border-radius: 8px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 30px; }
        @media(max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 18px; padding: 24px; }
        .card h2 { font-size: 18px; color: var(--primary); margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
        .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
        .badge-green { background: #065f46; color: #34d399; }
        .badge-yellow { background: #78350f; color: #fbbf24; }
        .btn-primary { display: inline-block; background: var(--primary); color: #070d1e; font-weight: 700; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-size: 13px; border: none; cursor: pointer; }
        .table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
        .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
        .table th { color: var(--muted); font-weight: 600; }
        select { background: #0b1329; border: 1px solid var(--border); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 12px; outline: none; }
        input[type="number"], input[type="password"] { background: #0b1329; border: 1px solid var(--border); color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 13px; width: 100%; margin-top: 6px; margin-bottom: 12px; outline: none; }
        .qr-box { text-align: center; margin: 15px 0; }
        .qr-box img { width: 220px; height: 220px; border-radius: 12px; background: #fff; padding: 8px; box-shadow: 0 0 20px rgba(56, 189, 248, 0.3); }
        .code-box { background: #0284c7; color: #fff; font-size: 26px; font-weight: 900; letter-spacing: 4px; padding: 12px; border-radius: 10px; margin: 12px 0; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="navbar">
            <div class="logo">⚙️ SIUSHO Master Admin</div>
            <div>
                <a href="/admin/logout" class="btn-logout">লগআউট 🚪</a>
            </div>
        </div>

        ${saved ? `<div style="background: rgba(52, 211, 153, 0.15); border: 1px solid #34d399; color: #a7f3d0; padding: 12px; border-radius: 10px; margin-bottom: 20px;">✅ সেটিংস সফলভাবে সেভ করা হয়েছে!</div>` : ''}

        <div class="grid-2">
            <!-- 1. Main WhatsApp Bot Host Control -->
            <div class="card">
                <h2>
                    <span>📱 মূল WhatsApp Bot হোস্ট</span>
                    <span class="status-badge ${isConnected ? 'badge-green' : 'badge-yellow'}">
                        ${isConnected ? 'Online & Linked ✅' : 'Waiting for Scan ⏳'}
                    </span>
                </h2>
                <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">এই WhatsApp অ্যাকাউন্টটি পুরো সিস্টেমের কেন্দ্রীয় বট হোস্ট হিসেবে চলবে।</p>

                ${!isConnected ? `
                    ${currentQRCodeDataUrl ? `
                        <div class="qr-box">
                            <p style="font-size: 13px; color: #38bdf8; font-weight: 600; margin-bottom: 8px;">📲 ক্যামেরা দিয়ে স্ক্যান করে হোস্ট লিঙ্ক করুন:</p>
                            <img src="${currentQRCodeDataUrl}" />
                        </div>
                    ` : '<p style="color: #fbbf24; font-size: 14px;">QR কোড তৈরি হচ্ছে...</p>'}

                    <div style="margin-top: 15px; border-top: 1px solid var(--border); padding-top: 12px;">
                        <p style="font-size: 12px; color: var(--muted);">অথবা ৮-সংখ্যার কোড দিয়ে লিংক করতে:</p>
                        <div class="code-box">${currentPairingCode || 'Generating...'}</div>
                        <a href="/admin/request-code" class="btn-primary">🔄 নতুন পেয়ারিং কোড / QR রিফ্রেশ</a>
                    </div>
                ` : `
                    <div style="padding: 16px; background: rgba(52, 211, 153, 0.1); border-radius: 12px; border: 1px solid #065f46; margin-top: 15px;">
                        <p style="color: #34d399; font-weight: 700; font-size: 15px;">🎉 WhatsApp বট সফলভাবে সচল আছে!</p>
                        <p style="font-size: 13px; color: var(--muted); margin-top: 4px;">যেকোনো ব্যবহারকারী এখন WhatsApp-এ মেসেজ দিলে স্বয়ংক্রিয়ভাবে সার্ভিস পাবে।</p>
                    </div>
                `}
            </div>

            <!-- 2. Pricing & Platform Settings -->
            <div class="card">
                <h2>💰 সাবস্ক্রিপশন ও প্রাইসিং সেটিংস</h2>
                <form action="/admin/settings-update" method="POST">
                    <label style="font-size: 13px; color: var(--muted);">Pro Executive প্ল্যান ফি (টাকা/মাস)</label>
                    <input type="number" name="proPrice" value="${settings.pricing.pro?.price || 299}">

                    <label style="font-size: 13px; color: var(--muted);">Business VIP প্ল্যান ফি (টাকা/মাস)</label>
                    <input type="number" name="businessPrice" value="${settings.pricing.business?.price || 799}">

                    <label style="font-size: 13px; color: var(--muted);">নতুন অ্যাডমিন পাসওয়ার্ড পরিবর্তন (ঐচ্ছিক)</label>
                    <input type="password" name="adminPassword" placeholder="নতুন পাসওয়ার্ড দিন">

                    <button type="submit" class="btn-primary">সেটিংস সংরক্ষণ করুন 💾</button>
                </form>
            </div>
        </div>

        <!-- 3. SaaS Registered Users Manager -->
        <div class="card">
            <h2>👥 সমস্ত নিবন্ধিত ব্যবহারকারী (${allUsers.length} জন)</h2>
            <div style="overflow-x: auto;">
                <table class="table">
                    <thead>
                        <tr>
                            <th>নাম</th>
                            <th>মোবাইল / ইমেইল</th>
                            <th>সংযুক্ত চ্যানেল</th>
                            <th>প্ল্যান</th>
                            <th>স্ট্যাটাস</th>
                            <th>অ্যাকশন</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allUsers.map(u => `
                            <tr>
                                <td><b>${u.name}</b></td>
                                <td>${u.phone || u.email || 'N/A'}</td>
                                <td>
                                    ${u.whatsappJid ? '📱 WhatsApp ' : ''}
                                    ${u.telegramChatId ? '🤖 Telegram' : ''}
                                    ${!u.whatsappJid && !u.telegramChatId ? '<span style="color:#64748b;">কানেক্টেড নয়</span>' : ''}
                                </td>
                                <td>
                                    <form action="/admin/user-update" method="POST" style="display:inline;">
                                        <input type="hidden" name="userId" value="${u.id}">
                                        <select name="plan" onchange="this.form.submit()">
                                            <option value="free" ${u.plan === 'free' ? 'selected' : ''}>Free</option>
                                            <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro (Paid)</option>
                                            <option value="business" ${u.plan === 'business' ? 'selected' : ''}>Business</option>
                                        </select>
                                </td>
                                <td>
                                        <select name="status" onchange="this.form.submit()">
                                            <option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option>
                                            <option value="suspended" ${u.status === 'suspended' ? 'selected' : ''}>Suspended</option>
                                        </select>
                                    </form>
                                </td>
                                <td>
                                    <span style="font-size: 11px; color: var(--muted);">${new Date(u.createdAt).toLocaleDateString()}</span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    <script>
        setInterval(async () => {
            try {
                const res = await fetch('/admin/status-json');
                const data = await res.json();
                const wasConnected = ${isConnected ? 'true' : 'false'};
                if (data.isConnected !== wasConnected) {
                    window.location.reload();
                }
            } catch(e) {}
        }, 3500);
    </script>
</body>
</html>`;
    res.send(html);
});

module.exports = app;
