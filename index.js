require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const path = require('path');
const fs = require('fs');

const { parseReminder, isGreeting } = require('./parser');
const { classifyIntent } = require('./ai/router');
const storage = require('./storage');
const finance = require('./services/finance');
const clients = require('./services/clients');
const urgent = require('./services/urgent');
const vault = require('./services/vault');
const dues = require('./services/dues');
const voice = require('./services/voice');
const { startWhatsApp, sendWhatsAppMessage, sendWhatsAppFile, requestNewPairingCode, getWhatsAppStatus } = require('./whatsapp');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_TOKEN) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is missing in .env!');
    process.exit(1);
}

const http = require('http');
const PORT = process.env.PORT || 3000;

// Ensure local directories exist
['./data', './vault_files'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Dashboard and Health check server
http.createServer(async (req, res) => {
    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url, `http://${host}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/request-code') {
        const botNumber = process.env.BOT_PHONE_NUMBER;
        await requestNewPairingCode(botNumber, handlePairingCode);
        res.writeHead(302, { Location: '/' });
        return res.end();
    }

    if (pathname === '/add-number') {
        const phone = parsedUrl.searchParams.get('phone');
        if (phone) {
            storage.addAuthorizedNumber(phone);
        }
        res.writeHead(302, { Location: '/' });
        return res.end();
    }

    if (pathname === '/remove-number') {
        const phone = parsedUrl.searchParams.get('phone');
        if (phone) {
            storage.removeAuthorizedNumber(phone);
        }
        res.writeHead(302, { Location: '/' });
        return res.end();
    }

    if (pathname === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            ...getWhatsAppStatus(),
            authorizedNumbers: storage.getAuthorizedNumbers()
        }));
    }

    const { isConnected, currentPairingCode, currentQRCodeDataUrl, lastPairingError } = getWhatsAppStatus();
    const users = storage.getUsers();
    const primaryDisplay = users.whatsappChatId ? users.whatsappChatId.split('@')[0] : (process.env.BOT_PHONE_NUMBER || '01576932471');
    const allAuth = storage.getAuthorizedNumbers();
    const secondaryNumbers = allAuth.filter(n => n !== primaryDisplay && n !== storage.normalizePhoneNumber(primaryDisplay));

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <title>SIUSHO AI Assistant Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; text-align: center; margin: 0; }
        .card { background: #1e293b; max-width: 500px; margin: 30px auto; padding: 30px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #334155; }
        h1 { margin-top: 0; font-size: 26px; color: #38bdf8; }
        .status-row { display: flex; justify-content: space-between; align-items: center; margin: 12px 0; padding: 12px 18px; background: #0f172a; border-radius: 12px; font-weight: 500; font-size: 14px; }
        .badge { padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
        .badge-green { background: #065f46; color: #34d399; }
        .badge-yellow { background: #78350f; color: #fbbf24; }
        .code-box { background: #0284c7; color: #fff; font-size: 32px; font-weight: 800; letter-spacing: 5px; padding: 18px; border-radius: 14px; margin: 25px 0 15px 0; user-select: all; box-shadow: 0 0 20px rgba(56, 189, 248, 0.4); }
        .instruction { font-size: 13px; color: #94a3b8; line-height: 1.6; text-align: left; background: #0f172a; padding: 15px; border-radius: 12px; margin-top: 20px; }
        .btn { display: inline-block; background: #38bdf8; color: #0f172a; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 10px; margin-top: 15px; transition: 0.2s; }
        .btn:hover { background: #7dd3fc; }
        .error { color: #f87171; font-size: 13px; margin-top: 10px; }
        .numbers-box { margin-top: 25px; text-align: left; background: #0f172a; padding: 20px; border-radius: 14px; border: 1px solid #334155; }
        .number-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
        .del-btn { color: #f87171; text-decoration: none; font-size: 12px; font-weight: 600; padding: 3px 8px; background: rgba(239, 68, 68, 0.15); border-radius: 6px; }
        .del-btn:hover { background: rgba(239, 68, 68, 0.3); }
        .add-form { display: flex; gap: 8px; margin-top: 15px; }
        .input-phone { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #f8fafc; font-size: 14px; outline: none; }
        .input-phone:focus { border-color: #38bdf8; }
        .submit-btn { background: #38bdf8; color: #0f172a; border: none; border-radius: 8px; padding: 10px 16px; font-weight: 700; cursor: pointer; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🤖 SIUSHO Assistant</h1>
        <p style="color: #94a3b8; font-size: 14px; margin-bottom: 25px;">Personal AI Executive Dashboard & Access Control</p>

        <div class="status-row">
            <span>Telegram Bot</span>
            <span class="badge badge-green">Connected ✅</span>
        </div>

        <div class="status-row">
            <span>WhatsApp Bot</span>
            <span class="badge ${isConnected ? 'badge-green' : 'badge-yellow'}">
                ${isConnected ? 'Online & Linked ✅' : 'Waiting for Pairing ⏳'}
            </span>
        </div>

        ${!isConnected ? `
            ${currentQRCodeDataUrl ? `
                <div style="margin: 20px 0;">
                    <p style="font-weight: 600; font-size: 16px; color: #38bdf8;">📲 ক্যামেরা দিয়ে নিচের QR কোডটি স্ক্যান করুন:</p>
                    <img src="${currentQRCodeDataUrl}" style="width: 250px; height: 250px; border-radius: 14px; background: #fff; padding: 10px; box-shadow: 0 0 25px rgba(56, 189, 248, 0.4);" />
                </div>
            ` : ''}

            <div style="margin: 20px 0; border-top: 1px solid #334155; padding-top: 15px;">
                <p style="font-size: 14px; color: #94a3b8;">অথবা ৮-সংখ্যার কোড দিয়ে লিংক করতে চাইলে:</p>
                <div class="code-box">${currentPairingCode || 'Generating...'}</div>
                <a href="/request-code" class="btn">🔄 নতুন কোড / QR রিফ্রেশ</a>
            </div>

            ${lastPairingError ? `<div class="error">⚠️ ${lastPairingError}</div>` : ''}

            <div class="instruction">
                📱 <b>কীভাবে লিঙ্ক করবেন:</b><br>
                1. আপনার মোবাইলের <b>WhatsApp</b> খুলুন।<br>
                2. <b>Linked Devices &gt; Link a Device</b>-এ যান।<br>
                3. ক্যামেরা দিয়ে উপরের <b>QR কোডটি স্ক্যান করুন</b> (অথবা নিচে "Link with phone number instead"-এ কোডটি দিন)!
            </div>
        ` : `
            <div style="margin-top: 20px; padding: 16px; background: #064e3b; border-radius: 14px; color: #6ee7b7; font-size: 14px;">
                🎉 <b>WhatsApp সফলভাবে কানেক্টেড!</b> আপনার সহকারী এখন লাইভ রয়েছে।
            </div>
        `}

        <!-- Dynamic Secondary Numbers Control Section -->
        <div class="numbers-box">
            <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #38bdf8; display: flex; justify-content: space-between; align-items: center;">
                <span>📱 অনুমোদিত নম্বরসমূহ (Access Control)</span>
            </h3>
            <p style="font-size: 12px; color: #94a3b8; margin: 0 0 14px 0;">যেসব নম্বর যোগ করবেন তারা সবাই WhatsApp-এ বটের সকল সুযোগ-সুবিধা ও স্বয়ংক্রিয় অ্যালার্ট পাবে।</p>

            <div class="number-item" style="color: #cbd5e1;">
                <span>👑 <b>মূল অ্যাকাউন্ট:</b> <code>${primaryDisplay}</code></span>
                <span style="font-size: 11px; color: #34d399; font-weight: bold;">PRIMARY</span>
            </div>

            ${secondaryNumbers.map(n => `
                <div class="number-item">
                    <span>👤 <code>${n}</code></span>
                    <a href="/remove-number?phone=${n}" onclick="return confirm('মুছে ফেলতে চান?');" class="del-btn">মুছুন 🗑️</a>
                </div>
            `).join('')}

            ${secondaryNumbers.length === 0 ? '<p style="color: #64748b; font-size: 13px; margin: 12px 0 6px 0;">কোনো সেকেন্ডারি নম্বর যোগ করা নেই। নিচে নম্বর দিন:</p>' : ''}

            <form action="/add-number" method="GET" class="add-form">
                <input type="text" name="phone" placeholder="যেমন: 017xxxxxxxx" class="input-phone" required>
                <button type="submit" class="submit-btn">+ যোগ করুন</button>
            </form>
        </div>
    </div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}).listen(PORT, () => {
    console.log(`🌐 Dashboard web server listening on port ${PORT}`);
});

// Auto Self-Ping to prevent Render free instance from sleeping
const pingTarget = process.env.RENDER_EXTERNAL_URL;
if (pingTarget) {
    console.log(`📡 Auto-ping configured for: ${pingTarget}`);
    setInterval(async () => {
        try {
            await fetch(pingTarget);
            console.log('💓 Self-ping sent to keep Render alive 24/7');
        } catch (e) {
            // ignore
        }
    }, 10 * 60 * 1000);
}

// 1. Initialize Telegram Bot
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
telegramBot.on('polling_error', (err) => {
    if (err.message && err.message.includes('409 Conflict')) return;
    console.warn('[Telegram Polling]:', err.message);
});
console.log('🤖 Telegram Bot (SIUSHO) is initialized and listening!');

// Quick Action Menu Keyboard
const MAIN_MENU_KEYBOARD = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '📊 আজকের হিসাব', callback_data: 'btn_fin_today' },
                { text: '📅 মাসিক হিসাব', callback_data: 'btn_fin_month' }
            ],
            [
                { text: '🤝 দেনা-পাওনা খাতা', callback_data: 'btn_dues' },
                { text: '📋 ক্লায়েন্ট লিস্ট', callback_data: 'btn_clients' }
            ],
            [
                { text: '📂 ভল্টের ফাইলসমূহ', callback_data: 'btn_vault' },
                { text: '📱 অনুমোদিত নম্বর', callback_data: 'btn_auth_numbers' }
            ],
            [
                { text: '🗑️ শেষ খরচ মুছো', callback_data: 'btn_fin_delete' }
            ]
        ]
    }
};

// 2. Cross-Platform Dispatchers
async function sendDualNotification(messageText, options = {}) {
    const users = storage.getUsers();
    let sentTelegram = false;
    let sentWhatsApp = 0;

    if (users.telegramChatId) {
        try {
            await telegramBot.sendMessage(users.telegramChatId, messageText, { parse_mode: 'Markdown', ...options });
            sentTelegram = true;
        } catch (err) {
            console.error('Failed to send Telegram notification:', err.message);
        }
    }

    const primaryWa = users.whatsappChatId || (process.env.BOT_PHONE_NUMBER ? `${process.env.BOT_PHONE_NUMBER.replace(/[^0-9]/g, '')}@s.whatsapp.net` : null);

    const targetSet = new Set();
    if (primaryWa) targetSet.add(primaryWa);

    // Broadcast to all authorized numbers (primary + secondary)
    const authorizedList = storage.getAuthorizedNumbers();
    for (const num of authorizedList) {
        targetSet.add(`${num}@s.whatsapp.net`);
    }

    for (const target of targetSet) {
        try {
            const ok = await sendWhatsAppMessage(target, messageText);
            if (ok) sentWhatsApp++;
        } catch (err) {
            console.error(`Failed to send WhatsApp notification to ${target}:`, err.message);
        }
    }

    console.log(`[Notification Triggered] Telegram: ${sentTelegram}, WhatsApp recipients: ${sentWhatsApp}`);
}

async function sendDualFile(filePath, caption, mimeType) {
    const users = storage.getUsers();

    if (users.telegramChatId) {
        try {
            if (mimeType && mimeType.startsWith('image/')) {
                await telegramBot.sendPhoto(users.telegramChatId, filePath, { caption: caption || '' });
            } else {
                await telegramBot.sendDocument(users.telegramChatId, filePath, { caption: caption || '' });
            }
        } catch (err) {
            console.error('Failed to send Telegram file:', err.message);
        }
    }

    const primaryWa = users.whatsappChatId || (process.env.BOT_PHONE_NUMBER ? `${process.env.BOT_PHONE_NUMBER.replace(/[^0-9]/g, '')}@s.whatsapp.net` : null);
    const targetSet = new Set();
    if (primaryWa) targetSet.add(primaryWa);

    const authorizedList = storage.getAuthorizedNumbers();
    for (const num of authorizedList) {
        targetSet.add(`${num}@s.whatsapp.net`);
    }

    for (const target of targetSet) {
        try {
            await sendWhatsAppFile(target, filePath, caption, mimeType);
        } catch (err) {
            console.error(`Failed to send WhatsApp file to ${target}:`, err.message);
        }
    }
}

// 3. Reminder Job Scheduler
function scheduleJob(reminder) {
    const targetDate = new Date(reminder.targetDate);
    if (targetDate.getTime() <= Date.now()) {
        storage.markReminderDone(reminder.id);
        return;
    }

    schedule.scheduleJob(reminder.id, targetDate, async () => {
        const text = `🔔 *REMINDER ALERT!*\n\n📝 *Task:* ${reminder.taskText}\n⏰ *Scheduled for:* ${reminder.humanReadableTime}`;
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ সম্পন্ন (Done)', callback_data: `done_${reminder.id}` },
                        { text: '⏰ ১০ মিনিট পর (Snooze)', callback_data: `snooze_${reminder.id}` }
                    ]
                ]
            }
        };
        await sendDualNotification(text, keyboard);
        storage.markReminderDone(reminder.id);
    });
}

function restoreReminders() {
    const pending = storage.getPendingReminders();
    console.log(`📦 Restoring ${pending.length} pending reminders...`);
    pending.forEach(reminder => {
        scheduleJob(reminder);
    });
}

// In-memory conversation history for context awareness
const conversationHistory = [];
function recordHistory(role, text) {
    conversationHistory.push({ role, text });
    if (conversationHistory.length > 8) {
        conversationHistory.shift();
    }
}

// 4. Central Intent Orchestrator
async function processUserCommand(text, platform, userChatId) {
    const cleanText = text.trim();
    recordHistory('user', cleanText);

    // Direct greeting check
    if (isGreeting(cleanText)) {
        const reply = "হ্যাঁ ভাই, আমি আছি! 🫡\nনিচের বাটনগুলো দিয়েও কাজ করতে পারেন, অথবা যেভাবেই ইচ্ছা মুখে বা লিখে বলুন!";
        recordHistory('bot', reply);
        if (platform === 'telegram') {
            await telegramBot.sendMessage(userChatId, reply, MAIN_MENU_KEYBOARD);
            return null;
        }
        return reply + "\n\n• 💸 খরচের হিসাব\n• 📊 দৈনিক রিপোর্ট ('আজকের হিসাব')\n• 🤝 দেনা-পাওনা খাতা\n• 👤 ক্লায়েন্ট ডেডলাইন\n• 🚨 পরীক্ষা/ভাইভা নাছোড়বান্দা অ্যালার্ম\n• 📱 অনুমোদিত নম্বরসমূহ ('নম্বর লিস্ট')\n• 🎙️ ভয়েস মেসেজ দিয়েও কথা বলতে পারেন!";
    }

    // Direct command for authorized numbers
    if (cleanText.startsWith('/addnumber') || cleanText.startsWith('/add_number') || cleanText.match(/^(?:নম্বর|নাম্বার)\s+(?:যোগ|এড|অ্যাড)\s+ক?রো?\s+([0-9+]+)/i)) {
        const match = cleanText.match(/([0-9+]{8,15})/);
        if (match) {
            const added = storage.addAuthorizedNumber(match[1]);
            const reply = added 
                ? `✅ *নতুন নম্বর অনুমোদিত হয়েছে!*\n\n📱 নম্বর: \`${added}\`\nএখন থেকে এই নম্বর থেকেও WhatsApp-এ বটের সকল সুবিধা ব্যবহার করা যাবে এবং অ্যালার্ট পাওয়া যাবে। 👍`
                : `❌ নম্বর ফরম্যাট সঠিক নয়। সঠিক মোবাইল নম্বর দিন (যেমন: 017xxxxxxxx)।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    if (cleanText.startsWith('/removenumber') || cleanText.startsWith('/remove_number') || cleanText.match(/^(?:নম্বর|নাম্বার)\s+(?:মুছে|বাদ|ডিলিট)\s+(?:দাও|ফেলো|করো)\s+([0-9+]+)/i)) {
        const match = cleanText.match(/([0-9+]{8,15})/);
        if (match) {
            const removed = storage.removeAuthorizedNumber(match[1]);
            const reply = removed
                ? `🗑️ *নম্বরটি সফলভাবে মুছে ফেলা হয়েছে!* (${match[1]})`
                : `❓ নম্বরটি অনুমোদিত লিস্টে পাওয়া যায়নি।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    if (cleanText === '/numbers' || cleanText === '/auth_numbers' || cleanText === 'নম্বর লিস্ট' || cleanText === 'অনুমোদিত নম্বর') {
        const reply = storage.formatAuthorizedNumbersList();
        recordHistory('bot', reply);
        return reply;
    }

    // AI Intent Classification with Conversation Context
    const classified = await classifyIntent(cleanText, conversationHistory);
    const { intent, data } = classified;
    console.log(`🧠 [AI Intent] ${intent} | Data:`, JSON.stringify(data));

    // Handle FINANCE_UPDATE_LAST
    if (intent === 'FINANCE_UPDATE_LAST' || (intent === 'FINANCE_ADD' && (!data.amount || data.amount <= 0))) {
        const updated = finance.updateLastTransaction(data);
        if (updated) {
            const reply = `✏️ *আগের এন্ট্রি আপডেট করা হয়েছে!*\n\n💵 *পরিমাণ:* ${updated.amount.toLocaleString('en-US')} ৳\n📁 *খাত:* ${updated.category}\n📝 *নোট:* ${updated.note || 'কোনো নোট নেই'}`;
            recordHistory('bot', reply);
            return reply;
        } else {
            const reply = `❓ আপডেট করার মতো আগের কোনো খরচের রেকর্ড পাওয়া যায়নি।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    // Handle FINANCE_DELETE_LAST
    if (intent === 'FINANCE_DELETE_LAST') {
        const deleted = finance.deleteLastTransaction();
        if (deleted) {
            const reply = `🗑️ *আগের ভুল এন্ট্রি সফলভাবে মুছে ফেলা হয়েছে!*\n\n❌ *মোছা এন্ট্রি:* ${deleted.category} (${deleted.amount} ৳) - ${deleted.note || ''}`;
            recordHistory('bot', reply);
            return reply;
        } else {
            const reply = `❓ মুছে ফেলার মতো কোনো সাম্প্রতিক এন্ট্রি নেই।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    // Handle FINANCE_ADD
    if (intent === 'FINANCE_ADD') {
        const item = finance.addTransaction(data);
        const icon = item.type === 'income' ? '🟢 আয়' : '🔴 ব্যয়';
        const reply = `✅ *${icon} সফলভাবে যোগ হয়েছে!*\n\n💵 *পরিমাণ:* ${item.amount.toLocaleString('en-US')} ৳\n📁 *খাত:* ${item.category}\n📝 *নোট:* ${item.note || 'কোনো নোট নেই'}\n📅 *তারিখ:* ${item.date}`;
        recordHistory('bot', reply);
        return reply;
    }

    // Handle FINANCE_REPORT
    if (intent === 'FINANCE_REPORT') {
        const reply = (data.period === 'month') ? finance.formatMonthlyReport() : finance.formatDailyReport();
        recordHistory('bot', reply);
        return reply;
    }

    // Handle DUE_ADD (দেনা-পাওনা যোগ)
    if (intent === 'DUE_ADD') {
        const d = dues.addDue(data);
        const typeText = d.type === 'receivable' ? '🟢 পাওনা (আপনি পাবেন)' : '🔴 দেনা (আপনাকে দিতে হবে)';
        const reply = `🤝 *দেনা-পাওনা এন্ট্রি সেভ হয়েছে!*\n\n${typeText}\n👤 *ব্যক্তি:* ${d.personName}\n💵 *টাকা:* ${d.amount.toLocaleString('en-US')} ৳\n📝 *নোট:* ${d.note || 'কোনো নোট নেই'}`;
        recordHistory('bot', reply);
        return reply;
    }

    // Handle DUE_LIST
    if (intent === 'DUE_LIST') {
        const reply = dues.formatDuesList();
        recordHistory('bot', reply);
        return reply;
    }

    // Handle DUE_SETTLE
    if (intent === 'DUE_SETTLE') {
        const settled = dues.settleDue(data.personName);
        if (settled) {
            const reply = `✅ *পরিশোধ সম্পন্ন!*\n👤 ${settled.personName}-এর ${settled.amount.toLocaleString('en-US')} টাকার বকেয়া সফলভাবে পরিশোধ হিসেবে চিহ্নিত করা হলো! 👍`;
            recordHistory('bot', reply);
            return reply;
        } else {
            const reply = `❓ "${data.personName || 'ব্যক্তি'}"-এর কোনো পেন্ডিং দেনা বা পাওনা পাওয়া যায়নি। 'দেনা পাওনা লিস্ট' লিখে চেক করুন।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    // Handle CLIENT_ADD
    if (intent === 'CLIENT_ADD') {
        const p = clients.addProject(data);
        const reply = `✅ *ক্লায়েন্ট প্রজেক্ট যুক্ত হয়েছে!*\n\n👤 *ক্লায়েন্ট:* ${p.clientName}\n📝 *কাজ:* ${p.projectTask}\n⏰ *ডেলিভারি ডেডলাইন:* ${p.deadlineReadable}\n\n💡 ডেডলাইনের আগে আমি আপনাকে স্বয়ংক্রিয়ভাবে অ্যালার্ট দেব!`;
        recordHistory('bot', reply);
        return reply;
    }

    // Handle CLIENT_LIST
    if (intent === 'CLIENT_LIST') {
        const reply = clients.formatClientList();
        recordHistory('bot', reply);
        return reply;
    }

    // Handle CLIENT_DONE
    if (intent === 'CLIENT_DONE') {
        const p = clients.markProjectDone(data.clientName);
        let reply = '';
        if (p) {
            reply = `🎉 *সাবাশ! কাজ কমপ্লিট!*\n👤 ক্লায়েন্ট: ${p.clientName}\n📝 কাজ: ${p.projectTask}\nপ্রজেক্টটি সফলভাবে সম্পন্ন হিসেবে চিহ্নিত করা হলো! 👍`;
        } else {
            reply = `❓ "${data.clientName || 'ক্লায়েন্ট'}"-এর কোনো পেন্ডিং কাজ খুঁজে পাওয়া যায়নি। 'ক্লায়েন্ট লিস্ট' লিখে চেক করুন।`;
        }
        recordHistory('bot', reply);
        return reply;
    }

    // Handle URGENT_ADD
    if (intent === 'URGENT_ADD') {
        const u = urgent.addUrgentTask(data);
        const firstTime = new Date(u.firstAlertISO).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true });
        const reply = `🚨 *নাছোড়বান্দা রিমাইন্ডার সেট করা হয়েছে!*\n\n📝 *বিষয়:* ${u.title}\n⏰ *প্রথম অ্যালার্ম:* ${firstTime}\n🔁 *ব্যবধান:* প্রতি ${u.repeatIntervalMins} মিনিট পর পর\n\n⚠️ *মনে রাখবেন:* নির্দিষ্ট সময় হলে এটি বারবার বাজতে থাকবে যতক্ষণ না আপনি চ্যাটে *"Done"* বা *"কাজ শেষ"* লিখবেন!`;
        recordHistory('bot', reply);
        return reply;
    }

    // Handle URGENT_CONFIRM
    if (intent === 'URGENT_CONFIRM') {
        const confirmed = urgent.confirmUrgentTask(data.keyword);
        let reply = '';
        if (confirmed) {
            reply = `✅ *অভিনন্দন!* আপনি *"${confirmed.title}"* সম্পন্ন করেছেন।\nনাছোড়বান্দা অ্যালার্ম সফলভাবে বন্ধ করা হলো! 🎯`;
        } else {
            reply = `ℹ️ বর্তমানে কোনো সক্রিয় নাছোড়বান্দা অ্যালার্ম চালু নেই।`;
        }
        recordHistory('bot', reply);
        return reply;
    }

    // Handle VAULT_SEARCH
    if (intent === 'VAULT_SEARCH') {
        const match = vault.searchAttachment(data.query);
        if (match) {
            if (platform === 'telegram') {
                if (match.mimeType.startsWith('image/')) {
                    telegramBot.sendPhoto(userChatId, match.storedPath, { caption: `📄 ${match.caption || match.originalName}` });
                } else {
                    telegramBot.sendDocument(userChatId, match.storedPath, { caption: `📄 ${match.caption || match.originalName}` });
                }
            } else if (platform === 'whatsapp') {
                sendWhatsAppFile(userChatId, match.storedPath, `📄 ${match.caption || match.originalName}`, match.mimeType);
            }
            const reply = `✅ ফাইলটি খুঁজে পেয়েছি! পাঠিয়ে দেওয়া হচ্ছে...`;
            recordHistory('bot', reply);
            return reply;
        } else {
            const reply = `❌ "${data.query}" সম্পর্কিত কোনো ফাইল ভল্টে পাওয়া যায়নি।\nভল্টের সব ফাইল দেখতে লিখুন: *"ভল্ট লিস্ট"*`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    // Handle VAULT_LIST
    if (intent === 'VAULT_LIST') {
        const reply = vault.listVaultFiles();
        recordHistory('bot', reply);
        return reply;
    }

    // Handle AUTH_NUMBER_ADD
    if (intent === 'AUTH_NUMBER_ADD') {
        const phone = data.phone || cleanText;
        const added = storage.addAuthorizedNumber(phone);
        if (added) {
            const reply = `✅ *সেকেন্ডারি নম্বর যুক্ত হয়েছে!*\n\n📱 নম্বর: \`${added}\`\nএখন থেকে এই নম্বর থেকেও WhatsApp-এ বটের সাথে কথা বলা ও রিপোর্ট পাওয়া যাবে! 👍`;
            recordHistory('bot', reply);
            return reply;
        } else {
            const reply = `❌ নম্বরের ফরম্যাটটি বুঝতে পারিনি। অনুগ্রহ করে সঠিক মোবাইল নম্বর লিখুন (যেমন: \`017xxxxxxxx\`)।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    // Handle AUTH_NUMBER_LIST
    if (intent === 'AUTH_NUMBER_LIST') {
        const reply = storage.formatAuthorizedNumbersList();
        recordHistory('bot', reply);
        return reply;
    }

    // Handle AUTH_NUMBER_REMOVE
    if (intent === 'AUTH_NUMBER_REMOVE') {
        const phone = data.phone || cleanText;
        const removed = storage.removeAuthorizedNumber(phone);
        if (removed) {
            const reply = `🗑️ *নম্বরটি সফলভাবে মুছে ফেলা হয়েছে!*`;
            recordHistory('bot', reply);
            return reply;
        } else {
            const reply = `❓ নম্বরটি তালিকায় পাওয়া যায়নি। 'অনুমোদিত নম্বর' লিখে লিস্ট চেক করুন।`;
            recordHistory('bot', reply);
            return reply;
        }
    }

    // Fallback: Standard or Multi-shot Timer Reminder
    const parsed = await parseReminder(cleanText);
    if (parsed) {
        const count = parsed.repeatCount || 1;
        const intervalSec = parsed.repeatIntervalSeconds || 0;
        const firstDate = new Date(parsed.targetDate);

        for (let i = 0; i < count; i++) {
            const itemDate = new Date(firstDate.getTime() + (i * intervalSec * 1000));
            const reminder = {
                id: 'rem_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4),
                taskText: count > 1 ? `${parsed.taskText} (#${i + 1}/${count})` : parsed.taskText,
                targetDate: itemDate.toISOString(),
                humanReadableTime: itemDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true }),
                completed: false,
                createdAt: new Date().toISOString()
            };

            storage.addReminder(reminder);
            scheduleJob(reminder);
        }

        const users = storage.getUsers();
        const deliveryText = (users.telegramChatId && users.whatsappChatId) ? 'WhatsApp & Telegram 📲' : 'Active Channel';

        let confirmText = `✅ *Reminder Set!*\n\n` +
            `📝 *Task:* ${parsed.taskText}\n` +
            `⏰ *Time:* ${parsed.humanReadableTime}`;

        if (count > 1) {
            confirmText += `\n🔁 *Repeat:* মোট ${count} বার (${intervalSec} সেকেন্ড পর পর)`;
        }
        confirmText += `\n📢 *Delivery:* ${deliveryText}`;

        recordHistory('bot', confirmText);
        return confirmText;
    }

    return `❓ কথাটি ঠিক বুঝতে পারিনি। আপনি যেকোনো কাজ, খরচ, দেনা-পাওনা, বা রিমাইন্ডার সাধারণ ভাষায় বলতে বা লিখতে পারেন। সাহায্য পেতে লিখুন *"help"* বা *"acho?"*`;
}

// ---------------- TELEGRAM HANDLERS ----------------
telegramBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const users = storage.getUsers();

    if (users.telegramChatId && users.telegramChatId !== chatId) {
        return telegramBot.sendMessage(chatId, '⛔ This bot is private and for personal use only.');
    }
    if (!users.telegramChatId) {
        storage.setTelegramUser(chatId);
    }

    // Check if voice / audio message
    if (msg.voice || msg.audio) {
        try {
            await telegramBot.sendMessage(chatId, '🎙️ আপনার ভয়েস মেসেজ শুনছি...');
            const fileId = msg.voice ? msg.voice.file_id : msg.audio.file_id;
            const mimeType = msg.voice ? (msg.voice.mime_type || 'audio/ogg') : (msg.audio.mime_type || 'audio/mpeg');

            const fileLink = await telegramBot.getFileLink(fileId);
            const res = await fetch(fileLink);
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const transcribedText = await voice.transcribeAudio(buffer, mimeType);
            if (!transcribedText) {
                return telegramBot.sendMessage(chatId, '❌ ভয়েস বুঝতে পারিনি, স্পষ্ট করে আবার বলুন।');
            }

            await telegramBot.sendMessage(chatId, `🗣️ *আপনি বলেছেন:* "${transcribedText}"`, { parse_mode: 'Markdown' });
            const reply = await processUserCommand(transcribedText, 'telegram', chatId);
            if (reply) {
                return telegramBot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
            }
            return;
        } catch (e) {
            console.error('Telegram voice error:', e.message);
            return telegramBot.sendMessage(chatId, '❌ ভয়েস প্রসেস করতে সমস্যা হয়েছে।');
        }
    }

    // Check if attachment (photo or document)
    if (msg.photo || msg.document) {
        try {
            let fileId, originalName, mimeType;
            if (msg.photo) {
                const largestPhoto = msg.photo[msg.photo.length - 1];
                fileId = largestPhoto.file_id;
                originalName = 'telegram_photo.jpg';
                mimeType = 'image/jpeg';
            } else {
                fileId = msg.document.file_id;
                originalName = msg.document.file_name || 'document';
                mimeType = msg.document.mime_type || 'application/octet-stream';
            }

            const fileLink = await telegramBot.getFileLink(fileId);
            const response = await fetch(fileLink);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const caption = msg.caption ? msg.caption.trim() : originalName;
            const saved = vault.saveAttachment({ buffer, originalName, caption, mimeType });

            return telegramBot.sendMessage(chatId, 
                `✅ *ডকুমেন্ট ভল্টে সংরক্ষিত হয়েছে!*\n\n` +
                `📄 *নাম / ক্যাপশন:* ${saved.caption}\n` +
                `📎 *ফাইল:* \`${saved.originalName}\`\n\n` +
                `💡 পরে এটি পেতে শুধু লিখবেন: *"আমার ${saved.caption} পাঠাও"*`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error('Telegram attachment save error:', e.message);
            return telegramBot.sendMessage(chatId, '❌ ফাইল সেভ করতে সমস্যা হয়েছে।');
        }
    }

    const text = msg.text ? msg.text.trim() : '';
    if (!text) return;

    if (text.startsWith('/start') || text.toLowerCase() === 'help') {
        return telegramBot.sendMessage(chatId,
            `👋 *স্বাগতম! আমি আপনার অল-ইন-ওয়ান AI পার্সোনাল অ্যাসিস্ট্যান্ট (SIUSHO)।*\n\n` +
            `নিচের কুইক বাটনগুলো দিয়ে সহজেই কাজ করতে পারেন অথবা সাধারণ ভাষায় লিখে বা **ভয়েস পাঠিয়ে** নির্দেশ দিতে পারেন! 👇`,
            { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD }
        );
    }

    const reply = await processUserCommand(text, 'telegram', chatId);
    if (reply) {
        return telegramBot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }
});

// Handle Telegram Inline Keyboard Callbacks
telegramBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        await telegramBot.answerCallbackQuery(query.id);

        if (data === 'btn_fin_today') {
            return telegramBot.sendMessage(chatId, finance.formatDailyReport(), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_fin_month') {
            return telegramBot.sendMessage(chatId, finance.formatMonthlyReport(), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_dues') {
            return telegramBot.sendMessage(chatId, dues.formatDuesList(), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_clients') {
            return telegramBot.sendMessage(chatId, clients.formatClientList(), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_vault') {
            return telegramBot.sendMessage(chatId, vault.listVaultFiles(), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_auth_numbers') {
            return telegramBot.sendMessage(chatId, storage.formatAuthorizedNumbersList(), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_fin_delete') {
            const deleted = finance.deleteLastTransaction();
            if (deleted) {
                return telegramBot.sendMessage(chatId, `🗑️ *শেষ খরচটি মুছে ফেলা হয়েছে!*\n${deleted.category}: ${deleted.amount} ৳ (${deleted.note || ''})`, { parse_mode: 'Markdown' });
            } else {
                return telegramBot.sendMessage(chatId, `❓ কোনো সাম্প্রতিক খরচ নেই।`);
            }
        }
        if (data.startsWith('done_')) {
            urgent.confirmUrgentTask();
            return telegramBot.sendMessage(chatId, `✅ *কাজটি সম্পন্ন হিসেবে চিহ্নিত করা হলো! অ্যালার্ম বন্ধ।* 👍`);
        }
        if (data.startsWith('snooze_')) {
            const newReminder = {
                id: 'snooze_' + Date.now(),
                taskText: 'Snoozed Reminder / Task',
                targetDate: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                humanReadableTime: new Date(Date.now() + 10 * 60 * 1000).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true }),
                completed: false,
                createdAt: new Date().toISOString()
            };
            storage.addReminder(newReminder);
            scheduleJob(newReminder);
            return telegramBot.sendMessage(chatId, `⏰ *১০ মিনিটের জন্য স্নুজ করা হলো!* ১০ মিনিট পর আবার মনে করিয়ে দেব।`);
        }
    } catch (err) {
        console.error('Callback query error:', err.message);
    }
});

// ---------------- WHATSAPP HANDLERS ----------------
function isAuthorizedWhatsApp(from) {
    return storage.isWhatsAppAuthorized(from);
}

async function handleWhatsAppText(from, text) {
    if (!from || from.endsWith('@g.us')) return;

    if (!isAuthorizedWhatsApp(from)) {
        console.warn(`[Security] Blocked unauthorized WhatsApp message from: ${from}`);
        return;
    }

    const users = storage.getUsers();
    if (!users.whatsappChatId) {
        storage.setWhatsAppUser(from);
        console.log(`👤 Linked WhatsApp User ID: ${from}`);
    }

    console.log(`💬 Processing WhatsApp command from ${from}: "${text}"`);

    if (text === '/start') {
        return sendWhatsAppMessage(from,
            `👋 স্বাগতম! আমি আপনার অল-ইন-ওয়ান AI পার্সোনাল অ্যাসিস্ট্যান্ট (SIUSHO)।\n\n` +
            `আমি যা যা করতে পারি:\n` +
            `1️⃣ 💸 দৈনিক আয়-ব্যয় ট্র্যাকিং ও রাত ১০টায় রিপোর্ট\n` +
            `2️⃣ 🤝 দেনা-পাওনা ও বকেয়া খাতা ('দেনা পাওনার হিসাব')\n` +
            `3️⃣ 👤 ক্লায়েন্ট প্রজেক্ট ও ডেডলাইন ট্র্যাকিং\n` +
            `4️⃣ 🚨 ভাইভা/পরীক্ষার নাছোড়বান্দা অ্যালার্ম\n` +
            `5️⃣ 📂 ফাইল ভল্ট (ছবি/পিডিএফ সেভ ও রিকল)\n` +
            `6️⃣ 🎙️ ভয়েস মেসেজ শুনে কাজ করা!`
        );
    }

    const reply = await processUserCommand(text, 'whatsapp', from);
    if (reply) {
        console.log(`📤 [WhatsApp Reply] To: ${from} | Reply: "${reply.slice(0, 50)}..."`);
        return sendWhatsAppMessage(from, reply);
    }
}

async function handleWhatsAppVoice(from, audioBuffer, mimeType) {
    if (!isAuthorizedWhatsApp(from)) return;

    try {
        await sendWhatsAppMessage(from, '🎙️ আপনার ভয়েস মেসেজ শুনছি...');
        const transcribedText = await voice.transcribeAudio(audioBuffer, mimeType);
        if (!transcribedText) {
            return sendWhatsAppMessage(from, '❌ ভয়েস বুঝতে পারিনি, স্পষ্ট করে আবার বলুন।');
        }

        await sendWhatsAppMessage(from, `🗣️ *আপনি বলেছেন:* "${transcribedText}"`);
        const reply = await processUserCommand(transcribedText, 'whatsapp', from);
        if (reply) {
            return sendWhatsAppMessage(from, reply);
        }
    } catch (e) {
        console.error('WhatsApp voice processing error:', e.message);
        return sendWhatsAppMessage(from, '❌ ভয়েস প্রসেস করতে সমস্যা হয়েছে।');
    }
}

async function handleWhatsAppMedia(from, buffer, originalName, caption, mimeType) {
    if (!isAuthorizedWhatsApp(from)) return;

    const users = storage.getUsers();
    if (!users.whatsappChatId) {
        storage.setWhatsAppUser(from);
    }

    try {
        const finalCaption = caption ? caption.trim() : originalName;
        const saved = vault.saveAttachment({ buffer, originalName, caption: finalCaption, mimeType });

        return sendWhatsAppMessage(from,
            `✅ ডকুমেন্ট ভল্টে সংরক্ষিত হয়েছে!\n\n` +
            `📄 নাম / ক্যাপশন: ${saved.caption}\n` +
            `📎 ফাইল: ${saved.originalName}\n\n` +
            `💡 পরে এটি পেতে শুধু লিখবেন: "আমার ${saved.caption} পাঠাও"`
        );
    } catch (e) {
        console.error('WhatsApp attachment save error:', e.message);
        return sendWhatsAppMessage(from, '❌ ফাইল সেভ করতে সমস্যা হয়েছে।');
    }
}

// ---------------- AUTOMATED CRON SCHEDULES ----------------
// 1. Daily Finance Report at 10:00 PM (22:00 Dhaka Time)
schedule.scheduleJob('0 22 * * *', async () => {
    console.log('⏰ [Cron] Running Daily Finance Report (10:00 PM)...');
    const report = finance.formatDailyReport();
    await sendDualNotification(`🌙 *রাত ১০টা: দিন শেষের আর্থিক হিসাব!*\n\n` + report);
});

// 2. Monthly Finance Report on the 1st of every month at 9:00 AM
schedule.scheduleJob('0 9 1 * *', async () => {
    console.log('⏰ [Cron] Running Monthly Finance Report...');
    const report = finance.formatMonthlyReport();
    await sendDualNotification(`🗓️ *নতুন মাসের শুরু: বিগত মাসের আর্থিক রিপোর্ট!*\n\n` + report);
});

// 3. Morning Client Deadlines Briefing at 9:00 AM
schedule.scheduleJob('0 9 * * *', async () => {
    console.log('⏰ [Cron] Running Morning Client Briefing (9:00 AM)...');
    const pending = clients.getPendingProjects();
    if (pending.length > 0) {
        const clientList = clients.formatClientList();
        await sendDualNotification(`☀️ *শুভ সকাল! আজকের ক্লায়েন্ট প্রজেক্ট আপডেট:*\n\n` + clientList);
    }
});

// 4. Urgent Nagging Alarm Checker (Every 1 minute)
schedule.scheduleJob('*/1 * * * *', async () => {
    const dueTasks = urgent.getDueTasks();
    for (const t of dueTasks) {
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ সম্পন্ন (Done)', callback_data: `done_${t.id}` },
                        { text: '⏰ ১০ মিনিট পর (Snooze)', callback_data: `snooze_${t.id}` }
                    ]
                ]
            }
        };
        const msg = `🚨 *জরুরি সতর্কতা! (নাছোড়বান্দা অ্যালার্ম #${t.alertCount})*\n\n` +
                    `📝 *বিষয়:* ${t.title}\n` +
                    `⏰ *প্রথম সতর্কবার্তা ছিল:* ${new Date(t.firstAlertISO).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true })}\n` +
                    `🔁 আপনি সম্পন্ন না করা পর্যন্ত প্রতি ${t.repeatIntervalMins} মিনিট পর পর অ্যালার্ম বাজবে!\n\n` +
                    `💡 কাজ শেষ হলে বাটনে চাপ দিন অথবা লিখুন: *"Done"*`;
        await sendDualNotification(msg, keyboard);
    }
});

async function handlePairingCode(code) {
    const users = storage.getUsers();
    if (users.telegramChatId) {
        try {
            await telegramBot.sendMessage(users.telegramChatId, 
                `🔑 *WhatsApp Pairing Code (ক্লাউড থেকে):*\n\n` +
                `👉 \`${code}\`\n\n` +
                `📱 আপনার ফোনের WhatsApp > Linked Devices > Link with phone number instead-এ গিয়ে কোডটি বসিয়ে দিন!`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error('Failed to send pairing code to Telegram:', e.message);
        }
    }
}

// Start WhatsApp & Restore Reminders
startWhatsApp(handleWhatsAppText, handleWhatsAppMedia, handleWhatsAppVoice, handlePairingCode);
restoreReminders();
console.log('🚀 SIUSHO All-in-One Executive Assistant is running smoothly!');
