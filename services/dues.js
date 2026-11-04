const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'dues.json');

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ dues: [] }, null, 2));
    }
}

function getDues() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        return data.dues || [];
    } catch (e) {
        return [];
    }
}

function saveDues(dues) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ dues }, null, 2));
}

function addDue(userId, { type, personName, amount, note }) {
    const list = getDues();
    const item = {
        id: 'due_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        userId: userId || 'default',
        type: type === 'payable' ? 'payable' : 'receivable',
        personName: (personName || 'ব্যক্তি').trim(),
        amount: Math.abs(parseFloat(amount) || 0),
        note: (note || '').trim(),
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    list.push(item);
    saveDues(list);
    return item;
}

function settleDue(userId, query) {
    const list = getDues();
    const clean = (query || '').toLowerCase().trim();
    const item = list.find(d => 
        d.status === 'pending' && 
        (!userId || d.userId === userId || (!d.userId && userId === 'default')) && (
            d.id === clean || 
            d.personName.toLowerCase().includes(clean)
        )
    );

    if (item) {
        item.status = 'settled';
        item.settledAt = new Date().toISOString();
        saveDues(list);
        return item;
    }
    return null;
}

function getActiveDues(userId) {
    return getDues().filter(d => 
        d.status === 'pending' && 
        (!userId || d.userId === userId || (!d.userId && userId === 'default'))
    );
}

function formatDuesList(userId) {
    const active = getActiveDues(userId);
    if (active.length === 0) {
        return `🎉 আপনার বর্তমানে কারো কাছে কোনো দেনা বা পাওনা বাকি নেই! খাতা একদম পরিষ্কার।`;
    }

    const receivables = active.filter(d => d.type === 'receivable');
    const payables = active.filter(d => d.type === 'payable');

    let totalReceivable = 0;
    let totalPayable = 0;

    let msg = `🤝 *দেনা-পাওনা ও বকেয়া খাতা:*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (receivables.length > 0) {
        msg += `🟢 *আপনি যাদের কাছে টাকা পাবেন (পাওনা):*\n`;
        receivables.forEach((d, idx) => {
            totalReceivable += d.amount;
            msg += `${idx + 1}. 👤 *${d.personName}:* ${d.amount.toLocaleString('en-US')} ৳ ${d.note ? `(${d.note})` : ''}\n`;
        });
        msg += `👉 *মোট পাওনা:* ${totalReceivable.toLocaleString('en-US')} ৳\n\n`;
    }

    if (payables.length > 0) {
        msg += `🔴 *আপনাকে যাদের টাকা দিতে হবে (দেনা):*\n`;
        payables.forEach((d, idx) => {
            totalPayable += d.amount;
            msg += `${idx + 1}. 👤 *${d.personName}:* ${d.amount.toLocaleString('en-US')} ৳ ${d.note ? `(${d.note})` : ''}\n`;
        });
        msg += `👉 *মোট দেনা:* ${totalPayable.toLocaleString('en-US')} ৳\n\n`;
    }

    const net = totalReceivable - totalPayable;
    const netSign = net >= 0 ? '+' : '';
    msg += `💰 *নেট হিসাব:* ${netSign}${net.toLocaleString('en-US')} ৳\n`;
    msg += `💡 কোনো বকেয়া শোধ হলে লিখুন: *"পরিশোধ [ব্যক্তির নাম]"*`;

    return msg;
}

module.exports = {
    addDue,
    settleDue,
    getActiveDues,
    formatDuesList
};
