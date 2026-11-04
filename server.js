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

// Common Developer-Grade CSS Stylesheet
const BASE_STYLES = `
:root {
    --bg: #090d16;
    --surface: #0f172a;
    --surface-hover: #162036;
    --surface-elevated: #1e293b;
    --border: #334155;
    --border-subtle: #1e293b;
    --primary: #2563eb;
    --primary-hover: #1d4ed8;
    --primary-focus: rgba(37, 99, 235, 0.35);
    --text: #f8fafc;
    --text-muted: #94a3b8;
    --text-subtle: #64748b;
    --success: #10b981;
    --success-bg: rgba(16, 185, 129, 0.1);
    --warning: #f59e0b;
    --warning-bg: rgba(245, 158, 11, 0.1);
    --danger: #ef4444;
    --danger-bg: rgba(239, 68, 68, 0.1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", sans-serif;
    background-color: var(--bg);
    color: var(--text);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
button, input, select {
    font-family: inherit;
}
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
}
.btn-primary {
    background-color: var(--primary);
    color: #ffffff;
}
.btn-primary:hover {
    background-color: var(--primary-hover);
}
.btn-secondary {
    background-color: var(--surface-elevated);
    border-color: var(--border);
    color: var(--text);
}
.btn-secondary:hover {
    background-color: var(--surface-hover);
}
.btn-danger-ghost {
    background-color: transparent;
    border-color: var(--border);
    color: #f87171;
}
.btn-danger-ghost:hover {
    background-color: var(--danger-bg);
    border-color: var(--danger);
}
.badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
}
.badge-green {
    background-color: var(--success-bg);
    border: 1px solid rgba(16, 185, 129, 0.25);
    color: var(--success);
}
.badge-amber {
    background-color: var(--warning-bg);
    border: 1px solid rgba(245, 158, 11, 0.25);
    color: var(--warning);
}
.badge-blue {
    background-color: rgba(37, 99, 235, 0.12);
    border: 1px solid rgba(37, 99, 235, 0.3);
    color: #93c5fd;
}
.badge-neutral {
    background-color: rgba(148, 163, 184, 0.1);
    border: 1px solid var(--border);
    color: var(--text-muted);
}
.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
}
.status-dot-green {
    background-color: var(--success);
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
}
.status-dot-amber {
    background-color: var(--warning);
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
}
.form-input {
    width: 100%;
    padding: 10px 12px;
    background-color: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-focus);
}
.form-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}
.alert {
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    gap: 10px;
}
.alert-error {
    background-color: var(--danger-bg);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
}
.alert-success {
    background-color: var(--success-bg);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #a7f3d0;
}
.table-container {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background-color: var(--surface);
}
.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
}
.data-table th {
    padding: 12px 16px;
    background-color: rgba(15, 23, 42, 0.9);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.data-table td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text);
}
.data-table tr:last-child td {
    border-bottom: none;
}
.data-table tr:hover td {
    background-color: rgba(255, 255, 255, 0.02);
}
`;

