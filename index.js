require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const path = require('path');
const fs = require('fs');

const { parseReminder, isGreeting } = require('./parser');
const { classifyIntent } = require('./ai/router');
const storage = require('./storage');
const usersService = require('./services/users');
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

// Ensure local directories exist
['./data', './vault_files'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const serverApp = require('./server');
const PORT = process.env.PORT || 3000;

serverApp.listen(PORT, () => {
    console.log(`🌐 SIUSHO SaaS Platform & Admin Panel listening on port ${PORT}`);
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
    if (err.message && (err.message.includes('409 Conflict') || err.message.includes('EFATAL') || err.message.includes('AggregateError'))) return;
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
                { text: '🔗 সিঙ্ক কোড (/link)', callback_data: 'btn_link' }
            ],
            [
                { text: '🗑️ শেষ খরচ মুছো', callback_data: 'btn_fin_delete' },
                { text: '👤 আমার প্রোফাইল', callback_data: 'btn_profile' }
            ]
        ]
    }
};

// 2. Multi-User Notification Dispatchers
async function sendUserNotification(userId, messageText, options = {}) {
    const user = usersService.getUserById(userId);
    if (!user) {
        console.warn('⚠️ sendUserNotification: User not found for id:', userId);
        return;
    }

    let sentTelegram = false;
    let sentWhatsApp = false;

    if (user.telegramChatId) {
        try {
            await telegramBot.sendMessage(user.telegramChatId, messageText, { parse_mode: 'Markdown', ...options });
            sentTelegram = true;
        } catch (err) {
            console.error(`Failed to send Telegram notification to user ${userId}:`, err.message);
        }
    }

    const waTarget = user.whatsappJid || user.whatsappLid;
    if (waTarget) {
        try {
            sentWhatsApp = await sendWhatsAppMessage(waTarget, messageText);
        } catch (err) {
            console.error(`Failed to send WhatsApp notification to user ${userId}:`, err.message);
        }
    }

    console.log(`[User Notification] User: ${user.name} (${userId}) | Telegram: ${sentTelegram}, WhatsApp: ${sentWhatsApp}`);
}

