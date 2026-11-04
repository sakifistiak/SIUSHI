const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function normalizePhoneNumber(input) {
    if (!input) return '';
    let clean = input.replace(/[^0-9]/g, '');
    if (clean.length === 11 && clean.startsWith('01')) {
        clean = '88' + clean;
    }
    return clean;
}

function loadData() {
    if (!fs.existsSync(DB_FILE)) {
        const initial = {
            users: {
                telegramChatId: null,
                whatsappChatId: null,
                authorizedWhatsApp: []
            },
            reminders: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        if (!data.users) data.users = {};
        if (!data.users.authorizedWhatsApp) data.users.authorizedWhatsApp = [];
        if (!data.reminders) data.reminders = [];
        return data;
    } catch (e) {
        return { users: { telegramChatId: null, whatsappChatId: null, authorizedWhatsApp: [] }, reminders: [] };
    }
}

function saveData(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function setTelegramUser(chatId) {
    const data = loadData();
    data.users.telegramChatId = chatId;
    saveData(data);
}

function setWhatsAppUser(chatId) {
    const data = loadData();
    data.users.whatsappChatId = chatId;
    saveData(data);
}

function getUsers() {
    return loadData().users;
}

function getAuthorizedNumbers() {
    const data = loadData();
    const envNumbers = (process.env.AUTHORIZED_NUMBERS || '')
        .split(',')
        .map(n => normalizePhoneNumber(n))
        .filter(Boolean);

    const botNum = normalizePhoneNumber(process.env.BOT_PHONE_NUMBER || '');
    const list = data.users.authorizedWhatsApp || [];

    const set = new Set([...list, ...envNumbers]);
    if (botNum) set.add(botNum);
    return Array.from(set);
}

function addAuthorizedNumber(rawNumber) {
    const clean = normalizePhoneNumber(rawNumber);
    if (!clean || clean.length < 8) return null;

    const data = loadData();
    if (!data.users.authorizedWhatsApp) {
        data.users.authorizedWhatsApp = [];
    }
    if (!data.users.authorizedWhatsApp.includes(clean)) {
        data.users.authorizedWhatsApp.push(clean);
        saveData(data);
    }
    return clean;
}

function removeAuthorizedNumber(rawNumber) {
    const clean = normalizePhoneNumber(rawNumber);
    if (!clean) return false;

    const data = loadData();
    if (!data.users.authorizedWhatsApp) return false;

    const idx = data.users.authorizedWhatsApp.indexOf(clean);
    if (idx !== -1) {
        data.users.authorizedWhatsApp.splice(idx, 1);
        saveData(data);
        return true;
    }
    return false;
}

function isWhatsAppAuthorized(from) {
    if (!from || from.endsWith('@g.us')) return false;

    const data = loadData();
    const users = data.users || {};
    const authorizedList = getAuthorizedNumbers();
    const botNum = normalizePhoneNumber(process.env.BOT_PHONE_NUMBER || '');

    const fromClean = from.split('@')[0].split(':')[0];

    // Direct match with primary whatsappChatId
    if (users.whatsappChatId) {
        const primaryClean = users.whatsappChatId.split('@')[0].split(':')[0];
        if (from === users.whatsappChatId || fromClean === primaryClean) return true;
    }

    // Direct match with BOT_PHONE_NUMBER
    if (botNum && fromClean === botNum) return true;

    // Direct match with any dynamically authorized number
    for (const num of authorizedList) {
        if (fromClean === num || from.startsWith(num)) return true;
    }

    // If completely new and no users are registered yet, allow initial onboarding
    if (!users.whatsappChatId && authorizedList.length === 0) return true;

    return false;
}

function formatAuthorizedNumbersList() {
    const list = getAuthorizedNumbers();
    const users = getUsers();
    const primary = users.whatsappChatId ? users.whatsappChatId.split('@')[0] : (process.env.BOT_PHONE_NUMBER || 'সেট করা নেই');

    let text = `📱 *অনুমোদিত WhatsApp নম্বরসমূহ:*\n━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `👑 *মূল নম্বর (Primary):* \`${primary}\`\n\n`;

    const secondaries = list.filter(n => n !== primary && n !== normalizePhoneNumber(primary));

    if (secondaries.length === 0) {
        text += `ℹ️ কোনো সেকেন্ডারি নম্বর এখনো যোগ করা হয়নি।\n\n💡 *নম্বর যোগ করতে লিখুন:*\n\`নম্বর যোগ করো 017xxxxxxxx\`\nবা ড্যাশবোর্ড থেকে সহজেই যোগ করতে পারেন।`;
    } else {
        text += `👥 *অনুমোদিত সেকেন্ডারি নম্বরসমূহ (${secondaries.length}টি):*\n`;
        secondaries.forEach((num, i) => {
            text += `${i + 1}. \`${num}\`\n`;
        });
        text += `\n💡 *মুছে ফেলতে লিখুন:* \`নম্বর মুছে ফেলো 017xxxxxxxx\``;
    }

    return text;
}

function addReminder(reminder) {
    const data = loadData();
    data.reminders.push(reminder);
    saveData(data);
}

function getPendingReminders() {
    const data = loadData();
    return data.reminders.filter(r => !r.completed);
}

function getRemindersByUser(userId) {
    const data = loadData();
    return data.reminders.filter(r => (!userId || r.userId === userId) && !r.completed);
}

function getReminderById(id) {
    const data = loadData();
    return data.reminders.find(r => r.id === id) || null;
}

function getLastReminderByUser(userId) {
    const data = loadData();
    for (let i = data.reminders.length - 1; i >= 0; i--) {
        const r = data.reminders[i];
        if (!userId || r.userId === userId) {
            return r;
        }
    }
    return null;
}

function markReminderDone(id) {
    const data = loadData();
    const item = data.reminders.find(r => r.id === id);
    if (item) {
        item.completed = true;
        saveData(data);
        return true;
    }
    return false;
}

function cancelReminder(id, userId) {
    const data = loadData();
    const item = data.reminders.find(r => r.id === id && (!userId || r.userId === userId));
    if (item) {
        item.completed = true;
        item.cancelled = true;
        saveData(data);
        return item;
    }
    return null;
}

module.exports = {
    loadData,
    setTelegramUser,
    setWhatsAppUser,
    getUsers,
    getAuthorizedNumbers,
    addAuthorizedNumber,
    removeAuthorizedNumber,
    isWhatsAppAuthorized,
    formatAuthorizedNumbersList,
    normalizePhoneNumber,
    addReminder,
    getPendingReminders,
    getRemindersByUser,
    getReminderById,
    getLastReminderByUser,
    markReminderDone,
    cancelReminder
};