// Clean SVG Icons
const ICONS = {
    terminal: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
    lock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    arrowRight: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
    refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`,
    logout: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`,
    copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`
};

// ---------------- 1. PUBLIC ROUTES ----------------

// Landing page with Login / Register tabs
app.get('/', (req, res) => {
    const userId = req.cookies.siusho_user;
    if (userId && usersService.getUserById(userId)) {
        return res.redirect('/dashboard');
    }

    const tab = req.query.tab || 'register';
    const error = req.query.error || '';
    const success = req.query.success || '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SIUSHO - Enterprise Operations Platform</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        ${BASE_STYLES}
        .landing-nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 18px 32px;
            border-bottom: 1px solid var(--border-subtle);
            background-color: rgba(9, 13, 22, 0.85);
            backdrop-filter: blur(12px);
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: -0.02em;
        }
        .brand-badge {
            background-color: var(--surface-elevated);
            border: 1px solid var(--border);
            color: var(--text-muted);
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 4px;
            font-weight: 600;
        }
        .main-hero {
            max-width: 1080px;
            margin: 60px auto;
            padding: 0 24px;
            display: grid;
            grid-template-columns: 1.15fr 0.85fr;
            gap: 48px;
            align-items: center;
        }
        @media(max-width: 860px) {
            .main-hero {
                grid-template-columns: 1fr;
                margin: 30px auto;
                gap: 36px;
            }
        }
        .hero-headline {
            font-size: 38px;
            font-weight: 800;
            line-height: 1.15;
            letter-spacing: -0.03em;
            color: #ffffff;
            margin-bottom: 16px;
        }
        .hero-subhead {
            font-size: 15px;
            color: var(--text-muted);
            line-height: 1.6;
            margin-bottom: 28px;
        }
        .feature-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .feature-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            font-size: 14px;
            color: #cbd5e1;
        }
        .auth-card {
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 28px;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
        }
        .tab-switch {
            display: flex;
            background-color: var(--bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 3px;
            margin-bottom: 24px;
        }
        .tab-item {
            flex: 1;
            text-align: center;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            border-radius: 4px;
            transition: all 0.15s ease;
        }
        .tab-item.active {
            background-color: var(--surface-elevated);
            color: var(--text);
            border: 1px solid var(--border);
        }
        .form-group {
            margin-bottom: 16px;
        }
    </style>
</head>
<body>
    <nav class="landing-nav">
        <div class="brand">
            <span style="color: var(--primary);">${ICONS.terminal}</span>
            <span>SIUSHO</span>
            <span class="brand-badge">SYSTEM V2.4</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
            <span class="badge badge-green">
                <span class="status-dot status-dot-green"></span>
                Operational
            </span>
            <a href="/admin/login" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                ${ICONS.lock}
                Admin Access
            </a>
        </div>
    </nav>

    <div class="main-hero">
        <div>
            <div style="margin-bottom: 12px;">
                <span class="badge badge-blue">ENTERPRISE AUTOMATION GATEWAY</span>
            </div>
            <h1 class="hero-headline">Autonomous Operations Platform for Professionals</h1>
            <p class="hero-subhead">Unified double-entry financial ledger, client deliverable schedules, and background automation dispatched bi-directionally over WhatsApp and Telegram.</p>

            <div class="feature-list">
                <div class="feature-item">
                    <span>${ICONS.check}</span>
                    <span>Automated real-time income and expense ledger tracking.</span>
                </div>
                <div class="feature-item">
                    <span>${ICONS.check}</span>
                    <span>Comprehensive counterparty receivables and liabilities ledger.</span>
                </div>
                <div class="feature-item">
                    <span>${ICONS.check}</span>
                    <span>Client project workflow tracking and daily 9:00 AM status briefings.</span>
                </div>
                <div class="feature-item">
                    <span>${ICONS.check}</span>
                    <span>Direct conversational interface with natural language understanding.</span>
                </div>
            </div>
        </div>

        <div class="auth-card">
            ${error ? `<div class="alert alert-error">${error}</div>` : ''}
            ${success ? `<div class="alert alert-success">${success}</div>` : ''}

            <div class="tab-switch">
                <a href="/?tab=register" class="tab-item ${tab === 'register' ? 'active' : ''}">Create Account</a>
                <a href="/?tab=login" class="tab-item ${tab === 'login' ? 'active' : ''}">Sign In</a>
            </div>

            ${tab === 'register' ? `
                <form action="/register" method="POST">
                    <div class="form-group">
                        <label class="form-label">Full Name</label>
                        <input type="text" name="name" class="form-input" placeholder="e.g. Sakif Ishtiak" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">WhatsApp Mobile Number</label>
                        <input type="text" name="phone" class="form-input" placeholder="e.g. 017xxxxxxxx or 88017xxxxxxxx" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email Address (Optional)</label>
                        <input type="email" name="email" class="form-input" placeholder="user@domain.com">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" name="password" class="form-input" placeholder="Minimum 6 characters" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; padding: 11px; margin-top: 6px;">
                        Register Account
                    </button>
                </form>
            ` : `
                <form action="/login" method="POST">
                    <div class="form-group">
                        <label class="form-label">Mobile Number or Email</label>
                        <input type="text" name="login" class="form-input" placeholder="017xxxxxxxx or user@domain.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" name="password" class="form-input" placeholder="Enter your password" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; padding: 11px; margin-top: 6px;">
                        Authenticate & Continue
                    </button>
                </form>
            `}
        </div>
    </div>
</body>
</html>`;
    res.send(html);
});

