const fs = require('fs');
const path = require('path');
const sheetsService = require('./sheets');
const db = require('./db');

const DB_PATH = path.join(__dirname, '..', 'data', 'finance.json');

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ transactions: [] }, null, 2));
    }
}

function getTransactions() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        if (Array.isArray(data)) return data;
        return data.transactions || [];
    } catch (e) {
        return [];
    }
}

function saveTransactions(transactions) {
    const list = Array.isArray(transactions) ? transactions : [];
    fs.writeFileSync(DB_PATH, JSON.stringify({ transactions: list }, null, 2));
    // Asynchronously save to cloud database if connected
    db.saveCollection('finance', list).catch(e => {
        console.warn('[DB Save Finance]:', e.message);
    });
}

/**
 * Standardized High-Accuracy Transaction Adding
 * Resolves all timezone calculation mismatches and Bengali digit parsing
 */
function addTransaction(userId, { type, amount, category, note }) {
    const list = getTransactions();
    const now = new Date();

    // Standard Dhaka Timezone Date & Month (fixes midnight date mismatch bug)
    const dateStr = db.getDhakaDateString(now);
    const monthStr = db.getDhakaMonthString(now);

    // Convert any Bengali digits to English and safely parse absolute amount
    const cleanAmountStr = db.bengaliToEnglishDigits(String(amount || '0')).replace(/[^0-9.]/g, '');
    const numAmount = Math.abs(parseFloat(cleanAmountStr) || 0);

    const item = {
        id: 'fin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        userId: userId || 'default',
        type: type === 'income' ? 'income' : 'expense',
        amount: numAmount,
        category: (category || (type === 'income' ? 'ইনকাম' : 'অন্যান্য খরচ')).trim(),
        note: (note || '').trim(),
        date: dateStr,
        month: monthStr,
        createdAt: now.toISOString()
    };

    list.push(item);
    saveTransactions(list);

    // Asynchronous non-blocking dispatch to Google Sheets webhook
    try {
        const usersService = require('./users');
        const user = usersService.getUserById(userId);
        const settings = usersService.getSettings();
        const webhookUrl = (user && user.googleSheetsWebhookUrl) || settings.googleSheetsWebhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL;
        if (webhookUrl) {
            sheetsService.syncTransactionToSheet(item, user, webhookUrl).catch(e => {
                console.warn('[Sheets Sync Background]:', e.message);
            });
        }
    } catch (e) {
        // Non-blocking
    }

    return item;
}

function updateLastTransaction(userId, fields) {
    const list = getTransactions();
    let lastIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
        if (!userId || list[i].userId === userId || !list[i].userId) {
            lastIdx = i;
            break;
        }
    }
    if (lastIdx === -1) return null;

    const last = list[lastIdx];
    if (fields.amount !== undefined && fields.amount !== null) {
        const cleanAmt = db.bengaliToEnglishDigits(String(fields.amount)).replace(/[^0-9.]/g, '');
        const parsed = parseFloat(cleanAmt);
        if (parsed > 0) last.amount = parsed;
    }
    if (fields.category) {
        last.category = fields.category.trim();
    }
    if (fields.note !== undefined) {
        last.note = fields.note.trim();
    }
    if (fields.type) {
        last.type = fields.type;
    }

    last.updatedAt = new Date().toISOString();
    saveTransactions(list);
    return last;
}

function deleteLastTransaction(userId) {
    const list = getTransactions();
    let lastIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
        if (!userId || list[i].userId === userId || !list[i].userId) {
            lastIdx = i;
            break;
        }
    }
    if (lastIdx === -1) return null;

    const [removed] = list.splice(lastIdx, 1);
    saveTransactions(list);
    return removed;
}

/**
 * High-Accuracy Daily Summary (using official Dhaka Date String)
 */
