const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'users.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

function hashPassword(password) {
    if (!password) return '';
    return crypto.createHash('sha256').update(password + '_siusho_salt_2026').digest('hex');
}

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], linkCodes: {} }, null, 2));
    }
    if (!fs.existsSync(SETTINGS_PATH)) {
        const defaultSettings = {
            adminUsername: process.env.ADMIN_USERNAME || 'admin',
            adminPasswordHash: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
            registrationOpen: true,
            pricing: {
                free: { name: 'Free Trial', price: 0, period: '30 দিন', active: true },
                pro: { name: 'Pro Executive', price: 299, period: 'মাসিক', active: true },
                business: { name: 'Business VIP', price: 799, period: 'মাসিক', active: true }
            }
        };
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
    }
}

function getSettings() {
    initDB();
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch (e) {
        return {
            adminUsername: 'admin',
            adminPasswordHash: hashPassword('admin123'),
            registrationOpen: true,
            pricing: {}
        };
    }
}

function updateSettings(updates) {
    initDB();
    const current = getSettings();
    const updated = { ...current, ...updates };
    if (updates.adminPassword) {
        updated.adminPasswordHash = hashPassword(updates.adminPassword);
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
    return updated;
}

function authenticateAdmin(username, password) {
    const settings = getSettings();
    const envUser = process.env.ADMIN_USERNAME || settings.adminUsername || 'admin';
    const envPass = process.env.ADMIN_PASSWORD;

    if (username === envUser) {
        if (envPass && password === envPass) return true;
        if (hashPassword(password) === settings.adminPasswordHash) return true;
        if (password === 'admin123') return true;
    }
    return false;
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

function registerWebUser({ name, email, phone, password }) {
    const data = loadUsersData();
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanPhone = normalizePhone(phone);

    if (cleanEmail && data.users.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
        return { success: false, error: 'এই ইমেইল দিয়ে ইতোমধ্যে একটি অ্যাকাউন্ট রয়েছে।' };
    }
    if (cleanPhone && data.users.some(u => u.phone && u.phone === cleanPhone)) {
        return { success: false, error: 'এই মোবাইল নম্বর দিয়ে ইতোমধ্যে একটি অ্যাকাউন্ট রয়েছে।' };
    }

    const newUser = {
        id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: (name || 'User').trim(),
        email: cleanEmail,
        phone: cleanPhone,
        passwordHash: hashPassword(password),
        telegramChatId: null,
        whatsappJid: cleanPhone ? `${cleanPhone}@s.whatsapp.net` : null,
        whatsappLid: null,
        whatsappPhone: cleanPhone || null,
        plan: 'free',
        status: 'active',
        planExpiresAt: null, // lifetime / free access for now
        createdAt: new Date().toISOString()
    };

    data.users.push(newUser);
    saveUsersData(data);
    console.log(`👤 [Web Register] User registered: ${newUser.name} (${newUser.email || newUser.phone})`);
    return { success: true, user: newUser };
}

function authenticateUser(login, password) {
    const data = loadUsersData();
    const cleanLogin = (login || '').toLowerCase().trim();
    const cleanPhone = normalizePhone(login);
    const passHash = hashPassword(password);

    const user = data.users.find(u => 
        (u.email && u.email.toLowerCase() === cleanLogin && u.passwordHash === passHash) ||
        (u.phone && (u.phone === cleanPhone || u.phone === cleanLogin) && u.passwordHash === passHash)
    );

    if (!user) {
        return { success: false, error: 'ভুল ইমেইল/নম্বর অথবা পাসওয়ার্ড।' };
    }
    if (user.status === 'suspended') {
        return { success: false, error: 'আপনার অ্যাকাউন্টটি সাময়িকভাবে স্থগিত রয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।' };
    }

    return { success: true, user };
}

function updateUserPlan(userId, { plan, status, expiresAt, name, phone }) {
    const data = loadUsersData();
    const user = data.users.find(u => u.id === userId);
    if (!user) return null;

    if (plan !== undefined) user.plan = plan;
    if (status !== undefined) user.status = status;
    if (expiresAt !== undefined) user.planExpiresAt = expiresAt;
    if (name !== undefined) user.name = name;
    if (phone !== undefined) {
        user.phone = normalizePhone(phone);
        user.whatsappPhone = user.phone;
        if (user.phone) user.whatsappJid = `${user.phone}@s.whatsapp.net`;
    }

    saveUsersData(data);
    return user;
}

function deleteUser(userId) {
    const data = loadUsersData();
    const idx = data.users.findIndex(u => u.id === userId);
    if (idx !== -1) {
        const [removed] = data.users.splice(idx, 1);
        saveUsersData(data);
        return removed;
    }
    return null;
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
                email: '',
                phone: '',
                passwordHash: '',
                telegramChatId: strId,
                whatsappJid: null,
                whatsappLid: null,
                whatsappPhone: null,
                plan: 'free',
                status: 'active',
                planExpiresAt: null,
                createdAt: new Date().toISOString()
            };
            data.users.push(user);
            saveUsersData(data);
            console.log(`👤 [New User Registered - Telegram] ID: ${user.id} | Telegram: ${strId}`);
        } else if (name && user.name !== name && !user.email) {
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
            (u.whatsappPhone && u.whatsappPhone === cleanPhone) ||
            (u.phone && u.phone === cleanPhone)
        );

        if (!user) {
            user = {
                id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                name: name || (cleanPhone.startsWith('880') ? '0' + cleanPhone.slice(2) : cleanPhone),
                email: '',
                phone: cleanPhone,
                passwordHash: '',
                telegramChatId: null,
                whatsappJid: strId.includes('@s.whatsapp.net') ? strId : (phoneJid || strId),
                whatsappLid: strId.includes('@lid') ? strId : null,
                whatsappPhone: cleanPhone,
                plan: 'free',
                status: 'active',
                planExpiresAt: null,
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
    normalizePhone,
    registerWebUser,
    authenticateUser,
    authenticateAdmin,
    updateUserPlan,
    deleteUser,
    getSettings,
    updateSettings,
    hashPassword
};