// Process Web User Registration
app.post('/register', (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !phone || !password) {
        return res.redirect('/?tab=register&error=' + encodeURIComponent('Full name, phone number, and password are required.'));
    }

    const result = usersService.registerWebUser({ name, email, phone, password });
    if (!result.success) {
        return res.redirect('/?tab=register&error=' + encodeURIComponent(result.error));
    }

    res.cookie('siusho_user', result.user.id, { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true });
    return res.redirect('/dashboard');
});

// Process Web User Login
app.post('/login', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        return res.redirect('/?tab=login&error=' + encodeURIComponent('Login identifier and password are required.'));
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
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Dashboard - SIUSHO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        ${BASE_STYLES}
        .app-navbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 28px;
            background-color: var(--surface);
            border-bottom: 1px solid var(--border);
        }
        .app-container {
            max-width: 1100px;
            margin: 28px auto;
            padding: 0 24px;
        }
        .sync-banner {
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-left: 4px solid var(--primary);
            border-radius: 8px;
            padding: 20px 24px;
            margin-bottom: 28px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 18px;
        }
        .code-display {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            background-color: var(--bg);
            border: 1px solid var(--border);
            color: #60a5fa;
            font-weight: 700;
            font-size: 20px;
            letter-spacing: 0.15em;
            padding: 8px 16px;
            border-radius: 6px;
            display: inline-flex;
            align-items: center;
            gap: 12px;
        }
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 18px;
            margin-bottom: 32px;
        }
        .kpi-card {
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
        }
        .kpi-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 8px;
        }
        .kpi-value {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.02em;
        }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 14px;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-muted);
        }
    </style>
