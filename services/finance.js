const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'finance.json');

function initDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ transactions: [] }, null, 2));
    }
}

function getTransactions() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        return data.transactions || [];
    } catch (e) {
        return [];
    }
}

function saveTransactions(transactions) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ transactions }, null, 2));
}

function addTransaction({ type, amount, category, note }) {
    const list = getTransactions();
    const now = new Date();
    // Dhaka Date: YYYY-MM-DD
    const offset = 6 * 60;
    const dhakaTime = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
    const dateStr = dhakaTime.toISOString().split('T')[0];
    const monthStr = dateStr.substring(0, 7); // YYYY-MM

    const numAmount = Math.abs(parseFloat(amount) || 0);

    const item = {
        id: 'fin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: type === 'income' ? 'income' : 'expense',
        amount: numAmount,
        category: category || (type === 'income' ? 'ইনকাম' : 'অন্যান্য খরচ'),
        note: note || '',
        date: dateStr,
        month: monthStr,
        createdAt: now.toISOString()
    };

    list.push(item);
    saveTransactions(list);
    return item;
}

function updateLastTransaction(fields) {
    const list = getTransactions();
    if (list.length === 0) return null;

    const last = list[list.length - 1];
    if (fields.amount !== undefined && fields.amount !== null && fields.amount > 0) {
        last.amount = parseFloat(fields.amount);
    }
    if (fields.category) {
        last.category = fields.category;
    }
    if (fields.note) {
        last.note = fields.note;
    }
    if (fields.type) {
        last.type = fields.type;
    }

    last.updatedAt = new Date().toISOString();
    saveTransactions(list);
    return last;
}

function deleteLastTransaction() {
    const list = getTransactions();
    if (list.length === 0) return null;

    const removed = list.pop();
    saveTransactions(list);
    return removed;
}

function getDailySummary(targetDateStr) {
    const list = getTransactions();
    const date = targetDateStr || (new Date(Date.now() + 6 * 3600 * 1000)).toISOString().split('T')[0];
    const dayItems = list.filter(t => t.date === date);

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryBreakdown = {};

    dayItems.forEach(t => {
        if (t.type === 'income') {
            totalIncome += t.amount;
        } else {
            totalExpense += t.amount;
            categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
        }
    });

    return {
        date,
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        count: dayItems.length,
        items: dayItems,
        categoryBreakdown
    };
}

function getMonthlySummary(targetMonthStr) {
    const list = getTransactions();
    const month = targetMonthStr || (new Date(Date.now() + 6 * 3600 * 1000)).toISOString().substring(0, 7);
    const monthItems = list.filter(t => t.month === month);

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryBreakdown = {};

    monthItems.forEach(t => {
        if (t.type === 'income') {
            totalIncome += t.amount;
        } else {
            totalExpense += t.amount;
            categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
        }
    });

    return {
        month,
        totalIncome,
        totalExpense,
        savings: totalIncome - totalExpense,
        count: monthItems.length,
        categoryBreakdown
    };
}

function formatDailyReport(targetDateStr) {
    const summary = getDailySummary(targetDateStr);
    let msg = `📊 *আজকের আর্থিক হিসাব (${summary.date})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💵 *মোট আয়:* ${summary.totalIncome.toLocaleString('en-US')} ৳\n`;
    msg += `💸 *মোট ব্যয়:* ${summary.totalExpense.toLocaleString('en-US')} ৳\n`;
    const balanceSign = summary.balance >= 0 ? '+' : '';
    msg += `💰 *আজকের নেট ব্যালেন্স:* ${balanceSign}${summary.balance.toLocaleString('en-US')} ৳\n`;

    if (summary.items.length > 0) {
        msg += `\n📝 *লেনদেনের বিবরণ:*\n`;
        summary.items.forEach((item, idx) => {
            const icon = item.type === 'income' ? '🟢' : '🔴';
            const sign = item.type === 'income' ? '+' : '-';
            msg += `${idx + 1}. ${icon} ${item.category}: ${sign}${item.amount} ৳ ${item.note ? `(${item.note})` : ''}\n`;
        });
    } else {
        msg += `\n(আজ কোনো লেনদেন রেকর্ড করা হয়নি)\n`;
    }

    return msg;
}

function formatMonthlyReport(targetMonthStr) {
    const summary = getMonthlySummary(targetMonthStr);
    let msg = `📅 *মাসিক আর্থিক সারসংক্ষেপ (${summary.month})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💵 *পুরো মাসের মোট আয়:* ${summary.totalIncome.toLocaleString('en-US')} ৳\n`;
    msg += `💸 *পুরো মাসের মোট ব্যয়:* ${summary.totalExpense.toLocaleString('en-US')} ৳\n`;
    const sign = summary.savings >= 0 ? '+' : '';
    msg += `💰 *মোট সঞ্চয় (Savings):* ${sign}${summary.savings.toLocaleString('en-US')} ৳\n\n`;

    const cats = Object.entries(summary.categoryBreakdown);
    if (cats.length > 0) {
        msg += `📁 *খাতভিত্তিক খরচের তালিকা:*\n`;
        cats.forEach(([cat, amt]) => {
            msg += `• ${cat}: ${amt.toLocaleString('en-US')} ৳\n`;
        });
    }

    return msg;
}

module.exports = {
    addTransaction,
    updateLastTransaction,
    deleteLastTransaction,
    getDailySummary,
    getMonthlySummary,
    formatDailyReport,
    formatMonthlyReport
};