function getDailySummary(userId, targetDateStr) {
    const list = getTransactions();
    const date = targetDateStr || db.getDhakaDateString(new Date());

    const dayItems = list.filter(t => 
        (!userId || t.userId === userId || (!t.userId && userId === 'default')) && 
        t.date === date
    );

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryBreakdown = {};

    dayItems.forEach(t => {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'income') {
            totalIncome += amt;
        } else {
            totalExpense += amt;
            categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + amt;
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

/**
 * High-Accuracy Monthly Summary (using official Dhaka Month String)
 */
function getMonthlySummary(userId, targetMonthStr) {
    const list = getTransactions();
    const month = targetMonthStr || db.getDhakaMonthString(new Date());

    const monthItems = list.filter(t => 
        (!userId || t.userId === userId || (!t.userId && userId === 'default')) && 
        t.month === month
    );

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryBreakdown = {};

    monthItems.forEach(t => {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'income') {
            totalIncome += amt;
        } else {
            totalExpense += amt;
            categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + amt;
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

function formatDailyReport(userId, targetDateStr) {
    const summary = getDailySummary(userId, targetDateStr);
    let msg = `*আজকের আর্থিক হিসাব (${summary.date})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `*মোট আয়:* ${summary.totalIncome.toLocaleString('en-US')} ৳\n`;
    msg += `*মোট ব্যয়:* ${summary.totalExpense.toLocaleString('en-US')} ৳\n`;
    const balanceSign = summary.balance >= 0 ? '+' : '';
    msg += `*আজকের নেট ব্যালেন্স:* ${balanceSign}${summary.balance.toLocaleString('en-US')} ৳\n`;

    if (summary.items.length > 0) {
        msg += `\n*লেনদেনের বিবরণ:*\n`;
        summary.items.forEach((item, idx) => {
            const tag = item.type === 'income' ? '[আয়]' : '[ব্যয়]';
            const sign = item.type === 'income' ? '+' : '-';
            msg += `${idx + 1}. ${tag} ${item.category}: ${sign}${item.amount.toLocaleString('en-US')} ৳ ${item.note ? `(${item.note})` : ''}\n`;
        });
    } else {
        msg += `\n(আজ কোনো লেনদেন রেকর্ড করা হয়নি)\n`;
    }

    return msg;
}

function formatMonthlyReport(userId, targetMonthStr) {
    const summary = getMonthlySummary(userId, targetMonthStr);
    let msg = `*মাসিক আর্থিক সারসংক্ষেপ (${summary.month})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `*পুরো মাসের মোট আয়:* ${summary.totalIncome.toLocaleString('en-US')} ৳\n`;
    msg += `*পুরো মাসের মোট ব্যয়:* ${summary.totalExpense.toLocaleString('en-US')} ৳\n`;
    const sign = summary.savings >= 0 ? '+' : '';
    msg += `*মোট সঞ্চয় (Savings):* ${sign}${summary.savings.toLocaleString('en-US')} ৳\n\n`;

    const cats = Object.entries(summary.categoryBreakdown);
    if (cats.length > 0) {
        msg += `*খাতভিত্তিক খরচের তালিকা:*\n`;
        cats.forEach(([cat, amt]) => {
            msg += `• ${cat}: ${amt.toLocaleString('en-US')} ৳\n`;
        });
    }

    return msg;
}

/**
 * Fast Rule-Based Quick Parser for Daily Income & Expenses (0ms latency)
 */
function parseQuickFinance(text) {
    if (!text) return null;
    const clean = db.bengaliToEnglishDigits(text.trim());

    // 1. Income expressions
    const incomeMatch = clean.match(/(?:ইনকাম|income|বেতন|salary|পেলেন|পেলাম|দিলো|dilam|pelam|লাভ)\s*(?:হলো|হল|হয়েছে)?\s*(\d+(?:\.\d+)?)\s*(?:টাকা|tk|taka)?/i) ||
                        clean.match(/(\d+(?:\.\d+)?)\s*(?:টাকা|tk|taka)?\s*(?:ইনকাম|income|বেতন|salary|পেলাম|pelam)/i);

    if (incomeMatch) {
        const amount = parseFloat(incomeMatch[1]);
        if (amount > 0) {
            let note = clean.replace(incomeMatch[0], '').trim();
            return { type: 'income', amount, category: 'ইনকাম', note };
        }
    }

    // 2. Expense: Category then Amount
    // e.g. 'চা ২০', 'চা ২০ টাকা', 'লাঞ্চ ১৫০ টাকা খরচ', 'রিকশা ভাড়া ৩০', 'কাঁচাবাজার ৫০০', 'খাবার খরচ ২০০'
    const expMatch = clean.match(/^([a-zA-Z\u0980-\u09FF\s]{2,18}?)\s*(\d+(?:\.\d+)?)\s*(?:টাকা|tk|taka)?(?:\s*(?:খরচ|khoroch|diyechi|দিলাম|দিচি))?$/i);
    if (expMatch && !/^(সকাল|দুপুর|রাত|মিনিট|ঘণ্টা|দিন|bar|বার|কাল|আজ|পরশু)/i.test(expMatch[1])) {
        const cat = expMatch[1].trim();
        const amount = parseFloat(expMatch[2]);
        if (amount > 0) {
            return { type: 'expense', amount, category: cat, note: '' };
        }
    }

    // 3. Expense: Amount then Category
    // e.g. '৫০ টাকা রিকশা ভাড়া', '150 tk lunch'
    const expMatch2 = clean.match(/^(\d+(?:\.\d+)?)\s*(?:টাকা|tk|taka)\s*(?:খরচ|khoroch)?\s*(.+)$/i);
    if (expMatch2) {
        const amount = parseFloat(expMatch2[1]);
        const cat = expMatch2[2].trim();
        if (amount > 0) {
            return { type: 'expense', amount, category: cat, note: '' };
        }
    }

    return null;
}

module.exports = {
    addTransaction,
    updateLastTransaction,
    deleteLastTransaction,
    getDailySummary,
    getMonthlySummary,
    formatDailyReport,
    formatMonthlyReport,
    parseQuickFinance
};