</head>
<body>
    <nav class="app-navbar">
        <div style="display: flex; align-items: center; gap: 14px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px;">
                <span style="color: var(--primary);">${ICONS.terminal}</span>
                <span>SIUSHO</span>
            </div>
            <span class="badge badge-neutral" style="font-size: 10px;">WORKSPACE</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
            <span class="badge ${user.plan === 'business' ? 'badge-blue' : user.plan === 'pro' ? 'badge-blue' : 'badge-neutral'}">
                Plan: ${user.plan}
            </span>
            <span style="font-size: 13px; color: var(--text-muted);">
                User: <b style="color: var(--text);">${user.name}</b>
            </span>
            <a href="/logout" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                ${ICONS.logout}
                Sign Out
            </a>
        </div>
    </nav>

    <div class="app-container">
        <!-- Messaging Gateway Sync Banner -->
        <div class="sync-banner">
            <div>
                <div style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">Messaging Gateway Sync Token</div>
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">
                    Send the command <code style="color: #93c5fd; background: var(--bg); padding: 2px 6px; border-radius: 4px;">/link ${syncCode}</code> to the bot from your WhatsApp or Telegram.
                </div>
                <div style="display: flex; gap: 10px; font-size: 12px;">
                    <span class="badge ${user.whatsappJid ? 'badge-green' : 'badge-neutral'}">
                        <span class="status-dot ${user.whatsappJid ? 'status-dot-green' : ''}"></span>
                        WhatsApp: ${user.whatsappJid ? 'Linked' : 'Not Linked'}
                    </span>
                    <span class="badge ${user.telegramChatId ? 'badge-green' : 'badge-neutral'}">
                        <span class="status-dot ${user.telegramChatId ? 'status-dot-green' : ''}"></span>
                        Telegram: ${user.telegramChatId ? 'Linked' : 'Not Linked'}
                    </span>
                </div>
            </div>
            <div>
                <div class="code-display" id="tokenDisplay">
                    <span>${syncCode}</span>
                    <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('/link ${syncCode}'); this.innerText='Copied';" style="padding: 4px 8px; font-size: 11px;">
                        Copy
                    </button>
                </div>
            </div>
        </div>

        <!-- Financial KPI Metrics -->
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-label">Today's Revenue</div>
                <div class="kpi-value" style="color: #34d399;">+${dailySummary.totalIncome.toLocaleString()} BDT</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Today's Expenditure</div>
                <div class="kpi-value" style="color: #f87171;">-${dailySummary.totalExpense.toLocaleString()} BDT</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Daily Net Balance</div>
                <div class="kpi-value" style="color: var(--text);">${dailySummary.balance >= 0 ? '+' : ''}${dailySummary.balance.toLocaleString()} BDT</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">Monthly Expenditure</div>
                <div class="kpi-value" style="color: #fbbf24;">${monthlySummary.totalExpense.toLocaleString()} BDT</div>
            </div>
        </div>

        <!-- Accounts Receivable & Payable -->
        <div style="margin-bottom: 32px;">
            <div class="section-header">
                <div class="section-title">Accounts Receivable & Payable (${duesList.length})</div>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Classification</th>
                            <th>Counterparty</th>
                            <th>Reference Note</th>
                            <th style="text-align: right;">Amount (BDT)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${duesList.map(d => `
                            <tr>
                                <td>
                                    <span class="badge ${d.type === 'receivable' ? 'badge-green' : 'badge-amber'}">
                                        ${d.type === 'receivable' ? 'Receivable' : 'Payable'}
                                    </span>
                                </td>
                                <td><b>${d.personName}</b></td>
                                <td style="color: var(--text-muted);">${d.note || 'None'}</td>
                                <td style="text-align: right; font-weight: 600;">${d.amount.toLocaleString()}</td>
                            </tr>
                        `).join('')}
                        ${duesList.length === 0 ? `
                            <tr>
                                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
                                    No pending receivable or payable entries recorded.
                                </td>
                            </tr>
                        ` : ''}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Ongoing Client Projects -->
        <div style="margin-bottom: 32px;">
            <div class="section-header">
                <div class="section-title">Client Deliverables & Deadlines (${pendingProjects.length})</div>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>Deliverable / Task</th>
                            <th>Scheduled Deadline</th>
                            <th style="text-align: right;">Fee (BDT)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pendingProjects.map(p => `
                            <tr>
                                <td><b>${p.clientName}</b></td>
                                <td>${p.projectTask}</td>
                                <td style="color: var(--text-muted); font-size: 12px;">${p.deadlineReadable}</td>
                                <td style="text-align: right; font-weight: 600; color: #93c5fd;">
                                    ${p.fee ? p.fee.toLocaleString() : 'Pending'}
                                </td>
                            </tr>
                        `).join('')}
                        ${pendingProjects.length === 0 ? `
                            <tr>
                                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
                                    No pending client deliverables recorded.
                                </td>
                            </tr>
                        ` : ''}
                    </tbody>
                </table>
            </div>
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
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Admin Authentication - SIUSHO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        ${BASE_STYLES}
        body {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }
        .login-card {
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 32px;
            width: 100%;
            max-width: 380px;
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
        }
    </style>
