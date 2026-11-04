const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'urgent.json');

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ tasks: [] }, null, 2));
    }
}

function getTasks() {
    initDB();
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        return data.tasks || [];
    } catch (e) {
        return [];
    }
}

function saveTasks(tasks) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ tasks }, null, 2));
}

function addUrgentTask({ title, firstAlertISO, repeatIntervalMins }) {
    const list = getTasks();
    const interval = Math.max(parseInt(repeatIntervalMins, 10) || 15, 2); // default 15 mins
    const item = {
        id: 'urg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: title || 'জরুরি কাজ / পরীক্ষা',
        firstAlertISO: firstAlertISO,
        nextAlertISO: firstAlertISO,
        repeatIntervalMins: interval,
        alertCount: 0,
        status: 'active', // active or confirmed
        createdAt: new Date().toISOString()
    };
    list.push(item);
    saveTasks(list);
    return item;
}

function confirmUrgentTask(query) {
    const list = getTasks();
    const activeTasks = list.filter(t => t.status === 'active');
    if (activeTasks.length === 0) return null;

    // If query provided, try matching by keyword or id
    if (query && query.trim() !== 'done' && query.trim() !== 'শেষ' && query.trim() !== 'completed') {
        const clean = query.toLowerCase().trim();
        const found = activeTasks.find(t => t.id === clean || t.title.toLowerCase().includes(clean));
        if (found) {
            found.status = 'confirmed';
            found.confirmedAt = new Date().toISOString();
            saveTasks(list);
            return found;
        }
    }

    // Otherwise confirm the oldest active task
    const target = activeTasks[0];
    target.status = 'confirmed';
    target.confirmedAt = new Date().toISOString();
    saveTasks(list);
    return target;
}

function getDueTasks() {
    const list = getTasks();
    const now = Date.now();
    const due = [];

    list.forEach(t => {
        if (t.status === 'active' && new Date(t.nextAlertISO).getTime() <= now) {
            due.push(t);
            t.alertCount = (t.alertCount || 0) + 1;
            // Schedule next nag in repeatIntervalMins
            t.nextAlertISO = new Date(now + t.repeatIntervalMins * 60 * 1000).toISOString();
        }
    });

    if (due.length > 0) {
        saveTasks(list);
    }
    return due;
}

function getActiveTasks() {
    return getTasks().filter(t => t.status === 'active');
}

module.exports = {
    addUrgentTask,
    confirmUrgentTask,
    getDueTasks,
    getActiveTasks
};