async function sendUserFile(userId, filePath, caption, mimeType) {
    const user = usersService.getUserById(userId);
    if (!user) return;

    if (user.telegramChatId) {
        try {
            if (mimeType && mimeType.startsWith('image/')) {
                await telegramBot.sendPhoto(user.telegramChatId, filePath, { caption: caption || '' });
            } else {
                await telegramBot.sendDocument(user.telegramChatId, filePath, { caption: caption || '' });
            }
        } catch (err) {
            console.error('Failed to send Telegram file:', err.message);
        }
    }

    const waTarget = user.whatsappJid || user.whatsappLid;
    if (waTarget) {
        try {
            await sendWhatsAppFile(waTarget, filePath, caption, mimeType);
        } catch (err) {
            console.error('Failed to send WhatsApp file:', err.message);
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
        await sendUserNotification(reminder.userId, text, keyboard);
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

// In-memory conversation history isolated per user
const userHistories = {};
function recordHistory(userId, role, text) {
    if (!userHistories[userId]) userHistories[userId] = [];
    userHistories[userId].push({ role, text });
    if (userHistories[userId].length > 8) {
        userHistories[userId].shift();
    }
}
function getUserHistory(userId) {
    return userHistories[userId] || [];
}

// 4. Central Multi-User Intent Orchestrator
async function processUserCommand(text, platform, userChatId, userId) {
    const cleanText = text.trim();
    recordHistory(userId, 'user', cleanText);
    const user = usersService.getUserById(userId);

    // Direct greeting check
    if (isGreeting(cleanText)) {
        const reply = `হ্যাঁ ${user?.name || 'ভাই'}, আমি আছি! 🫡\nনিচের বাটনগুলো দিয়েও কাজ করতে পারেন, অথবা যেভাবেই ইচ্ছা মুখে বা লিখে বলুন!`;
        recordHistory(userId, 'bot', reply);
        if (platform === 'telegram') {
            await telegramBot.sendMessage(userChatId, reply, MAIN_MENU_KEYBOARD);
            return null;
        }
        return reply + "\n\n• 💸 খরচের হিসাব\n• 📊 দৈনিক রিপোর্ট ('আজকের হিসাব')\n• 🤝 দেনা-পাওনা খাতা\n• 👤 ক্লায়েন্ট ডেডলাইন\n• 🚨 পরীক্ষা/ভাইভা নাছোড়বান্দা অ্যালার্ম\n• 🔗 অন্য ডিভাইস সিঙ্ক করতে: /link\n• 🎙️ ভয়েস মেসেজ দিয়েও কথা বলতে পারেন!";
    }

    // Direct account linking commands
    if (cleanText === '/link' || cleanText === 'লিঙ্ক' || cleanText === 'সিঙ্ক' || cleanText === 'sync') {
        const code = usersService.generateLinkCode(userId);
        const instructions = platform === 'telegram'
            ? `🔗 *আপনার অ্যাকাউন্ট সিঙ্ক কোড:* 👉 \`${code}\` 👈\n\n` +
              `📱 *কীভাবে WhatsApp লিঙ্ক করবেন:*\n` +
              `আপনার WhatsApp থেকে এই বটকে লিখুন:\n` +
              `\`/link ${code}\`\n\n` +
              `⏱️ এই কোডটির মেয়াদ ১৫ মিনিট। লিঙ্ক করার সাথে সাথে আপনার WhatsApp ও Telegram-এর সমস্ত ডেটা ও রিমাইন্ডার এক হয়ে যাবে!`
            : `🔗 *আপনার অ্যাকাউন্ট সিঙ্ক কোড:* 👉 \`${code}\` 👈\n\n` +
              `🤖 *কীভাবে Telegram লিঙ্ক করবেন:*\n` +
              `আপনার Telegram থেকে বটকে (@siusho_bot) লিখুন:\n` +
              `\`/link ${code}\`\n\n` +
              `⏱️ এই কোডটির মেয়াদ ১৫ মিনিট। লিঙ্ক করার সাথে সাথে উভয় প্ল্যাটফর্মের ডেটা এক হয়ে যাবে!`;
        recordHistory(userId, 'bot', instructions);
        return instructions;
    }

    if (cleanText.startsWith('/link ') || cleanText.startsWith('/link:') || cleanText.match(/^সিঙ্ক\s+([0-9]{6})/i)) {
        const parts = cleanText.split(/[\s:]+/);
        const code = parts[1];
        const res = usersService.linkAccountWithCode(code, platform, userChatId);
        let reply = '';
        if (res.success) {
            reply = `🎉 *অভিনন্দন! আপনার অ্যাকাউন্ট সফলভাবে লিঙ্ক হয়েছে!*\n\n` +
                    `এখন থেকে আপনি Telegram এবং WhatsApp—উভয় মাধ্যম থেকেই আপনার সমস্ত খরচ, দেনা-পাওনা, প্রজেক্ট এবং রিমাইন্ডার একসাথে পরিচালনা করতে পারবেন! 🚀`;
        } else {
            reply = `❌ ${res.message}`;
        }
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    if (cleanText === '/profile' || cleanText === 'আমার প্রোফাইল' || cleanText === 'আমার তথ্য') {
        let reply = `👤 *আপনার প্রোফাইল তথ্য:*\n━━━━━━━━━━━━━━━━━━━━━\n`;
        reply += `🆔 *ইউজার আইডি:* \`${user?.id}\`\n`;
        reply += `📛 *নাম:* ${user?.name}\n`;
        reply += `📱 *WhatsApp:* ${user?.whatsappPhone ? user.whatsappPhone : (user?.whatsappJid ? 'সংযুক্ত ✅' : 'সংযুক্ত নয় ❌')}\n`;
        reply += `🤖 *Telegram:* ${user?.telegramChatId ? `সংযুক্ত ✅ (ID: ${user.telegramChatId})` : 'সংযুক্ত নয় ❌'}\n\n`;
        reply += `💡 অন্য ডিভাইস লিঙ্ক করতে লিখুন: \`/link\``;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Direct Snooze & Done commands (WhatsApp & Telegram)
    if (/^(snooze|স্নুজ|১০\s*মিনিট\s*পর|10\s*min\s*por)$/i.test(cleanText)) {
        const lastRem = storage.getLastReminderByUser(userId);
        const taskText = lastRem ? lastRem.taskText : 'রিমাইন্ডার';
        const targetDate = new Date(Date.now() + 10 * 60 * 1000);
        const newReminder = {
            id: 'rem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            userId: userId,
            taskText: `${taskText} (স্নুজ)`,
            targetDate: targetDate.toISOString(),
            humanReadableTime: targetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true }),
            completed: false,
            createdAt: new Date().toISOString()
        };
        storage.addReminder(newReminder);
        scheduleJob(newReminder);
        const reply = `⏰ *১০ মিনিটের জন্য স্নুজ করা হলো!*\n📝 বিষয়: ${newReminder.taskText}\n১০ মিনিট পর আবার মনে করিয়ে দেব।`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    if (/^(done|কাজ\s*শেষ|শেষ|হয়েছে|সম্পন্ন)$/i.test(cleanText)) {
        urgent.confirmUrgentTask(userId);
        const lastRem = storage.getLastReminderByUser(userId);
        if (lastRem && !lastRem.completed) {
            storage.markReminderDone(lastRem.id);
        }
        const reply = `✅ *কাজটি সম্পন্ন হিসেবে চিহ্নিত করা হলো! অ্যালার্ম ও রিমাইন্ডার বন্ধ।* 👍`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Active Reminders List
    if (/^(reminders|reminder\s*list|আমার\s*রিমাইন্ডার|রিমাইন্ডার\s*লিস্ট|রিমাইন্ডারসমূহ)$/i.test(cleanText)) {
        const active = storage.getRemindersByUser(userId);
        if (active.length === 0) {
            const reply = `ℹ️ বর্তমানে আপনার কোনো পেন্ডিং রিমাইন্ডার নেই।\nনতুন রিমাইন্ডার সেট করতে লিখুন:\n- "কাল সকাল ১০টায় মিটিং"\n- "১০ মিনিট পর ওষুধ খাব"`;
            recordHistory(userId, 'bot', reply);
            return reply;
        }
        let reply = `⏰ *আপনার সক্রিয় রিমাইন্ডারসমূহ (${active.length}টি):*\n━━━━━━━━━━━━━━━━━━━━━\n`;
        active.forEach((r, idx) => {
            reply += `${idx + 1}. 📝 *${r.taskText}*\n   ⏰ ${r.humanReadableTime}\n   🆔 \`${r.id}\`\n\n`;
        });
        reply += `💡 বাতিল করতে লিখুন: \`রিমাইন্ডার বাতিল [আইডি]\``;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Cancel Reminder
    if (cleanText.startsWith('রিমাইন্ডার বাতিল') || cleanText.startsWith('/cancel_reminder') || cleanText.startsWith('cancel reminder')) {
        const targetId = cleanText.replace(/^(?:রিমাইন্ডার\s*বাতিল|cancel\s*reminder|\/cancel_reminder)\s*/i, '').trim();
        const active = storage.getRemindersByUser(userId);
        const toCancel = active.find(r => r.id === targetId || r.taskText.toLowerCase().includes(targetId.toLowerCase()));
        if (toCancel) {
            storage.cancelReminder(toCancel.id, userId);
            const reply = `✅ *রিমাইন্ডারটি সফলভাবে বাতিল করা হলো!*\n📝 *${toCancel.taskText}* (${toCancel.humanReadableTime})`;
            recordHistory(userId, 'bot', reply);
            return reply;
        } else {
            const reply = `❓ রিমাইন্ডারটি পাওয়া যায়নি। আপনার রিমাইন্ডার লিস্ট দেখতে লিখুন: *"আমার রিমাইন্ডার"*`;
            recordHistory(userId, 'bot', reply);
            return reply;
        }
    }

    // High-Speed Local Finance Detection (0ms latency, zero calculation errors)
    const quickFin = finance.parseQuickFinance(cleanText);
    if (quickFin) {
        const item = finance.addTransaction(userId, quickFin);
        const icon = item.type === 'income' ? '🟢 আয়' : '🔴 ব্যয়';
        const reply = `✅ *${icon} সফলভাবে যোগ হয়েছে!*\n\n💵 *পরিমাণ:* ${item.amount.toLocaleString('en-US')} ৳\n📁 *খাত:* ${item.category}\n📝 *নোট:* ${item.note || 'কোনো নোট নেই'}\n📅 *তারিখ:* ${item.date}`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // AI Intent Classification with User-Specific Context
    const history = getUserHistory(userId);
    const classified = await classifyIntent(cleanText, history);
    const { intent, data } = classified;
    console.log(`🧠 [AI Intent - User: ${user?.name}] ${intent} | Data:`, JSON.stringify(data));

    // Handle FINANCE_UPDATE_LAST
    if (intent === 'FINANCE_UPDATE_LAST' || (intent === 'FINANCE_ADD' && (!data.amount || data.amount <= 0))) {
        const updated = finance.updateLastTransaction(userId, data);
        if (updated) {
            const reply = `✏️ *আগের এন্ট্রি আপডেট করা হয়েছে!*\n\n💵 *পরিমাণ:* ${updated.amount.toLocaleString('en-US')} ৳\n📁 *খাত:* ${updated.category}\n📝 *নোট:* ${updated.note || 'কোনো নোট নেই'}`;
            recordHistory(userId, 'bot', reply);
            return reply;
        } else {
            const reply = `❓ আপডেট করার মতো আগের কোনো খরচের রেকর্ড পাওয়া যায়নি।`;
            recordHistory(userId, 'bot', reply);
            return reply;
        }
    }

    // Handle FINANCE_DELETE_LAST
    if (intent === 'FINANCE_DELETE_LAST') {
        const deleted = finance.deleteLastTransaction(userId);
        if (deleted) {
            const reply = `🗑️ *আগের ভুল এন্ট্রি সফলভাবে মুছে ফেলা হয়েছে!*\n\n❌ *মোছা এন্ট্রি:* ${deleted.category} (${deleted.amount} ৳) - ${deleted.note || ''}`;
            recordHistory(userId, 'bot', reply);
            return reply;
        } else {
            const reply = `❓ মুছে ফেলার মতো কোনো সাম্প্রতিক এন্ট্রি নেই।`;
            recordHistory(userId, 'bot', reply);
            return reply;
        }
    }

    // Handle FINANCE_ADD
    if (intent === 'FINANCE_ADD') {
        const item = finance.addTransaction(userId, data);
        const icon = item.type === 'income' ? '🟢 আয়' : '🔴 ব্যয়';
        const reply = `✅ *${icon} সফলভাবে যোগ হয়েছে!*\n\n💵 *পরিমাণ:* ${item.amount.toLocaleString('en-US')} ৳\n📁 *খাত:* ${item.category}\n📝 *নোট:* ${item.note || 'কোনো নোট নেই'}\n📅 *তারিখ:* ${item.date}`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle FINANCE_REPORT
    if (intent === 'FINANCE_REPORT') {
        const reply = (data.period === 'month') ? finance.formatMonthlyReport(userId) : finance.formatDailyReport(userId);
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle DUE_ADD (দেনা-পাওনা যোগ)
    if (intent === 'DUE_ADD') {
        const d = dues.addDue(userId, data);
        const typeText = d.type === 'receivable' ? '🟢 পাওনা (আপনি পাবেন)' : '🔴 দেনা (আপনাকে দিতে হবে)';
        const reply = `🤝 *দেনা-পাওনা এন্ট্রি সেভ হয়েছে!*\n\n${typeText}\n👤 *ব্যক্তি:* ${d.personName}\n💵 *টাকা:* ${d.amount.toLocaleString('en-US')} ৳\n📝 *নোট:* ${d.note || 'কোনো নোট নেই'}`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle DUE_LIST
    if (intent === 'DUE_LIST') {
        const reply = dues.formatDuesList(userId);
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle DUE_SETTLE
    if (intent === 'DUE_SETTLE') {
        const settled = dues.settleDue(userId, data.personName);
        if (settled) {
            const reply = `✅ *পরিশোধ সম্পন্ন!*\n👤 ${settled.personName}-এর ${settled.amount.toLocaleString('en-US')} টাকার বকেয়া সফলভাবে পরিশোধ হিসেবে চিহ্নিত করা হলো! 👍`;
            recordHistory(userId, 'bot', reply);
            return reply;
        } else {
            const reply = `❓ "${data.personName || 'ব্যক্তি'}"-এর কোনো পেন্ডিং দেনা বা পাওনা পাওয়া যায়নি। 'দেনা পাওনা লিস্ট' লিখে চেক করুন।`;
            recordHistory(userId, 'bot', reply);
            return reply;
        }
    }

    // Handle CLIENT_ADD
    if (intent === 'CLIENT_ADD') {
        const p = clients.addProject(userId, data);
        const reply = `✅ *ক্লায়েন্ট প্রজেক্ট যুক্ত হয়েছে!*\n\n👤 *ক্লায়েন্ট:* ${p.clientName}\n📝 *কাজ:* ${p.projectTask}\n⏰ *ডেলিভারি ডেডলাইন:* ${p.deadlineReadable}\n\n💡 ডেডলাইনের আগে আমি আপনাকে স্বয়ংক্রিয়ভাবে অ্যালার্ট দেব!`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle CLIENT_LIST
    if (intent === 'CLIENT_LIST') {
        const reply = clients.formatClientList(userId);
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle CLIENT_DONE
    if (intent === 'CLIENT_DONE') {
        const p = clients.markProjectDone(userId, data.clientName);
        let reply = '';
        if (p) {
            reply = `🎉 *সাবাশ! কাজ কমপ্লিট!*\n👤 ক্লায়েন্ট: ${p.clientName}\n📝 কাজ: ${p.projectTask}\nপ্রজেক্টটি সফলভাবে সম্পন্ন হিসেবে চিহ্নিত করা হলো! 👍`;
        } else {
            reply = `❓ "${data.clientName || 'ক্লায়েন্ট'}"-এর কোনো পেন্ডিং কাজ খুঁজে পাওয়া যায়নি। 'ক্লায়েন্ট লিস্ট' লিখে চেক করুন।`;
        }
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle URGENT_ADD
    if (intent === 'URGENT_ADD') {
        const u = urgent.addUrgentTask(userId, data);
        const firstTime = new Date(u.firstAlertISO).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true });
        const reply = `🚨 *নাছোড়বান্দা রিমাইন্ডার সেট করা হয়েছে!*\n\n📝 *বিষয়:* ${u.title}\n⏰ *প্রথম অ্যালার্ম:* ${firstTime}\n🔁 *ব্যবধান:* প্রতি ${u.repeatIntervalMins} মিনিট পর পর\n\n⚠️ *মনে রাখবেন:* নির্দিষ্ট সময় হলে এটি বারবার বাজতে থাকবে যতক্ষণ না আপনি চ্যাটে *"Done"* বা *"কাজ শেষ"* লিখবেন!`;
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle URGENT_CONFIRM
    if (intent === 'URGENT_CONFIRM') {
        const confirmed = urgent.confirmUrgentTask(userId, data.keyword);
        let reply = '';
        if (confirmed) {
            reply = `✅ *অভিনন্দন!* আপনি *"${confirmed.title}"* সম্পন্ন করেছেন।\nনাছোড়বান্দা অ্যালার্ম সফলভাবে বন্ধ করা হলো! 🎯`;
        } else {
            reply = `ℹ️ বর্তমানে কোনো সক্রিয় নাছোড়বান্দা অ্যালার্ম চালু নেই।`;
        }
        recordHistory(userId, 'bot', reply);
        return reply;
    }

    // Handle VAULT_SEARCH
    if (intent === 'VAULT_SEARCH') {
        const match = vault.searchAttachment(userId, data.query);
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
            recordHistory(userId, 'bot', reply);
            return reply;
        } else {
            const reply = `❌ "${data.query}" সম্পর্কিত কোনো ফাইল ভল্টে পাওয়া যায়নি।\nভল্টের সব ফাইল দেখতে লিখুন: *"ভল্ট লিস্ট"*`;
            recordHistory(userId, 'bot', reply);
            return reply;
        }
    }

    // Handle VAULT_LIST
    if (intent === 'VAULT_LIST') {
        const reply = vault.listVaultFiles(userId);
        recordHistory(userId, 'bot', reply);
        return reply;
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
                userId: userId,
                taskText: count > 1 ? `${parsed.taskText} (#${i + 1}/${count})` : parsed.taskText,
                targetDate: itemDate.toISOString(),
                humanReadableTime: itemDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true }),
                completed: false,
                createdAt: new Date().toISOString()
            };

            storage.addReminder(reminder);
            scheduleJob(reminder);
        }

        const deliveryText = (user?.telegramChatId && (user?.whatsappJid || user?.whatsappLid))
            ? 'WhatsApp & Telegram 📲'
            : (platform === 'whatsapp' ? 'WhatsApp' : 'Telegram');

        let confirmText = `✅ *Reminder Set!*\n\n` +
            `📝 *Task:* ${parsed.taskText}\n` +
            `⏰ *Time:* ${parsed.humanReadableTime}`;

        if (count > 1) {
            confirmText += `\n🔁 *Repeat:* মোট ${count} বার (${intervalSec} সেকেন্ড পর পর)`;
        }
        confirmText += `\n📢 *Delivery:* ${deliveryText}`;

        recordHistory(userId, 'bot', confirmText);
        return confirmText;
    }

    return `❓ কথাটি ঠিক বুঝতে পারিনি। আপনি যেকোনো কাজ, খরচ, দেনা-পাওনা, বা রিমাইন্ডার সাধারণ ভাষায় বলতে বা লিখতে পারেন। সাহায্য পেতে লিখুন *"help"* বা *"acho?"*`;
}

// ---------------- TELEGRAM HANDLERS ----------------
telegramBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram User';
    const user = usersService.getOrCreateUser({ platform: 'telegram', id: chatId, name: senderName });

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
            const reply = await processUserCommand(transcribedText, 'telegram', chatId, user.id);
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
            const saved = vault.saveAttachment(user.id, { buffer, originalName, caption, mimeType });

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
            `👋 *স্বাগতম ${user.name}! আমি আপনার অল-ইন-ওয়ান AI পার্সোনাল অ্যাসিস্ট্যান্ট (SIUSHO)।*\n\n` +
            `🛡️ *আপনার জন্য সম্পূর্ণ আলাদা ও সুরক্ষিত প্রাইভেট স্পেস তৈরি করা হয়েছে।* আপনার কোনো তথ্য অন্য কারও সাথে শেয়ার হবে না।\n\n` +
            `নিচের কুইক বাটনগুলো দিয়ে সহজেই কাজ করতে পারেন অথবা সাধারণ ভাষায় লিখে বা **ভয়েস পাঠিয়ে** নির্দেশ দিতে পারেন! 👇`,
            { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD }
        );
    }

    const reply = await processUserCommand(text, 'telegram', chatId, user.id);
    if (reply) {
        return telegramBot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }
});

// Handle Telegram Inline Keyboard Callbacks
telegramBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const senderName = [query.from?.first_name, query.from?.last_name].filter(Boolean).join(' ') || query.from?.username || 'Telegram User';
    const user = usersService.getOrCreateUser({ platform: 'telegram', id: chatId, name: senderName });
    const data = query.data;

    try {
        await telegramBot.answerCallbackQuery(query.id);

        if (data === 'btn_fin_today') {
            return telegramBot.sendMessage(chatId, finance.formatDailyReport(user.id), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_fin_month') {
            return telegramBot.sendMessage(chatId, finance.formatMonthlyReport(user.id), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_dues') {
            return telegramBot.sendMessage(chatId, dues.formatDuesList(user.id), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_clients') {
            return telegramBot.sendMessage(chatId, clients.formatClientList(user.id), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_vault') {
            return telegramBot.sendMessage(chatId, vault.listVaultFiles(user.id), { parse_mode: 'Markdown' });
        }
        if (data === 'btn_link') {
            const code = usersService.generateLinkCode(user.id);
            return telegramBot.sendMessage(chatId,
                `🔗 *আপনার অ্যাকাউন্ট সিঙ্ক কোড:* 👉 \`${code}\` 👈\n\n` +
                `📱 *কীভাবে WhatsApp লিঙ্ক করবেন:*\n` +
                `আপনার WhatsApp থেকে এই বটকে লিখুন:\n` +
                `\`/link ${code}\`\n\n` +
                `⏱️ এই কোডটির মেয়াদ ১৫ মিনিট। লিঙ্ক করার সাথে সাথে আপনার WhatsApp ও Telegram-এর সমস্ত ডেটা এক হয়ে যাবে!`,
                { parse_mode: 'Markdown' }
            );
        }
        if (data === 'btn_profile') {
            let reply = `👤 *আপনার প্রোফাইল তথ্য:*\n━━━━━━━━━━━━━━━━━━━━━\n`;
            reply += `🆔 *ইউজার আইডি:* \`${user.id}\`\n`;
            reply += `📛 *নাম:* ${user.name}\n`;
            reply += `📱 *WhatsApp:* ${user.whatsappPhone ? user.whatsappPhone : (user.whatsappJid ? 'সংযুক্ত ✅' : 'সংযুক্ত নয় ❌')}\n`;
            reply += `🤖 *Telegram:* ${user.telegramChatId ? `সংযুক্ত ✅ (ID: ${user.telegramChatId})` : 'সংযুক্ত নয় ❌'}\n\n`;
            reply += `💡 অন্য ডিভাইস লিঙ্ক করতে লিখুন: \`/link\``;
            return telegramBot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }
        if (data === 'btn_fin_delete') {
            const deleted = finance.deleteLastTransaction(user.id);
            if (deleted) {
                return telegramBot.sendMessage(chatId, `🗑️ *শেষ খরচটি মুছে ফেলা হয়েছে!*\n${deleted.category}: ${deleted.amount} ৳ (${deleted.note || ''})`, { parse_mode: 'Markdown' });
            } else {
                return telegramBot.sendMessage(chatId, `❓ কোনো সাম্প্রতিক খরচ নেই।`);
            }
        }
        if (data.startsWith('done_')) {
            const remId = data.replace('done_', '');
            storage.markReminderDone(remId);
            urgent.confirmUrgentTask(user.id);
            return telegramBot.sendMessage(chatId, `✅ *কাজটি সম্পন্ন হিসেবে চিহ্নিত করা হলো! অ্যালার্ম বন্ধ।* 👍`);
        }
        if (data.startsWith('snooze_')) {
            const oldId = data.replace('snooze_', '');
            const oldRem = storage.getReminderById(oldId);
            const taskText = oldRem ? oldRem.taskText : 'রিমাইন্ডার';
            const targetDate = new Date(Date.now() + 10 * 60 * 1000);
            const newReminder = {
                id: 'rem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                userId: user.id,
                taskText: `${taskText} (স্নুজ)`,
                targetDate: targetDate.toISOString(),
                humanReadableTime: targetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true }),
                completed: false,
                createdAt: new Date().toISOString()
            };
            storage.addReminder(newReminder);
            scheduleJob(newReminder);
            return telegramBot.sendMessage(chatId, `⏰ *১০ মিনিটের জন্য স্নুজ করা হলো!*\n📝 বিষয়: ${newReminder.taskText}\n১০ মিনিট পর আবার মনে করিয়ে দেব।`);
        }
    } catch (err) {
        console.error('Callback query error:', err.message);
    }
});

// ---------------- WHATSAPP HANDLERS ----------------
async function handleWhatsAppText(from, text, msg) {
    if (!from || from.endsWith('@g.us')) return;

    const senderName = msg?.pushName || '';
    const phoneJid = msg?.key?.remoteJid?.includes('@s.whatsapp.net') 
        ? msg.key.remoteJid 
        : (msg?.key?.participant?.includes('@s.whatsapp.net') ? msg.key.participant : null);

    const user = usersService.getOrCreateUser({ platform: 'whatsapp', id: from, name: senderName, phoneJid });
    console.log(`💬 [WhatsApp User: ${user.name} (${user.id})] Command: "${text}"`);

    if (text === '/start') {
        const welcome = `👋 *স্বাগতম ${user.name}! আমি আপনার অল-ইন-ওয়ান AI পার্সোনাল অ্যাসিস্ট্যান্ট (SIUSHO)।*\n\n` +
            `🛡️ *আপনার জন্য সম্পূর্ণ আলাদা ও নিরাপদ প্রাইভেট স্পেস তৈরি করা হয়েছে।* আপনার কোনো তথ্য অন্য কারও সাথে শেয়ার হবে না।\n\n` +
            `আমি যা যা করতে পারি:\n` +
            `1️⃣ 💸 দৈনিক আয়-ব্যয় ট্র্যাকিং ও রাত ১০টায় রিপোর্ট\n` +
            `2️⃣ 🤝 দেনা-পাওনা ও বকেয়া খাতা ('দেনা পাওনার হিসাব')\n` +
            `3️⃣ 👤 ক্লায়েন্ট প্রজেক্ট ও ডেডলাইন ট্র্যাকিং\n` +
            `4️⃣ 🚨 ভাইভা/পরীক্ষার নাছোড়বান্দা অ্যালার্ম\n` +
            `5️⃣ 📂 ফাইল ভল্ট (ছবি/পিডিএফ সেভ ও রিকল)\n` +
            `6️⃣ 🔗 Telegram সিঙ্ক করতে লিখুন: \`/link\`\n` +
            `7️⃣ 🎙️ ভয়েস মেসেজ শুনে কাজ করা!`;
        return sendWhatsAppMessage(from, welcome);
    }

    const reply = await processUserCommand(text, 'whatsapp', from, user.id);
    if (reply) {
        console.log(`📤 [WhatsApp Reply] To: ${from} | Reply: "${reply.slice(0, 50)}..."`);
        return sendWhatsAppMessage(from, reply);
    }
}

async function handleWhatsAppVoice(from, audioBuffer, mimeType, msg) {
    const senderName = msg?.pushName || '';
    const phoneJid = msg?.key?.remoteJid?.includes('@s.whatsapp.net') ? msg.key.remoteJid : null;
    const user = usersService.getOrCreateUser({ platform: 'whatsapp', id: from, name: senderName, phoneJid });

    try {
        await sendWhatsAppMessage(from, '🎙️ আপনার ভয়েস মেসেজ শুনছি...');
        const transcribedText = await voice.transcribeAudio(audioBuffer, mimeType);
        if (!transcribedText) {
            return sendWhatsAppMessage(from, '❌ ভয়েস বুঝতে পারিনি, স্পষ্ট করে আবার বলুন।');
        }

        await sendWhatsAppMessage(from, `🗣️ *আপনি বলেছেন:* "${transcribedText}"`);
        const reply = await processUserCommand(transcribedText, 'whatsapp', from, user.id);
        if (reply) {
            return sendWhatsAppMessage(from, reply);
        }
    } catch (e) {
        console.error('WhatsApp voice processing error:', e.message);
        return sendWhatsAppMessage(from, '❌ ভয়েস প্রসেস করতে সমস্যা হয়েছে।');
    }
}

async function handleWhatsAppMedia(from, buffer, originalName, caption, mimeType, msg) {
    const senderName = msg?.pushName || '';
    const phoneJid = msg?.key?.remoteJid?.includes('@s.whatsapp.net') ? msg.key.remoteJid : null;
    const user = usersService.getOrCreateUser({ platform: 'whatsapp', id: from, name: senderName, phoneJid });

    try {
        const finalCaption = caption ? caption.trim() : originalName;
        const saved = vault.saveAttachment(user.id, { buffer, originalName, caption: finalCaption, mimeType });

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

// ---------------- AUTOMATED MULTI-USER CRON SCHEDULES ----------------
// 1. Daily Finance Report at 10:00 PM (22:00 Dhaka Time) for each user
schedule.scheduleJob('0 22 * * *', async () => {
    console.log('⏰ [Cron] Running Daily Finance Reports for all users (10:00 PM)...');
    const allUsers = usersService.getAllUsers();
    for (const u of allUsers) {
        const summary = finance.getDailySummary(u.id);
        if (summary.items.length > 0) {
            const report = finance.formatDailyReport(u.id);
            await sendUserNotification(u.id, `🌙 *রাত ১০টা: দিন শেষের আর্থিক হিসাব!*\n\n` + report);
        }
    }
});

// 2. Monthly Finance Report on the 1st of every month at 9:00 AM for each user
schedule.scheduleJob('0 9 1 * *', async () => {
    console.log('⏰ [Cron] Running Monthly Finance Reports for all users...');
    const allUsers = usersService.getAllUsers();
    for (const u of allUsers) {
        const report = finance.formatMonthlyReport(u.id);
        await sendUserNotification(u.id, `🗓️ *নতুন মাসের শুরু: বিগত মাসের আর্থিক রিপোর্ট!*\n\n` + report);
    }
});

// 3. Morning Client Deadlines Briefing at 9:00 AM for each user
schedule.scheduleJob('0 9 * * *', async () => {
    console.log('⏰ [Cron] Running Morning Client Briefing for all users (9:00 AM)...');
    const allUsers = usersService.getAllUsers();
    for (const u of allUsers) {
        const pending = clients.getPendingProjects(u.id);
        if (pending.length > 0) {
            const clientList = clients.formatClientList(u.id);
            await sendUserNotification(u.id, `☀️ *শুভ সকাল! আজকের ক্লায়েন্ট প্রজেক্ট আপডেট:*\n\n` + clientList);
        }
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
        await sendUserNotification(t.userId, msg, keyboard);
    }
});

async function handlePairingCode(code) {
    const allUsers = usersService.getAllUsers();
    const primary = allUsers.find(u => u.telegramChatId);
    if (primary && primary.telegramChatId) {
        try {
            await telegramBot.sendMessage(primary.telegramChatId, 
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
console.log('🚀 SIUSHO Multi-User AI Executive Assistant is running smoothly!');