</head>
<body>
    <div class="login-card">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="color: var(--primary); display: inline-flex; margin-bottom: 8px;">
                ${ICONS.lock}
            </div>
            <h1 style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em;">System Administration</h1>
            <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Sign in with master credentials to access gateway controls.</p>
        </div>

        ${error ? `<div class="alert alert-error">${error}</div>` : ''}

        <form action="/admin/login" method="POST">
            <div style="margin-bottom: 16px;">
                <label class="form-label">Username</label>
                <input type="text" name="username" class="form-input" placeholder="admin" required>
            </div>
            <div style="margin-bottom: 20px;">
                <label class="form-label">Master Password</label>
                <input type="password" name="password" class="form-input" placeholder="••••••••" required>
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 10px;">
                Authenticate
            </button>
        </form>

        <div style="text-align: center; margin-top: 20px;">
            <a href="/" style="font-size: 12px; color: var(--text-subtle);">Return to application</a>
        </div>
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
    return res.redirect('/admin/login?error=' + encodeURIComponent('Invalid administrative username or password.'));
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
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Administration Console - SIUSHO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        ${BASE_STYLES}
        .admin-nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 28px;
            background-color: var(--surface);
            border-bottom: 1px solid var(--border);
        }
        .admin-container {
            max-width: 1180px;
            margin: 28px auto;
            padding: 0 24px;
        }
        .grid-layout {
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 24px;
            margin-bottom: 28px;
        }
        @media(max-width: 860px) {
            .grid-layout { grid-template-columns: 1fr; }
        }
        .panel-card {
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 24px;
        }
        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-subtle);
        }
        .panel-title {
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text);
        }
        .qr-wrapper {
            background-color: #ffffff;
            padding: 12px;
            border-radius: 8px;
            display: inline-block;
            margin: 14px 0;
            border: 1px solid var(--border);
        }
        .qr-wrapper img {
            display: block;
            width: 200px;
            height: 200px;
        }
        .pairing-code-box {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            background-color: var(--bg);
            border: 1px solid var(--border);
            color: #60a5fa;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: 0.2em;
            padding: 10px 16px;
            border-radius: 6px;
            display: inline-block;
            margin: 10px 0;
        }
        .select-input {
            background-color: var(--bg);
            border: 1px solid var(--border);
            color: var(--text);
            padding: 5px 8px;
            border-radius: 4px;
            font-size: 12px;
            outline: none;
        }
    </style>
