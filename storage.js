const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DB_FILE)) {
        const initial = {
            users: {
                telegramChatId: null,
                whatsappChatId: null
            },
            reminders: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch (e) {
        return { users: { telegramChatId: null, whatsappChatId: null }, reminders: [] };
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

function addReminder(reminder) {
    const data = loadData();
    data.reminders.push(reminder);
    saveData(data);
}

function getPendingReminders() {
    const data = loadData();
    return data.reminders.filter(r => !r.completed);
}

function markReminderDone(id) {
    const data = loadData();
    const item = data.reminders.find(r => r.id === id);
    if (item) {
        item.completed = true;
        saveData(data);
    }
}

module.exports = {
    loadData,
    setTelegramUser,
    setWhatsAppUser,
    getUsers,
    addReminder,
    getPendingReminders,
    markReminderDone
};
