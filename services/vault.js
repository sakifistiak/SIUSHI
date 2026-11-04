const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'vault.json');
const VAULT_DIR = path.join(__dirname, '..', 'vault_files');

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ files: [] }, null, 2));
    }
    if (!fs.existsSync(VAULT_DIR)) {
        fs.mkdirSync(VAULT_DIR, { recursive: true });
    }
}

function getFiles() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        return data.files || [];
    } catch (e) {
        return [];
    }
}

function saveFiles(files) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ files }, null, 2));
}

function saveAttachment(userId, { buffer, originalName, caption, mimeType }) {
    initDB();
    const safeName = (originalName || 'file_' + Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFileName = `${Date.now()}_${safeName}`;
    const storedPath = path.join(VAULT_DIR, storedFileName);

    fs.writeFileSync(storedPath, buffer);

    const record = {
        id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        userId: userId || 'default',
        originalName: originalName || storedFileName,
        storedPath: storedPath,
        caption: (caption || '').trim(),
        mimeType: mimeType || 'application/octet-stream',
        createdAt: new Date().toISOString()
    };

    const list = getFiles();
    list.push(record);
    saveFiles(list);
    return record;
}

function searchAttachment(userId, query) {
    const list = getFiles();
    if (!query || list.length === 0) return null;

    const userFiles = list.filter(f => !userId || f.userId === userId || (!f.userId && userId === 'default'));
    if (userFiles.length === 0) return null;

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    
    let bestMatch = null;
    let highestScore = 0;

    for (const file of userFiles) {
        const text = `${file.originalName} ${file.caption}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
            if (text.includes(term)) {
                score += 1;
            }
        }
        if (score > highestScore) {
            highestScore = score;
            bestMatch = file;
        }
    }

    if (highestScore > 0 && fs.existsSync(bestMatch.storedPath)) {
        return bestMatch;
    }
    return null;
}

function listVaultFiles(userId) {
    const list = getFiles();
    const userFiles = list.filter(f => !userId || f.userId === userId || (!f.userId && userId === 'default'));
    if (userFiles.length === 0) {
        return `📂 আপনার ভল্টে বর্তমানে কোনো ফাইল বা ডকুমেন্ট সংরক্ষিত নেই।`;
    }

    let msg = `📂 *আপনার ভল্টে সংরক্ষিত ডকুমেন্টসমূহ:*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    userFiles.forEach((f, idx) => {
        msg += `${idx + 1}. 📄 *${f.caption || f.originalName}*\n`;
        msg += `   📎 নাম: \`${f.originalName}\`\n\n`;
    });
    msg += `💡 যেকোনো ফাইল পেতে লিখুন: *"আমার [ফাইলের নাম] পাঠাও"*`;
    return msg;
}

module.exports = {
    saveAttachment,
    searchAttachment,
    listVaultFiles
};