</head>
<body>
    <nav class="admin-nav">
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px;">
                <span style="color: var(--primary);">${ICONS.terminal}</span>
                <span>SIUSHO</span>
            </div>
            <span class="badge badge-amber" style="font-size: 10px;">ADMIN CONSOLE</span>
        </div>
        <div style="display: flex; align-items: center; gap: 14px;">
            <a href="/dashboard" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">User Dashboard</a>
            <a href="/admin/logout" class="btn btn-danger-ghost" style="font-size: 12px; padding: 6px 12px;">
                ${ICONS.logout}
                Sign Out
            </a>
        </div>
    </nav>

    <div class="admin-container">
        ${saved ? `<div class="alert alert-success">Configuration settings have been successfully persisted.</div>` : ''}

        <div class="grid-layout">
            <!-- 1. Central WhatsApp Gateway Host -->
            <div class="panel-card">
                <div class="panel-header">
                    <span class="panel-title">WhatsApp Gateway Host</span>
                    <span class="badge ${isConnected ? 'badge-green' : 'badge-amber'}">
                        <span class="status-dot ${isConnected ? 'status-dot-green' : 'status-dot-amber'}"></span>
                        ${isConnected ? 'Online & Linked' : 'Awaiting Connection'}
                    </span>
                </div>
                <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                    Central Baileys socket controlling conversational automation and notifications across all registered accounts.
                </p>

                ${!isConnected ? `
                    ${currentQRCodeDataUrl ? `
                        <div style="text-align: center; margin: 18px 0;">
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Scan with WhatsApp via Linked Devices</div>
                            <div class="qr-wrapper">
                                <img src="${currentQRCodeDataUrl}" alt="WhatsApp QR Code">
                            </div>
                        </div>
                    ` : '<div style="color: var(--warning); font-size: 13px; margin: 16px 0;">Generating pairing socket QR code...</div>'}

                    <div style="border-top: 1px solid var(--border-subtle); padding-top: 16px; margin-top: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted);">Pairing Code (Alternative)</div>
                        <div class="pairing-code-box">${currentPairingCode || 'Awaiting Request'}</div>
                        <div>
                            <a href="/admin/request-code" class="btn btn-secondary" style="font-size: 12px;">
                                ${ICONS.refresh}
                                Request Fresh Pairing Code / QR
                            </a>
                        </div>
                    </div>
                ` : `
                    <div style="margin-top: 20px; padding: 16px; background-color: var(--success-bg); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 6px;">
                        <div style="font-weight: 600; font-size: 14px; color: var(--success); margin-bottom: 4px;">Host Gateway Operational</div>
                        <div style="font-size: 13px; color: var(--text-muted);">
                            The central bot host session is live and actively dispatching conversational events.
                        </div>
                    </div>
                `}
            </div>

            <!-- 2. System Configuration & Pricing -->
            <div class="panel-card">
                <div class="panel-header">
                    <span class="panel-title">System & Billing Configuration</span>
                </div>
                <form action="/admin/settings-update" method="POST">
                    <div style="margin-bottom: 14px;">
                        <label class="form-label">Pro Tier Rate (BDT / Month)</label>
                        <input type="number" name="proPrice" class="form-input" value="${settings.pricing.pro?.price || 299}" required>
                    </div>
                    <div style="margin-bottom: 14px;">
                        <label class="form-label">Business Tier Rate (BDT / Month)</label>
                        <input type="number" name="businessPrice" class="form-input" value="${settings.pricing.business?.price || 799}" required>
                    </div>
                    <div style="margin-bottom: 18px;">
                        <label class="form-label">Update Master Admin Password</label>
                        <input type="password" name="adminPassword" class="form-input" placeholder="Leave empty to retain existing secret">
                    </div>
                    <button type="submit" class="btn btn-primary" style="font-size: 13px;">
                        Save Configuration
                    </button>
                </form>
            </div>
        </div>

        <!-- 3. Registered Accounts Directory -->
        <div class="panel-card">
            <div class="panel-header">
                <span class="panel-title">Registered Accounts Directory (${allUsers.length})</span>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>User Name</th>
                            <th>Identifier</th>
                            <th>Gateway Sync</th>
                            <th>Subscription Plan</th>
                            <th>Account Status</th>
                            <th>Registered</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allUsers.map(u => `
                            <tr>
                                <td><b>${u.name}</b></td>
                                <td style="color: var(--text-muted);">${u.phone || u.email || 'N/A'}</td>
                                <td>
                                    <div style="display: flex; gap: 6px;">
                                        ${u.whatsappJid ? '<span class="badge badge-green" style="font-size: 10px;">WhatsApp</span>' : ''}
                                        ${u.telegramChatId ? '<span class="badge badge-blue" style="font-size: 10px;">Telegram</span>' : ''}
                                        ${!u.whatsappJid && !u.telegramChatId ? '<span class="badge badge-neutral" style="font-size: 10px;">Unlinked</span>' : ''}
                                    </div>
                                </td>
                                <td>
                                    <form action="/admin/user-update" method="POST" style="display: inline;">
                                        <input type="hidden" name="userId" value="${u.id}">
                                        <select name="plan" class="select-input" onchange="this.form.submit()">
                                            <option value="free" ${u.plan === 'free' ? 'selected' : ''}>Free Tier</option>
                                            <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>Pro Tier</option>
                                            <option value="business" ${u.plan === 'business' ? 'selected' : ''}>Business Tier</option>
                                        </select>
                                </td>
                                <td>
                                        <select name="status" class="select-input" onchange="this.form.submit()">
                                            <option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option>
                                            <option value="suspended" ${u.status === 'suspended' ? 'selected' : ''}>Suspended</option>
                                        </select>
                                    </form>
                                </td>
                                <td style="color: var(--text-subtle); font-size: 12px;">
                                    ${new Date(u.createdAt).toISOString().split('T')[0]}
                                </td>
                            </tr>
                        `).join('')}
                        ${allUsers.length === 0 ? `
                            <tr>
                                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
                                    No accounts registered yet.
                                </td>
                            </tr>
                        ` : ''}
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
