const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'clients.json');

function initDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ projects: [] }, null, 2));
    }
}

function getProjects() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        return data.projects || [];
    } catch (e) {
        return [];
    }
}

function saveProjects(projects) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ projects }, null, 2));
}

function addProject({ clientName, projectTask, deadlineISO, fee }) {
    const list = getProjects();
    const item = {
        id: 'cp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        clientName: clientName || 'ক্লায়েন্ট',
        projectTask: projectTask || 'প্রজেক্ট কাজ',
        deadlineISO: deadlineISO,
        deadlineReadable: new Date(deadlineISO).toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true }),
        fee: fee || '',
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    list.push(item);
    saveProjects(list);
    return item;
}

function getPendingProjects() {
    const list = getProjects();
    return list.filter(p => p.status === 'pending');
}

function markProjectDone(query) {
    const list = getProjects();
    const clean = (query || '').toLowerCase().trim();
    const item = list.find(p => p.status === 'pending' && (
        p.id === clean || 
        p.clientName.toLowerCase().includes(clean) || 
        p.projectTask.toLowerCase().includes(clean)
    ));

    if (item) {
        item.status = 'completed';
        item.completedAt = new Date().toISOString();
        saveProjects(list);
        return item;
    }
    return null;
}

function formatClientList() {
    const pending = getPendingProjects();
    if (pending.length === 0) {
        return `🎉 আপনার বর্তমানে কোনো পেন্ডিং ক্লায়েন্ট প্রজেক্ট নেই! সব কাজ শেষ।`;
    }

    let msg = `📋 *চলমান ক্লায়েন্ট প্রজেক্ট ও ডেডলাইনের তালিকা:*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    pending.forEach((p, idx) => {
        const diffDays = Math.ceil((new Date(p.deadlineISO).getTime() - Date.now()) / (1000 * 3600 * 24));
        let urgency = '';
        if (diffDays < 0) urgency = '⚠️ (ডেডলাইন পার হয়ে গেছে!)';
        else if (diffDays === 0) urgency = '🚨 (আজকেই ডেডলাইন!)';
        else if (diffDays <= 2) urgency = `⏳ (বাকি আছে মাত্র ${diffDays} দিন!)`;
        else urgency = `🗓️ (বাকি ${diffDays} দিন)`;

        msg += `${idx + 1}. 👤 *ক্লায়েন্ট:* ${p.clientName}\n`;
        msg += `   📝 *কাজ:* ${p.projectTask}\n`;
        msg += `   ⏰ *ডেলিভারি:* ${p.deadlineReadable} ${urgency}\n`;
        if (p.fee) msg += `   💵 *বাজেট/ফি:* ${p.fee}\n`;
        msg += `\n`;
    });

    msg += `💡 কোনো কাজ শেষ হলে লিখুন: *"কাজ শেষ [ক্লায়েন্টের নাম]"*`;
    return msg;
}

module.exports = {
    addProject,
    getPendingProjects,
    markProjectDone,
    formatClientList
};
