const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'users.json');

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], linkCodes: {} }, null, 2));
    }
}

function loadUsersData() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        if (!data.users) data.users = [];
        if (!data.linkCodes) data.linkCodes = {};
        return data;
    } catch (e) {
        return { users: [], linkCodes: {} };
    }
}

function saveUsersData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function normalizePhone(input) {
    if (!input) return '';
    let clean = input.replace(/[^0-9]/g, '');
    if (clean.length === 11 && clean.startsWith('01')) {
        clean = '88' + clean;
    }
    return clean;
}

function getOrCreateUser({ platform, id, name, phoneJid }) {
    const data = loadUsersData();
    const strId = String(id);
    let user = null;

    if (platform === 'telegram') {
        user = data.users.find(u => String(u.telegramChatId) === strId);
        if (!user) {
            user = {
                id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                name: name || 'Telegram User',
                telegramChatId: strId,
                whatsappJid: null,
                whatsappPhone: null,
                createdAt: new Date().toISOString()
            };
            data.users.push(user);
            saveUsersData(data);
            console.log(`👤 [New User Registered - Telegram] ID: ${user.id} | Telegram: ${strId}`);
        } else if (name && user.name !== name) {
            user.name = name;
            saveUsersData(data);
        }
        return user;
    }

    if (platform === 'whatsapp') {
        const cleanFrom = strId.split('@')[0].split(':')[0];
        const cleanPhone = phoneJid ? phoneJid.split('@')[0].split(':')[0] : cleanFrom;

        user = data.users.find(u => 
            u.whatsappJid === strId || 
            u.whatsappLid === strId ||
            (u.whatsappPhone && u.whatsappPhone === cleanPhone)
        );

        if (!user) {
            user = {
                id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                name: name || (cleanPhone.startsWith('880') ? '0' + cleanPhone.slice(2) : cleanPhone),
                telegramChatId: null,
                whatsappJid: strId.includes('@s.whatsapp.net') ? strId : (phoneJid || strId),
                whatsappLid: strId.includes('@lid') ? strId : null,
                whatsappPhone: cleanPhone,
                createdAt: new Date().toISOString()
            };
            data.users.push(user);
            saveUsersData(data);
            console.log(`👤 [New User Registered - WhatsApp] ID: ${user.id} | WhatsApp: ${strId} (${cleanPhone})`);
        } else {
            let updated = false;
            if (strId.includes('@lid') && user.whatsappLid !== strId) {
                user.whatsappLid = strId;
                updated = true;
            }
            if (strId.includes('@s.whatsapp.net') && user.whatsappJid !== strId) {
                user.whatsappJid = strId;
                updated = true;
            }
            if (updated) saveUsersData(data);
        }
        return user;
    }

    return null;
}

function getUserById(userId) {
    if (!userId) return null;
    const data = loadUsersData();
    return data.users.find(u => u.id === userId) || null;
}

function getAllUsers() {
    return loadUsersData().users;
}

function generateLinkCode(userId) {
    const data = loadUsersData();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    data.linkCodes[code] = {
        userId,
        expiresAt: Date.now() + 15 * 60 * 1000 // 15 mins
    };
    saveUsersData(data);
    return code;
}

function linkAccountWithCode(code, platform, id, phoneJid) {
    const data = loadUsersData();
    const cleanCode = (code || '').trim();
    const entry = data.linkCodes[cleanCode];

    if (!entry) {
        return { success: false, message: 'সিঙ্ক কোডটি সঠিক নয় বা এটি আগে ব্যবহার করা হয়েছে।' };
    }
    if (Date.now() > entry.expiresAt) {
        delete data.linkCodes[cleanCode];
        saveUsersData(data);
        return { success: false, message: 'সিঙ্ক কোডের মেয়াদ শেষ হয়ে গেছে। নতুন কোড জেনারেট করে চেষ্টা করুন।' };
    }

    const targetUser = data.users.find(u => u.id === entry.userId);
    if (!targetUser) {
        delete data.linkCodes[cleanCode];
        saveUsersData(data);
        return { success: false, message: 'মূল অ্যাকাউন্টটি পাওয়া যায়নি।' };
    }

    const strId = String(id);
    if (platform === 'telegram') {
        data.users = data.users.filter(u => u.id === targetUser.id || String(u.telegramChatId) !== strId);
        targetUser.telegramChatId = strId;
    } else if (platform === 'whatsapp') {
        const cleanFrom = strId.split('@')[0].split(':')[0];
        const cleanPhone = phoneJid ? phoneJid.split('@')[0].split(':')[0] : cleanFrom;
        data.users = data.users.filter(u => u.id === targetUser.id || (u.whatsappJid !== strId && u.whatsappPhone !== cleanPhone));
        targetUser.whatsappJid = strId.includes('@s.whatsapp.net') ? strId : (phoneJid || strId);
        if (strId.includes('@lid')) targetUser.whatsappLid = strId;
        targetUser.whatsappPhone = cleanPhone;
    }

    delete data.linkCodes[cleanCode];
    saveUsersData(data);
    console.log(`🔗 [Account Linked] User: ${targetUser.id} successfully linked to ${platform}: ${strId}`);
    return { success: true, user: targetUser };
}

module.exports = {
    getOrCreateUser,
    getUserById,
    getAllUsers,
    generateLinkCode,
    linkAccountWithCode,
    normalizePhone
};
